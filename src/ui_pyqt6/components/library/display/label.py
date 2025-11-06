"""
标签组件
用于显示文本信息
"""

from PyQt6.QtWidgets import QLabel
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QFont

from ..base.base_widget import BaseWidget


class Label(QLabel, BaseWidget):
    """标签组件"""

    def __init__(self, text="", parent=None, style_manager=None):
        # 初始化基类 - QLabel先调用
        QLabel.__init__(self, text, parent)
        BaseWidget.__init__(self, parent, style_manager)

        self.setObjectName("label")
        self.apply_label_style()

    def init_ui(self):
        """初始化UI"""
        pass

    def apply_label_style(self):
        """应用标签样式"""
        colors = self.style_manager.get_colors()
        font = self.style_manager.get_font('base')
        self.setFont(font)
        self.setStyleSheet(f"""
            QLabel#label {{
                color: {colors['text-primary']};
                font-size: {self.style_manager.font_sizes['base']}px;
            }}
        """)

    def set_text_color(self, color):
        """设置文字颜色"""
        self.setStyleSheet(f"""
            QLabel#label {{
                color: {color};
                font-size: {self.style_manager.font_sizes['base']}px;
            }}
        """)

    def set_font_size(self, size_key):
        """设置字体大小"""
        font = self.get_font(size_key)
        self.setFont(font)

    def set_bold(self, bold=True):
        """设置字体粗细"""
        font = self.font()
        font.setBold(bold)
        self.setFont(font)

    def set_alignment(self, alignment):
        """设置对齐方式"""
        self.setAlignment(alignment)
