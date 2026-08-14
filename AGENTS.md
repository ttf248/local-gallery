# Comic Reader · AI 协作编码规则

> 本文件是仓库内 AI 助手（Claude / Codex / 其他）与人类协作者共同遵循的规则。
> 分两层：**通用规则**（适用于所有改动）与**项目专属规则**（只针对本 Comic Reader 全栈项目）。

---

## 目录

- [通用规则](#通用规则)
  - [语言、验证与提交](#语言验证与提交)
  - [依赖、文档与测试同步](#依赖文档与测试同步)
  - [代码风格与格式化](#代码风格与格式化)
  - [安全与跨平台兼容](#安全与跨平台兼容)
- [项目专属规则](#项目专属规则)
  - [技术栈与运行入口](#技术栈与运行入口)
  - [架构边界](#架构边界)
  - [项目文档与调试配置](#项目文档与调试配置)
  - [测试基线](#测试基线)
  - [构建产物与发布](#构建产物与发布)

---

## 通用规则

大型任务自行拆分子任务，完成子任务执行 git 提交，然后继续

### 语言、验证与提交

- **所有提交说明、PR 描述、文档与本文件中面向用户的部分，统一使用中文**；代码标识符、API 字段、日志 key 沿用英文。
- git 日志采用标准 git 日志格式
- 非琐碎改动必须使用**多行提交信息**，正文至少说明：
  1. **背景**：为什么改、改动动机；
  2. **关键改动**：影响哪些模块/接口/路径；
  3. **验证方式**：跑了哪些命令、看到了什么结果；
  4. **影响范围**：是否影响 API、配置、文档、构建产物。
- 一个提交只表达一个清晰主题，**只包含当前任务相关文件**。临时草稿、调试输出、一次性实验不得混入。
- **本地临时输出**（构建产物、缓存、日志、截图、压测样本）不得提交，除非它们本就是正式输入或正式产物。详见 `.gitignore`。

### 依赖、文档与测试同步

- **不在仓库配置中硬编码解释器/工具链的绝对路径**：
  - Go 工具链由 `go.mod` 的 `go` 指令与 `GOTOOLCHAIN` 控制；
  - Node 包管理器与版本由 `frontend/package.json#engines`（如有）和 `package-lock.json` 锁定；
  - 解释器/工具链由编辑器或 CI 选择，不绑定 `.exe`、`.ps1`、`.venv` 等具体路径。
- **新增第三方依赖时必须同步更新对应清单**：
  - 后端 → `backend/go.mod`（并运行 `go mod tidy`）；
  - 前端 → `frontend/package.json`，并提交 `package-lock.json`；
  - 严禁手动编辑 `go.sum` / `package-lock.json` 之外的内容。
- **重构时只保留最新实现**，不保留历史兼容入口、兼容参数、兼容分支、兼容文档；文档与代码必须**统一描述当前版本逻辑**。
- **改动以下内容时必须同步更新 README / `docs/` / `.vscode/`**：
  - 后端 API 路径、请求/响应字段、错误码；
  - 前端路由、用户可见的快捷键、主题/外观行为；
  - 默认配置项、环境变量、命令行参数；
  - VSCode 调试入口、PowerShell 脚本入参。
- **同步顺序**：先改代码与测试 → 再更新 README/docs → 再更新 `.vscode/` 与脚本 → 提交时一次性带上。

### 代码风格与格式化

- 仓库根 `.editorconfig` 是所有语言格式化的单一事实来源：
  - Go：`tab` 缩进、`gofmt` / `goimports`；
  - 前端（TS/TSX/JS/CSS/JSON）：**2 空格**缩进、Prettier；
  - Markdown：保留行尾空格用于换行。
- **保存即格式化**：Go 使用 `gofumpt`（如启用）/ `gofmt`；前端使用 Prettier。CI / 评审时若发现格式脏改动，视为未完成。
- 前端 ESLint 规则以 `frontend/.eslintrc*` 为准；TypeScript 严格模式默认开启（`tsconfig.app.json`），**禁止使用 `any` 绕过**，必要时用 `unknown` + 守卫。
- 后端优先使用标准库与已引入依赖；新增 linter / formatter 工具前先在 PR 中说明动机。

### 安全与跨平台兼容

- 项目会**直接读取用户本地漫画目录**，路径处理必须遵循：
  - 后端统一通过 `path/filepath` 拼接，禁止字符串拼路径；
  - **必须使用路径安全中间件**（如 `internal/middleware/path_safety.go`）防止越权访问漫画根目录之外的文件；
  - URL 路径参数解码后再做白名单校验。
- 不在日志/响应/前端 store 中明文写入完整文件系统绝对路径，只暴露相对路径或目录别名。
- **跨平台**：路径分隔符、换行、文件名大小写敏感性按"Windows / macOS / Linux 三平台都能跑"对待；前端不做 OS 探测特化。
- 前端使用 Tailwind 时不要硬编码颜色 hex，统一走 `theme.extend.colors`（或语义化类），避免明暗主题不一致。
- 后端 SSE / WebSocket 推送需考虑超时与断连清理，避免 goroutine 泄漏。

---

## 项目专属规则

### 技术栈与运行入口

| 层 | 技术 |
|----|------|
| 后端 | Go 1.24 + Fiber v2 + `disintegration/imaging` + `hashicorp/golang-lru/v2` |
| 前端 | React 18 + Vite 5 + TypeScript 5 + Tailwind 3 + Zustand + TanStack Query + react-virtuoso |
| 测试 | Go `testing` + `tests/integration`、Vitest + Testing Library、Playwright（e2e） |
| 脚本 | PowerShell（`scripts/*.ps1`），跨平台命令写在 VSCode tasks 中 |

- **运行入口以 VSCode 为首选**：`.vscode/launch.json` 中提供 4 个独立调试入口 + 1 个复合调试。
- **不要新增更多调试入口**：如确有必要，先在 PR 中说明，避免 launch 列表膨胀。
- Go 入口固定为 `backend/cmd/server/main.go`；前端入口固定为 `frontend/src/main.tsx`（如不存在则在 PR 中确认）。
- 配置文件：
  - 后端真实配置：`backend/config.json`（不入仓，参考 `backend/config.example.json`）；
  - 环境变量：`.env`（不入仓，参考 `.env.example`）；
  - 漫画根目录优先级：CLI 参数 `--comic-root` > 环境变量 `COMIC_ROOT` > 配置文件 > 默认 `./comics`。

### 架构边界

- **后端** 只负责：扫描本地目录、生成与缓存缩略图、提供 HTTP API 与 SSE 进度流、托管生产环境前端静态资源。
- **前端** 只负责：UI 渲染、用户交互、本地偏好（主题/收藏/最近）的持久化、调用后端 API。
- **跨域**：开发期 Vite dev server 通过代理访问后端；生产期由后端单端口同时托管 API 与静态资源，不引入额外反向代理。
- **缓存目录**：缩略图缓存与运行时缓存统一放在仓库根 `.cache/`（不入仓，由服务运行期重建）。不允许把缓存路径硬编码进源码，必须从配置/环境变量派生。
- **不要引入微服务/消息队列/数据库**：当前架构是单进程 + 本地文件 + 浏览器本地存储

### 项目文档与调试配置

- **长期文档目录**：`docs/`
  - `docs/ARCHITECTURE.md` — 模块划分、数据流、扩展点；
  - `docs/API.md` — HTTP 接口契约（路径/参数/响应/错误码）；
  - `docs/SHORTCUTS.md` — 前端快捷键全集；
  - 新增长期文档请在 README "项目结构" 一节补一行引用。
- **调试配置入口**：`.vscode/launch.json`、`.vscode/tasks.json`、`.vscode/settings.json`、`.vscode/extensions.json`。
- **必须同步更新的触发条件**（任一命中即同步）：
  - 后端 API 增删改、错误码变化；
  - 前端路由变化、用户可见快捷键变化；
  - 默认端口、默认缓存目录、配置项 key 变化；
  - launch/tasks 中的命令、cwd、env 变化；
  - 脚本入参变化。
- **同步要求**：README → `docs/` → `.vscode/` → `scripts/*.ps1`，按这个顺序改并尽量一次性提交。

### 测试基线

- **后端单元测试**：`cd backend && go test ./...`；覆盖率建议 ≥ 关键路径 70%，不强制百分比。
- **后端集成测试**：`cd backend && go test ./tests/integration -v`，使用真实 HTTP 路由，覆盖扫描/缩略图/SSE 主链路。
- **前端单元/组件测试**：`cd frontend && npm run test`（Vitest + Testing Library）。
- **端到端测试**：`cd frontend && npm run test:e2e`（Playwright），或使用 `scripts/test-e2e.ps1` 启动浏览器自动化。
- **改动业务逻辑必须同步新增/更新测试**：
  - 后端 handler / middleware / service 的行为变更 → `go test` 用例；
  - 前端组件 / hook / store 的行为变更 → Vitest 用例；
  - 跨层主链路变更 → 至少补一条 integration 或 e2e 用例。
- **性能测试**：
  - 后端性能基线只在**显式的性能优化任务**中执行，作为回归对照；
  - 不强制每次改动都跑性能测试；
  - 性能调优如涉及扫描/缩略图生成主路径，必须在 PR 中附上优化前/后的命令、样本与指标（吞吐、p95、内存）。
- **测试数据**：临时测试素材（漫画目录、临时图片）放在仓库外或 `tests/integration/testdata/` 下；不要把大文件或真实版权漫画提交进仓。

### 构建产物与发布

- **构建产物不入仓**：
  - 后端二进制：`bin/`、`build/`、`.exe/.dll/.so/.dylib`；
  - 前端产物：`frontend/dist/`、`frontend/build/`、`frontend/.vite/`；
  - 运行时缓存：`.cache/`；
  - 覆盖率与 e2e 报告：`coverage/`、`test-results/`、`playwright-report/`、`playwright/.cache/`。
  以上均通过根 `.gitignore` 屏蔽。
- **构建命令**：
  - 后端：`cd backend && go build -o ../bin/server ./cmd/server`（也封装在 `scripts/build.ps1`）；
  - 前端：`cd frontend && npm run build`；
  - 全栈：`scripts/build.ps1` 或 VSCode 任务 `build: all`。
- **发布流程（当前阶段保持人工）**：
  - 项目目前**不维护自动化 CI / Release workflow**；版本号与发版说明视需要手动更新 `package.json` / `go.mod` 与 README；
  - 如未来引入 tag/release 流程：
    1. tag 使用 `vMAJOR.MINOR.PATCH` 形式；
    2. 发版前在 `docs/release-notes/vX.Y.Z.md` 写中文用户向发布说明；
    3. 推送 tag 时人工确认远端无同名 tag，再走手动 Release；
    4. CI 仅保留 `workflow_dispatch` 手动入口，不在 push / PR 时自动触发构建/发布。
- **依赖升级策略**：
  - 后端：通过 `go get -u <module>` 升级，配合 `go mod tidy`，评估 `go.sum` 变更；
  - 前端：通过 `npm update` 或显式 `npm install <pkg>@<version>`，**必须**提交 `package-lock.json`；
  - 升级后跑一遍后端测试 + 前端构建 + 关键 e2e，验证无回归。

---

## 附录：典型改动 checklist

- [ ] 改了 API？→ 更新 `docs/API.md` + 后端测试 + README。
- [ ] 改了路由/页面？→ 更新 README "项目结构" + 前端测试。
- [ ] 改了快捷键？→ 更新 `docs/SHORTCUTS.md` + 前端组件属性。
- [ ] 改了配置项/环境变量？→ 更新 `backend/config.example.json` + `.env.example` + README。
- [ ] 改了端口/启动命令？→ 更新 `.vscode/launch.json` + `.vscode/tasks.json` + `scripts/*.ps1`。
- [ ] 新增依赖？→ 更新对应清单 + 锁文件 + PR 描述中列出。
- [ ] 涉及路径/文件系统访问？→ 确认经过 `path/filepath` + 路径安全中间件 + 日志脱敏。
- [ ] 涉及 SSE / 长连接？→ 确认超时与断连清理，避免 goroutine 泄漏。
- [ ] 涉及主题/外观？→ 在明暗主题下人工目视一遍。

---

> 本文件改动需提交多行 Git 信息，并在 README 顶部或末尾保留指向本文件的引用。