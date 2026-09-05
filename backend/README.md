# Backend · Go + Fiber

> 本地画廊（Local Gallery）的 Go 后端。Fiber v2 路由，扫描 + 缩略图 + 视频管线 + 偏好持久化。

主文档见仓库根 [README.md](../README.md) / [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) / [docs/API.md](../docs/API.md)。本文件只写后端本地开发相关的速查。

---

## 启动

```bash
cd backend
go mod tidy
cp config.example.yaml config.yaml     # 编辑 mediaRoots 等
go run ./cmd/server                     # 默认 :8080
```

启动后访问 `http://localhost:8080/api/health` 健康检查。

可用 flag（仅一个）：

| flag              | 说明                                     |
| ----------------- | ---------------------------------------- |
| `--config <yaml>` | 非默认位置配置文件（默认 `config.yaml`） |

**不再支持环境变量或 CLI 覆盖**，所有运行时参数集中在 `config.yaml`。

---

## 目录

```
backend/
├── cmd/server/main.go            # 入口：flag + YAML + 服务装配
├── internal/
│   ├── config/                   # YAML 加载 + 校验 + 热更新
│   ├── models/                   # 领域模型
│   ├── services/                 # 业务（scanner / thumbnail / video_*）
│   ├── store/                    # JSON 原子写
│   ├── handlers/                 # Fiber 路由
│   └── middleware/               # logger / recover / path_safety
├── tests/integration/            # 端到端 HTTP 测试
├── config.example.yaml           # 配置样例
└── go.mod
```

---

## 测试

```bash
# 全部
go test ./...

# 仅集成测试（HTTP 端到端，app.Test）
go test ./tests/integration -v

# 跑单个测试
go test ./internal/services -run TestScanner -v
```

集成测试会构造真实 HTTP app，扫临时目录、断言响应 / SSE / 转码状态。

---

## 常用 API（速查）

完整契约见 [docs/API.md](../docs/API.md)。

| 类别   | 端点                                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------- |
| 健康   | `GET /api/health`                                                                                                     |
| 认证   | `GET/POST/DELETE /api/auth/session`（LAN 令牌换取 8 小时 HttpOnly 会话）                              |
| 扫描   | `POST /api/scans` · `GET /api/scans/:id/events` (SSE) · `GET/DELETE /api/scans/:id` · `GET/DELETE /api/library`       |
| 库     | `GET /api/library/manifest` · `GET /api/library/:id/children` · `GET /api/albums` · `GET /api/albums/:id/media` · `POST /api/library/nodes/query` · `GET /api/tags` |
| 缩略图 | `GET /api/thumbs/:id` · `POST /api/thumbs/:id/cover` · `POST /api/thumbs/cleanup`                                     |
| 媒体   | `GET /api/media/:id` · `GET /api/images/:id/info`                                                                     |
| 视频   | `GET /api/videos/:id/info` · `/api/videos/:id/transcode/{status,events,cancel}`                                       |
| 缓存   | `GET /api/cache/stats` · `POST /api/cache/clear?scope=thumbs|faststart|transcode|all`                                 |
| 用户状态 | `GET/PATCH /api/prefs` · `GET/POST/DELETE /api/favorites` · `GET/POST/DELETE /api/history` · `GET/PUT/DELETE /api/activity` |
| 系统   | `POST /api/fs/open` · `GET/PUT /api/config`（仅本机）                                                                 |

---

## 配置

完整字段与默认值见 [config.example.yaml](./config.example.yaml)。热生效字段参见 [docs/API.md §14](../docs/API.md#14-服务端配置)。
