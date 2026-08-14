# Backend - Go + Fiber

漫画阅读器后端服务。

## 启动

```bash
go mod tidy
go run ./cmd/server --comic-root "E:\漫画"
```

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
| CLI | `--comic-root "E:\漫画"` |
| Env | `COMIC_ROOT=E:\漫画` |
| File | `config.json` |
| Default | `./comics` |

详见 `config.example.json`。
