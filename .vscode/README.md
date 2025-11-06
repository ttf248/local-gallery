# VSCode 配置说明

本项目已配置完整的VSCode开发环境，包含启动项和任务配置。

## 🚀 启动项 (Launch Configurations)

按 `Ctrl+Shift+P` 打开命令面板，输入"显示运行和调试"或直接按 `F5` 查看所有启动项：

### 可用的启动项：

1. **Python: 当前文件 (调试)**
   - 调试当前打开的Python文件
   - 快捷键: `F5`

2. **运行完整测试套件**
   - 运行所有unittest测试
   - 包含所有测试文件

3. **运行性能测试**
   - 运行真实世界性能测试（使用E:\漫画目录）
   - 测试扫描性能

4. **启动漫画阅读器主程序**
   - 直接启动主程序
   - 快捷键: `F5`（当main.py为活动文件时）

5. **调试ImageProcessor**
   - 专门调试ImageProcessor单元测试

6. **Python: 交互式窗口**
   - 在交互式窗口中运行代码

## 📋 任务 (Tasks)

按 `Ctrl+Shift+P` 打开命令面板，输入"任务：运行任务"或按 `Ctrl+P` 输入`task `：

### 可用的任务：

1. **运行所有测试** ⭐ (默认测试任务)
   - 运行完整的unittest测试套件
   - 快捷键: `Ctrl+P` → 输入 `task test`

2. **运行性能测试**
   - 执行真实世界性能测试

3. **运行标准unittest**
   - 运行标准格式的unittest

4. **启动漫画阅读器** ⭐ (默认构建任务)
   - 启动主程序
   - 快捷键: `Ctrl+P` → 输入 `task build`

5. **代码格式化 (Black)**
   - 自动格式化Python代码

6. **代码检查 (Flake8)**
   - 检查代码质量

## 🎯 常用快捷键

| 操作 | 快捷键 |
|------|--------|
| 启动调试 | `F5` |
| 运行任务 | `Ctrl+P` → 输入 `task ` |
| 显示测试资源管理器 | `Ctrl+Shift+P` → "测试: 显示测试资源管理器" |
| 运行当前测试 | `Ctrl+F5` |
| 运行测试 | `Ctrl+,` → 测试选项卡 |

## 🔧 设置说明

`.vscode/settings.json` 配置了：
- ✅ 启用unittest测试框架
- ✅ 自动发现测试
- ✅ Python解释器路径
- ✅ PYTHONPATH环境变量
- ✅ 分析路径

## 📦 依赖环境

确保已安装以下Python包：
```bash
pip install -r requirements.txt
```

## 🐛 故障排除

### 1. 找不到启动项
- 解决方案：按 `Ctrl+Shift+P` → 输入 "Reload Window" 重新加载窗口

### 2. 测试无法发现
- 确保 `.vscode/settings.json` 中 `python.testing.unittestEnabled` 为 `true`
- 检查PYTHONPATH是否正确设置为 `${workspaceFolder}/src`

### 3. 模块导入错误
- 确保在项目根目录打开VSCode
- 检查虚拟环境是否激活

## 📝 示例工作流程

1. **开发新功能**：
   - 编辑代码 → 使用启动项调试主程序
   - 快捷键: `F5`

2. **编写测试**：
   - 编写测试代码 → 使用任务运行测试
   - 快捷键: `Ctrl+P` → `task test`

3. **性能测试**：
   - 修改核心代码后 → 运行性能测试
   - 快捷键: `Ctrl+P` → `task 性能`

---

配置创建时间: 2025-11-06
