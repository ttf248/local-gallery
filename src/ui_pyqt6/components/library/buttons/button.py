"""
基础按钮组件
所有按钮的基类
支持动画效果
"""

from PyQt6.QtWidgets import QPushButton, QHBoxLayout
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QFont

import sys
from pathlib import Path

# 添加src路径
src_path = Path(__file__).parent.parent.parent.parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from ..base.base_widget import BaseWidget
from ui_pyqt6.widgets.animated_widget import AnimatedButtonMixin


class Button(AnimatedButtonMixin, BaseWidget, QPushButton):
    """基础按钮组件 - 支持动画效果"""

    def __init__(self, text="", parent=None, style_manager=None):
        # 初始化基类（注意顺序：QWidget在最后）
        QPushButton.__init__(self, text, parent)
        BaseWidget.__init__(self, parent, style_manager)
        AnimatedButtonMixin.__init__(self, parent)

        # 设置按钮属性
        self.setObjectName("button")
        self.setCheckable(False)
        self.setCursor(Qt.CursorShape.PointingHandCursor)

        # 应用样式
        self.apply_button_style()

    def init_ui(self):
        """初始化UI - 按钮不需要额外的UI"""
        pass

    def apply_button_style(self):
        """应用按钮样式"""
        colors = self.style_manager.get_colors()
        font = self.style_manager.get_font('sm')
        radius = self.get_border_radius('sm')
        padding = self.get_spacing('md')

        self.setFont(font)
        self.setStyleSheet(f"""
            QPushButton#button {{
                background-color: {colors['bg-secondary']};
                color: {colors['text-primary']};
                border: 1px solid {colors['border-light']};
                padding: {padding}px {self.get_spacing('lg')}px;
                border-radius: {radius}px;
                min-width: 80px;
                min-height: 32px;
            }}
            QPushButton#button:hover {{
                background-color: {colors['bg-tertiary']};
                border-color: {colors['accent']};
            }}
            QPushButton#button:pressed {{
                background-color: {colors['accent-pressed']};
                color: {colors['text-white']};
            }}
            QPushButton#button:disabled {{
                background-color: {colors['border-medium']};
                color: {colors['text-tertiary']};
            }}
        """)

    def on_clicked(self):
        """点击事件处理 - 已被动画混入类处理"""
        pass

    def set_text(self, text):
        """设置按钮文字"""
        self.setText(text)

    def get_text(self):
        """获取按钮文字"""
        return self.text()

    def set_icon_text(self, icon, text):
        """设置带图标的文字"""
        # 简化实现，直接使用文字
        self.setText(f"{icon} {text}")
