# Comic Reader (Web)

> 漫画阅读器 · 浏览器即开即看

一个轻量的 Web 漫画阅读器。后端负责扫描本地漫画目录、生成缩略图、提供 HTTP API；前端用现代浏览器即可访问和阅读。

---

## � 特性

- 🌐 **纯浏览器访问** — 无需安装桌面客户端
- � **异步扫描** — SSE 实时进度推送，支持取消
- 🖼️ **缩略图缓存** — 磁盘缓存 + LRU，断网复用
- 🌗 **明暗主题** — 跟随系统或手动切换
- ⌨️ **完整快捷键** — Ctrl/方向键/F11 等桌面级操作
- 🎬 **幻灯片模式** — 自动翻页
- ⭐ **收藏 / 最近** — 跨设备持久化
- 📦 **单二进制部署** — Go 后端，无运行时依赖

---

## 🚀 快速开始

### 1. 准备漫画根目录

任意位置均可，例如 `E:\漫画`、`~/Pictures/comics`。

### 2. 启动后端

```bash
cd backend
go mod tidy
go run ./cmd/server --comic-root "E:\漫画"
# 或使用环境变量
COMIC_ROOT="E:\漫画" go run ./cmd/server
```

后端默认监听 `http://localhost:8080`，健康检查 `http://localhost:8080/api/health`。

### 3. 启动前端（开发模式）

```bash
cd frontend
npm install
npm run dev
```

打开浏览器访问 `http://localhost:5173`。

### 4. 生产部署（单端口）

```bash
cd frontend && npm run build      # 产物在 frontend/dist
cd ../backend && go build -o ../bin/server ./cmd/server
COMIC_ROOT=/path/to/comics ./bin/server
```

后端在同一端口（默认 8080）同时提供 API 与前端静态资源。

---

## ⚙️ 配置

漫画根目录支持 4 种来源（优先级从高到低）：

| 来源 | 示例 |
|------|------|
| 命令行参数 | `--comic-root "E:\漫画"` |
| 环境变量 | `COMIC_ROOT=E:\漫画` |
| 配置文件 | `backend/config.json` 字段 `comicRoot` |
| 默认值 | `./comics`（相对后端目录） |

完整配置项见 [`backend/config.example.json`](./backend/config.example.json) 或 [`.env.example`](./.env.example)。

---

## � 开发

| 操作 | 命令 |
|------|------|
| 启动后端 | `cd backend && go run ./cmd/server` |
| 启动前端 | `cd frontend && npm run dev` |
| 后端测试 | `cd backend && go test ./...` |
| 前端构建 | `cd frontend && npm run build` |
| 集成测试 | `cd backend && go test ./tests/integration -v` |
| 一键启动 | VSCode → 运行和调试 → 选择 "全栈: 后端 + 前端 (复合)" |

VSCode 调试配置见 `.vscode/launch.json`，包含 4 个调试入口 + 1 个复合调试。

---

## 📁 项目结构

```
.
├── backend/           # Go + Fiber 服务
├── frontend/          # React + Vite + TypeScript
├── docs/              # 架构、API、快捷键文档
├── scripts/           # dev/build/test 脚本
└── .vscode/           # VSCode 配置
```

详细结构见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

```
.
├── backend/                     # Go + Fiber 服务
│   ├── cmd/server/main.go       # 入口（flag/env/file 配置装配）
│   ├── internal/                # config / models / services / store / handlers / middleware
│   └── tests/integration/       # 端到端 HTTP 测试
├── frontend/                    # React 18 + Vite + TypeScript
│   └── src/                     # api/ hooks/ store/ routes/ components/ utils/
├── docs/                        # 架构、API、快捷键文档
├── scripts/                     # dev/build/test 脚本
└── .vscode/                     # VSCode 配置（launch/tasks/extensions）
```

---

## ⌨️ 快捷键

完整快捷键列表见 [docs/SHORTCUTS.md](./docs/SHORTCUTS.md)。

常用快捷键：

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+O` | 打开/切换漫画目录 |
| `Ctrl+S` | 启动扫描 |
| `F5` | 刷新 |
| `Ctrl+H` | 回到主页 |
| `Ctrl+D` | 我的收藏 |
| `←/→` | 翻页 |
| `+/-/0` | 缩放 |
| `R` | 旋转 |
| `Space` | 幻灯片 |
| `F11` | 全屏 |
| `?` / `Ctrl+/` | 快捷键帮助 |

---

## 📜 许可

仅供个人学习和非商业用途。
