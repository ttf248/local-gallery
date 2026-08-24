package services

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/disintegration/imaging"
)

// ErrFFmpegUnavailable 表示 ffmpeg 不可用（可执行文件不存在 / 路径为空 / 启动失败）。
//
// 调用方应回退到原"客户端抽帧 + 上传"流程(ErrVideoCoverMissing),而不是
// 直接 500。这是 FFmpeg 作为可选依赖的契约。
var ErrFFmpegUnavailable = errors.New("ffmpeg unavailable")

// VideoCoverExtractor 用 ffmpeg 在服务端抽一帧作为视频封面。
//
// 抽帧策略:取视频时长 10% 位置的一帧(夹到 1~3s,避免片头黑屏),缩放到
// 服务端缩略图尺寸(width × height,JPEG quality 85)。
//
// 与前端浏览器抽帧的差异:
//   - 不依赖浏览器加载整段视频(对 1GB+ 视频关键省时)
//   - 不消耗浏览器内存 / 不抢 video decoder
//   - 输出尺寸、格式、JPEG 质量都统一,UI 一致性更好
//
// 调用方约定:
//   - 视频文件必须存在且扩展名在 models.VideoExts 内
//   - 失败(ffmpeg 不可用 / 抽帧失败 / 编码失败)返回 ErrFFmpegUnavailable
//     或具体错误;调用方决定是否回退到客户端流程
type VideoCoverExtractor struct {
	ffmpegPath  string
	ffprobePath string
	width       int
	height      int
	quality     int

	// 抽帧位置(秒):取 max(1, min(3, duration*0.1))。
	// 跟前端 useVideoCover 的 SEEK_MIN/SEEK_MAX/SEEK_RATIO 保持一致,
	// 这样 ffmpeg 抽出来的图与浏览器抽出来的"看起来是同一帧",不影响
	// 视觉连续性 / 测试断言。
	seekMin   float64
	seekMax   float64
	seekRatio float64

	// 单次 ffmpeg 调用超时(防止某次抽帧卡死)。10s 对 4K 文件也够:
	// 4K H.264 seek 到 1~3s 抽一帧,典型 100~500ms。
	timeout time.Duration
}

// VideoCoverOptions 构造选项。
type VideoCoverOptions struct {
	FFmpegPath  string        // ffmpeg 可执行文件绝对路径(为空时 Available()=false)
	FFprobePath string        // ffprobe 可执行文件绝对路径(可空,默认从 ffmpeg 同目录推断)
	Width       int           // 输出宽度,默认 320
	Height      int           // 输出高度,默认 350
	Quality     int           // JPEG 质量 1-100,默认 85
	Timeout     time.Duration // 单次抽帧超时,默认 10s
}

// NewVideoCoverExtractor 构造;FFmpegPath 为空时构造仍成功但 Available()=false,
// 后续调用会一律返回 ErrFFmpegUnavailable(graceful degradation)。
func NewVideoCoverExtractor(opts VideoCoverOptions) *VideoCoverExtractor {
	w := opts.Width
	if w <= 0 {
		w = 320
	}
	h := opts.Height
	if h <= 0 {
		h = 350
	}
	q := opts.Quality
	if q <= 0 {
		q = jpegQuality
	}
	t := opts.Timeout
	if t <= 0 {
		t = 10 * time.Second
	}
	ffprobe := opts.FFprobePath
	if ffprobe == "" && opts.FFmpegPath != "" {
		// 默认 ffprobe 在 ffmpeg 同目录(同扩展名:windows 走 .exe)
		dir := filepath.Dir(opts.FFmpegPath)
		base := "ffprobe"
		if strings.HasSuffix(strings.ToLower(opts.FFmpegPath), ".exe") {
			base = "ffprobe.exe"
		}
		ffprobe = filepath.Join(dir, base)
	}
	return &VideoCoverExtractor{
		ffmpegPath:  opts.FFmpegPath,
		ffprobePath: ffprobe,
		width:       w,
		height:      h,
		quality:     q,
		seekMin:     1.0,
		seekMax:     3.0,
		seekRatio:   0.1,
		timeout:     t,
	}
}

