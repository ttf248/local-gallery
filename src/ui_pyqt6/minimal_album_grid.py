"""
极简主义漫画网格组件
基于HTML原型图设计：6列网格展示，悬停效果
"""

import sys
from pathlib import Path
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QScrollArea, QGridLayout,
    QFrame, QLabel, QPushButton, QSizePolicy, QSpacerItem
)
from PyQt6.QtCore import Qt, pyqtSignal, QPropertyAnimation, QEasingCurve, QRect
from PyQt6.QtGui import QFont, QPixmap, QPainter, QColor

# 添加src路径
src_path = Path(__file__).parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from core.config import ConfigManager


class MinimalAlbumCard(QFrame):
    """极简主义漫画卡片"""

    # 定义信号
    clicked = pyqtSignal(str)  # 专辑路径
    favoriteClicked = pyqtSignal(str)  # 收藏按钮

    def __init__(self, album_data, parent=None):
        super().__init__(parent)
        self.album_data = album_data
        self.is_favorite = False
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("minimal-album-card")
        self.setFixedSize(180, 260)
        self.setFrameShape(QFrame.Shape.Box)

        # 卡片布局
        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(8)

        # 封面区域
        self.create_cover_area(layout)

        # 信息区域
        self.create_info_area(layout)

        # 操作区域
        self.create_action_area(layout)

    def create_cover_area(self, parent_layout):
        """创建封面区域"""
        cover_frame = QFrame()
        cover_frame.setObjectName("album-cover")
        cover_frame.setFixedSize(164, 200)

        # 封面标签
        self.cover_label = QLabel()
        self.cover_label.setObjectName("cover-image")
        self.cover_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.cover_label.setFixedSize(164, 200)
        self.cover_label.setStyleSheet("""
            QLabel {
                background-color: #F8F9FA;
                border: 1px solid #E9ECEF;
                border-radius: 4px;
            }
        """)

        # 占位符图标
        placeholder = QLabel("🖼️")
        placeholder.setFont(QFont("Segoe UI Emoji", 48))
        placeholder.setAlignment(Qt.AlignmentFlag.AlignCenter)
        placeholder.setParent(self.cover_label)
        placeholder.setGeometry(0, 0, 164, 200)

        # 页数标签
        self.page_count_label = QLabel("120页")
        self.page_count_label.setObjectName("page-count")
        self.page_count_label.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignTop)
        self.page_count_label.setFixedSize(50, 20)
        self.page_count_label.setStyleSheet("""
            QLabel {
                background-color: rgba(255, 255, 255, 0.9);
                color: #6C757D;
                border-radius: 4px;
                padding: 2px 6px;
                font-size: 11px;
            }
        """)
        self.page_count_label.move(110, 5)

        cover_layout = QVBoxLayout(cover_frame)
        cover_layout.setContentsMargins(0, 0, 0, 0)
        cover_layout.addWidget(self.cover_label)

        parent_layout.addWidget(cover_frame)

    def create_info_area(self, parent_layout):
        """创建信息区域"""
        info_layout = QVBoxLayout()
        info_layout.setContentsMargins(4, 0, 4, 0)
        info_layout.setSpacing(4)

        # 标题
        self.title_label = QLabel(self.album_data.get('name', '未命名'))
        self.title_label.setObjectName("album-title")
        self.title_label.setFont(QFont("PingFang SC", 14, QFont.Weight.Medium))
        self.title_label.setMaximumHeight(20)
        self.title_label.setStyleSheet("""
            QLabel {
                color: #2C3E50;
            }
        """)
        info_layout.addWidget(self.title_label)

        # 作者
        self.author_label = QLabel(self.album_data.get('author', '未知作者'))
        self.author_label.setObjectName("album-author")
        self.author_label.setFont(QFont("PingFang SC", 12))
        self.author_label.setMaximumHeight(18)
        self.author_label.setStyleSheet("""
            QLabel {
                color: #6C757D;
            }
        """)
        info_layout.addWidget(self.author_label)

        parent_layout.addLayout(info_layout)

    def create_action_area(self, parent_layout):
        """创建操作区域"""
        action_layout = QHBoxLayout()
        action_layout.setContentsMargins(4, 0, 4, 0)
        action_layout.setSpacing(8)

        # 评分
        rating_layout = QHBoxLayout()
        rating_layout.setSpacing(4)

        star_icon = QLabel("⭐")
        star_icon.setFont(QFont("Segoe UI Emoji", 12))
        rating_layout.addWidget(star_icon)

        self.rating_label = QLabel("9.2")
        self.rating_label.setObjectName("album-rating")
        self.rating_label.setFont(QFont("PingFang SC", 12))
        self.rating_label.setStyleSheet("""
            QLabel {
                color: #6C757D;
            }
        """)
        rating_layout.addWidget(self.rating_label)

        action_layout.addLayout(rating_layout)

        action_layout.addStretch()

        # 收藏按钮
        self.favorite_btn = QPushButton()
        self.favorite_btn.setObjectName("favorite-button")
        self.favorite_btn.setFixedSize(24, 24)
        self.favorite_btn.setCheckable(True)
        self.favorite_btn.clicked.connect(self.on_favorite_clicked)
        action_layout.addWidget(self.favorite_btn)

        # 播放按钮
        self.play_btn = QPushButton()
        self.play_btn.setObjectName("play-button")
        self.play_btn.setFixedSize(24, 24)
        self.play_btn.setIcon(QIcon("▶"))
        self.play_btn.clicked.connect(self.on_play_clicked)
        action_layout.addWidget(self.play_btn)

        parent_layout.addLayout(action_layout)

    def on_favorite_clicked(self):
        """收藏按钮点击"""
        self.favoriteClicked.emit(self.album_data.get('path', ''))

    def on_play_clicked(self):
        """播放按钮点击"""
        self.clicked.emit(self.album_data.get('path', ''))

    def set_favorite(self, is_favorite):
        """设置收藏状态"""
        self.is_favorite = is_favorite
        self.favorite_btn.setChecked(is_favorite)

        if is_favorite:
            self.favorite_btn.setStyleSheet("""
                QPushButton {
                    color: #E74C3C;
                    border: none;
                    font-size: 16px;
                }
            """)
        else:
            self.favorite_btn.setStyleSheet("""
                QPushButton {
                    color: #ADB5BD;
                    border: none;
                    font-size: 16px;
                }
            """)

    def set_rating(self, rating):
        """设置评分"""
        self.rating_label.setText(f"{rating:.1f}")

    def set_page_count(self, count):
        """设置页数"""
        self.page_count_label.setText(f"{count}页")


