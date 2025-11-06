"""
动画管理器
统一管理所有UI动画效果
"""

import sys
from pathlib import Path
from PyQt6.QtCore import QObject, QPropertyAnimation, QEasingCurve, QRect, QTimer, pyqtSignal
from PyQt6.QtWidgets import QWidget, QGraphicsOpacityEffect
from PyQt6.QtGui import QPainter, QColor

# 添加src路径
src_path = Path(__file__).parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from ui_pyqt6.style_manager import StyleManager


class AnimationManager(QObject):
    """动画管理器 - 统一管理所有动画效果"""

    # 定义动画类型
    ANIM_FADE_IN = "fade_in"       # 淡入
    ANIM_FADE_OUT = "fade_out"     # 淡出
    ANIM_SLIDE_LEFT = "slide_left"      # 左滑
    ANIM_SLIDE_RIGHT = "slide_right"    # 右滑
    ANIM_SLIDE_UP = "slide_up"          # 上滑
    ANIM_SLIDE_DOWN = "slide_down"      # 下滑
    ANIM_ZOOM_IN = "zoom_in"      # 放大
    ANIM_ZOOM_OUT = "zoom_out"    # 缩小
    ANIM_PULSE = "pulse"          # 脉冲
    ANIM_ROTATE = "rotate"        # 旋转
    ANIM_HOVER = "hover"          # 悬停

    def __init__(self, style_manager=None, parent=None):
        super().__init__(parent)
        self.style_manager = style_manager or StyleManager()
        self.animations = {}  # 存储活动动画
        self.effects = {}     # 存储动画效果

    def fade_in(self, widget, duration=300, easing=QEasingCurve.Type.OutCubic, finished_callback=None):
        """淡入动画"""
        effect = QGraphicsOpacityEffect(widget)
        widget.setGraphicsEffect(effect)
        self.effects[id(widget)] = effect

        animation = QPropertyAnimation(effect, b"opacity")
        animation.setDuration(duration)
        animation.setStartValue(0.0)
        animation.setEndValue(1.0)
        animation.setEasingCurve(easing)

        if finished_callback:
            animation.finished.connect(finished_callback)

        animation.start()
        self.animations[id(widget)] = animation
        return animation

    def fade_out(self, widget, duration=300, easing=QEasingCurve.Type.OutCubic, finished_callback=None):
        """淡出动画"""
        if id(widget) not in self.effects:
            effect = QGraphicsOpacityEffect(widget)
            widget.setGraphicsEffect(effect)
            self.effects[id(widget)] = effect
        else:
            effect = self.effects[id(widget)]

        animation = QPropertyAnimation(effect, b"opacity")
        animation.setDuration(duration)
        animation.setStartValue(1.0)
        animation.setEndValue(0.0)
        animation.setEasingCurve(easing)

        if finished_callback:
            animation.finished.connect(finished_callback)

        animation.start()
        self.animations[id(widget)] = animation
        return animation

    def slide_in(self, widget, direction="left", duration=400, easing=QEasingCurve.Type.OutCubic):
        """滑入动画"""
        # 保存原始位置
        original_rect = widget.geometry().adjusted(0, 0, 0, 0)

        # 根据方向设置起始位置
        if direction == "left":
            start_rect = QRect(original_rect.x() - 100, original_rect.y(),
                              original_rect.width(), original_rect.height())
        elif direction == "right":
            start_rect = QRect(original_rect.x() + 100, original_rect.y(),
                              original_rect.width(), original_rect.height())
        elif direction == "up":
            start_rect = QRect(original_rect.x(), original_rect.y() - 100,
                              original_rect.width(), original_rect.height())
        elif direction == "down":
            start_rect = QRect(original_rect.x(), original_rect.y() + 100,
                              original_rect.width(), original_rect.height())
        else:
            start_rect = original_rect

        # 设置起始位置
        widget.setGeometry(start_rect)
        widget.show()

        # 创建滑入动画
        animation = QPropertyAnimation(widget, b"geometry")
        animation.setDuration(duration)
        animation.setStartValue(start_rect)
        animation.setEndValue(original_rect)
        animation.setEasingCurve(easing)
        animation.start()

        self.animations[id(widget)] = animation
        return animation

    def slide_out(self, widget, direction="left", duration=400, easing=QEasingCurve.Type.OutCubic, finished_callback=None):
        """滑出动画"""
        original_rect = widget.geometry().adjusted(0, 0, 0, 0)

        # 根据方向设置结束位置
        if direction == "left":
            end_rect = QRect(original_rect.x() - 100, original_rect.y(),
                            original_rect.width(), original_rect.height())
        elif direction == "right":
            end_rect = QRect(original_rect.x() + 100, original_rect.y(),
                            original_rect.width(), original_rect.height())
        elif direction == "up":
            end_rect = QRect(original_rect.x(), original_rect.y() - 100,
                            original_rect.width(), original_rect.height())
        elif direction == "down":
            end_rect = QRect(original_rect.x(), original_rect.y() + 100,
                            original_rect.width(), original_rect.height())
        else:
            end_rect = original_rect

        # 创建滑出动画
        animation = QPropertyAnimation(widget, b"geometry")
        animation.setDuration(duration)
        animation.setStartValue(original_rect)
        animation.setEndValue(end_rect)
        animation.setEasingCurve(easing)

        if finished_callback:
            animation.finished.connect(finished_callback)

        animation.start()
        self.animations[id(widget)] = animation
        return animation

    def zoom_in(self, widget, duration=300, easing=QEasingCurve.Type.OutBack, finished_callback=None):
        """放大动画"""
        original_rect = widget.geometry().adjusted(0, 0, 0, 0)
        center = original_rect.center()

        # 起始尺寸（缩小）
        start_rect = QRect(
            center.x() - int(original_rect.width() * 0.8 / 2),
            center.y() - int(original_rect.height() * 0.8 / 2),
            int(original_rect.width() * 0.8),
            int(original_rect.height() * 0.8)
        )

        widget.setGeometry(start_rect)
        widget.show()

        animation = QPropertyAnimation(widget, b"geometry")
        animation.setDuration(duration)
        animation.setStartValue(start_rect)
        animation.setEndValue(original_rect)
        animation.setEasingCurve(easing)

        if finished_callback:
            animation.finished.connect(finished_callback)

        animation.start()
        self.animations[id(widget)] = animation
        return animation

    def zoom_out(self, widget, duration=300, easing=QEasingCurve.Type.InBack, finished_callback=None):
        """缩小动画"""
        original_rect = widget.geometry().adjusted(0, 0, 0, 0)
        center = original_rect.center()

        # 结束尺寸（缩小）
        end_rect = QRect(
            center.x() - int(original_rect.width() * 0.8 / 2),
            center.y() - int(original_rect.height() * 0.8 / 2),
            int(original_rect.width() * 0.8),
            int(original_rect.height() * 0.8)
        )

        animation = QPropertyAnimation(widget, b"geometry")
        animation.setDuration(duration)
        animation.setStartValue(original_rect)
        animation.setEndValue(end_rect)
        animation.setEasingCurve(easing)

        if finished_callback:
            animation.finished.connect(finished_callback)

        animation.start()
        self.animations[id(widget)] = animation
        return animation

    def pulse(self, widget, duration=1000, scale=1.1, easing=QEasingCurve.Type.InOutSine, callback=None):
        """脉冲动画（缩放循环）"""
        original_rect = widget.geometry().adjusted(0, 0, 0, 0)
        center = original_rect.center()

        # 放大尺寸
        larger_rect = QRect(
            center.x() - int(original_rect.width() * scale / 2),
            center.y() - int(original_rect.height() * scale / 2),
            int(original_rect.width() * scale),
            int(original_rect.height() * scale)
        )

        # 正向动画（放大）
        forward_anim = QPropertyAnimation(widget, b"geometry")
        forward_anim.setDuration(duration // 2)
        forward_anim.setStartValue(original_rect)
        forward_anim.setEndValue(larger_rect)
        forward_anim.setEasingCurve(easing)

        # 反向动画（缩小）
        backward_anim = QPropertyAnimation(widget, b"geometry")
        backward_anim.setDuration(duration // 2)
        backward_anim.setStartValue(larger_rect)
        backward_anim.setEndValue(original_rect)
        backward_anim.setEasingCurve(easing)

        # 连接动画序列
        forward_anim.finished.connect(backward_anim.start)

        if callback:
            backward_anim.finished.connect(callback)

        forward_anim.start()
        self.animations[id(widget)] = forward_anim
        return forward_anim

    def hover_effect(self, widget, scale=1.05, duration=200):
        """悬停效果（缩放）"""
        original_rect = widget.geometry().adjusted(0, 0, 0, 0)
        center = original_rect.center()

        # 悬停尺寸
        hover_rect = QRect(
            center.x() - int(original_rect.width() * scale / 2),
            center.y() - int(original_rect.height() * scale / 2),
            int(original_rect.width() * scale),
            int(original_rect.height() * scale)
        )

        animation = QPropertyAnimation(widget, b"geometry")
        animation.setDuration(duration)
        animation.setStartValue(original_rect)
        animation.setEndValue(hover_rect)
        animation.setEasingCurve(QEasingCurve.Type.OutQuad)

        animation.start()
        self.animations[id(widget)] = animation
        return animation

    def leave_effect(self, widget, duration=200):
        """离开效果（恢复原状）"""
        original_rect = widget.geometry().adjusted(0, 0, 0, 0)
        current_rect = widget.geometry()

        # 如果当前已经是原始大小，不需要动画
        if current_rect == original_rect:
            return None

        animation = QPropertyAnimation(widget, b"geometry")
        animation.setDuration(duration)
        animation.setStartValue(current_rect)
        animation.setEndValue(original_rect)
        animation.setEasingCurve(QEasingCurve.Type.OutQuad)

        animation.start()
        self.animations[id(widget)] = animation
        return animation

    def stop_animation(self, widget):
        """停止指定组件的动画"""
        anim_id = id(widget)
        if anim_id in self.animations:
            self.animations[anim_id].stop()
            del self.animations[anim_id]

    def stop_all(self):
        """停止所有动画"""
        for anim in self.animations.values():
            anim.stop()
        self.animations.clear()

    def is_animating(self, widget) -> bool:
        """检查组件是否在动画中"""
        anim_id = id(widget)
        if anim_id in self.animations:
            return self.animations[anim_id].state() == QPropertyAnimation.State.Running
        return False


class LoadingAnimator(QObject):
    """加载动画器"""

    def __init__(self, style_manager=None, parent=None):
        super().__init__(parent)
        self.style_manager = style_manager or StyleManager()
        self.timer = QTimer()
        self.timer.timeout.connect(self.update_animation)
        self.widgets = {}  # 存储加载中的组件和状态
        self.angle = 0

    def start(self, widget, style="spinner", duration=50):
        """开始加载动画"""
        self.widgets[id(widget)] = {
            'style': style,
            'angle': 0
        }

        if not self.timer.isActive():
            self.timer.start(duration)

        widget.update()

    def stop(self, widget):
        """停止加载动画"""
        anim_id = id(widget)
        if anim_id in self.widgets:
            del self.widgets[anim_id]
            widget.update()

        if not self.widgets:
            self.timer.stop()

    def update_animation(self):
        """更新动画"""
        self.angle = (self.angle + 30) % 360

        # 更新所有组件
        for anim_id in list(self.widgets.keys()):
            widget = None
            # 注意：这里需要通过某种方式找到对应的widget
            # 在实际使用中，建议直接调用widget.update()

    def get_angle(self) -> int:
        """获取当前角度"""
        return self.angle
