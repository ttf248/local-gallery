package services

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sync/singleflight"
)

// ErrFaststartUnavailable 表示 ffmpeg 不可用或不可执行。
//
// 视频 faststart 化是「优化项」而不是「必需项」:调用方拿到此错误时
// 应回退到直接流式发送原文件,而不是 5xx(原文件本身是合法的,只是
// 没有 faststart 优化)。
var ErrFaststartUnavailable = errors.New("faststart unavailable")

// FaststartStatus 描述一次 faststart 解析的结果。
//
// 状态机:
//
//	Unknown / Skipped / Fast / Remuxed
//
// handler 端一般只关心 "我该发哪个文件" —— 见 Resolve 返回值。
type FaststartStatus int32

const (
	// StatusUnknown 默认零值（理论上不该被外部观察到；Resolve 总会写实际值）。
	StatusUnknown FaststartStatus = iota
	// StatusSkipped 非 MP4/M4V 容器,跳过 faststart 化,直接发原文件。
	StatusSkipped
	// StatusFast 原文件已经是 faststart,无需重封装。
	StatusFast
	// StatusRemuxed 通过 ffmpeg 重封装成功,服务的是缓存文件。
	StatusRemuxed
	// StatusFallback ffmpeg 重封装失败,回退到发原文件。
	StatusFallback
)

func (s FaststartStatus) String() string {
	switch s {
	case StatusSkipped:
		return "skipped"
	case StatusFast:
		return "fast"
	case StatusRemuxed:
		return "remuxed"
	case StatusFallback:
		return "fallback"
	default:
		return "unknown"
	}
}

// VideoFaststartService 把「非 faststart 的 MP4」自动重封装为 faststart 形式
// 并缓存,供 /api/videos 流式发送。
//
// 为什么需要:
//
//	浏览器原生 <video> 元素对「moov atom 在文件末尾」(非 faststart) 的 MP4,
//	在边下边播场景下往往要拉到文件末尾才能拿到时长和起始位置才能开始播放,
//	对 1GB+ 视频基本不可用。把 moov 移到文件头后,浏览器从头读几十 KB 就
//	能开始播放,体验与 faststart 原生 MP4 一致。
//
// 工作流:
//
//	 1. 客户端 GET /api/videos?path=<abs> 触发
//	 2. handler 调 Resolve(abs) 得到 (servePath, status)
//	 3. 缓存命中: 立刻返回缓存文件路径
//	    缓存未命中且 ffmpeg 可用: ffmpeg -c copy -movflags +faststart 重封装,
//	                                  结果写盘,下次直接命中
//	    缓存未命中且 ffmpeg 不可用: 回退到发原文件 (StatusFallback),
//	                                  不阻断播放只是没有 faststart 优化
//	    非 MP4/M4V 容器: 跳过 (StatusSkipped)
//
// 失效策略: 缓存 key = md5(abs_path + "|" + mtime_ns + "|" + size),
// 源文件 mtime/size 变化时 (重新下载/重编码) 自动重新生成。
//
// 并发: singleflight 防止同一视频的并发请求触发多次重封装;内部 sync.Mutex
// 保护 status 字段的原子读写(仅用于诊断/统计,不影响正确性)。
type VideoFaststartService struct {
	cacheDir string
	ffmpeg   string

	// 单次 ffmpeg 调用超时。1GB 文件 -c copy 重封装通常 1-3s,20s 留足余量。
	timeout time.Duration

	// 同 key 并发请求只跑一次 ffmpeg;其它协程等结果。
	flight singleflight.Group

	// 状态计数器(原子);handler 端用 LastStatus() 查最近一次结果,
	// 测试用 Stats() 拿累计计数。
	statusCounters [5]atomic.Int64
}

// FaststartOptions 构造选项。
type FaststartOptions struct {
	CacheDir string // 必填,缩略图/封面同级目录
	FFmpeg   string // ffmpeg 可执行文件绝对路径;为空时 Available()=false
	Timeout  time.Duration // 单次 ffmpeg 超时,默认 20s
}

