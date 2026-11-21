package main

import (
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/httputil"
)

// newFiberApp 创建 HTTP 应用。
//
// Immutable 必须开着。Fiber 默认把路由参数、查询串直接指向 fasthttp 的
// 请求缓冲区，而那块缓冲区会在同一条 keep-alive 连接的下一次请求里被
// 覆写。写进磁盘的人工决定（相似整理的分组标识、相册规则、人物改名）
// 一旦这样「借」了地址，下一条请求就会把它变成别的字符串 —— 用户刚做
// 的决定会悄悄落到别的分组上，撤销也会恢复到错的地方。开启之后这些
// 值都会复制一份，代价只是每次请求多几次小分配。
func newFiberApp() *fiber.App {
	return fiber.New(fiber.Config{
		AppName:               "local-gallery",
		DisableStartupMessage: true,
		// Immutable：路由参数与查询串先复制再交给 handler。
		Immutable: true,
		// ShutdownWithTimeout 无法主动关闭 keep-alive 连接；设置读取和空闲
		// 超时，确保退出窗口有明确上界。SSE 不设置 WriteTimeout。
		ReadTimeout: 30 * time.Second,
		IdleTimeout: 60 * time.Second,
		// 备份导入允许 32 MiB 文件及 JSON 包装；封面和认证接口另有自身限制。
		BodyLimit: 64 * 1024 * 1024,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			if fe, ok := err.(*fiber.Error); ok {
				return httputil.Error(c, fe.Code, "http_error", fe.Message)
			}
			return httputil.Internal(c, "internal_error", "internal server error")
		},
	})
}
