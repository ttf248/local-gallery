"""
极简主义漫画网格组件
基于HTML原型图设计：6列网格展示，悬停效果
使用组件库：AlbumCard, EmptyState, Pagination
"""

import sys
from pathlib import Path
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QScrollArea, QGridLayout, QFrame
)
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QFont

# 添加src路径
src_path = Path(__file__).parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from core.config import ConfigManager
from ui_pyqt6.style_manager import StyleManager
from ui_pyqt6.components.library import AlbumCard, EmptyState, Pagination


# 删除原有MinimalAlbumCard类，使用组件库的AlbumCard


class MinimalAlbumGrid(QWidget):
    """极简主义漫画网格"""

    # 定义信号
    albumClicked = pyqtSignal(str)
    favoriteClicked = pyqtSignal(str)

    def __init__(self, config_manager, parent=None):
        super().__init__(parent)
        self.config_manager = config_manager
        self.style_manager = StyleManager()
        self.albums = []
        self.current_view = 'grid'  # 'grid' or 'list'
        self.current_page = 1
        self.items_per_page = 24  # 每页显示24个（6列x4行）
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

        # 分页组件
        self.pagination = Pagination(
            current_page=1,
            total_pages=1,
            parent=self,
            style_manager=self.style_manager
        )
        self.pagination.pageChanged.connect(self.on_page_changed)
        layout.addWidget(self.pagination)

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

        # 计算分页
        total_pages = (len(self.albums) + self.items_per_page - 1) // self.items_per_page
        self.pagination.set_total_pages(total_pages if total_pages > 0 else 1)

        # 获取当前页数据
        start_index = (self.current_page - 1) * self.items_per_page
        end_index = min(start_index + self.items_per_page, len(self.albums))
        page_albums = self.albums[start_index:end_index]

        # 添加漫画卡片
        columns = 6 if self.current_view == 'grid' else 1

        for index, album in enumerate(page_albums):
            row = index // columns
            col = index % columns

            # 使用组件库的AlbumCard
            card = AlbumCard(
                album_data=album,
                config_manager=self.config_manager,
                parent=self.grid_container,
                style_manager=self.style_manager
            )
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

        # 使用组件库的EmptyState
        empty_state = EmptyState(
            title="暂无漫画",
            description="请选择文件夹并扫描以添加漫画",
            action_text="开始扫描",
            icon="📚",
            parent=self.grid_container,
            style_manager=self.style_manager
        )

        self.grid_layout.addWidget(empty_state, 0, 0, Qt.AlignmentFlag.AlignCenter)

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
        self.current_page = 1  # 重置到第一页
        self.refresh_grid()
        self.albums = original_albums

    def on_page_changed(self, page):
        """页码改变处理"""
        self.current_page = page
        self.refresh_grid()

    def set_page_size(self, size):
        """设置每页显示数量"""
        if size != self.items_per_page:
            self.items_per_page = size
            self.current_page = 1
            self.refresh_grid()
