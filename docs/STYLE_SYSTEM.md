# 极简主义样式系统

## 概述

基于HTML原型图设计的PyQt6极简主义样式系统，提供一致、现代的视觉体验。

## 设计原则

### 1. 极简主义
- **纯粹简洁**：去除冗余装饰，专注核心功能
- **留白艺术**：合理运用留白，让界面更舒适
- **清晰层次**：明确的信息架构和视觉层级
- **优雅交互**：自然流畅的动效和反馈

### 2. 色彩系统
遵循原型图配色方案：
- 主色：`#4A90E2` (极简蓝)
- 背景：`#F8F9FA` (浅灰)
- 边框：`#E9ECEF` (精细分割线)
- 文字：`#2C3E50` (深蓝灰)

## 核心组件

### StyleManager
位置：`src/ui_pyqt6/style_manager.py`

#### 功能特性
- 极简配色方案（浅色/深色）
- 设计规范（间距、圆角、阴影）
- 动画过渡支持
- 主题切换

#### 使用方式
```python
from ui_pyqt6.style_manager import StyleManager

# 初始化样式管理器
style_manager = StyleManager()

# 获取当前配色
colors = style_manager.get_colors()
primary_color = colors['minimal-blue']

# 获取字体
font = style_manager.get_font('base', QFont.Weight.Medium)

# 获取样式表
stylesheet = style_manager.get_stylesheet('sidebar')

# 切换主题
style_manager.toggle_theme()

# 获取设计规范
spacing = style_manager.get_spacing('lg')  # 16px
radius = style_manager.get_border_radius('md')  # 8px
```

### 主题配置
位置：`src/ui_pyqt6/theme/minimal.py`

#### 配色方案
- **MINIMAL_LIGHT**：浅色极简主题
- **MINIMAL_DARK**：深色极简主题

#### 设计规范
- **FONT_SYSTEM**：字体系统（Inter、PingFang SC等）
- **SPACING**：间距系统（基于4px）
- **BORDER_RADIUS**：圆角系统
- **SHADOWS**：阴影系统
- **ANIMATION**：动画时长

### QSS样式表
位置：`src/ui_pyqt6/qss/minimal.qss`

#### 特性
- 完整的QSS样式定义
- 组件状态（hover、pressed、disabled）
- 统一的设计语言
- 跨平台兼容

## 配色规范

### 浅色主题
```css
minimal-gray: #F8F9FA     /* 背景 */
minimal-border: #E9ECEF   /* 边框 */
minimal-text: #2C3E50     /* 文字 */
minimal-blue: #4A90E2     /* 强调 */
minimal-green: #50C878    /* 成功 */
minimal-red: #E74C3C      /* 错误 */
minimal-yellow: #F39C12   /* 警告 */
```

### 深色主题
```css
minimal-gray: #1A1D23     /* 背景 */
minimal-border: #2D3748   /* 边框 */
minimal-text: #E2E8F0     /* 文字 */
minimal-blue: #4A90E2     /* 强调 */
```

## 组件样式

### 按钮
- **主按钮**：实心蓝色背景，白色文字
- **次要按钮**：透明背景，蓝色边框和文字
- **文字按钮**：纯文字，无背景

### 输入框
- 白色背景
- 1px边框（#E9ECEF）
- 6px圆角
- 聚焦时边框变蓝色

### 卡片
- 白色背景
- 1px边框（#E9ECEF）
- 8px圆角
- 悬停时边框变蓝色

## 设计规范

### 间距系统
- xs: 4px
- sm: 8px
- md: 12px
- lg: 16px
- xl: 24px
- 2xl: 32px
- 3xl: 48px

### 圆角规范
- sm: 4px (按钮、输入框)
- md: 8px (卡片)
- lg: 12px (对话框)
- xl: 16px (大卡片)

### 字体系统
- xs: 11px (小标签)
- sm: 12px (按钮、菜单)
- base: 14px (正文)
- lg: 16px (小标题)
- xl: 18px (中标题)
- 2xl: 20px (Section标题)
- 3xl: 24px (页面标题)
- 4xl: 30px (主标题)

### 字体族
1. Inter
2. PingFang SC
3. Microsoft YaHei
4. SF Pro Display
5. Segoe UI
6. Roboto
7. system-ui
8. sans-serif

## 动画系统

### 动画时长
- fast: 150ms (点击反馈)
- normal: 200ms (悬停效果)
- slow: 300ms (页面切换)

### 缓动曲线
- OutCubic：用于自然减速
- Linear：用于恒定速度
- InOutCubic：用于对称过渡

### 悬停效果
- 卡片上移：translateY(-2px)
- 边框颜色过渡：0.2s ease
- 缩放效果：scale(1.02)

## 使用指南

### 在组件中应用样式
```python
class MinimalWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.init_ui()
        self.apply_style()

    def init_ui(self):
        # 初始化UI

    def apply_style(self):
        # 应用样式
        style_manager = StyleManager()
        self.setStyleSheet(style_manager.get_stylesheet('component_type'))
```

### 自定义组件样式
```python
# 在StyleManager中添加新样式
styles = {
    'custom_component': f"""
        QWidget {{
            background-color: {colors['card-bg']};
            border: 1px solid {colors['border-light']};
            border-radius: {self.border_radius['md']}px;
        }}
    """
}
```

### 动画效果
```python
# 应用悬停动画
def enterEvent(self, event):
    self.animation = QPropertyAnimation(self, b"geometry")
    self.animation.setDuration(200)
    self.animation.setEasingCurve(QEasingCurve.Type.OutCubic)
    self.animation.start()
```

## 最佳实践

### 1. 统一使用StyleManager
- 所有样式都通过StyleManager管理
- 避免直接在组件中硬编码样式
- 使用设计规范中的值

### 2. 组件化设计
- 每个UI组件都应有对应的样式定义
- 保持组件的独立性和可复用性
- 使用ObjectName便于样式选择

### 3. 响应式布局
- 使用布局管理器而非固定尺寸
- 考虑不同屏幕尺寸的适配
- 保持合适的间距和比例

### 4. 性能优化
- 避免频繁的样式切换
- 合理使用QSS的继承机制
- 避免过于复杂的样式规则

## 主题切换

### 方式1：配置管理器
```python
config_manager = ConfigManager()
config_manager.set_theme('dark')
style_manager.toggle_theme()
```

### 方式2：StyleManager直接切换
```python
style_manager = StyleManager()
style_manager.toggle_theme()  # 浅色 <-> 深色
```

### 方式3：通过信号槽
```python
style_manager.themeChanged.connect(self.on_theme_changed)

def on_theme_changed(self, theme_name):
    # 主题切换后的处理
    self.refresh_styles()
```

## 兼容性

### 平台支持
- Windows 10/11 ✅
- macOS 12+ ✅
- Ubuntu 20.04+ ✅

### 依赖项
- PyQt6
- Python 3.8+

### 浏览器兼容性
- 不适用（桌面应用）

## 更新日志

### v2.0.0 - 极简主义样式系统
- ✅ 全新的极简配色方案
- ✅ 完整的设计规范系统
- ✅ 动画和过渡效果
- ✅ 主题切换支持
- ✅ QSS样式表
- ✅ 设计规范文档

## 贡献指南

如需修改样式系统：

1. 更新`minimal.py`中的设计规范
2. 修改`style_manager.py`中的逻辑
3. 更新`minimal.qss`样式表
4. 更新此文档
5. 测试所有主题切换

## 许可证

本样式系统遵循项目整体MIT许可证。
