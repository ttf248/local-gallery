"""
主按钮组件
高亮显示的主要操作按钮
"""

from PyQt6.QtWidgets import QPushButton
from PyQt6.QtCore import Qt

from .button import Button


class PrimaryButton(Button):
    """主按钮组件 - 用于主要操作"""

    def __init__(self, text="", parent=None, style_manager=None):
        super().__init__(text, parent, style_manager)
        self.setObjectName("primary-button")

    def apply_button_style(self):
        """应用主按钮样式"""
        colors = self.style_manager.get_colors()
        font = self.style_manager.get_font('sm', QPushButton.font(self).weight())
        radius = self.get_border_radius('sm')
        padding = self.get_spacing('md')

        self.setFont(font)
        self.setStyleSheet(f"""
            QPushButton#primary-button {{
                background-color: {colors['accent']};
                color: {colors['text-white']};
                border: 1px solid {colors['accent']};
                padding: {padding}px {self.get_spacing('lg')}px;
                border-radius: {radius}px;
                min-width: 80px;
                min-height: 32px;
                font-weight: 500;
            }}
            QPushButton#primary-button:hover {{
                background-color: {colors['accent-hover']};
            }}
            QPushButton#primary-button:pressed {{
                background-color: {colors['accent-pressed']};
            }}
            QPushButton#primary-button:disabled {{
                background-color: {colors['border-medium']};
                color: {colors['text-tertiary']};
                border-color: {colors['border-medium']};
            }}
        """)
