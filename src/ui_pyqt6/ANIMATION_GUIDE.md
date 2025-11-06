# 动画系统集成指南

## 概述

从阶段8开始，我们为组件库添加了完整的动画支持，提供流畅的交互体验。动画系统基于PyQt6的QPropertyAnimation实现，支持淡入淡出、滑动、缩放、脉冲等多种效果。

## 架构

### 核心组件

1. **AnimationManager** (`src/ui_pyqt6/animation_manager.py`)
   - 统一的动画管理器
   - 提供各种动画效果的实现
   - 管理活动动画的生命周期

2. **AnimatedWidget** (`src/ui_pyqt6/widgets/animated_widget.py`)
   - 基础动画混入类
   - 为Widget添加动画能力

3. **AnimatedButtonMixin** (`src/ui_pyqt6/widgets/animated_widget.py`)
   - 按钮动画混入
   - 提供悬停和点击动画效果

4. **AnimatedCardMixin** (`src/ui_pyqt6/widgets/animated_widget.py`)
   - 卡片动画混入
   - 提供悬停缩放和淡入淡出效果

5. **TransitionManager** (`src/ui_pyqt6/widgets/animated_widget.py`)
   - 页面过渡管理器
   - 提供页面切换动画

## 已集成动画的组件

### 1. 按钮组件 (Button, PrimaryButton, SecondaryButton, IconButton)

**支持的动画效果：**
- 悬停动画：鼠标悬停时轻微缩放
- 点击动画：按下时缩小，释放时恢复
- 淡入动画：`animate_fade_in(duration, easing, callback)`
- 淡出动画：`animate_fade_out(duration, easing, callback)`
- 缩放动画：`animate_zoom_in/out(duration, easing, callback)`
- 脉冲动画：`animate_pulse(duration, scale, easing, callback)`

**使用示例：**
```python
from ui_pyqt6.components.library import PrimaryButton, SecondaryButton

# 创建按钮（自动获得悬停和点击动画）
btn = PrimaryButton("保存", parent, style_manager)

# 手动触发动画
btn.animate_fade_in(300)  # 淡入
btn.animate_zoom_in(200)  # 缩放
btn.animate_pulse(1000)   # 脉冲
```

### 2. 卡片组件 (Card)

**支持的动画效果：**
- 悬停缩放：鼠标悬停时放大
- 淡入动画：显示时淡入
- 淡出动画：隐藏时淡出
- 缩放动画：放大/缩小效果

**使用示例：**
```python
from ui_pyqt6.components.library import Card

# 创建卡片（自动获得悬停动画）
card = Card(parent, style_manager)
card.get_layout().addWidget(content)

# 手动触发动画
card.animate_fade_in(300)
card.animate_zoom_out(300)
```

## 动画效果详解

### 淡入/淡出 (Fade)
- 通过透明度变化实现
- 适用于显示/隐藏内容
- 默认时长：300ms
- 默认缓动：OutCubic

```python
widget.animate_fade_in(duration=300, callback=finished_callback)
widget.animate_fade_out(duration=300, callback=finished_callback)
```

### 滑动 (Slide)
- 通过几何位置变化实现
- 适用于页面过渡、抽屉等
- 支持4个方向：left, right, up, down
- 默认时长：400ms

```python
widget.animate_slide_in(direction="left", duration=400)
widget.animate_slide_out(direction="up", duration=400, callback=callback)
```

### 缩放 (Zoom)
- 通过几何尺寸变化实现
- 适用于强调、聚焦等
- 支持放大和缩小
- 默认时长：300ms
- 缩放比例：0.8 (缩小) / 1.2 (放大)

```python
widget.animate_zoom_in(duration=300, callback=callback)
widget.animate_zoom_out(duration=300, callback=callback)
```

### 脉冲 (Pulse)
- 循环缩放动画
- 适用于吸引注意力
- 往返一次为一个周期
- 默认时长：1000ms
- 缩放比例：1.1

```python
widget.animate_pulse(duration=1000, scale=1.1, callback=callback)
```

### 悬停效果 (Hover)
- 鼠标悬停时触发
- 轻微缩放效果
- 离开时恢复原状
- 默认缩放比例：1.05
- 默认时长：200ms

```python
# 悬停效果由混入类自动处理
# 手动控制
widget.animate_hover_enter(duration=200)
widget.animate_hover_leave(duration=200)
```

## 页面过渡效果

使用`TransitionManager`实现页面间的平滑过渡：

```python
from ui_pyqt6.widgets.animated_widget import TransitionManager

transition_manager = TransitionManager()

# 过渡退出
transition_manager.transition_out(
    old_widget,
    transition_type=TransitionManager.TRANSITION_FADE,
    duration=400,
    callback=show_new_widget
)

# 过渡进入
transition_manager.transition_in(
    new_widget,
    transition_type=TransitionManager.TRANSITION_SLIDE,
    duration=400
)

# 切换过渡
transition_manager.transition_swap(
    old_widget,
    new_widget,
    transition_type=TransitionManager.TRANSITION_ZOOM,
    duration=400
)
```

