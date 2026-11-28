# Local Gallery · 本地画廊

单用户、本机优先的开源媒体画廊。直接在浏览器中浏览、检索与整理本机的照片、视频和漫画，所有原始媒体目录始终**只读**，浏览历史、精选、收藏、阅读进度与本地分析结果全部保存在本机目录中，无需数据库或云服务。

[下载发布包](https://github.com/ttf248/local-gallery/releases) · [实机演示](#实机演示) · [核心特性](#核心特性) · [快速开始](#快速开始) · [从源码运行](#从源码运行) · [项目文档](#项目文档)

---

## 实机演示

演示录自当前源码运行的独立图库。风景照片与漫画页为 AI 生成的虚构素材，演示日期和地点为样例数据。

### 照片 · 从时间线到大图

按年、月或媒体类型浏览全库时间线。也可在「相册」沿原有文件夹层级打开照片墙。进入大图后可翻看相邻照片、查看拍摄信息或加入精选。

![从时间线浏览照片，打开大图并查看拍摄信息](./docs/media/photo-browse.gif)

### 发现 · 从地点找回照片

按年份、人物、地点和智能相册主题探索图库。「足迹」从 EXIF 坐标生成聚合地图和行程，展开一段行程即可查看当时的照片。安装并运行对应分析后，还可以用中文描述、相似图片或照片里的文字检索。

![从发现进入足迹，在离线地图旁展开一段行程](./docs/media/photo-discover.gif)

### 整理 · 逐组挑选代表照片

本机分析会将完全重复、近似副本和连拍分组。逐组对照后，可更换代表照片、标记已处理、忽略或加入精选。「珍藏」汇集精选照片、收藏的相册等资源与最近浏览记录。

![在相似照片审阅界面对照照片、切换代表并标记已处理](./docs/media/photo-organize.gif)

### 漫画 · 从书架接着读

漫画目录进入独立书架，按作品和话序组织。阅读器支持单页、连续、双页和从右向左翻页，并保存阅读进度。下次可从首页「继续阅读」回到上次的位置。

![打开漫画书架中的作品，切换双页翻阅，再从首页恢复进度](./docs/media/comic-read.gif)

### 设置与任务 · 管理本机图库

在「分析与计划」运行照片元数据、文字识别、语义向量、人脸、相似照片等分析，也可以安排每日增量任务。「数据与存储」提供派生缓存清理和本机状态备份恢复，「媒体库与服务」用于管理目录、扫描与访问方式。

![在任务中心查看分析记录和每日计划，再打开数据与存储](./docs/media/local-tasks.gif)

---

## 核心特性

- **原始目录始终只读**：不移动、不改名、不删除、不覆写任何原始照片、视频或漫画文件；支持目录变化实时监听与增量索引。
- **双工作台分离**：按媒体根目录类型（`photo` / `comic`）划分为独立的照片工作台与漫画工作台，导航、视图、进度与措辞互不混淆。
- **照片浏览、发现与整理**：
  - 全库照片时间线、「那年今日」回忆、原始文件夹相册与方括号 `[标签]` 聚合。
  - 本地 EXIF/GPS 解析、中国省市区三级离线足迹地图与行程聚合、候选人物聚类与头像精选、智能相册主题分组。
  - 基于本地 Chinese-CLIP 与 RapidOCR 的中文语义搜索、以图搜图与图片文字检索。
  - 完全重复、近似副本与连拍分组审阅、代表照片挑选、并排对比与单张照片精选。
- **漫画书架与阅读器**：
  - 按作品、系列与卷层级组织书架，支持本地 `ComicInfo.xml` / `series.json` / `info.json` 解析、自动封面精选与人工元信息覆盖。
  - 沉浸式暗场阅读器：单页 / 连续滚动 / 双页并排、LTR / RTL 翻页、多种缩放适配、章节目录、页码缩略图、按页保存进度与未读管理。
- **单进程与本地安全边界**：
  - Go 单进程托管 API 与前端静态资源，默认仅监听并放行本机回环访问（`accessMode: local`）；局域网访问（`accessMode: lan`）要求令牌鉴权与 `HttpOnly` 会话 Cookie。
  - 所有公共媒体接口仅使用不可逆资源 ID（`r_` / `a_` / `c_` / `f_`），并在访问时按当前媒体根重新校验路径边界与符号链接。

---

## 快速开始

从 [GitHub Releases](https://github.com/ttf248/local-gallery/releases) 下载对应系统与架构的 v2 发布包。v1.x 用户请将 v2 解压到新目录后重新添加原有媒体目录。

| 平台 | 启动方式 |
| --- | --- |
| Windows 10/11 x64 | 完整解压 `local-gallery-v2.x.y-windows-amd64-portable.zip` 到具有写权限的目录，双击运行 `start.bat`。 |
| macOS / Linux (x64 / arm64) | 解压对应压缩包，在包目录执行 `cp config.example.yaml config.yaml`，按需编辑后运行 `./local-gallery --config ./config.yaml`（可先将 `mediaRoots` 设为 `[]`，启动后再通过网页添加）。 |

首次启动步骤：

1. 在浏览器打开 <http://127.0.0.1:8080>。
2. 进入「设置与任务 → 媒体库与服务」添加本地目录，并为每个目录指定内容类型（**照片**或**漫画**）。
3. 应用自动扫描目录树并建立索引，完成后即可在侧栏切换工作台浏览；在终端按 `Ctrl+C` 停止服务。

### 启用本机分析与视频增强

- **Windows x64 便携包**：内置 Python 3.11、FFmpeg/ffprobe、Chinese-CLIP、RapidOCR、YuNet 与 SFace，核心分析可离线运行。优先使用支持 DirectML 的 GPU，未检测到可用 GPU 时自动回退 CPU。如需 Buffalo_m 人脸模型或相册封面审美模型，运行包内 `download-extra-models.bat` 按需下载。第三方组件来源与许可见[Windows 便携包第三方组件](./scripts/windows-portable/第三方组件.md)。
- **macOS / Linux 基础包**：开箱即可浏览照片、漫画和浏览器原生支持的视频。安装 FFmpeg/ffprobe 并配置 `ffmpegPath` 后，可启用视频封面抽帧、HEIC/HEIF/TIFF 转换、MP4 faststart 与按需转码。本机 AI 分析环境安装步骤见[分析环境配置](#分析环境配置)。
- 在「设置与任务 → 分析与计划」按需启动分析模块或配置每日增量计划。人物分析默认关闭，需显式启用后运行；足迹完全基于本机离线行政边界解析，不访问外部地图服务。

### 配置与本地数据

- **单一配置来源**：所有运行参数均通过 `--config` 指定的 YAML 文件维护（不引入环境变量或额外 CLI 参数覆盖）。完整配置项与默认值见 [config.example.yaml](./backend/config.example.yaml) 与 [API 文档 · 健康、认证与配置](./docs/API.md#2-健康认证与服务端配置)。
- **网络访问控制**：默认 `accessMode: local` 仅接受回环请求；在可信局域网开启 `accessMode: lan` 时必须配置 32–256 位无空白字符的 `accessToken`（内置服务不终止 TLS，请勿直接暴露至公网）。
- **本地数据分层**：未配置 `cacheDir` 时默认使用进程工作目录下的 `.local-gallery/`：
  - `state/`：用户收藏、精选、浏览历史、阅读进度、人工纠错、任务计划与状态备份（缓存清理不会触及）。
  - `derived/`：缩略图、预览图、格式转换、视频转码、AI 模型权重与可重建分析索引，可在「设置与任务 → 数据与存储」查看占用与清理。
  - `temp/`：临时工作目录。
- **媒体组织方式**：面向单用户本地目录树，支持实时监听文件变动与 `.nomedia` 目录排除；ZIP/RAR 等压缩包需先解压为目录。

---

## 从源码运行

### 环境要求

- Git
- Go 1.24+
- Node.js 20+（含 npm）
- 可选：FFmpeg / ffprobe（视频封面、HEIC/TIFF 转换、视频转码）
- 可选：Python 3.11（本地 AI 分析 Worker）

### 准备依赖与配置

Windows 可直接在仓库根目录运行 `scripts\setup-dev.bat`。macOS / Linux 执行：

```sh
(cd backend && go mod download)
npm --prefix frontend ci
cp backend/config.example.yaml backend/config.yaml
```

编辑 `backend/config.yaml`，将 `mediaRoots` 修改为本机目录或置为 `[]`。

### 启动开发服务

在两个终端分别启动后端与前端：

```sh
# 终端 1：后端（监听 127.0.0.1:8080）
cd backend
go run ./cmd/server --config config.yaml
```

```sh
# 终端 2：前端（监听 localhost:5173，代理 /api 至 127.0.0.1:8080）
cd frontend
npm run dev
```

浏览器访问 <http://localhost:5173>。VSCode 用户也可直接使用仓库预置的「全栈复合调试」入口（见 `.vscode/launch.json`）。

如需本地单进程生产模式运行：将 `backend/config.yaml` 中的 `staticDir` 设为 `../frontend/dist`。Windows 在仓库根目录执行 `build.bat` 与 `start.bat`；macOS / Linux 构建步骤见[构建与发布](./docs/RELEASE.md#本地开发构建)。

### 分析环境配置

- **Windows 源码开发**：运行 `backend\aiworker\setup.bat` 自动创建 Python 3.11 虚拟环境（`.venv`）、安装 CUDA 版 PyTorch 与依赖并下载校验模型（脚本默认代理为 `127.0.0.1:7897`，可按需修改）。如需安装 FFmpeg，可运行 `scripts\install-ffmpeg.bat`。
- **macOS / Linux 源码开发**：在 `backend/aiworker/` 创建 Python 3.11 虚拟环境 `.venv`，安装对应平台的 PyTorch、torchvision、Chinese-CLIP 1.6.0 与 [requirements.txt](./backend/aiworker/requirements.txt)，然后运行 `python download_models.py`。Linux 支持 CUDA，macOS 使用 CPU。
- 模型权重统一存放在 `<cacheDir>/derived/ai/models/` 并在加载前校验 SHA-256；架构与运行细节见[架构文档 · 本地分析引擎](./docs/ARCHITECTURE.md#5-本地分析引擎与派生索引)。

---

## 开发验证

| 工作目录 | 命令 | 说明 |
| --- | --- | --- |
| `backend/` | `go test ./...`、`go vet ./...` | Go 单元测试与静态检查 |
| `backend/` | `go test -race ./...` | Go 并发竞态检查 |
| `backend/` | `go test ./tests/integration -v` | 后端 HTTP 集成主链路测试 |
| `backend/aiworker/` | `python test_worker.py` | Python AI Worker 单元测试 |
| `frontend/` | `npm run lint`、`npm run typecheck`、`npm run test` | ESLint、TypeScript 类型检查与 Vitest 组件测试 |
| `frontend/` | `npm run build` | 前端生产构建 |
| `frontend/` | `npm run test:e2e` | 独立临时媒体库的全栈 Playwright E2E 测试 |
| `frontend/` | `npm run audit:layout`、`npm run audit:contrast`、`npm run audit:crash`、`npm run audit:size` | 布局几何、对比度、崩溃探针与首屏体积审计 |
| `frontend/` | `npm run shot` | 多主题/视口截图（输出至 `frontend/.smoke/`） |
| 仓库根 | `build.bat`、`node scripts/package-release.mjs 2.0.0 windows amd64` | Windows 全栈构建与发布包打包 |

首次运行 E2E 前需在 `frontend/` 执行 `npx playwright install chromium`。审计与截图脚本默认访问运行中的 `http://127.0.0.1:5173`，可通过环境变量 `LG_BASE` 指定其他地址，完整参数见[设计契约 · 验证方法](./docs/DESIGN.md#7-验证方法)。

---

## 目录结构

```text
local-gallery/
├── backend/                # Go 后端服务（cmd/server 入口、internal/* 业务与存储、aiworker/ 本地分析 Worker）
├── frontend/               # React + TypeScript + Vite 前端应用与审计/E2E 测试
├── docs/                   # 产品、设计、架构、API、快捷键与发布文档
├── scripts/                # 开发、构建、E2E、离线地理数据处理与多平台打包脚本
├── .github/workflows/      # 手动触发的 CI 与 Release 工作流
└── .vscode/                # 预置调试与任务配置
```

---

## 项目文档

| 文档 | 用途与阅读时机 |
| --- | --- |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 贡献流程、代码规范、测试要求与提交规范（参与贡献前阅读） |
| [AGENTS.md](./AGENTS.md) | 工程边界、AI 协作规范与文档同步清单（改动代码或协作前阅读） |
| [产品契约](./docs/PRODUCT.md) | 产品定位、双工作台信息架构、路由表、页面职责与功能语义 |
| [设计契约](./docs/DESIGN.md) | Atelier 设计系统、体验与交互原则、无障碍/大库底线与视觉验证 |
| [架构文档](./docs/ARCHITECTURE.md) | 系统模块边界、资源快照、安全模型、媒体管线、本地分析引擎与性能基准 |
| [API 文档](./docs/API.md) | HTTP / SSE 全量接口、请求参数、响应字段、协商机制与错误码 |
| [快捷键说明](./docs/SHORTCUTS.md) | 全局导航、照片墙、大图预览、相似审阅、漫画阅读器与视频播放键盘操作 |
| [构建与发布](./docs/RELEASE.md) | 跨平台本地构建、CI 门禁、正式发布与 Windows 便携包验收 |
| [第三方组件声明](./scripts/windows-portable/第三方组件.md) | Windows 便携包内置运行时、FFmpeg 与模型权重来源及许可说明 |

---

## 许可说明

当前仓库尚未附带统一的开源许可证文件，再分发与商业使用授权尚未明确。Windows 便携包所含第三方运行时与模型权重各自遵循上游许可，详见[第三方组件声明](./scripts/windows-portable/第三方组件.md)；内嵌离线行政区划数据的来源与使用限制见[架构文档 · 离线地理与足迹](./docs/ARCHITECTURE.md#离线地理与足迹)。
