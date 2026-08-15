# Backend - Go + Fiber

漫画阅读器后端服务。

## 启动

```bash
cd backend
go mod tidy
# 1. 复制示例配置
cp config.example.yaml config.yaml
# 2. 编辑 config.yaml，设置 comicRoot
# 3. 启动
go run ./cmd/server
```

后端从 `./config.yaml`（相对启动 CWD）加载配置；不存在则用内置默认值。未配置 `cacheDir` 时自动在 CWD 下创建 `.comic-reader/` 用于缩略图、扫描结果、用户偏好。

可用 flag：

- `--config <path>`：指向其他位置的配置文件（默认 `config.yaml`）
- `--static-dir <dir>`：覆盖 `staticDir` 字段（生产部署前端产物路径）

**不再支持环境变量或 `--comic-root` 等覆盖**，所有配置集中在 `config.yaml`。

## 测试

```bash
go test ./...
```

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 + 配置信息 |

完整 API 文档见 [docs/API.md](../docs/API.md)（T15 阶段定稿）。

## 配置

| 来源 | 示例 |
|------|------|
| YAML | `backend/config.yaml` |
| Default | 内置（缓存目录自动创建 `./.comic-reader/`） |

完整字段与默认值见 `config.example.yaml`。