// Available 返回 ffmpeg 是否可用(用 -version 探一次)。
// 失败/不可执行时返回 false,调用方应回退到客户端流程。
func (e *VideoCoverExtractor) Available() bool {
	if e == nil || e.ffmpegPath == "" {
		return false
	}
	cmd := exec.Command(e.ffmpegPath, "-version")
	if err := cmd.Run(); err != nil {
		return false
	}
	return true
}

// FFmpegAvailableAt 静态辅助:不构造 extractor 也探测 ffmpeg 是否可用。
// 用于 handlers/config.go 在 GET /api/config 时回填 ffmpegAvailable 字段。
func FFmpegAvailableAt(ffmpegPath string) bool {
	if ffmpegPath == "" {
		return false
	}
	cmd := exec.Command(ffmpegPath, "-version")
	if err := cmd.Run(); err != nil {
		return false
	}
	return true
}

// FFmpegPath 返回构造时设置的 ffmpeg 路径(供日志 / 调试用)。
func (e *VideoCoverExtractor) FFmpegPath() string {
	if e == nil {
		return ""
	}
	return e.ffmpegPath
}

// FFprobePath 返回 ffprobe 路径(供 Probe 使用)。
func (e *VideoCoverExtractor) FFprobePath() string {
	if e == nil {
		return ""
	}
	return e.ffprobePath
}

// probeDuration 读视频时长(秒)。读不到时返回 0(让调用方按 fallback 取 seek=1s)。
//
// 优先用 ffprobe(快、只读 metadata),ffprobe 不在 / 失败时回退到
// ffmpeg -i 解析 stdout。
func (e *VideoCoverExtractor) probeDuration(ctx context.Context, absPath string) (float64, error) {
	if e.ffprobePath != "" {
		if d, err := e.probeDurationViaFFprobe(ctx, absPath); err == nil && d > 0 {
			return d, nil
		}
	}
	if e.ffmpegPath == "" {
		return 0, errors.New("no ffmpeg/ffprobe path")
	}
	return e.probeDurationViaFFmpeg(ctx, absPath)
}

func (e *VideoCoverExtractor) probeDurationViaFFprobe(ctx context.Context, absPath string) (float64, error) {
	cmd := exec.CommandContext(ctx, e.ffprobePath,
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		absPath,
	)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return 0, err
	}
	s := strings.TrimSpace(out.String())
	if s == "" || s == "N/A" {
		return 0, errors.New("empty duration")
	}
	var d float64
	if _, err := fmt.Sscanf(s, "%f", &d); err != nil || d <= 0 {
		return 0, errors.New("parse duration: " + s)
	}
	return d, nil
}

func (e *VideoCoverExtractor) probeDurationViaFFmpeg(ctx context.Context, absPath string) (float64, error) {
	cmd := exec.CommandContext(ctx, e.ffmpegPath, "-i", absPath)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	// ffmpeg -i 没有输出文件时 exit code = 1,但 stderr 仍包含 metadata
	_ = cmd.Run()
	idx := strings.Index(out.String(), "Duration:")
	if idx < 0 {
		return 0, errors.New("duration not found in ffmpeg output")
	}
	rest := out.String()[idx+len("Duration:"):]
	if c := strings.Index(rest, ","); c > 0 {
		rest = rest[:c]
	}
	rest = strings.TrimSpace(rest)
	var h, m, s float64
	if _, err := fmt.Sscanf(rest, "%f:%f:%f", &h, &m, &s); err != nil {
		return 0, fmt.Errorf("parse duration: %q", rest)
	}
	return h*3600 + m*60 + s, nil
}

