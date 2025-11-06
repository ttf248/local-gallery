"""
动画混入类
为Widget添加动画功能
"""

import sys
from pathlib import Path
from PyQt6.QtCore import QObject, QPropertyAnimation, QEasingCurve, QRect, pyqtSignal
from PyQt6.QtWidgets import QWidget, QGraphicsOpacityEffect
from PyQt6.QtGui import QPainter, QColor

# 添加src路径
src_path = Path(__file__).parent.parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from ui_pyqt6.animation_manager import AnimationManager


class AnimatedWidget:
    """动画混入类 - 为Widget添加动画功能"""

    def __init__(self, parent=None):
        # 不调用super().__init__()以避免QObject冲突
        self.animation_manager = AnimationManager()
        self._setup_animation_support()

    def _setup_animation_support(self):
        """设置动画支持"""
        # 为悬停效果启用事件
        if hasattr(self, 'setMouseTracking'):
            self.setMouseTracking(True)

    def animate_fade_in(self, duration=300, easing=QEasingCurve.Type.OutCubic, callback=None):
        """淡入动画"""
        if not isinstance(self, QWidget):
            return None

        def on_finished():
            if callback:
                callback()

        return self.animation_manager.fade_in(self, duration, easing, on_finished)

    def animate_fade_out(self, duration=300, easing=QEasingCurve.Type.OutCubic, callback=None):
        """淡出动画"""
        if not isinstance(self, QWidget):
            return None

        def on_finished():
            if callback:
                callback()

        return self.animation_manager.fade_out(self, duration, easing, on_finished)

    def animate_slide_in(self, direction="left", duration=400, easing=QEasingCurve.Type.OutCubic):
        """滑入动画"""
        if not isinstance(self, QWidget):
            return None

        return self.animation_manager.slide_in(self, direction, duration, easing)

    def animate_slide_out(self, direction="left", duration=400, easing=QEasingCurve.Type.OutCubic, callback=None):
        """滑出动画"""
        if not isinstance(self, QWidget):
            return None

        def on_finished():
            if callback:
                callback()

        return self.animation_manager.slide_out(self, direction, duration, easing, on_finished)

    def animate_zoom_in(self, duration=300, easing=QEasingCurve.Type.OutBack, callback=None):
        """放大动画"""
        if not isinstance(self, QWidget):
            return None

        def on_finished():
            if callback:
                callback()

        return self.animation_manager.zoom_in(self, duration, easing, on_finished)

    def animate_zoom_out(self, duration=300, easing=QEasingCurve.Type.InBack, callback=None):
        """缩小动画"""
        if not isinstance(self, QWidget):
            return None

        def on_finished():
            if callback:
                callback()

        return self.animation_manager.zoom_out(self, duration, easing, on_finished)

    def animate_pulse(self, duration=1000, scale=1.1, easing=QEasingCurve.Type.InOutSine, callback=None):
        """脉冲动画"""
        if not isinstance(self, QWidget):
            return None

        def on_finished():
            if callback:
                callback()

        return self.animation_manager.pulse(self, duration, scale, easing, on_finished)

    def animate_hover_enter(self, duration=200):
        """悬停进入动画"""
        if not isinstance(self, QWidget):
            return None

        return self.animation_manager.hover_effect(self, 1.05, duration)

    def animate_hover_leave(self, duration=200):
        """悬停离开动画"""
        if not isinstance(self, QWidget):
            return None

        return self.animation_manager.leave_effect(self, duration)

    def stop_animation(self):
        """停止动画"""
        if isinstance(self, QWidget):
            self.animation_manager.stop_animation(self)

    def is_animating(self) -> bool:
        """检查是否在动画中"""
        if isinstance(self, QWidget):
            return self.animation_manager.is_animating(self)
        return False