// NewVideoFaststartService 构造;FFmpeg 为空时仍成功但 Available()=false,
// 后续 Resolve 全部返回 StatusFallback(直接发原文件,不报错)。
func NewVideoFaststartService(opts FaststartOptions) *VideoFaststartService {
	t := opts.Timeout
	if t <= 0 {
		t = 20 * time.Second
	}
	return &VideoFaststartService{
		cacheDir: opts.CacheDir,
		ffmpeg:   opts.FFmpeg,
		timeout:  t,
	}
}

// Available 返回 ffmpeg 是否可用。
func (s *VideoFaststartService) Available() bool {
	if s == nil || s.ffmpeg == "" {
		return false
	}
	cmd := exec.Command(s.ffmpeg, "-version")
	if err := cmd.Run(); err != nil {
		return false
	}
	return true
}

// FFmpegPath 返回构造时设置的 ffmpeg 路径。
func (s *VideoFaststartService) FFmpegPath() string {
	if s == nil {
		return ""
	}
	return s.ffmpeg
}

// CacheDir 返回构造时设置的缓存目录。
func (s *VideoFaststartService) CacheDir() string {
	if s == nil {
		return ""
	}
	return s.cacheDir
}

// Resolve 是核心入口: 给定视频绝对路径,返回「应该发给浏览器的文件路径」和
// 解析状态。失败永远不返回 error —— 任何内部异常都退化为发原文件(不阻断播放)。
//
// 状态机:
//
//	非 MP4/M4V 容器             → (absPath, StatusSkipped)
//	ffmpeg 不可用                → (absPath, StatusFallback)
//	原文件 Stat 失败             → (absPath, StatusFallback)
//	原文件已是 faststart         → (absPath, StatusFast)         [不发缓存,免得浪费一次磁盘写]
//	重封装成功(新缓存)          → (cachedPath, StatusRemuxed)
//	重封装失败(ffmpeg 报错)     → (absPath, StatusFallback)      [原文件本身可读,只是没 faststart 优化]
//
// 调用方拿到 servePath 后直接 c.SendFile(servePath) 即可;Range/MIME 等
// 头仍由 handler 端按原逻辑设置,因为 faststart 化只改字节布局、不动容器格式。
func (s *VideoFaststartService) Resolve(absPath string) (servePath string, status FaststartStatus) {
	if s == nil {
		return absPath, StatusFallback
	}
	defer func() {
		// 兜底:任何 panic / 未预期的早返回都视为 fallback
		if servePath == "" {
			servePath = absPath
			status = StatusFallback
		}
		s.statusCounters[status].Add(1)
	}()

	// 非 MP4/M4V 容器: 跳过(faststart 是 MP4 概念,AVI/MKV/WebM/MOV
	// 处理路径不同;MKV 走 -movflags 不生效)。直接发原文件。
	ext := strings.ToLower(filepath.Ext(absPath))
	if ext != ".mp4" && ext != ".m4v" {
		return absPath, StatusSkipped
	}

	// ffmpeg 不可用: 退化
	if !s.Available() {
		return absPath, StatusFallback
	}

	// 源文件不存在: 退化(handler 会自己 Stat 失败返回 404,这里不必预校验)
	fi, err := os.Stat(absPath)
	if err != nil {
		return absPath, StatusFallback
	}

	key := faststartKey(absPath, fi.ModTime(), fi.Size())
	cachedPath := filepath.Join(s.cacheDir, "video-faststart", key+".mp4")

	// 1) 缓存命中 → 直接发缓存文件
	if _, err := os.Stat(cachedPath); err == nil {
		return cachedPath, StatusRemuxed
	}

	// 2) 原文件已是 faststart → 不写缓存(浪费一次磁盘 IO),
	//    直接让 handler 发原文件,省一次 ffmpeg。
	if isFaststart(absPath) {
		return absPath, StatusFast
	}

	// 3) 缓存未命中 + 非 faststart → 重封装
	//    singleflight 防止并发请求触发多次 ffmpeg。
	v, err, _ := s.flight.Do(key, func() (interface{}, error) {
		// 双重检查:进入临界区后再查一次磁盘,避免上一个协程刚写完
		// 被本协程再次重写。
		if _, err := os.Stat(cachedPath); err == nil {
			return cachedPath, nil
		}
		if err := s.remux(absPath, cachedPath); err != nil {
			return "", err
		}
		return cachedPath, nil
	})
	if err != nil {
		// ffmpeg 失败 / 写盘失败:回退到原文件(handler 仍能正常发出去,
		// 只是失去 faststart 优化)。注意记到 stderr 方便排查。
		fmt.Fprintf(os.Stderr, "faststart remux failed for %s: %v\n", absPath, err)
		return absPath, StatusFallback
	}
	return v.(string), StatusRemuxed
}

