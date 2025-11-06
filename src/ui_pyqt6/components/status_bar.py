"""
PyQt6状态栏组件
显示状态信息
"""

from PyQt6.QtWidgets import QStatusBar, QLabel
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QFont

class StatusBar(QStatusBar):
    """状态栏组件"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("status_bar")

        # 主状态标签
        self.status_label = QLabel("准备就绪")
        self.status_label.setObjectName("status_label")
        self.addWidget(self.status_label)

        # 分隔符
        separator = QLabel(" | ")
        separator.setObjectName("separator")
        self.addPermanentWidget(separator)

        # 信息标签
        self.info_label = QLabel("")
        self.info_label.setObjectName("info_label")
        self.addPermanentWidget(self.info_label)

    def set_status(self, text, msg_type="info"):
        """设置状态信息"""
        self.status_label.setText(text)

        # 根据消息类型设置颜色
        colors = {
            "info": "#86868B",
            "success": "#34C759",
            "warning": "#FF9500",
            "error": "#FF3B30",
        }
        color = colors.get(msg_type, "#86868B")
        self.status_label.setStyleSheet(f"color: {color};")

    def set_info(self, text):
        """设置附加信息"""
        self.info_label.setText(text)
