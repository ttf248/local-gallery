# 贡献指南

感谢关注和参与 Local Gallery。在提交 Issue 或 Pull Request 前，请先阅读本指南并参考对应专题文档。

## 项目约定速览

- **定位与边界**：Local Gallery 是单用户本地媒体画廊（Go 单进程 + 本地 JSON 持久化 + React 浏览器 UI），不引入数据库、消息队列或微服务；原始媒体目录始终**只读**。
- **语言规范**：提交说明、PR 描述、文档和界面可见文案统一使用中文；代码标识符、API 字段名、错误码与日志 key 使用英文。
- **格式规范**：以仓库根目录 `.editorconfig` 为唯一格式来源：
  - Go：Tab 缩进，`gofmt` / `gofumpt`。
  - 前端：2 空格缩进，Prettier（`npm run format`）与 ESLint（`frontend/eslint.config.js`）。
  - TypeScript：严格模式，禁止使用 `any` 绕过类型检查，必要时使用 `unknown` 与类型守卫。
- **配置与依赖**：
  - 运行时配置唯一来源为 YAML（CLI 仅保留 `--config`），不新增环境变量或参数覆盖应用配置。
  - 依赖变动同步锁文件：后端执行 `go mod tidy`，前端通过 npm 同步 `package.json` 与 `package-lock.json`。
  - 兼顾 Windows、macOS、Linux 三平台路径分隔符、换行与大小写差异；前端不做 OS 探测特化。

更详细的工程边界与协作要求见 [AGENTS.md](./AGENTS.md)。

## 本地开发环境

依赖安装、配置文件准备、前后端启动与本地 AI Worker 环境搭建见 [README.md · 从源码运行](./README.md#从源码运行)。

VSCode 仓库内已提供四个独立调试配置（后端、前端、本地最新构建、后端服务测试）与一个「全栈复合调试」配置（见 `.vscode/launch.json`）。

## 改动与文档同步

任何行为变更都应在同一提交或 PR 中同步对应测试与专题文档，保证「每项事实只在对应专题维护完整说明，其余位置引用」：

| 改动类型 | 同步测试 | 同步文档 |
| --- | --- | --- |
| 后端 Handler / 中间件 / Service 行为 | 对应 Go 单元测试，跨层主链路同步 `backend/tests/integration` | [API.md](./docs/API.md)、[ARCHITECTURE.md](./docs/ARCHITECTURE.md) |
| 前端组件 / Hook / Store 行为 | 对应 Vitest 测试，关键路径同步 Playwright E2E | [PRODUCT.md](./docs/PRODUCT.md)、[ARCHITECTURE.md](./docs/ARCHITECTURE.md) |
| 界面布局、主题或交互改动 | 对应组件测试、布局/对比度/崩溃审计与实际截图检查 | [DESIGN.md](./docs/DESIGN.md)（涉及路由/职责时同步 [PRODUCT.md](./docs/PRODUCT.md)） |
| 快捷键改动 | `frontend/src/utils/shortcutsTable.test.ts` 与处理器测试 | [SHORTCUTS.md](./docs/SHORTCUTS.md) |
| 配置项、端口或运行脚本 | 配置与启动测试 | [backend/config.example.yaml](./backend/config.example.yaml)、[README.md](./README.md)、[RELEASE.md](./docs/RELEASE.md) |
| 纯文档改动 | 核对 Markdown 格式、本地链接、章节锚点与代码一致性 | 相关专题文档 |

## 提交前验证

按改动范围运行对应命令（完整命令表见 [README.md · 开发验证](./README.md#开发验证)）：

```sh
# 后端
cd backend
go vet ./...
go test ./...

# 前端
cd frontend
npm run lint
npm run typecheck
npm run test
npm run build
```

跨层功能或路由变更请额外运行全栈 E2E：

```sh
cd frontend
npm run test:e2e
```

界面与主题变更请在明暗双主题下基于当前源码实机启动并检查界面截图（截图存放在 `frontend/.smoke/<任务>/`，不提交入仓），详见 [DESIGN.md · 验证方法](./docs/DESIGN.md#7-验证方法)。

## 提交规范

使用 Conventional Commits 格式，提交主题统一使用中文：

```text
<type>(<scope>): <中文简述>

背景与动机：...
关键改动：...
验证方式与结果：...
影响范围：...
```

- 常用 `type`：`feat`、`fix`、`refactor`、`perf`、`docs`、`test`、`chore`、`build`。
- 非琐碎改动必须使用多行提交说明，写明背景、关键改动、验证结果与影响范围。
- 单次提交只包含当前任务相关文件；临时草稿、日志、截图、缓存、覆盖率报告与构建产物不入仓。
- CI 与 Release 工作流均通过 GitHub Actions `workflow_dispatch` 手动触发，不自动随 push 或 PR 运行，详见 [RELEASE.md](./docs/RELEASE.md)。
