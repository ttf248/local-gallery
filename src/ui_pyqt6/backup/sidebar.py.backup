"""
PyQt6侧边栏组件
导航菜单和快速操作
"""

from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QPushButton, QLabel, QFrame
)
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QFont, QIcon

class Sidebar(QWidget):
    """侧边栏导航组件"""

    # 定义信号
    homeClicked = pyqtSignal()
    browseClicked = pyqtSignal()
    scanClicked = pyqtSignal()
    recentClicked = pyqtSignal()
    favoritesClicked = pyqtSignal()
    settingsClicked = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedWidth(240)
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("sidebar")
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # 顶部Logo区域
        self.create_header()

        # 导航菜单
        self.create_navigation()

        # 添加弹性空间
        layout.addStretch()

        # 底部设置
        self.create_footer()

    def create_header(self):
        """创建顶部Logo区域"""
        header_frame = QFrame()
        header_frame.setObjectName("header")
        header_frame.setFixedHeight(80)

        layout = QVBoxLayout(header_frame)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)

        title = QLabel("📚 漫画阅读器")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setObjectName("title")
        font = QFont()
        font.setPointSize(16)
        font.setBold(True)
        title.setFont(font)

        layout.addWidget(title)

        self.layout().addWidget(header_frame)

    def create_navigation(self):
        """创建导航菜单"""
        nav_frame = QFrame()
        nav_frame.setObjectName("navigation")
        layout = QVBoxLayout(nav_frame)
        layout.setContentsMargins(8, 16, 8, 16)
        layout.setSpacing(4)

        # 导航按钮
        self.home_btn = self.create_nav_button("🏠", "主页", self.homeClicked)
        self.browse_btn = self.create_nav_button("📁", "浏览文件夹", self.browseClicked)
        self.scan_btn = self.create_nav_button("🔍", "扫描漫画", self.scanClicked)

        layout.addWidget(self.home_btn)
        layout.addWidget(self.browse_btn)
        layout.addWidget(self.scan_btn)

        # 分隔线
        separator = QFrame()
        separator.setFrameShape(QFrame.Shape.HLine)
        separator.setFrameShadow(QFrame.Shadow.Sunken)
        layout.addWidget(separator)

        # 收藏和历史
        self.recent_btn = self.create_nav_button("🕒", "最近浏览", self.recentClicked)
        self.favorites_btn = self.create_nav_button("⭐", "我的收藏", self.favoritesClicked)

        layout.addWidget(self.recent_btn)
        layout.addWidget(self.favorites_btn)

        self.layout().addWidget(nav_frame)

    def create_nav_button(self, icon, text, callback):
        """创建导航按钮"""
        btn = QPushButton(f"{icon}  {text}")
        btn.setCheckable(True)
        btn.setObjectName("nav_button")
        btn.clicked.connect(callback)
        return btn

    def create_footer(self):
        """创建底部设置"""
        footer_frame = QFrame()
        footer_frame.setObjectName("footer")
        footer_frame.setFixedHeight(60)

        layout = QVBoxLayout(footer_frame)
        layout.setContentsMargins(8, 8, 8, 8)

        settings_btn = QPushButton("⚙️ 设置")
        settings_btn.setObjectName("settings_button")
        settings_btn.clicked.connect(self.settingsClicked)

        layout.addWidget(settings_btn)

        self.layout().addWidget(footer_frame)

    def set_active_item(self, item):
        """设置激活的导航项"""
        buttons = {
            'home': self.home_btn,
            'browse': self.browse_btn,
            'scan': self.scan_btn,
            'recent': self.recent_btn,
            'favorites': self.favorites_btn,
        }

        # 重置所有按钮
        for btn in buttons.values():
            if btn:
                btn.setChecked(False)

        # 设置当前按钮为激活状态
        if item in buttons and buttons[item]:
            buttons[item].setChecked(True)
