# 构建、CI 与发布指南

本文件维护跨平台本地构建、全栈端到端验证、CI 门禁以及正式版本发布流程。日常开发入门命令见根 [README.md](../README.md#从源码运行)。

---

## 本地开发构建

### 环境要求

- Go 1.24+
- Node.js 20+（CI 使用 Node.js 22）与 npm
- Windows 便携包本地打包另需 Python 3.11（64 位）

### Windows

仓库根目录提供批处理脚本：

```bat
:: 首次准备前后端依赖并生成 backend\config.yaml
scripts\setup-dev.bat

:: 构建前端产物（frontend\dist）与后端可执行文件（bin\local-gallery.exe）
build.bat

:: 启动最新单进程构建（自动校验配置与产物）
start.bat
```

### macOS / Linux

```sh
(cd backend && go mod download)
(cd frontend && npm ci && npm run build)
mkdir -p bin
(cd backend && go build -o ../bin/local-gallery ./cmd/server)
(cd backend && ../bin/local-gallery --config config.yaml)
```

> 单进程运行时请将 `backend/config.yaml` 中的 `staticDir` 设为 `../frontend/dist`。

---

## 端到端测试与本地审计

首次运行 E2E 前需在 `frontend/` 安装 Playwright Chromium：

```sh
cd frontend
npx playwright install chromium
npm run test:e2e
```

测试脚本 [`scripts/test-e2e.mjs`](../scripts/test-e2e.mjs) 会自动生成隔离的临时媒体库、构建并启动独立端口服务，完成后清理临时进程与目录（Windows 若刚退出的进程句柄暂未释放导致临时目录删除告警，不影响测试退出码）。Windows 亦可在仓库根目录运行：

```bat
scripts\test-e2e.bat --audit
scripts\test-e2e.bat --crash
```

---

## CI 与提交推送

### GitHub Actions CI

工作流文件位于 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)，**仅通过 `workflow_dispatch` 手动触发**（不自动在 push / PR 运行）：

- **`verify` 矩阵（`ubuntu-latest`、`windows-latest`、`macos-latest`）**：
  1. `go test ./...`
  2. `npm run lint`、`npm run test`、`npm run typecheck`
  3. Playwright 全栈 `npm run test:e2e`（失败时自动上传 `playwright-*` 报告，保留 7 天）
  4. Ubuntu 节点额外执行前端首屏体积预算审计（`node scripts/size-audit.mjs --dist`）并产出校验用构建包 `local-gallery-ci-<sha>.tar.gz`
- **`race`（`ubuntu-latest`）**：并行运行 `go test -race ./...` 并发竞态检查。

### 本地发布辅助脚本（Windows）

提交并推送前，先将当前任务相关文件 `git add` 至暂存区，准备好符合规范的多行中文提交说明文件后执行：

```bat
scripts\publish.bat commit-message.txt [远端] [分支] [--skip-validation]
```

默认按序执行构建、Go 测试、前端 lint 与 Vitest 单元测试后再提交推送；纯文档改动可传入 `--skip-validation`（需注意参数顺序：`scripts\publish.bat msg.txt origin main --skip-validation`）。

如需跟踪某次提交的 GitHub Actions 状态（需已安装并登录 `gh`）：

```bat
scripts\watch-github-actions.bat <commit-sha>
```

---

## 正式发布流程

当前架构沿用 **v2 发布线**（`v2.MINOR.PATCH`），禁止覆盖已公开的历史发布版本。工作流文件位于 [`.github/workflows/release.yml`](../.github/workflows/release.yml)。

### 发布步骤

1. **预览下一个版本号**：
   ```sh
   node scripts/release-version.mjs patch   # 或 minor
   ```
   首个正式版为 `v2.0.0`，后续从仓库已有最高 v2 正式标签递增。
2. **编写中文发布说明**：在 `docs/release-notes/v2.x.y.md` 创建对应版本的中文说明文件（Release 工作流会强校验该文件存在且非空），随本次发布代码一并提交并推送到默认分支。
3. **手动触发 Release 工作流**：在 GitHub Actions 页面选择默认分支运行 `Release`：
   - 选择与步骤 1 一致的 `increment`（`patch` / `minor`）；`version` 留空即可自动计算。
   - 若因中途失败重试已创建的草稿或标签，在 `version` 填入原版本号并基于同一提交重跑。
4. **自动门禁与五平台打包**：
   - `verify` 复用完整 CI 门禁（三平台测试 + E2E + Go race + 首屏体积预算）。
   - `frontend` 注入 `LOCAL_GALLERY_VERSION` 构建无 sourcemap 的前端产物。
   - `package` 生成以下 5 个平台压缩包（单个文件强校验小于 2 GiB）：
     - `local-gallery-v2.x.y-windows-amd64-portable.zip`（含内置 Python 3.11、DirectML 推理栈、MSVC 运行库、FFmpeg 8.1.1 与核心模型，并在 CI 中自动执行解压冒烟验收）
     - `local-gallery-v2.x.y-linux-amd64.tar.gz`
     - `local-gallery-v2.x.y-linux-arm64.tar.gz`
     - `local-gallery-v2.x.y-darwin-amd64.tar.gz`
     - `local-gallery-v2.x.y-darwin-arm64.tar.gz`
   - `publish` 校验产物数量为 5，生成 `SHA256SUMS`，创建注释标签、上传附件到草稿 Release 后正式公开。
5. **发布后人工核验**：从 GitHub Releases 下载 Windows ZIP 与 `SHA256SUMS` 至本机临时目录，校验 SHA-256，执行下方解压验收脚本并在浏览器核对实际运行界面。

> **标签推送权限说明**：若门禁运行期间默认分支的 `.github/workflows/` 文件发生改动，GitHub 可能拒绝工作流令牌为旧提交创建标签。确认该次运行的门禁与打包验收均通过后，由维护者本地创建并推送指向该运行提交的同名注释标签，再重跑失败的 `publish` 作业即可复用已验证产物。

---

## 本地打包与 Windows 便携包验收

打包脚本 [`scripts/package-release.mjs`](../scripts/package-release.mjs) 支持全部 5 个目标平台（Windows 便携包必须在 Windows x64 主机上打包与验收）：

```bat
npm --prefix frontend ci
node scripts/package-release.mjs 2.x.y windows amd64
python scripts\windows-portable\smoke.py artifacts\local-gallery-v2.x.y-windows-amd64-portable.zip 2.x.y
```

打包说明：

- **依赖校验**：[`scripts/windows-portable/bundle.py`](../scripts/windows-portable/bundle.py) 下载并逐项校验 Python 3.11、MSVC 运行库、FFmpeg 8.1.1 及模型许可与权重的 SHA-256；可通过环境变量 `LG_RELEASE_MODEL_CACHE` 复用本机已校验的模型缓存目录。
- **冒烟验收**：[`scripts/windows-portable/smoke.py`](../scripts/windows-portable/smoke.py) 使用独立端口与包含中文及空格的临时解压路径，验证 `start.bat`、前后端版本号注入、样例媒体扫描、FFmpeg 与内置模型实际推理。
- **无源码映射（Sourcemap）**：生产构建默认不输出 `.map` 文件，打包脚本亦会过滤 `dist/assets/*.map` 兜底；仅需排查线上堆栈时可在本地执行 `LOCAL_GALLERY_SOURCEMAP=hidden npm run build`。
- **版本号注入**：正式版本号统一注入 Go（`-ldflags -X .../internal/config.Version=...`）、Vite（`LOCAL_GALLERY_VERSION`）与压缩包文件名；开发版保持源码默认值 `0.1.0`。
