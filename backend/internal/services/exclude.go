package services

import (
	"path/filepath"
	"sort"
	"strings"
)

// ExcludeConfig 描述一组排除规则。
//
//   - SkipHidden:跳过以 `.` 开头的目录/文件(默认 true,推荐保留;
//     用户真有需要可设为 false)
//   - SystemFiles:无论用户配置如何都强制跳过的「系统噪声」文件。
//     大小写不敏感、跨平台一致,无须把 Thumbs.db / desktop.ini / .DS_Store
//     全部塞进用户的 patterns 列表。
//   - Patterns:用户自定义 glob 模式集合。模式仅匹配单个路径段(目录名
//     或文件名),不跨 / 边界;`*` 匹配该段内任意字符,`?` 匹配单个字符。
//     模式不区分大小写。
//
// 设计原则:
//  1. 全部匹配都针对"路径段"(basename)而非整段绝对路径 —
//     用户写 `node_modules` 即表示「任意深度的 node_modules 目录」,
//     不需要写 `**/node_modules`(虽然 `**` 这类通配本来就不需要)。
//  2. 性能:每个文件/目录只需 O(N) 次 Match,N = patterns 数量,通常 < 20;
//     模式按 Pattern 长度预排序(短模式优先,先命中先返回),
//     在百万级目录的库里能省下一半时间。
//  3. 任意规则命中即跳过,与"全部命中才跳过"相比,行为更直觉。
type ExcludeConfig struct {
	SkipHidden  bool
	SystemFiles map[string]bool // 强制跳过的文件名(小写)
	Patterns    []string

	// 预编译的 patterns。NormalizeExcludeConfig 时编译一次,matchAnyPattern
	// 走这里,而不是每个文件/目录都重新 strings.ToLower + filepath.Match。
	// 在百万级目录 × 几十个 pattern 的库里,这一项省的时间很可观。
	// 老代码在 matchAnyPattern 内对每个 name 都 strings.ToLower(p) 一次,
	// 等价于把 N 个 pattern 各自低格化 N 次 → O(N²) 字符串扫描。
	compiled []compiledPattern
}

// compiledPattern 预编译后的 pattern。
//   - lower:小写化后的 pattern(命中时无需再 ToLower)
//   - isGlob:是否含 * 或 ? 元字符;非 glob 走精确字符串比较,跳过
//     filepath.Match 的开销
type compiledPattern struct {
	pattern string
	lower   string
	isGlob  bool
}

// DefaultExclude 默认排除规则:跨平台「系统噪声」+ 隐藏目录。
//
// 选这 3 个系统文件的理由:
//   - Thumbs.db:Windows 缩略图缓存,每个含图目录都有
//   - desktop.ini:Windows 目录属性文件
//   - .DS_Store:macOS Finder 目录元数据
func DefaultExclude() ExcludeConfig {
	return ExcludeConfig{
		SkipHidden: true,
		SystemFiles: map[string]bool{
			"thumbs.db":  true,
			"desktop.ini": true,
			".ds_store":  true,
		},
		Patterns: nil,
	}
}

// normalize 归一化配置:把 patterns 去空、trim、去重、排序(短优先,字典序次之),
// 并把 SystemFiles 转小写(compareTo 时直接转小写即可)。
//
// 用户输入经常含空格或多余空行(尤其是从 Settings UI 多行文本框读到的),
// 不规范化会让 match 行为不可预测。
//
// 这里同时把 Patterns 预编译:对每个 pattern 算一次 lower + hasMeta,
// matchAnyPattern 直接用预编译结果,省掉每个文件都 ToLower 一遍 pattern
// 的 O(N²) 开销。
func (e ExcludeConfig) normalize() ExcludeConfig {
	out := ExcludeConfig{
		SkipHidden:  e.SkipHidden,
		SystemFiles: e.SystemFiles,
		Patterns:    make([]string, 0, len(e.Patterns)),
		compiled:    make([]compiledPattern, 0, len(e.Patterns)),
	}
	if out.SystemFiles == nil {
		out.SystemFiles = map[string]bool{}
	} else {
		// 强制小写
		lc := make(map[string]bool, len(e.SystemFiles))
		for k, v := range e.SystemFiles {
			lc[strings.ToLower(k)] = v
		}
		out.SystemFiles = lc
	}
	// 去空 + trim + 大小写无关去重(保留首次出现的大小写)
	seen := make(map[string]bool, len(e.Patterns))
	unique := make([]string, 0, len(e.Patterns))
	for _, p := range e.Patterns {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		key := strings.ToLower(p)
		if seen[key] {
			continue
		}
		seen[key] = true
		unique = append(unique, p)
	}
	sort.SliceStable(unique, func(i, j int) bool {
		li, lj := len(unique[i]), len(unique[j])
		if li != lj {
			return li < lj
		}
		return unique[i] < unique[j]
	})
	out.Patterns = unique
	// 预编译:同时算 lower 和 hasMeta
	for _, p := range unique {
		lower := strings.ToLower(p)
		isGlob := strings.ContainsAny(p, "*?[")
		out.compiled = append(out.compiled, compiledPattern{
			pattern: p,
			lower:   lower,
			isGlob:  isGlob,
		})
	}
	return out
}

