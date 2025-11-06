"""
次要按钮组件
用于次要操作的按钮
"""

from PyQt6.QtWidgets import QPushButton
from PyQt6.QtCore import Qt

from .button import Button


class SecondaryButton(Button):
    """次要按钮组件 - 用于次要操作"""

    def __init__(self, text="", parent=None, style_manager=None):
        super().__init__(text, parent, style_manager)
        self.setObjectName("secondary-button")

    def apply_button_style(self):
        """应用次要按钮样式"""
        colors = self.style_manager.get_colors()
        font = self.style_manager.get_font('sm', QPushButton.font(self).weight())
        radius = self.get_border_radius('sm')
        padding = self.get_spacing('md')

        self.setFont(font)
        self.setStyleSheet(f"""
            QPushButton#secondary-button {{
                background-color: transparent;
                color: {colors['accent']};
                border: 1px solid {colors['accent']};
                padding: {padding}px {self.get_spacing('lg')}px;
                border-radius: {radius}px;
                min-width: 80px;
                min-height: 32px;
                font-weight: 500;
            }}
            QPushButton#secondary-button:hover {{
                background-color: {colors['accent']};
                color: {colors['text-white']};
            }}
            QPushButton#secondary-button:pressed {{
                background-color: {colors['accent-pressed']};
            }}
            QPushButton#secondary-button:disabled {{
                border-color: {colors['border-medium']};
                color: {colors['text-tertiary']};
            }}
        """)