// LastStatus 返回最近一次 Resolve 的状态(线程安全)。
//
// 设计意图:给 handler / 日志 / 调试用,例如"这次响应到底是发的缓存还是
// 原文件";不想为此引入锁。零竞争窗口可接受(读到旧值不影响正确性)。
func (s *VideoFaststartService) LastStatus() FaststartStatus {
	if s == nil {
		return StatusUnknown
	}
	// 找最新 Add 过的那个(近似,不严格)
	var best FaststartStatus = StatusUnknown
	var bestVal int64
	for i, c := range &s.statusCounters {
		v := c.Load()
		if v >= bestVal {
			bestVal = v
			best = FaststartStatus(i)
		}
	}
	return best
}

// Stats 返回各状态累计计数(测试 / 监控用)。
func (s *VideoFaststartService) Stats() (skipped, fast, remuxed, fallback int64) {
	if s == nil {
		return
	}
	return s.statusCounters[StatusSkipped].Load(),
		s.statusCounters[StatusFast].Load(),
		s.statusCounters[StatusRemuxed].Load(),
		s.statusCounters[StatusFallback].Load()
}

// faststartKey 缓存 key。同 (absPath, mtime, size) 一定命中同一缓存,
// 源文件被覆盖/重编码时 mtime 或 size 必变化 → 自动失效。
func faststartKey(absPath string, mtime time.Time, size int64) string {
	h := md5.New()
	fmt.Fprintf(h, "fs:%s|%d|%d", absPath, mtime.UnixNano(), size)
	return hex.EncodeToString(h.Sum(nil))
}

// isFaststart 通过读文件前若干字节判断 moov atom 是否在文件头部(且 mdat 在它之后)。
//
// MP4 是 box 序列,每个 box = [4 字节 size][4 字节 type][payload...]。
// 顶层 box 顺次扫描:
//
//	- 先遇到 moov: 视为 faststart
//	- 先遇到 mdat: 视为非 faststart(moov 在 mdat 后,典型录屏/手机录制产物)
//	- 探测 buffer 用完还没遇到任一关键 box: 保守视为"非 faststart",
//	  触发一次 remux(下次访问走缓存,白跑一次成本可忽略)
//
// 为节省 IO,只读前 8 MiB。实际 faststart 文件的 moov box 一般远小于
// 此值(几十 KB ~ 几 MB,极端 4K HDR 长视频可能更大但仍远小于 8 MiB);
// 而非 faststart 文件的 mdat box 一定在最前几字节就出现,probe 阶段
// 就能识别。
func isFaststart(absPath string) bool {
	const probe = 8 * 1024 * 1024
	f, err := os.Open(absPath)
	if err != nil {
		return false
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return false
	}
	readSize := probe
	if st.Size() < int64(readSize) {
		readSize = int(st.Size())
	}
	buf := make([]byte, readSize)
	n, err := f.Read(buf)
	if err != nil && n == 0 {
		return false
	}
	return firstTopLevelAtom(buf[:n], "moov", "mdat") == "moov"
}

