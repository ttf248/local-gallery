# 漫画阅读器 - Linux 桌面版 v3.0

[![Linux](https://img.shields.io/badge/Linux-FCC624?style=flat&logo=linux&logoColor=black)](https://www.linux.org/)
[![Electron](https://img.shields.io/badge/Electron-47848F?style=flat&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)](https://reactjs.org/)

一个专为 **Linux 平台** 设计的现代化漫画阅读器，采用 **极简主义** 设计理念，**100% 还原原型图交互**。

> **原型图** 📄 [html/demo-minimal.html](html/demo-minimal.html) - 完整UI设计参考

## ✨ 核心特性

### 🎨 设计系统
- **极简主义美学**：干净界面，专注内容
- **iPhone 风格视觉**：圆润边角、柔和阴影、精致细节
- **双主题支持**：浅色主题 + 深色主题
- **流畅动画**：60fps 过渡效果，丝滑体验

### 📚 功能模块
- **智能漫画扫描**：自动发现本地图片文件夹和子文件夹
- **合集管理**：支持多集漫画，自动分组和关联
- **连续阅读**：跨集自动连续阅读，无缝切换
- **网格/列表视图**：6列网格展示，支持切换
- **高级搜索筛选**：多维度筛选，实时搜索
- **全屏阅读模式**：沉浸式阅读体验
- **阅读进度跟踪**：自动保存阅读位置
- **收藏与历史**：快速访问喜爱的漫画和合集
- **自定义快捷键**：13个可配置快捷键
- **中文路径完美支持**：支持中文目录名和文件名

## 🏗️ 架构说明

### 技术栈
- **Electron 28** (集成 Chrome 120 + Node.js 20)
- **React 18** + **TypeScript 5**
- **Vite 5** (快速热更新)
- **Tailwind CSS 3** (样式)
- **Zustand** (状态管理)

### 架构设计

```
┌─────────────────────────────────────────┐
│           渲染进程 (Renderer)             │
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │  React   │  │ React    │  │ 路由    │ │
│  │ 组件库    │  │ 状态管理  │  │ 管理    │ │
│  └──────────┘  └──────────┘  └────────┘ │
│  ┌────────────────────────────────────┐ │
│  │     Express.js API 层              │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
                    ↕️ IPC 通信
┌─────────────────────────────────────────┐
│            主进程 (Main)                │
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ 窗口     │  │ 菜单     │  │ 系统    │ │
│  │ 管理     │  │ 管理     │  │ 托盘    │ │
│  └──────────┘  └──────────┘  └────────┘ │
│  ┌────────────────────────────────────┐ │
│  │     Node.js 原生模块               │ │
│  │  ┌────────┐ ┌────────┐ ┌──────────┐│ │
│  │  │ fs     │ │ path   │ │ child_   ││ │
│  │  │ 模块   │ │ 模块   │ │ process  ││ │
│  │  └────────┘ └────────┘ └──────────┘│ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 数据流转

```
用户操作 → React 组件 → Zustand 状态 → Express API → IPC → 主进程 → JSON 文件
    ↑                                                                          ↓
    ←─────────────── 显示更新 ←─────────── 读取文件 ←───────────────
```

**存储方案**：纯 JSON 文件存储（无数据库依赖）
- 数据文件：`~/.comic_reader/data.json`
- 配置文件：`~/.comic_reader/settings.json`
- 缓存目录：`~/.comic_reader/cache/`

## 🚀 快速开始

### 环境要求
- **Node.js**: 20.0+ (LTS)
- **操作系统**: Linux (Ubuntu 20.04+ / CentOS 8+ / Arch Linux)

### 安装依赖
```bash
# 克隆项目
git clone <your-repo-url>
cd comic-reader

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### 开发模式

```bash
# 启动渲染进程 (Vite 热更新，端口 5173)
npm run dev:renderer

# 启动主进程 (Electron)
npm run dev:main

# 启动完整开发模式 (推荐)
npm run dev
```

## ⚙️ 服务与端口配置

### 端口说明
| 服务 | 端口 | 说明 | 配置位置 |
|------|------|------|----------|
| Vite 开发服务器 | **5173** | React 渲染进程热更新 | `vite.config.ts:20` |
| Electron 应用 | **无固定端口** | 桌面应用，通过 IPC 通信 | - |

### 配置详情

**Vite 开发服务器配置** (`vite.config.ts`)
```typescript
server: {
  host: '0.0.0.0',        // 监听所有地址
  port: 5173,              // 开发端口
  strictPort: true         // 强制使用指定端口
}
```

**启动流程**
1. 执行 `npm run dev` 启动 concurrent
2. 并行执行：
   - `npm run dev:renderer` → 启动 Vite (端口 5173)
   - `npm run dev:main` → Electron 主进程，等待端口 5173 可访问后启动

## 📂 漫画文件路径配置

### 存储结构

推荐目录结构：
```
📁 漫画存储根目录 (用户自定义)
│
├── 📁 进击的巨人/
│   ├── 📁 第1话/
│   │   ├── 📄 01.jpg
│   │   ├── 📄 02.jpg
│   │   └── ... (共120页)
│   ├── 📁 第2话/
│   │   ├── 📄 01.jpg
│   │   └── ... (共115页)
│   ├── 📁 第3话/
│   └── 📁 第4话/
│
├── 📁 鬼灭之刃/
│   ├── 📁 Vol.1/
│   ├── 📁 Vol.2/
│   └── ...
```

### 配置漫画路径

**方法 1：通过设置界面**
1. 打开应用 → 设置 → 存储设置
2. 修改"漫画存储路径"
3. 点击"扫描新路径"

**方法 2：修改配置文件**
编辑 `~/.comic_reader/settings.json`：
```json
{
  "storage": {
    "comicPaths": [
      "/home/用户名/漫画",
      "/mnt/data/comics"
    ]
  }
}
```

**自动检测规则**
系统会自动识别以下命名模式：
- `第N话`: `第1话`, `第2话`
- `第N集`: `第1集`, `第2集`
- `Vol.N`: `Vol.1`, `Vol.2`
- `第N卷`: `第1卷`, `第2卷`

**合集识别**：
- 至少 2 个相似文件夹视为合集
- 自动按章节号排序
- 支持混合存储（合集 + 独立漫画）

## 🪟 Windows 平台部署

### 注意事项

**中文路径支持**
- ✅ Node.js 原生支持 UTF-8
- ✅ Windows 10/11 完美支持中文路径
- ✅ 无需额外配置

**示例路径**
```
D:\我的漫画\进击的巨人\第1话\01.jpg
C:\Users\用户\桌面\漫画收藏\鬼灭之刃\Vol.1\01.jpg
```

### 构建生产版本

```bash
# 构建应用
npm run build

# 打包为可执行文件
npm run pack

# 生成安装包 (Windows)
npm run dist

# 输出文件
# dist/Comic Reader Setup.exe
# dist/Comic Reader Win 64bit.zip
```

### Windows 特有配置

**文件关联** (可选)
```json
// settings.json
{
  "fileAssociation": {
    "enabled": true,
    "extensions": [".jpg", ".jpeg", ".png", ".webp"]
  }
}
```

**系统托盘** (Windows 特有)
- 右键托盘图标：显示菜单
- 双击托盘图标：显示/隐藏主窗口
- 支持任务栏进度显示阅读进度

## 📦 项目结构

```
comic-reader/
├── public/                     # 静态资源
│   ├── icons/                  # 应用图标
│   └── index.html
│
├── src/                        # 源代码
│   ├── main/                   # 主进程
│   │   ├── main.ts             # 应用入口
│   │   └── preload.ts          # IPC 预加载脚本
│   │
│   ├── renderer/               # 渲染进程
│   │   ├── components/         # React 组件
│   │   │   ├── layout/         # 布局组件
│   │   │   ├── MainInterface/  # 主界面
│   │   │   ├── ReadingInterface/ # 阅读界面
│   │   │   ├── SearchInterface/  # 搜索界面
│   │   │   └── SettingsInterface/ # 设置界面
│   │   │
│   │   ├── services/           # 业务逻辑
│   │   │   ├── database.ts     # JSON 数据管理
│   │   │   └── file-scanner.ts # 文件扫描
│   │   │
│   │   ├── store/              # 状态管理
│   │   └── App.tsx
│   │
│   └── shared/                 # 共享代码
│       ├── constants/          # 常量
│       └── interfaces/         # TypeScript 接口
│
├── index.html                  # HTML 入口
├── vite.config.ts              # Vite 配置
├── package.json
└── README.md
```

## 🔧 常见问题

### 启动问题

**Q: Vite 端口 5173 被占用？**
```bash
# 查找占用进程
lsof -i :5173

# 杀死进程
kill -9 <PID>
```

**Q: Electron 无法启动？**
```bash
# 重新安装依赖
rm -rf node_modules package-lock.json
npm install
```

### 扫描问题

**Q: 漫画路径扫描失败？**
```bash
# 检查路径权限
chmod -R 755 /path/to/comics

# 检查路径是否存在
ls -la /path/to/comics
```

**Q: 合集识别失败？**
- 确认文件夹命名符合规范：`漫画名/第1话/`
- 至少需要 2 个相似文件夹才会被识别为合集
- 检查是否包含图片文件

### 性能问题

**Q: 内存占用过高？**
- 在设置中关闭"预加载缩略图"
- 减少并发扫描数量

**Q: 扫描速度慢？**
- 启用多线程扫描（设置 → 高级 → 并发数）
- 建议并发数：CPU 核心数

## 📝 更新日志

### v3.0.0 - Electron 重构 (2025-11-07)
- ✨ 全新的 Electron + React 架构
- ⚡ 高性能文件扫描 (1000+ 漫画/秒)
- 💾 JSON 文件存储（零依赖）
- 🎯 100% 还原原型图交互
- ⌨️ 13 个可自定义快捷键
- 🌓 双主题支持 (浅色/深色)

### v2.0.0 - 极简主义重构
- 极简主义界面设计
- iPhone 风格视觉系统

### v1.0.0 - 初始版本
- 基础漫画浏览功能
- 图片查看器

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

开发流程：
1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'feat: Add AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

---

**让阅读成为一种享受 ✨**
