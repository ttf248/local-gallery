"""
极简主义侧边栏组件
基于HTML原型图设计：240px宽度，导航菜单，标签系统
使用组件库：NavButton, Tag
"""

from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QLabel, QFrame, QScrollArea, QSizePolicy, QHBoxLayout
)
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QFont

import sys
from pathlib import Path

# 添加src路径
src_path = Path(__file__).parent.parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from ui_pyqt6.style_manager import StyleManager
from ui_pyqt6.components.library import NavButton, Tag


class MinimalSidebar(QWidget):
    """极简主义侧边栏导航组件"""

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
        self.current_button = None
        self.style_manager = StyleManager()
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("minimal-sidebar")

        # 主布局
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # 顶部Logo区域
        self.create_header()

        # 创建滚动区域
        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        scroll_area.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        scroll_area.setObjectName("sidebar-scroll")
        scroll_area.setFrameShape(QFrame.Shape.NoFrame)

        # 滚动内容
        scroll_content = QWidget()
        scroll_content.setObjectName("sidebar-content")
        scroll_layout = QVBoxLayout(scroll_content)
        scroll_layout.setContentsMargins(0, 0, 0, 0)
        scroll_layout.setSpacing(0)

        # 导航菜单
        self.create_navigation(scroll_layout)

        # 标签区域
        self.create_tags_section(scroll_layout)

        # 添加弹性空间
        scroll_layout.addStretch()

        scroll_area.setWidget(scroll_content)
        layout.addWidget(scroll_area, 1)

    def create_header(self):
        """创建顶部Logo区域"""
        header_frame = QFrame()
        header_frame.setObjectName("sidebar-header")
        header_frame.setFixedHeight(72)

        layout = QVBoxLayout(header_frame)
        layout.setContentsMargins(24, 16, 24, 16)

        # Logo和标题
        title_layout = QVBoxLayout()

        # 图标和标题
        icon_label = QLabel("📖")
        icon_label.setFont(QFont("Segoe UI Emoji", 24))
        icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)

        app_title = QLabel("漫画阅读器")
        app_title.setObjectName("app-title")
        app_title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        app_title.setFont(QFont("PingFang SC", 16, QFont.Weight.Medium))

        title_layout.addWidget(icon_label)
        title_layout.addWidget(app_title)
        layout.addLayout(title_layout)

        self.layout().addWidget(header_frame)

    def create_navigation(self, parent_layout):
        """创建导航菜单"""
        # 导航标题
        nav_title = QLabel("Navigation")
        nav_title.setObjectName("section-title")
        nav_title.setFont(self.style_manager.get_font('sm'))
        nav_title.setStyleSheet(f"""
            QLabel {{
                color: {self.style_manager.get_colors()['text-tertiary']};
                font-size: {self.style_manager.font_sizes['xs']}px;
                font-weight: 500;
                padding: 16px;
            }}
        """)
        parent_layout.addWidget(nav_title)

        # 导航按钮 - 使用组件库的NavButton
        self.home_btn = NavButton(
            text="我的漫画",
            icon="🏠",
            is_active=True,
            parent=self,
            style_manager=self.style_manager
        )
        self.home_btn.clicked.connect(self.homeClicked)
        self.home_btn.clicked.connect(lambda: self.set_active_button(self.home_btn))
        parent_layout.addWidget(self.home_btn)

        self.favorites_btn = NavButton(
            text="收藏",
            icon="❤️",
            is_active=False,
            parent=self,
            style_manager=self.style_manager
        )
        self.favorites_btn.clicked.connect(self.favoritesClicked)
        self.favorites_btn.clicked.connect(lambda: self.set_active_button(self.favorites_btn))
        parent_layout.addWidget(self.favorites_btn)

        self.recent_btn = NavButton(
            text="历史",
            icon="⏰",
            is_active=False,
            parent=self,
            style_manager=self.style_manager
        )
        self.recent_btn.clicked.connect(self.recentClicked)
        self.recent_btn.clicked.connect(lambda: self.set_active_button(self.recent_btn))
        parent_layout.addWidget(self.recent_btn)

        # 不带信号的导航项
        self.categories_btn = NavButton(
            text="分类",
            icon="📁",
            is_active=False,
            parent=self,
            style_manager=self.style_manager
        )
        parent_layout.addWidget(self.categories_btn)

        self.imports_btn = NavButton(
            text="导入记录",
            icon="📥",
            is_active=False,
            parent=self,
            style_manager=self.style_manager
        )
        parent_layout.addWidget(self.imports_btn)

        parent_layout.addSpacing(16)

# 删除原有create_nav_button方法，使用组件库的NavButton

    def create_tags_section(self, parent_layout):
        """创建标签区域"""
        # 标签标题
        tags_title = QLabel("Tags")
        tags_title.setObjectName("section-title")
        tags_title.setFont(self.style_manager.get_font('sm'))
        tags_title.setStyleSheet(f"""
            QLabel {{
                color: {self.style_manager.get_colors()['text-tertiary']};
                font-size: {self.style_manager.font_sizes['xs']}px;
                font-weight: 500;
                padding: 16px;
            }}
        """)
        parent_layout.addWidget(tags_title)

        # 标签容器
        tags_layout = QHBoxLayout()
        tags_layout.setContentsMargins(16, 8, 16, 16)
        tags_layout.setSpacing(8)

        # 预定义标签 - 使用组件库的Tag
        tags = [
            ('冒险', '#E3F2FD', '#4A90E2'),
            ('爱情', '#E8F5E9', '#50C878'),
            ('奇幻', '#FFF3E0', '#F39C12'),
            ('科幻', '#FFEBEE', '#E74C3C'),
        ]

        for text, bg_color, text_color in tags:
            tag = Tag(
                text=text,
                bg_color=bg_color,
                text_color=text_color,
                parent=self,
                style_manager=self.style_manager
            )
            tags_layout.addWidget(tag)

        tags_layout.addStretch()
        parent_layout.addLayout(tags_layout)

    def set_active_button(self, button):
        """设置活动按钮"""
        if self.current_button:
            self.current_button.set_active(False)

        button.set_active(True)
        self.current_button = button

    def set_home_active(self):
        """设置主页为活动状态"""
        if hasattr(self, 'home_btn'):
            self.set_active_button(self.home_btn)
