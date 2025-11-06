"""
极简主义侧边栏组件
基于HTML原型图设计：240px宽度，导航菜单，标签系统
"""

from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QPushButton, QLabel, QFrame, QScrollArea, QSizePolicy
)
from PyQt6.QtCore import Qt, pyqtSignal, QPropertyAnimation, QEasingCurve
from PyQt6.QtGui import QFont, QPalette, QColor


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
        parent_layout.addWidget(nav_title)

        # 导航按钮
        self.nav_buttons = {
            'home': ('🏠', '我的漫画', self.homeClicked),
            'favorites': ('❤️', '收藏', self.favoritesClicked, 8),
            'recent': ('⏰', '历史', self.recentClicked),
            'categories': ('📁', '分类', None),
            'imports': ('📥', '导入记录', None),
        }

        for key, data in self.nav_buttons.items():
            if len(data) == 3:
                icon, text, signal = data
                count = None
            else:
                icon, text, signal, count = data

            btn = self.create_nav_button(icon, text, count, signal)
            setattr(self, f"{key}_btn", btn)
            parent_layout.addWidget(btn)

        parent_layout.addSpacing(16)

    def create_nav_button(self, icon, text, count=None, signal=None):
        """创建导航按钮"""
        btn = QPushButton()
        btn.setObjectName("nav-button")
        btn.setCheckable(True)

        # 布局
        layout = QVBoxLayout(btn)
        layout.setContentsMargins(16, 12, 16, 12)
        layout.setSpacing(6)

        # 图标和文字布局
        content_layout = QHBoxLayout()

        # 图标
        icon_label = QLabel(icon)
        icon_label.setFont(QFont("Segoe UI Emoji", 16))
        icon_label.setFixedWidth(20)
        content_layout.addWidget(icon_label)

        # 文字
        text_label = QLabel(text)
        text_label.setObjectName("nav-text")
        text_label.setFont(QFont("PingFang SC", 14))
        content_layout.addWidget(text_label, 1)

        # 数量
        if count is not None:
            count_label = QLabel(str(count))
            count_label.setObjectName("nav-count")
            count_label.setFont(QFont("PingFang SC", 11))
            count_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            count_label.setFixedSize(20, 16)
            count_label.setStyleSheet("""
                QLabel {
                    background-color: #E3F2FD;
                    color: #4A90E2;
                    border-radius: 8px;
                }
            """)
            content_layout.addWidget(count_label)

        layout.addLayout(content_layout)

        # 连接信号
        if signal:
            btn.clicked.connect(signal)
            btn.clicked.connect(lambda: self.set_active_button(btn))

        return btn

    def create_tags_section(self, parent_layout):
        """创建标签区域"""
        # 标签标题
        tags_title = QLabel("Tags")
        tags_title.setObjectName("section-title")
        parent_layout.addWidget(tags_title)

        # 标签容器
        tags_layout = QHBoxLayout()
        tags_layout.setContentsMargins(16, 8, 16, 16)
        tags_layout.setSpacing(8)
        tags_layout.setWrapMode(QSizePolicy.Policy.WrapMode.Wrap)

        # 预定义标签
        tags = [
            ('冒险', '#E3F2FD', '#4A90E2'),
            ('爱情', '#E8F5E9', '#50C878'),
            ('奇幻', '#FFF3E0', '#F39C12'),
            ('科幻', '#FFEBEE', '#E74C3C'),
        ]

        for text, bg_color, text_color in tags:
            tag = self.create_tag(text, bg_color, text_color)
            tags_layout.addWidget(tag)

        tags_layout.addStretch()
        parent_layout.addLayout(tags_layout)

    def create_tag(self, text, bg_color, text_color):
        """创建标签"""
        label = QLabel(text)
        label.setObjectName("tag")
        label.setFont(QFont("PingFang SC", 12))
        label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        label.setFixedHeight(24)
        label.setStyleSheet(f"""
            QLabel {{
                background-color: {bg_color};
                color: {text_color};
                border-radius: 12px;
                padding: 0 12px;
            }}
        """)
        return label

    def set_active_button(self, button):
        """设置活动按钮"""
        if self.current_button:
            self.current_button.setChecked(False)

        button.setChecked(True)
        self.current_button = button

        # 添加点击动画
        self.animate_click(button)

    def animate_click(self, button):
        """点击动画效果"""
        animation = QPropertyAnimation(button, b"geometry")
        animation.setDuration(150)
        animation.setEasingCurve(QEasingCurve.Type.OutCubic)

        # 获取按钮当前几何
        geo = button.geometry()
        # 轻微缩放效果（通过调整几何模拟）
        animation.setStartValue(geo)
        animation.setEndValue(geo)
        animation.start()

    def set_home_active(self):
        """设置主页为活动状态"""
        if hasattr(self, 'home_btn'):
            self.set_active_button(self.home_btn)
