"""
PyQt6工具栏组件
顶部操作栏
"""

from PyQt6.QtWidgets import (
    QWidget, QHBoxLayout, QPushButton, QLineEdit, QComboBox,
    QLabel, QSpacerItem, QSizePolicy
)
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QFont

class Toolbar(QWidget):
    """工具栏组件"""

    # 定义信号
    browseClicked = pyqtSignal()
    scanClicked = pyqtSignal()
    filterChanged = pyqtSignal(str)
    themeClicked = pyqtSignal()
    settingsClicked = pyqtSignal()
    searchTextChanged = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("toolbar")
        self.setFixedHeight(64)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(16, 8, 16, 8)
        layout.setSpacing(8)

        # 左侧操作按钮
        self.create_left_panel(layout)

        # 中间搜索框
        self.create_search_panel(layout)

        # 右侧功能按钮
        self.create_right_panel(layout)

    def create_left_panel(self, layout):
        """创建左侧操作面板"""
        self.browse_btn = QPushButton("📁 选择文件夹")
        self.browse_btn.setObjectName("browse_button")
        self.browse_btn.clicked.connect(self.browseClicked)

        self.scan_btn = QPushButton("🔍 扫描")
        self.scan_btn.setObjectName("scan_button")
        self.scan_btn.clicked.connect(self.scanClicked)

        layout.addWidget(self.browse_btn)
        layout.addWidget(self.scan_btn)

        # 分隔线
        layout.addWidget(self.create_separator())

    def create_search_panel(self, layout):
        """创建搜索面板"""
        # 搜索框
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("🔍 搜索漫画...")
        self.search_input.textChanged.connect(self.searchTextChanged)
        self.search_input.setObjectName("search_input")

        # 筛选下拉框
        self.filter_combo = QComboBox()
        self.filter_combo.addItems(["全部", "图片数", "最新", "收藏"])
        self.filter_combo.currentTextChanged.connect(self.filterChanged)
        self.filter_combo.setObjectName("filter_combo")

        layout.addWidget(self.search_input, 2)  # 搜索框占据更多空间
        layout.addWidget(self.filter_combo)

        # 分隔线
        layout.addWidget(self.create_separator())

    def create_right_panel(self, layout):
        """创建右侧功能面板"""
        self.theme_btn = QPushButton("🌙")
        self.theme_btn.setObjectName("theme_button")
        self.theme_btn.setToolTip("切换主题")
        self.theme_btn.clicked.connect(self.themeClicked)

        self.settings_btn = QPushButton("⚙️")
        self.settings_btn.setObjectName("settings_button")
        self.settings_btn.setToolTip("设置")
        self.settings_btn.clicked.connect(self.settingsClicked)

        layout.addWidget(self.theme_btn)
        layout.addWidget(self.settings_btn)

    def create_separator(self):
        """创建分隔线"""
        separator = QLabel("|")
        separator.setObjectName("separator")
        separator.setStyleSheet("color: #86868B; font-size: 16px;")
        return separator

    def set_search_text(self, text):
        """设置搜索框文本"""
        if hasattr(self, 'search_input'):
            self.search_input.setText(text)

    def set_filter(self, filter_text):
        """设置筛选条件"""
        if hasattr(self, 'filter_combo'):
            index = self.filter_combo.findText(filter_text)
            if index >= 0:
                self.filter_combo.setCurrentIndex(index)
