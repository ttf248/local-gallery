# 图像浏览器 / Viewer

> 通用本地图像浏览器 · 浏览即开即看

一个轻量的 Web 应用：扫描本地图像目录、生成缩略图、提供 HTTP API；前端用现代浏览器即可访问和浏览。
漫画 / 同人志只是其中一个使用场景，应用本身对图像类型与目录结构保持中性。

---

## 特性

- 🌐 **纯浏览器访问** — 无需安装桌面客户端
- 🔄 **异步扫描** — SSE 实时进度推送，支持取消
- 🖼️ **缩略图缓存** — 磁盘缓存 + LRU，断网复用
- 🎞️ **视频支持** — 浏览器原生 `<video>` 播放 + 抽帧首帧做封面（不依赖 ffmpeg）
- 🌗 **明暗双主题 + 6 套强调色** — 跟随系统或手动切换；graphite / indigo / rose / forest / ochre / plum
- 🏷️ **标签页 / 智能合集** — `/tags/<标签名>` 一级路由，封面轮播 + 统计 + 收藏
- ⌨️ **完整快捷键** — Ctrl/方向键/F11 等桌面级操作；`?` 唤起可搜索帮助浮层
- 🪟 **三种显示模式** — 单张、连续滚动、双张并排（左右方向可切换）
- 🖼️ **四种图片适配** — 适应 / 按宽 / 按高 / 原始，按 `F` 循环
- 🎬 **幻灯片模式** — 自动翻页
- ⭐ **收藏 / 最近** — 跨设备持久化
- 🎨 **极简设计语言** — 米白 / 炭灰双底色，无衬线大标题 + 几何图标
- 📦 **单二进制部署** — Go 后端，无运行时依赖

---

## 🚀 快速开始

### 1. 准备图像根目录

任意位置均可，例如 `E:\帕鲁 Mod\归档\二次元`、`~/Pictures`。
目录结构无要求：可以是子目录各自装一组图片（每组一个"文件夹"），也可以是松散的散图。

### 2. 配置后端

```bash
cd backend
cp config.example.yaml config.yaml
# 编辑 config.yaml，至少设置 mediaRoots（数组，支持多个目录）
```

后端从 `./config.yaml`（相对启动 CWD）加载配置；不存在则用内置默认值。未配置 `cacheDir` 时自动在 CWD 下创建 `.image-viewer/`。

> 配置项 `mediaRoots` 是权威字段（数组）。旧名 `mediaRoot` / `comicRoot`（单数）仍可识别，视为单元素数组。`/api/health` 同时返回 `mediaRoots`（数组）和 `mediaRoot`（首元素），便于排查。多根扫描结果会合并到一个全局库，每个相册/集合带 `sourceRoot` / `sourceName` 标识来源，UI 卡片显示「来自 XXX」badge。

### 3. 启动后端

```bash
go run ./cmd/server
```

后端默认监听 `http://localhost:8080`，健康检查 `http://localhost:8080/api/health`。

可选 flag：

- `--config <path>`：指向其他位置的 YAML 配置文件
- `--static-dir <dir>`：覆盖 `staticDir` 字段（生产部署前端产物路径）

**不再支持环境变量或 `--media-root` 等覆盖**，所有运行时配置集中在 `config.yaml`。

### 4. 启动前端（开发模式）

```bash
cd ../frontend
npm install
npm run dev
```

打开浏览器访问 `http://localhost:5173`。

### 5. 生产部署（单端口）

```bash
cd frontend && npm run build      # 产物在 frontend/dist
cd ../backend && go build -o ../bin/server ./cmd/server
# 在 backend/config.yaml 中设置 mediaRoots 指向图像根目录（支持多个）
./bin/server
```

后端在同一端口（默认 8080）同时提供 API 与前端静态资源。

---

## ⚙️ 配置

图像根目录与所有运行时参数集中在 [`backend/config.yaml`](./backend/config.example.yaml)：

| 来源 | 示例 |
|------|------|
| YAML 配置文件 | `backend/config.yaml` 字段 `mediaRoots` 等 |
| 内置默认值 | `./images`（相对后端 CWD），缓存目录 `<CWD>/.image-viewer/` |
| 网页设置页 | `/settings` → 「服务端」section；改动自动写回 YAML（部分字段需重启） |

完整字段见 [`backend/config.example.yaml`](./backend/config.example.yaml)。
HTTP 接口详见 [`docs/API.md`](./docs/API.md) 中「配置项（服务端）」一节。

---

## 🛠 开发

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

---

## 🧩 可选依赖: ffmpeg

> **当前代码并不直接调用 ffmpeg**。视频封面由前端 `<video>` + `canvas` 抽帧、缓存到后端(`/api/thumbs/cover`),视频元数据由浏览器 `loadedmetadata` 派生,这是有意识的选择 —— 详见 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) 「视频封面流程」一节。

本仓库提供一个**绿色安装脚本**,把 `ffmpeg` / `ffprobe` / `ffplay` 放在项目内,便于后续集成(服务端抽帧 / 读真实元数据 / 转码等):

```bash
# Windows PowerShell(默认从 gyan.dev 拉 ffmpeg-release-essentials.zip,约 100MB)
pwsh -File scripts/install-ffmpeg.ps1

# 强制重装
pwsh -File scripts/install-ffmpeg.ps1 -Force

# 换源
pwsh -File scripts/install-ffmpeg.ps1 -Url https://example.com/your.zip

# 自定义安装目录
pwsh -File scripts/install-ffmpeg.ps1 -TargetDir D:\tools\ffmpeg
```

**安装路径约定**(默认情况):

```
bin/ffmpeg/windows/amd64/
├── ffmpeg.exe
├── ffprobe.exe
└── ffplay.exe
```

- 整个 `bin/` 目录已在 `.gitignore` 中被忽略,二进制不入仓,clone 仓库后跑一次脚本即可就位。
- 脚本**幂等**:已安装且 `ffmpeg -version` 可用会直接跳过。
- 脚本**不需要管理员权限**,不写系统目录、不修改 `PATH`。
- 当前仅内置 Windows x64 流程;macOS / Linux 路径结构同形(`bin/ffmpeg/darwin/amd64/` 等),后续按需补 `scripts/install-ffmpeg.sh`。


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
| `Ctrl+O` | 打开/切换图像目录 |
| `Ctrl+S` | 启动扫描 |
| `F5` | 刷新 |
| `Ctrl+H` | 回到主页 |
| `Ctrl+D` | 我的收藏 |
| `←/→` / `PageUp/PageDown` | 翻页（连续模式为滚一屏） |
| `G` | 跳到指定页 |
| `N` / `P` | 上一本 / 下一本（按当前列表） |
| `S` | 收藏 / 取消收藏 |
| 点击图片 | 左/右 1/3 翻页（中段不响应） |
| `1` / `2` / `3` | 单张 / 连续滚动 / 双张并排 |
| `F` | 图片适配循环（适应 → 按宽 → 按高 → 原始） |
| `L` | 翻页方向（LTR / RTL，仅双张并排模式） |
| `+/-/0` | 缩放 |
| `R` | 旋转 |
| `Space` | 幻灯片 |
| `F11` | 全屏 |
| `?` / `Ctrl+/` | 快捷键帮助 |

完整列表见 [`docs/SHORTCUTS.md`](docs/SHORTCUTS.md)。

---

## 📜 许可

仅供个人学习和非商业用途。