class AnimatedButtonMixin(AnimatedWidget):
    """按钮动画混入"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._hover_enabled = True
        self._click_animation_enabled = True

    def enable_hover_animation(self, enabled=True):
        """启用/禁用悬停动画"""
        self._hover_enabled = enabled

    def enable_click_animation(self, enabled=True):
        """启用/禁用点击动画"""
        self._click_animation_enabled = enabled

    def enterEvent(self, event):
        """鼠标进入事件"""
        if self._hover_enabled:
            self.animate_hover_enter(150)
        super().enterEvent(event)

    def leaveEvent(self, event):
        """鼠标离开事件"""
        if self._hover_enabled:
            self.animate_hover_leave(150)
        super().leaveEvent(event)

    def mousePressEvent(self, event):
        """鼠标按下事件"""
        if self._click_animation_enabled and isinstance(self, QWidget):
            # 缩小效果
            self.animation_manager.zoom_out(self, 100, QEasingCurve.Type.InQuad)
        super().mousePressEvent(event)

    def mouseReleaseEvent(self, event):
        """鼠标释放事件"""
        if self._click_animation_enabled and isinstance(self, QWidget):
            # 恢复效果
            self.animation_manager.zoom_in(self, 150, QEasingCurve.Type.OutQuad)
        super().mouseReleaseEvent(event)


class AnimatedCardMixin(AnimatedWidget):
    """卡片动画混入"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._hover_scale = 1.02
        self._shadow_enabled = True

    def enable_shadow_animation(self, enabled=True):
        """启用/禁用阴影动画"""
        self._shadow_enabled = enabled

    def set_hover_scale(self, scale):
        """设置悬停缩放比例"""
        self._hover_scale = scale

    def enterEvent(self, event):
        """鼠标进入事件"""
        if isinstance(self, QWidget):
            # 悬停缩放
            self.animation_manager.hover_effect(self, self._hover_scale, 200)
        super().enterEvent(event)

    def leaveEvent(self, event):
        """鼠标离开事件"""
        if isinstance(self, QWidget):
            # 恢复原状
            self.animation_manager.leave_effect(self, 200)
        super().leaveEvent(event)

    def showEvent(self, event):
        """显示事件 - 添加淡入动画"""
        self.animate_fade_in(300)
        super().showEvent(event)

    def hideEvent(self, event):
        """隐藏事件 - 添加淡出动画"""
        self.animate_fade_out(300)
        super().hideEvent(event)


class TransitionManager:
    """页面过渡管理器"""

    # 定义过渡类型
    TRANSITION_FADE = "fade"           # 淡入淡出
    TRANSITION_SLIDE = "slide"         # 滑动
    TRANSITION_ZOOM = "zoom"           # 缩放
    TRANSITION_PUSH = "push"           # 推入

    def __init__(self, parent=None):
        # 不调用super().__init__()以避免QObject冲突
        self.animation_manager = AnimationManager()

    def transition_out(self, widget, transition_type=TRANSITION_FADE, duration=400, callback=None):
        """过渡退出"""
        if transition_type == self.TRANSITION_FADE:
            return self.animation_manager.fade_out(widget, duration, callback=callback)
        elif transition_type == self.TRANSITION_SLIDE:
            return self.animation_manager.slide_out(widget, "up", duration, callback=callback)
        elif transition_type == self.TRANSITION_ZOOM:
            return self.animation_manager.zoom_out(widget, duration, callback=callback)
        else:
            if callback:
                callback()
            return None

    def transition_in(self, widget, transition_type=TRANSITION_FADE, duration=400, callback=None):
        """过渡进入"""
        if transition_type == self.TRANSITION_FADE:
            return self.animation_manager.fade_in(widget, duration, callback=callback)
        elif transition_type == self.TRANSITION_SLIDE:
            return self.animation_manager.slide_in(widget, "down", duration, callback=callback)
        elif transition_type == self.TRANSITION_ZOOM:
            return self.animation_manager.zoom_in(widget, duration, callback=callback)
        else:
            if callback:
                callback()
            return None

    def transition_swap(self, old_widget, new_widget, transition_type=TRANSITION_FADE, duration=400):
        """过渡切换两个组件"""
        def show_new():
            self.transition_in(new_widget, transition_type, duration)

        self.transition_out(old_widget, transition_type, duration, callback=show_new)
