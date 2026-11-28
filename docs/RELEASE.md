# 构建与发布

Windows 开发、构建和发布包入口在根 [README.md](../README.md)；本文件只保留跨平台验证与正式发布步骤。

## 本地开发

Windows 首次准备依赖：

```bat
scripts\setup-dev.bat
```

设置 `backend\config.yaml` 后，`build.bat` 构建前后端，`start.bat` 启动服务。Go 1.24+、Node.js 20+ 和 npm 需已安装。

macOS / Linux 直接用 Go 与 npm：

```sh
(cd backend && go mod download)
(cd frontend && npm ci)
(cd frontend && npm run build)
mkdir -p bin
(cd backend && go build -o ../bin/local-gallery ./cmd/server)
(cd backend && ../bin/local-gallery --config config.yaml)
```

E2E 首次运行前，在 `frontend/` 安装 Chromium：

```sh
cd frontend
npx playwright install chromium
npm run test:e2e
```

测试入口 `scripts/test-e2e.mjs` 会创建临时媒体库、构建并启动隔离服务，结束后清理临时进程和目录。Windows 上进程刚结束时文件句柄可能还没释放，临时目录删不掉只会打印警告（带上目录路径），不会把这一轮跑批报成失败 —— 退出码只看用例与审计。Windows 也可从仓库根目录运行 `scripts\test-e2e.bat --audit` 或 `scripts\test-e2e.bat --crash`。

## CI

在 GitHub Actions 手动启动 CI 或 Release。CI 在 Windows、macOS、Linux 上运行 Go 测试、前端 lint、类型检查、单元测试和 E2E。E2E 失败时，在对应运行的 Artifacts 下载 `playwright-*` 报告，报告保留七天。Linux 同时审计首屏体积并上传验证包，Go race 检查则在独立 Ubuntu 任务并行运行。Release 复用同一套 CI 门禁。

如需提交推送，先按项目规则暂存当前任务文件，再准备多行中文提交说明文件：

```bat
scripts\publish.bat commit-message.txt
```

脚本只提交已暂存文件，默认运行构建、后端测试、前端 lint 和单元测试，然后推送当前分支。文档改动可加 `--skip-validation`。脚本不会自动运行 GitHub Actions。

查看指定提交的工作流：

```bat
scripts\watch-github-actions.bat <commit-sha>
```

需要先安装并登录 GitHub CLI（`gh`）。

## 正式发布

1. 运行 `node scripts/release-version.mjs patch` 预览版本。首发为 `v2.0.0`，以后从最高的正式 v2 标签递增。选 `minor` 时递增次版本并清零补丁号。
2. 在 `docs/release-notes/v2.x.y.md` 准备中文说明，将代码与说明提交并推送 CNB。等同一提交同步到 GitHub 默认分支。
3. 在 GitHub Actions 手动运行 Release，选择同一个 `increment`。`version` 可留空。如果上次发布已建立标签或草稿，填写原版本并从同一提交重跑该工作流，或在默认分支仍指向该提交时重新触发。
4. CI 与打包验收通过后，工作流创建注释标签、上传五个平台包与 `SHA256SUMS` 到草稿，再公开 Release。可同时验证不同提交，正式标签和附件的写入串行执行。公开后附件以该版本为准，后续修复使用新版本。
5. 从 GitHub Release 下载 Windows ZIP 与 `SHA256SUMS` 到本机临时目录。对比 `Get-FileHash -Algorithm SHA256`，再运行下方的解压验收命令并查看实际页面。

如果门禁运行期间默认分支的工作流文件发生变化，GitHub 可能拒绝工作流令牌为旧提交创建标签。确认该次运行的门禁和包验收均通过后，由维护者推送指向该运行提交的同名注释标签，再重跑该次运行的发布作业，沿用已验证的产物。[GitHub 发布权限说明](https://docs.github.com/en/rest/releases/releases#create-a-release)

Windows 可用 Go、Node.js 和 Python 3.11 本地打包。先运行 `npm --prefix frontend ci`，再执行：

```bat
node scripts/package-release.mjs 2.0.0 windows amd64
python scripts\windows-portable\smoke.py artifacts\local-gallery-v2.0.0-windows-amd64-portable.zip 2.0.0
```

打包脚本拉取并校验 Python、FFmpeg 和模型的 SHA256。打包时可通过 `LG_RELEASE_MODEL_CACHE` 复用已有模型目录，校验通过后复制。Windows 验收使用独立端口和带空格及中文的临时路径，检查启动器、前后端版本、样本扫描、FFmpeg 和内置模型的实际推理。使用方法见 [README](../README.md#使用发布包)。

**发布包不含源码映射。** 前端构建默认不产出 `.map` —— 那是一份完整的
TS/TSX 源码，随包分发等于把源码公开。需要排查线上堆栈时用
`LOCAL_GALLERY_SOURCEMAP=hidden npm run build` 单独构建；打包脚本会再删
一次 `dist/assets/*.map` 兜底。

发布号统一注入 Go、Vite 和压缩包名称。开发版本从源码默认值读取。构建产物和缓存由 `.gitignore` 管理。