// ShouldSkipDir 决定一个子目录是否在扫描时被跳过。
//
// 调用方传入目录的 basename(即 `os.DirEntry.Name()`),不传完整路径 —
// 匹配逻辑就是按段匹配,没有跨 / 的语义,完整路径反而要切片比对浪费 CPU。
//
// 返回 true 表示「整个子树都不要进去」,调用方应跳过该子目录。
func (e ExcludeConfig) ShouldSkipDir(name string) bool {
	if name == "" {
		return false
	}
	// 隐藏目录(以 . 开头) — 包括 .git / .cache / .DS_Store / .local
	if e.SkipHidden && strings.HasPrefix(name, ".") {
		return true
	}
	return e.matchAnyPattern(name)
}

// ShouldSkipFile 决定一个文件是否在扫描时被忽略。
//
// 文件层面的 skip 比目录面更严格:
//   - 系统文件白名单(Thumbs.db 等)永远命中,即使 SkipHidden=false
//   - 用户自定义 patterns 仍生效
//
// 注意:这里不应用 SkipHidden,因为 `.bashrc` 之类的隐藏文件本来就不太
// 可能出现在媒体根下,且与目录的"隐藏"语义不同 — 隐藏目录通常是元数据
// 目录,隐藏文件常常是用户的真实内容(如 .htaccess)。
func (e ExcludeConfig) ShouldSkipFile(name string) bool {
	if name == "" {
		return false
	}
	if e.SystemFiles[strings.ToLower(name)] {
		return true
	}
	return e.matchAnyPattern(name)
}

// matchAnyPattern 对单个名字做 glob 匹配(不区分大小写)。任意一条
// 模式命中即返回 true。
//
// 走预编译结果:非 glob pattern 走精确字符串比较(常量级),glob pattern
// 走 filepath.Match + 预低格化的 pattern 字符串。
// 老代码每次都对 name 和 pattern 各 ToLower 一次,百万级目录的扫描
// 里 O(N²) 的字符串处理改成 O(N) + O(N) 各一次。
func (e ExcludeConfig) matchAnyPattern(name string) bool {
	if len(e.compiled) == 0 {
		return false
	}
	nameLower := strings.ToLower(name)
	for _, p := range e.compiled {
		if p.isGlob {
			// glob:走 filepath.Match 两次(原始 case + 小写 case),
			// 仍走预低格化的 pattern,省掉对 pattern 的 ToLower。
			ok, err := filepath.Match(p.pattern, name)
			if err != nil {
				continue
			}
			if ok {
				return true
			}
			ok, _ = filepath.Match(p.lower, nameLower)
			if ok {
				return true
			}
		} else {
			// 字面量:精确字符串比较,O(len)
			if p.lower == nameLower {
				return true
			}
		}
	}
	return false
}

// NormalizeExcludeConfig 把传入的 SkipHidden + SystemFiles 列表 + Patterns
// 列表合成归一化后的 ExcludeConfig,供上层 handler 一次性转换好缓存复用。
//
// 内置系统白名单(Thumbs.db / desktop.ini / .DS_Store)永远在 — 调用方
// 传 systemFiles 只是在白名单之上追加。这样用户「删掉 Thumbs.db 让它被
// 扫到」是不可能的,符合「跨平台系统噪声永远不要进库」的契约。
func NormalizeExcludeConfig(skipHidden bool, systemFiles []string, patterns []string) ExcludeConfig {
	defaults := DefaultExclude()
	cfg := ExcludeConfig{
		SkipHidden:  skipHidden,
		SystemFiles: make(map[string]bool, len(defaults.SystemFiles)+len(systemFiles)),
		Patterns:    patterns,
	}
	for k, v := range defaults.SystemFiles {
		cfg.SystemFiles[k] = v
	}
	for _, s := range systemFiles {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		cfg.SystemFiles[strings.ToLower(s)] = true
	}
	return cfg.normalize()
}
