package middleware

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/gofiber/fiber/v2"
	"io"
	"net/http/httptest"
)

func TestValidatePath(t *testing.T) {
	root, _ := filepath.Abs("/safe/root")
	rootWithSep := root + string(os.PathSeparator)

	cases := []struct {
		name    string
		path    string
		wantErr bool
	}{
		{"inside", filepath.Join(root, "sub", "a.png"), false},
		{"exact root", root, false},
		{"relative", "sub/a.png", true},
		{"escape", filepath.Join(root, "..", "evil.png"), true},
		{"prefix-attack", "/safe/root-other/x.png", true},
		{"empty", "", true},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := validatePath(root, rootWithSep, c.path)
			if (err != nil) != c.wantErr {
				t.Fatalf("path=%q err=%v wantErr=%v", c.path, err, c.wantErr)
			}
		})
	}
}

func TestOpenInOS_Empty(t *testing.T) {
	if err := OpenInOS(""); err == nil {
		t.Fatal("want error for empty path")
	}
}

func TestOpenInOS_NotExist(t *testing.T) {
	if err := OpenInOS("/this/path/does/not/exist/zzz"); err == nil {
		t.Fatal("want error for missing path")
	}
}

// 跳过需要图形界面的真实打开调用（CI/headless 环境）。
func TestOpenInOS_SkipReal(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("不实际启动 explorer")
	}
}

// 验证中间件可以通过 SetRoot 热更新根路径，无需重启 Fiber app。
func TestPathSafetyMiddleware_HotReload(t *testing.T) {
	dir1 := t.TempDir()
	dir2 := t.TempDir()
	abs1, _ := filepath.Abs(dir1)
	abs2, _ := filepath.Abs(dir2)

	mw, state := PathSafetyMiddleware(abs1)
	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Use(mw)
	app.Get("/x", func(c *fiber.Ctx) error {
		return c.SendString("ok")
	})

	// 第一次：dir2 下的路径应被拒绝
	res, _ := app.Test(httptest.NewRequest("GET", "/x?path="+filepath.Join(abs2, "a.png"), nil), -1)
	if res.StatusCode != 400 {
		t.Fatalf("dir2 path should be rejected, got %d", res.StatusCode)
	}

	// 热更新根到 dir2
	state.SetRoot(abs2)

	// 再次请求同一 URL：现在应通过（中间件不返回 400），但 handler 仍可能报错或成功
	// 我们用 path safety 的 400 状态作为指示器
	res2, _ := app.Test(httptest.NewRequest("GET", "/x?path="+filepath.Join(abs2, "a.png"), nil), -1)
	if res2.StatusCode == 400 {
		t.Fatalf("dir2 path should pass after hot reload, got %d", res2.StatusCode)
	}
	// dir1 的旧路径现在应被拒绝
	res3, _ := app.Test(httptest.NewRequest("GET", "/x?path="+filepath.Join(abs1, "a.png"), nil), -1)
	if res3.StatusCode != 400 {
		t.Fatalf("dir1 path should now be rejected, got %d", res3.StatusCode)
	}
	// sanity: io 引用
	_ = io.Discard
}