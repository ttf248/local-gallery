"""
图标按钮组件
仅显示图标的按钮
"""

from PyQt6.QtWidgets import QPushButton
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QIcon, QFont

from .button import Button


class IconButton(Button):
    """图标按钮组件"""

    def __init__(self, icon="", parent=None, style_manager=None):
        super().__init__(icon, parent, style_manager)
        self.setObjectName("icon-button")

    def apply_button_style(self):
        """应用图标按钮样式"""
        colors = self.style_manager.get_colors()
        font = self.style_manager.get_font('lg')
        radius = self.get_border_radius('sm')
        padding = self.get_spacing('sm')

        self.setFont(font)
        self.setStyleSheet(f"""
            QPushButton#icon-button {{
                background-color: {colors['bg-secondary']};
                color: {colors['text-primary']};
                border: 1px solid {colors['border-light']};
                padding: {padding}px;
                border-radius: {radius}px;
                min-width: 32px;
                min-height: 32px;
            }}
            QPushButton#icon-button:hover {{
                background-color: {colors['bg-tertiary']};
                border-color: {colors['accent']};
            }}
            QPushButton#icon-button:pressed {{
                background-color: {colors['accent-pressed']};
                color: {colors['text-white']};
            }}
            QPushButton#icon-button:disabled {{
                background-color: {colors['border-medium']};
                color: {colors['text-tertiary']};
            }}
        """)
