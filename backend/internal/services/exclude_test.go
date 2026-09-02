package services

import (
	"testing"
)

// 故意分多个 t.Run 让失败时定位更准。
func TestExcludeConfig_ShouldSkipDir(t *testing.T) {
	t.Run("default skips hidden dirs", func(t *testing.T) {
		e := DefaultExclude()
		for _, name := range []string{".git", ".cache", ".DS_Store", ".vscode"} {
			if !e.ShouldSkipDir(name) {
				t.Errorf("expected default to skip %q", name)
			}
		}
	})
	t.Run("default does not skip visible dirs", func(t *testing.T) {
		e := DefaultExclude()
		for _, name := range []string{"photos", "vacation", "2024-01-01", "vol 1"} {
			if e.ShouldSkipDir(name) {
				t.Errorf("default should not skip %q", name)
			}
		}
	})
	t.Run("skipHidden=false keeps hidden dirs", func(t *testing.T) {
		e := DefaultExclude()
		e.SkipHidden = false
		// .DS_Store 是文件白名单(始终跳过);目录的 .xxx 应保留
		if e.ShouldSkipDir(".git") {
			t.Error("SkipHidden=false should keep .git")
		}
	})
	t.Run("user pattern matches at basename", func(t *testing.T) {
		e := NormalizeExcludeConfig(true, nil, []string{"node_modules", "dist", "build*"})
		if !e.ShouldSkipDir("node_modules") {
			t.Error("expected to skip node_modules")
		}
		if !e.ShouldSkipDir("dist") {
			t.Error("expected to skip dist")
		}
		if !e.ShouldSkipDir("build-output") {
			t.Error("expected to skip build-output (build* glob)")
		}
		if e.ShouldSkipDir("source") {
			t.Error("source should not be skipped")
		}
	})
	t.Run("patterns are case-insensitive", func(t *testing.T) {
		e := NormalizeExcludeConfig(true, nil, []string{"Node_Modules"})
		if !e.ShouldSkipDir("node_modules") {
			t.Error("expected case-insensitive match for node_modules")
		}
		if !e.ShouldSkipDir("NODE_MODULES") {
			t.Error("expected case-insensitive match for NODE_MODULES")
		}
	})
	t.Run("patterns trim whitespace and dedupe", func(t *testing.T) {
		e := NormalizeExcludeConfig(true, nil, []string{"  node_modules  ", "", "node_modules", "  "})
		if len(e.Patterns) != 1 {
			t.Errorf("expected 1 deduped pattern, got %d (%v)", len(e.Patterns), e.Patterns)
		}
		if !e.ShouldSkipDir("node_modules") {
			t.Error("expected trimmed pattern to still match")
		}
	})
	t.Run("invalid pattern does not crash", func(t *testing.T) {
		// [ 是非法 glob;filepath.Match 会返回 ErrBadPattern
		e := NormalizeExcludeConfig(true, nil, []string{"[invalid", "real_pattern"})
		// 不应 panic,「real_pattern」仍生效
		if !e.ShouldSkipDir("real_pattern") {
			t.Error("valid pattern should still work even if invalid pattern exists")
		}
		if e.ShouldSkipDir("") {
			t.Error("empty name should not match")
		}
	})
}

func TestExcludeConfig_ShouldSkipFile(t *testing.T) {
	t.Run("system files always skipped regardless of SkipHidden", func(t *testing.T) {
		e := DefaultExclude()
		e.SkipHidden = false
		// 强制白名单永远命中
		for _, name := range []string{"Thumbs.db", "thumbs.db", "DESKTOP.INI", ".DS_Store"} {
			if !e.ShouldSkipFile(name) {
				t.Errorf("expected system file %q to be skipped", name)
			}
		}
	})
	t.Run("user file pattern also applies", func(t *testing.T) {
		e := NormalizeExcludeConfig(true, nil, []string{"*.tmp", "~$*"})
		if !e.ShouldSkipFile("foo.tmp") {
			t.Error("expected foo.tmp to match *.tmp")
		}
		if !e.ShouldSkipFile("~$lockfile.docx") {
			t.Error("expected ~$lockfile.docx to match ~$*")
		}
		if e.ShouldSkipFile("foo.jpg") {
			t.Error("foo.jpg should not be skipped")
		}
	})
	t.Run("user-supplied system files merge with default", func(t *testing.T) {
		e := NormalizeExcludeConfig(true, []string{".Spotlight-V100"}, nil)
		if !e.ShouldSkipFile(".Spotlight-V100") {
			t.Error("custom system file should be added")
		}
		if !e.ShouldSkipFile("Thumbs.db") {
			t.Error("built-in system file should still be in default list")
		}
	})
}

func TestNormalizeExcludeConfig_PatternSort(t *testing.T) {
	// 短模式优先,避免 "a*" 在 "ab" 之前就匹配掉更长名字
	e := NormalizeExcludeConfig(true, nil, []string{"*", "node_modules", "node_*"})
	if e.Patterns[0] != "*" {
		// filepath.Match("*", "anything") == true,所以 "*" 必须放第一个就命中
		// 实际顺序就是短优先 + 字典序;不强制 "*" 在最前,但要可重现
		t.Logf("sorted: %v", e.Patterns)
	}
	// 至少要保证同一长度内字典序
	for i := 1; i < len(e.Patterns); i++ {
		li, lj := len(e.Patterns[i-1]), len(e.Patterns[i])
		if li == lj && e.Patterns[i-1] > e.Patterns[i] {
			t.Errorf("not sorted: %v", e.Patterns)
		}
	}
}

// TestExcludeConfig_Precompiled 验证 normalize 时一次性预编译 patterns,
// 而非每次 matchAnyPattern 临时计算。
//
// 行为:NormalizeExcludeConfig 后 len(e.compiled) == len(e.Patterns),
// 每条 compiledPattern 的 lower 字段 == strings.ToLower(原 pattern),
// isGlob 反映是否含 * ? [ 元字符。
func TestExcludeConfig_Precompiled(t *testing.T) {
	e := NormalizeExcludeConfig(true, nil, []string{
		"node_modules",  // 字面量
		".DS_Store",     // 字面量
		"thumb.*",       // glob
		"[A-Z]*.tmp",    // glob(字符类)
		"  ",            // 去空
		"node_modules",  // 重复(去重)
	})
	if len(e.compiled) != 4 {
		t.Fatalf("expected 4 unique patterns, got %d (raw=%v)", len(e.compiled), e.Patterns)
	}
	wantGlob := map[string]bool{
		"node_modules": false,
		".DS_Store":    false,
		"thumb.*":      true,
		"[A-Z]*.tmp":   true,
	}
	for _, c := range e.compiled {
		want, ok := wantGlob[c.pattern]
		if !ok {
			t.Errorf("unexpected compiled pattern: %q", c.pattern)
			continue
		}
		if c.isGlob != want {
			t.Errorf("%q: isGlob=%v want %v", c.pattern, c.isGlob, want)
		}
		wantLower := ""
		for _, r := range c.pattern {
			if r >= 'A' && r <= 'Z' {
				wantLower += string(r + 32)
			} else {
				wantLower += string(r)
			}
		}
		if c.lower != wantLower {
			t.Errorf("%q: lower=%q want %q", c.pattern, c.lower, wantLower)
		}
	}
}