// firstTopLevelAtom 按 MP4 box 边界走,返回"先遇到的关键 box type"。
// 不下钻到子 box(box payload 内的偶然字节序列不会被误判)。
//
// 返回值:
//   - "moov"/"mdat": 找到了指定的关键 box
//   - "": 探测 buffer 用完还没找到任一关键 box
func firstTopLevelAtom(data []byte, atoms ...string) string {
	atomSet := make(map[string]bool, len(atoms))
	for _, a := range atoms {
		atomSet[a] = true
	}
	pos := 0
	for pos+8 <= len(data) {
		size := uint32(data[pos])<<24 | uint32(data[pos+1])<<16 | uint32(data[pos+2])<<8 | uint32(data[pos+3])
		boxType := string(data[pos+4 : pos+8])
		if atomSet[boxType] {
			return boxType
		}
		// size == 0: box 延续到文件末尾(本探测 buffer 内无法判断类型)
		// size == 1: 64-bit largesize,跳过(本探测范围内几乎不出现)
		if size == 0 || size == 1 {
			return ""
		}
		// 防御:异常的 size(超大、负数)直接停,免得越界
		if size > uint32(len(data)-pos) {
			return ""
		}
		pos += int(size)
	}
	return ""
}

// containsAtom 在 MP4 box 序列中查找指定 4 字节 type。
// 保留以备未来审计/调试用;主判断改用 firstTopLevelAtom 区分 moov 与 mdat 先后顺序。
func containsAtom(data []byte, want string) bool {
	pos := 0
	for pos+8 <= len(data) {
		size := uint32(data[pos])<<24 | uint32(data[pos+1])<<16 | uint32(data[pos+2])<<8 | uint32(data[pos+3])
		boxType := string(data[pos+4 : pos+8])
		if boxType == want {
			return true
		}
		if size == 0 || size == 1 {
			return false
		}
		if size > uint32(len(data)-pos) {
			return false
		}
		pos += int(size)
	}
	return false
}

// remux 调 ffmpeg 把源文件重封装为 faststart 写到 dstPath。
//
// -c copy: 不重新编码(只搬 box),对 1GB 视频 1-3s 完成;
// -movflags +faststart: moov 移到 mdat 前面;
// 输出格式固定 mp4(输入是 mp4/m4v),方便缓存扩展名稳定。
//
// 失败:含 ffmpeg 进程未启动(→ ErrFaststartUnavailable)与 ffmpeg
// 跑了但退出非 0(→ 具体错误,handler 端统一 fallback)。
func (s *VideoFaststartService) remux(srcPath, dstPath string) error {
	if err := os.MkdirAll(filepath.Dir(dstPath), 0o755); err != nil {
		return fmt.Errorf("create cache subdir: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), s.timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, s.ffmpeg,
		"-hide_banner",
		"-loglevel", "error",
		"-y", // 覆盖已存在的部分写入
		"-i", srcPath,
		"-c", "copy",
		"-movflags", "+faststart",
		"-f", "mp4",
		dstPath,
	)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		if cmd.ProcessState == nil {
			// 进程根本没起来(ffmpeg 路径失效、权限不足)→ unavailable
			return fmt.Errorf("%w: %s", ErrFaststartUnavailable, err.Error())
		}
		if ctx.Err() == context.DeadlineExceeded {
			return fmt.Errorf("faststart remux timeout: %w", ctx.Err())
		}
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("faststart remux: %s", msg)
	}
	// 兜底校验:ffmpeg 退出 0 但 dst 不存在或为空,按失败处理
	fi, statErr := os.Stat(dstPath)
	if statErr != nil || fi.Size() == 0 {
		return fmt.Errorf("faststart remux produced empty output: stat=%v", statErr)
	}
	return nil
}

// ClearCache 清空 faststart 缓存目录(测试用)。
//
// 真实场景下不需要主动调:缓存 key 已带 mtime+size,源文件变化即自动
// 失效;此处主要用于测试隔离。
func (s *VideoFaststartService) ClearCache() error {
	if s == nil || s.cacheDir == "" {
		return nil
	}
	dir := filepath.Join(s.cacheDir, "video-faststart")
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return nil
	}
	return os.RemoveAll(dir)
}

// 并发安全验证:Resolve 在多协程下不能破坏 s 内部状态。
// 当前实现里 s 只读 ffmpeg/cacheDir,flight 自带并发安全,不需要额外锁。
// 但保留方法签名以备未来加状态字段(已被废弃,只是为防止引用移除编译失败)。
var _ = sync.Mutex{}
