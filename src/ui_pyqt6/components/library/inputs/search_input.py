"""
搜索输入框组件
带搜索图标的输入框
"""

from PyQt6.QtWidgets import QHBoxLayout, QWidget
from PyQt6.QtCore import pyqtSignal

from .line_edit import LineEdit
from ..buttons.icon_button import IconButton


class SearchInput(QWidget):
    """搜索输入框组件"""

    # 定义信号
    textChanged = pyqtSignal(str)
    returnPressed = pyqtSignal()

    def __init__(self, placeholder="搜索...", parent=None, style_manager=None):
        super().__init__(parent)
        self.style_manager = style_manager
        self.init_ui()
        self.apply_style()

        # 连接信号
        self.line_edit.textChanged.connect(self.textChanged.emit)
        self.line_edit.returnPressed.connect(self.returnPressed.emit)

    def init_ui(self):
        """初始化UI"""
        # 主布局
        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)

        # 搜索图标
        self.search_icon = IconButton("🔍", self, self.style_manager)
        self.search_icon.setEnabled(False)
        layout.addWidget(self.search_icon)

        # 搜索输入框
        self.line_edit = LineEdit("", "", self, self.style_manager)
        self.line_edit.setMinimumWidth(300)
        layout.addWidget(self.line_edit, 1)

    def apply_style(self):
        """应用样式"""
        colors = self.style_manager.get_colors()
        self.setStyleSheet(f"""
            QWidget {{
                background-color: {colors['bg-secondary']};
                border: 1px solid {colors['border-light']};
                border-radius: {self.style_manager.border_radius['sm']}px;
                padding: 8px 12px;
            }}
            QWidget:focus-within {{
                border-color: {colors['accent']};
            }}
        """)

    def set_placeholder(self, text):
        """设置占位符文字"""
        self.line_edit.set_placeholder(text)

    def get_text(self) -> str:
        """获取搜索文字"""
        return self.line_edit.get_text()

    def set_text(self, text):
        """设置搜索文字"""
        self.line_edit.set_text(text)

    def clear(self):
        """清空输入"""
        self.line_edit.clear()