class MinimalAlbumGrid(QWidget):
    """极简主义漫画网格"""

    # 定义信号
    albumClicked = pyqtSignal(str)
    favoriteClicked = pyqtSignal(str)

    def __init__(self, config_manager, parent=None):
        super().__init__(parent)
        self.config_manager = config_manager
        self.albums = []
        self.current_view = 'grid'  # 'grid' or 'list'
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("minimal-album-grid")

        # 主布局
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # 创建滚动区域
        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        scroll_area.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        scroll_area.setObjectName("album-grid-scroll")
        scroll_area.setFrameShape(QFrame.Shape.NoFrame)

        # 网格容器
        self.grid_container = QWidget()
        self.grid_container.setObjectName("album-grid-container")
        self.grid_layout = QGridLayout(self.grid_container)
        self.grid_layout.setContentsMargins(24, 24, 24, 24)
        self.grid_layout.setSpacing(20)
        self.grid_layout.setAlignment(Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignLeft)

        scroll_area.setWidget(self.grid_container)
        layout.addWidget(scroll_area, 1)

    def update_albums(self, albums):
        """更新漫画列表"""
        self.albums = albums
        self.refresh_grid()

    def refresh_grid(self):
        """刷新网格"""
        # 清除现有卡片
        for i in range(self.grid_layout.count()):
            child = self.grid_layout.itemAt(i).widget()
            if child:
                child.setParent(None)

        if not self.albums:
            self.show_empty_state()
            return

        # 添加漫画卡片
        columns = 6 if self.current_view == 'grid' else 1

        for index, album in enumerate(self.albums):
            row = index // columns
            col = index % columns

            card = MinimalAlbumCard(album)
            card.clicked.connect(self.albumClicked.emit)
            card.favoriteClicked.connect(self.favoriteClicked.emit)

            # 设置收藏状态
            if self.config_manager:
                is_fav = self.config_manager.is_favorite(album.get('path', ''))
                card.set_favorite(is_fav)

            # 设置评分
            rating = album.get('rating', 9.0)
            card.set_rating(rating)

            # 设置页数
            page_count = album.get('image_count', 0)
            card.set_page_count(page_count)

            self.grid_layout.addWidget(card, row, col)

    def show_empty_state(self):
        """显示空状态"""
        # 清除现有卡片
        for i in range(self.grid_layout.count()):
            child = self.grid_layout.itemAt(i).widget()
            if child:
                child.setParent(None)

        # 空状态标签
        empty_label = QLabel("暂无漫画\n请选择文件夹并扫描")
        empty_label.setObjectName("empty-state")
        empty_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        empty_label.setFont(QFont("PingFang SC", 16))
        empty_label.setStyleSheet("""
            QLabel {
                color: #ADB5BD;
            }
        """)
        empty_label.setFixedSize(400, 200)

        self.grid_layout.addWidget(empty_label, 0, 0, Qt.AlignmentFlag.AlignCenter)

    def set_view_mode(self, mode):
        """设置视图模式"""
        if self.current_view != mode:
            self.current_view = mode
            self.refresh_grid()

    def apply_filter(self, filter_text):
        """应用筛选"""
        if not filter_text:
            self.refresh_grid()
            return

        filtered_albums = []
        for album in self.albums:
            name = album.get('name', '').lower()
            author = album.get('author', '').lower()
            if filter_text.lower() in name or filter_text.lower() in author:
                filtered_albums.append(album)

        # 临时更新列表
        original_albums = self.albums
        self.albums = filtered_albums
        self.refresh_grid()
        self.albums = original_albums
