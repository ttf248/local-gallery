# Backend · Go + Fiber

> 图像浏览器的 Go 后端。Fiber v2 路由，扫描 + 缩略图 + 视频管线 + 偏好持久化。

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

可用 flag（仅这两个）：

| flag | 说明 |
|------|------|
| `--config <yaml>` | 非默认位置配置文件（默认 `config.yaml`） |
| `--static-dir <dir>` | 覆盖 `staticDir`（生产单端口托管前端产物） |

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

| 类别 | 端点 |
|------|------|
| 健康 | `GET /api/health` |
| 扫描 | `POST /api/scan` · `POST /api/scan/start` · `GET /api/scan/:id/events` (SSE) · `GET /api/scan/latest` |
| 库 | `GET /api/folders` · `GET /api/tags` · `GET /api/search` |
| 缩略图 | `GET /api/thumbs` · `POST /api/thumbs/cover` · `GET /api/thumbs/stats` |
| 原图 | `GET /api/images` · `GET /api/images/info` |
| 视频 | `GET /api/videos` · `GET /api/videos/info` · `/api/videos/transcode/{status,events,cancel,cache/*}` |
| 偏好 | `GET/PATCH /api/prefs` · `GET/POST/DELETE /api/favorites` · `GET/POST/DELETE /api/history` · `GET/POST /api/progress` |
| 系统 | `GET /api/fs/open` · `GET/PUT /api/config` |

---

## 配置

完整字段与默认值见 [config.example.yaml](./config.example.yaml)。热生效字段参见 [docs/API.md §14](../docs/API.md#14-服务端配置)。