// Extract 在服务端抽一帧作为视频封面,返回 JPEG 字节(已按 Width/Height 缩放)。
//
// 失败(ffmpeg 不可用 / 视频解码失败 / ffmpeg 进程超时)返回错误。
// 调用方应:
//   - 接 ErrFFmpegUnavailable → 完全回退到客户端流程(原 ErrVideoCoverMissing)
//   - 其它错误 → 也回退(容错优先,视频文件损坏时不应 500)
func (e *VideoCoverExtractor) Extract(absPath string) ([]byte, error) {
	if e == nil || e.ffmpegPath == "" {
		return nil, ErrFFmpegUnavailable
	}
	ctx, cancel := context.WithTimeout(context.Background(), e.timeout)
	defer cancel()

	// 1) 拿时长,计算 seek 位置
	seek := 1.0
	if d, derr := e.probeDuration(ctx, absPath); derr == nil && d > 0 {
		seek = d * e.seekRatio
		if seek < e.seekMin {
			seek = e.seekMin
		}
		if seek > e.seekMax {
			seek = e.seekMax
		}
	}

	// 2) 抽帧到 stdout
	//
	// -ss 在 -i 之前:fast seek(只解码到目标位置),对长视频关键。
	// -frames:v 1:只要一帧就退出。
	// scale + pad:保持比例 letterbox 到目标尺寸,跟 imaging.Fit 行为一致。
	// image2pipe + mjpeg:把 JPEG 字节直接写到 stdout,免去落盘再读。
	filter := fmt.Sprintf(
		"scale=w=%d:h=%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2:black",
		e.width, e.height, e.width, e.height,
	)
	cmd := exec.CommandContext(ctx, e.ffmpegPath,
		"-hide_banner",
		"-loglevel", "error",
		"-ss", fmt.Sprintf("%.3f", seek),
		"-i", absPath,
		"-frames:v", "1",
		"-vf", filter,
		"-q:v", fmt.Sprintf("%d", e.jpegQualityToFfmpeg(e.quality)),
		"-f", "image2pipe",
		"-vcodec", "mjpeg",
		"-",
	)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		// 关键判定:进程没启动 vs 进程跑了但失败。
		// - cmd.ProcessState == nil  → 进程根本没起来(可执行文件找不到 / 没权限)
		//   → ErrFFmpegUnavailable(ffmpeg 这条路不可用,callers 回退)
		// - cmd.ProcessState != nil  → 进程跑了,exit code != 0
		//   → ffmpeg 自身报错(视频文件损坏 / 编码不支持 / 输入文件不存在等)
		//   → 返回具体错误(让上层决定:timeout 时回退,其它也回退,记日志)
		if cmd.ProcessState == nil {
			return nil, fmt.Errorf("%w: %s", ErrFFmpegUnavailable, err.Error())
		}
		if ctx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("ffmpeg timeout: %w", ctx.Err())
		}
		errStr := strings.TrimSpace(stderr.String())
		if errStr == "" {
			errStr = err.Error()
		}
		return nil, fmt.Errorf("ffmpeg extract: %s", errStr)
	}
	out := stdout.Bytes()
	if len(out) == 0 {
		return nil, errors.New("ffmpeg produced empty output")
	}
	// 兜底:ffmpeg 抽出来的图有可能不是 1:1 精确尺寸(参数解析 round),
	// 强制过一遍 imaging 走标准化 resize,保证 UI 看到的就是 Width×Height。
	img, err := jpeg.Decode(bytes.NewReader(out))
	if err != nil {
		// 也可能是 PNG(罕见);用 image.Decode 兜底
		img, _, err = image.Decode(bytes.NewReader(out))
		if err != nil {
			return nil, fmt.Errorf("decode ffmpeg output: %w", err)
		}
	}
	thumb := imaging.Fit(img, e.width, e.height, imaging.Lanczos)
	return encodeJPEG(thumb, e.quality)
}

// jpegQualityToFfmpeg 把 libjpeg 的 1-100 映射到 ffmpeg -q:v(2-31, 越小越好)。
//
// 360p 缩略图体积不是关键,统一给高质量档(2-3)即可。
func (e *VideoCoverExtractor) jpegQualityToFfmpeg(q int) int {
	switch {
	case q >= 90:
		return 1
	case q >= 80:
		return 2
	case q >= 70:
		return 3
	case q >= 60:
		return 4
	default:
		return 5
	}
}
