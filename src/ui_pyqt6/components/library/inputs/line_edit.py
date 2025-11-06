"""
文本输入框组件
"""

from PyQt6.QtWidgets import QLineEdit
from PyQt6.QtCore import pyqtSignal, Qt
from PyQt6.QtGui import QFont

from ..base.base_widget import BaseWidget


class LineEdit(QLineEdit, BaseWidget):
    """文本输入框组件"""

    def __init__(self, text="", placeholder="", parent=None, style_manager=None):
        # 初始化基类 - QLineEdit先调用
        QLineEdit.__init__(self, text, parent)
        BaseWidget.__init__(self, parent, style_manager)

        self.setObjectName("line-edit")
        self.setPlaceholderText(placeholder)

        # 应用样式
        self.apply_line_edit_style()

        # 连接信号
        self.textChanged.connect(self.on_text_changed)
        self.returnPressed.connect(self.on_return_pressed)
        self.selectionChanged.connect(self.on_selection_changed)

    def init_ui(self):
        """初始化UI"""
        pass

    def apply_line_edit_style(self):
        """应用输入框样式"""
        colors = self.style_manager.get_colors()
        font = self.style_manager.get_font('sm')
        radius = self.get_border_radius('sm')
        padding = self.get_spacing('sm')

        self.setFont(font)
        self.setStyleSheet(f"""
            QLineEdit#line-edit {{
                background-color: {colors['bg-primary']};
                color: {colors['text-primary']};
                border: 1px solid {colors['border-light']};
                padding: {padding}px {self.get_spacing('md')}px;
                border-radius: {radius}px;
                font-size: {self.style_manager.font_sizes['sm']}px;
                selection-background-color: {colors['accent']};
                min-height: 32px;
            }}
            QLineEdit#line-edit:focus {{
                border-color: {colors['accent']};
            }}
            QLineEdit#line-edit:disabled {{
                background-color: {colors['bg-tertiary']};
                color: {colors['text-tertiary']};
            }}
        """)

    def on_text_changed(self, text):
        """文本变化处理"""
        pass

    def on_return_pressed(self):
        """回车键处理"""
        pass

    def on_selection_changed(self):
        """选择变化处理"""
        pass

    def set_placeholder(self, text):
        """设置占位符文字"""
        self.setPlaceholderText(text)

    def get_text(self) -> str:
        """获取输入文字"""
        return self.text()

    def set_text(self, text):
        """设置输入文字"""
        self.setText(text)
