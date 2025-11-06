"""
标签组件
用于显示小标签
"""

from PyQt6.QtWidgets import QLabel
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QFont

from ..base.base_widget import BaseWidget


class Tag(BaseWidget):
    """标签组件 - 用于显示小标签"""

    clicked = pyqtSignal()  # 点击信号

    def __init__(self, text="", bg_color="#E3F2FD", text_color="#4A90E2", parent=None, style_manager=None):
        # 先设置属性，再调用父类初始化
        self.text = text
        self.bg_color = bg_color
        self.text_color = text_color
        super().__init__(parent, style_manager)
        # 注意：init_ui()会在BaseWidget.__init__()中自动调用

    def init_ui(self):
        """初始化UI"""
        # 标签
        self.label = QLabel(self.text, self)
        self.label.setObjectName("tag")
        self.label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.label.setFont(self.get_font('sm'))

        # 应用样式
        self.apply_tag_style()

        # 设置大小
        self.setFixedHeight(24)

    def apply_tag_style(self):
        """应用标签样式"""
        colors = self.style_manager.get_colors()
        radius = self.get_border_radius('lg')

        # 自定义颜色或使用默认颜色
        bg = self.bg_color
        text = self.text_color

        self.setStyleSheet(f"""
            QLabel#tag {{
                background-color: {bg};
                color: {text};
                border-radius: {radius}px;
                padding: 0 12px;
                font-size: {self.style_manager.font_sizes['sm']}px;
            }}
        """)

        # 调整大小以适应内容
        self.label.adjustSize()
        self.setFixedWidth(self.label.width() + 24)

    def set_text(self, text):
        """设置标签文字"""
        self.text = text
        self.label.setText(text)
        self.apply_tag_style()

    def get_text(self) -> str:
        """获取标签文字"""
        return self.text