**过渡类型：**
- `TRANSITION_FADE`：淡入淡出
- `TRANSITION_SLIDE`：滑动
- `TRANSITION_ZOOM`：缩放
- `TRANSITION_PUSH`：推入（可扩展）

## 动画控制

### 检查动画状态
```python
if widget.is_animating():
    print("组件正在动画中")
```

### 停止动画
```python
# 停止单个组件的动画
widget.stop_animation()

# 停止所有动画（通过AnimationManager）
animation_manager.stop_all()
```

## 动画配置

### 自定义缓动曲线

所有动画支持自定义缓动曲线：

```python
from PyQt6.QtCore import QEasingCurve

# 使用预定义缓动
widget.animate_fade_in(
    duration=300,
    easing=QEasingCurve.Type.OutCubic
)
```

**常用缓动类型：**
- `OutCubic`：快速开始，慢速结束
- `InCubic`：慢速开始，快速结束
- `InOutCubic`：慢速开始，中间加速，慢速结束
- `OutBack`：超调后回弹
- `InOutSine`：平滑过渡

## 性能优化

### 1. 动画管理
- AnimationManager统一管理所有动画
- 避免重复创建动画对象
- 自动清理完成的动画

### 2. 动画限制
- 同时运行的动画数量适中
- 避免在短时间内触发大量动画
- 为大组件谨慎使用复杂动画

### 3. 硬件加速
- 动画使用GPU加速
- 合理使用QGraphicsEffect
- 避免频繁重绘

## 最佳实践

### 1. 动画时长
- 微交互：100-200ms
- 标准过渡：300-400ms
- 复杂过渡：500ms以上

### 2. 缓动选择
- 进入动画：使用In或InOut类型
- 退出动画：使用Out类型
- 强调动画：使用Back类型

### 3. 动画触发
- 用户操作：立即响应
- 状态变化：延迟100-200ms
- 页面过渡：根据复杂度调整

### 4. 动画组合
- 淡入 + 滑动：优雅的进入效果
- 缩放 + 淡出：强调后隐藏
- 脉冲 + 悬停：吸引注意

## 示例代码

### 完整按钮动画示例
```python
from PyQt6.QtWidgets import QWidget, QVBoxLayout
from PyQt6.QtCore import QEasingCurve
from ui_pyqt6.components.library import PrimaryButton

class AnimatedWidget(QWidget):
    def __init__(self):
        super().__init__()
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout(self)

        # 创建带动画的按钮
        btn = PrimaryButton("点击我", self, self.style_manager)
        btn.clicked.connect(self.on_button_clicked)
        layout.addWidget(btn)

    def on_button_clicked(self):
        sender = self.sender()
        # 执行缩放脉冲动画
        sender.animate_pulse(800, scale=1.2)
```

### 卡片悬停效果示例
```python
from ui_pyqt6.components.library import Card, Label

class AnimatedCard(Card):
    def __init__(self, title, content):
        super().__init__(padding=20, spacing=10)
        self.set_hover_scale(1.05)  # 设置悬停缩放比例

        # 添加内容
        title_label = Label(title, self, self.style_manager)
        title_label.set_font_size('lg')
        title_label.set_bold(True)
        self.get_layout().addWidget(title_label)

        content_label = Label(content, self, self.style_manager)
        self.get_layout().addWidget(content_label)
```

## 故障排除

### 动画不流畅
- 检查组件尺寸是否合理
- 减少同时运行的动画数量
- 使用硬件加速

### 动画卡顿
- 避免在动画过程中修改组件属性
- 使用合适的动画时长
- 检查是否有其他性能问题

### 内存泄漏
- 确保动画完成后正确清理
- 使用AnimationManager管理动画
- 避免创建过多动画对象

## 扩展动画

### 创建自定义动画
```python
def custom_animation(self, duration=300):
    """自定义动画示例"""
    from PyQt6.QtCore import QPropertyAnimation, QEasingCurve

    animation = QPropertyAnimation(self, b"geometry")
    animation.setDuration(duration)
    animation.setEasingCurve(QEasingCurve.Type.OutCubic)

    # 设置起始和结束值
    start_geo = self.geometry()
    end_geo = start_geo.adjusted(0, 0, 100, 100)

    animation.setStartValue(start_geo)
    animation.setEndValue(end_geo)
    animation.start()

    return animation
```

### 添加新的动画混入类
```python
class AnimatedListMixin(AnimatedWidget):
    """列表动画混入示例"""

    def animate_item_add(self, item, duration=300):
        """添加项动画"""
        item.setVisible(False)
        item.animate_fade_in(duration)

    def animate_item_remove(self, item, duration=300):
        """移除项动画"""
        def on_finished():
            item.setParent(None)
            item.deleteLater()

        item.animate_fade_out(duration, callback=on_finished)
```

## 总结

动画系统为组件库提供了强大的交互能力，通过合理的动画设计，可以显著提升用户体验。所有组件都基于统一的动画管理器，确保动画效果的一致性和性能。开发者可以轻松为任何组件添加动画效果，创造流畅、美观的用户界面。
