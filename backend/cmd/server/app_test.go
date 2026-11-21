package main

import (
	"io"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

// TestRouteParamsSurviveLaterRequests 验证路由参数不会在后续请求里变形。
//
// Fiber 默认让路由参数直接指向 fasthttp 的请求缓冲区，而那块缓冲区
// 会在同一条 keep-alive 连接的下一次请求里被原地覆写。handler 里存下
// 的参数于是变成下一条请求的路径 —— 写进磁盘的人工决定就跟着错了：
// 相似整理里表现为「刚标记的组又变回原样，撤销也恢复不到原状态」。
//
// 所以这里用真实的 keep-alive 连接连发两条请求，第二条的路径比第一���
// 长，正好盖住第一段标识留在缓冲区里的位置。
func TestRouteParamsSurviveLaterRequests(t *testing.T) {
	app := newFiberApp()
	kept := ""
	app.Put("/api/similarity/groups/:id", func(c *fiber.Ctx) error {
		kept = c.Params("id")
		return c.SendString("ok")
	})
	app.Get("/api/other/:name", func(c *fiber.Ctx) error {
		return c.SendString("other")
	})

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("监听失败：%v", err)
	}
	go func() { _ = app.Listener(listener) }()
	defer func() { _ = app.Shutdown() }()

	// 单条连接：两条请求必须落在同一条 keep-alive 连接上。
	client := &http.Client{
		Timeout:   5 * time.Second,
		Transport: &http.Transport{MaxIdleConns: 1, MaxIdleConnsPerHost: 1, MaxConnsPerHost: 1},
	}
	base := "http://" + listener.Addr().String()

	request, err := http.NewRequest(http.MethodPut, base+"/api/similarity/groups/exact-b369cf414b2d", nil)
	if err != nil {
		t.Fatalf("构造请求失败：%v", err)
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("第一条请求失败：%v", err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	_ = response.Body.Close()

	// 后续请求：路径都够长，正好盖住第一段标识留在缓冲区里的位置。
	// 多发几条：缓冲区容量够不够是浮动的，只要有一条盖住了就说明
	// 参数没被复制。
	for _, path := range []string{
		"/api/other/near-1bf4609778ef-xxxxxxxx",
		"/api/other/near-1bf4609778ef-xxxxxxxxxx",
		"/api/other/near-1bf4609778ef-xxxxxxxxxxx",
	} {
		response, err = client.Get(base + path)
		if err != nil {
			t.Fatalf("后续请求失败：%v", err)
		}
		_, _ = io.Copy(io.Discard, response.Body)
		_ = response.Body.Close()
		if kept != "exact-b369cf414b2d" {
			t.Fatalf("路由参数在后续请求里变形了：%q", kept)
		}
	}
}
