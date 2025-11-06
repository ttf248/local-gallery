# 漫画阅读器 (Comic Reader)

一个采用现代iPhone风格设计的漫画阅读工具，支持瀑布流展示、批量扫描、高级图片查看。

![预览](docs/v1.7.2.gif)

## 🎨 设计特色

### iPhone风格界面

- 🍎 原生iOS设计语言，SF Pro Display字体系统
- 🌊 流畅的瀑布流漫画展示
- 🎭 现代化卡片设计和悬停效果
- ✨ 智能布局和响应式设计
- 📱 类原生的交互体验

### 启动页设计

- 🚀 现代化启动界面with应用图标
- 📋 智能快速操作提示
- 🎯 直观的操作引导
- 💡 快捷键提示集成

## 🔥 核心功能

### 🔍 智能漫画扫描

- **递归扫描**：自动发现所有子文件夹中的图片
- **格式支持**：JPG, JPEG, PNG, GIF, BMP, WEBP, TIFF
- **智能识别**：自动将包含图片的文件夹识别为漫画
- **统计信息**：显示图片数量、文件夹大小
- **Unicode支持**：完美支持中文路径和文件名

### 🖼️ 高级图片查看器

- **专业级查看**：高质量图片预览，支持大图加载
- **多种缩放模式**：智能适应、1:1原始大小、自定义缩放(10%-1000%)
- **图片旋转**：支持90°旋转，可重置
- **全屏模式**：F11或双击进入，沉浸式体验
- **导航控制**：键盘/鼠标多种控制方式
- **幻灯片播放**：自动播放功能
- **图片信息**：详细EXIF信息查看
- **快捷键帮助**：完整帮助系统

### ⭐ 智能收藏系统

- **一键收藏**：星形按钮快速收藏/取消
- **持久化存储**：收藏状态自动保存
- **快速访问**：快捷键快速打开收藏夹
- **状态同步**：收藏状态实时更新显示

### 📚 历史记录管理

- **自动记录**：打开漫画后自动添加到历史
- **智能清理**：自动移除不存在的路径
- **快速访问**：快捷键快速查看最近浏览
- **数量限制**：默认保存最近10个漫画

## ⚙️ 配置系统

### 📝 配置概览

漫画阅读器提供23个可配置选项，支持导入/导出/重置，配置文件位于：

- **Windows**: `C:\Users\[用户名]\.comic_reader\settings.json`
- **macOS**: `~/.comic_reader/settings.json`
- **Linux**: `~/.comic_reader/settings.json`

### 🎨 界面配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `theme` | string | `light` | 主题模式 (light/dark/system) |
| `window_maximized` | bool | `false` | 启动时窗口最大化 |
| `sidebar_width` | int | `240` | 侧边栏宽度 (px) |
| `show_thumbnails` | bool | `true` | 显示缩略图 |
| `image_smooth` | bool | `true` | 图片平滑缩放 |
| `image_zoom_mode` | string | `fit_window` | 默认缩放模式 |

### 🖼️ 图片查看配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `image_preload` | bool | `true` | 预加载下一张图片 |
| `image_cache_size` | int | `100` | 图片缓存大小 (MB) |
| `image_thumbnail_size` | int | `200` | 缩略图大小 (px) |
| `slideshow_interval` | int | `3` | 幻灯片间隔 (秒) |

### ⌨️ 快捷键配置

支持自定义13个快捷键：

| 操作 | 默认快捷键 | 说明 |
|------|-----------|------|
| `open_folder` | `Ctrl+O` | 打开文件夹 |
| `scan_albums` | `F5` | 扫描漫画 |
| `open_recent` | `Ctrl+R` | 最近浏览 |
| `open_favorites` | `Ctrl+F` | 我的收藏 |
| `toggle_favorite` | `Ctrl+D` | 收藏/取消收藏 |
| `fullscreen` | `F11` | 全屏 |
| `next_image` | `Right` | 下一张图片 |
| `prev_image` | `Left` | 上一张图片 |
| `zoom_in` | `Ctrl++` | 放大 |
| `zoom_out` | `Ctrl+-` | 缩小 |
| `reset_zoom` | `Ctrl+0` | 重置缩放 |
| `rotate_right` | `Ctrl+R` | 顺时针旋转 |
| `rotate_left` | `Ctrl+Shift+R` | 逆时针旋转 |

### 🔍 扫描配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `scan_recursive` | bool | `true` | 递归扫描子文件夹 |
| `scan_hidden_folders` | bool | `false` | 扫描隐藏文件夹 |
| `image_formats` | list | `['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff']` | 支持的图片格式 |

### 📊 数据管理配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `max_recent` | int | `10` | 最近浏览最大数量 |
| `auto_save_window_state` | bool | `true` | 自动保存窗口状态 |
| `auto_switch_album` | bool | `true` | 启用相册间自动切换 |
| `show_switch_notification` | bool | `true` | 显示切换提示 |

### 💾 配置管理

#### 访问设置
- 点击侧边栏的 **"设置"** 按钮
- 或使用快捷键 (如果已配置)

#### 导入/导出配置
```bash
# 导出配置
设置对话框 → "导出配置" → 选择JSON文件

# 导入配置
设置对话框 → "导入配置" → 选择JSON文件
```

#### 重置配置
```bash
# 一键恢复所有默认设置
设置对话框 → "重置为默认"
```

### 📝 自定义配置示例

```json
{
  "theme": "dark",
  "max_recent": 20,
  "image_cache_size": 200,
  "shortcuts": {
    "open_folder": "Ctrl+Shift+O",
    "scan_albums": "F6"
  }
}
```

## 📚 完整文档

### 📋 用户文档

- ⌨️ [快捷键文档](docs/SHORTCUTS.md) - 完整的快捷键列表和使用技巧
- ⚙️ [配置说明](README.md#-配置系统) - 详细的配置项说明

### 🏗️ 开发文档

- 🏗️ [架构设计文档](docs/ARCHITECTURE.md) - 项目架构和技术实现