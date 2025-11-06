"""
基础组件类
所有组件的基类，提供通用功能和样式管理
"""

from PyQt6.QtWidgets import QWidget
from PyQt6.QtCore import QObject, pyqtSignal
from PyQt6.QtGui import QFont, QFontDatabase
from PyQt6.QtCore import QPropertyAnimation, QEasingCurve

import sys
from pathlib import Path

# 添加src路径
src_path = Path(__file__).parent.parent.parent.parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from ui_pyqt6.style_manager import StyleManager


class BaseWidget(QWidget):
    """所有组件的基类"""

    # 组件信号
    clicked = pyqtSignal()
    double_clicked = pyqtSignal()
    enter = pyqtSignal()  # 鼠标进入
    leave = pyqtSignal()  # 鼠标离开

    def __init__(self, parent=None, style_manager=None):
        super().__init__(parent)
        self.style_manager = style_manager or StyleManager()
        self.init_common_properties()
        self.init_ui()
        self.apply_base_style()

    def init_common_properties(self):
        """初始化通用属性"""
        # 组件状态
        self._is_enabled = True
        self._is_hovered = False
        self._is_focused = False

        # 动画对象
        self._animation = None

        # 组件属性
        self.setMouseTracking(True)

    def init_ui(self):
        """初始化UI - 子类应重写此方法"""
        pass

    def apply_base_style(self):
        """应用基础样式 - 子类可重写此方法"""
        # 应用字体
        self.setFont(self.style_manager.get_font('base'))

    def apply_style(self, style_class, **kwargs):
        """应用指定样式类"""
        # 子类应重写此方法以应用特定的样式
        pass

    def set_enabled(self, enabled: bool):
        """设置组件启用状态"""
        self._is_enabled = enabled
        self.setEnabled(enabled)
        self.update()

    def is_enabled(self) -> bool:
        """获取组件启用状态"""
        return self._is_enabled

    def enterEvent(self, event):
        """鼠标进入事件"""
        super().enterEvent(event)
        self._is_hovered = True
        self.on_enter()
        self.enter.emit()

    def leaveEvent(self, event):
        """鼠标离开事件"""
        super().leaveEvent(event)
        self._is_hovered = False
        self.on_leave()
        self.leave.emit()

    def on_enter(self):
        """鼠标进入时的处理 - 子类可重写"""
        pass

    def on_leave(self):
        """鼠标离开时的处理 - 子类可重写"""
        pass

    def animate_click(self, duration=150):
        """点击动画效果"""
        if self._animation:
            self._animation.stop()

        self._animation = QPropertyAnimation(self, b"geometry")
        self._animation.setDuration(duration)
        self._animation.setEasingCurve(QEasingCurve.Type.OutCubic)

        # 轻微缩放效果
        geo = self.geometry()
        self._animation.setStartValue(geo)
        self._animation.setEndValue(geo)
        self._animation.start()

    def animate_property(self, property_name, start_value, end_value, duration=200):
        """属性动画"""
        animation = QPropertyAnimation(self, property_name.encode())
        animation.setDuration(duration)
        animation.setStartValue(start_value)
        animation.setEndValue(end_value)
        animation.setEasingCurve(QEasingCurve.Type.OutCubic)
        animation.start()
        return animation

    def get_style_manager(self) -> StyleManager:
        """获取样式管理器"""
        return self.style_manager

    def get_color(self, key: str) -> str:
        """获取颜色值"""
        return self.style_manager.get_color(key)

    def get_spacing(self, key: str) -> int:
        """获取间距值"""
        return self.style_manager.get_spacing(key)

    def get_font(self, size_key='base', weight=QFont.Weight.Normal):
        """获取字体"""
        return self.style_manager.get_font(size_key, weight)

    def get_border_radius(self, key: str) -> int:
        """获取圆角值"""
        return self.style_manager.get_border_radius(key)
