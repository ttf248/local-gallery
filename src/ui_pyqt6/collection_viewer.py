"""
PyQt6合集查看器
显示合集内的所有相册
"""

import os
import sys
from pathlib import Path
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QScrollArea, QFrame, QGridLayout, QSizePolicy
)
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QFont, QPixmap

# Add src to path if not already there
src_path = Path(__file__).parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from utils.logger import get_logger, log_info, log_warning, log_exception, log_debug


class CollectionViewer(QWidget):
    """合集查看器组件"""

    # 定义信号
    albumClicked = pyqtSignal(str)  # 传入相册路径
    backClicked = pyqtSignal()  # 返回信号

    def __init__(self, app, collection_data, parent=None):
        super().__init__(parent)
        self.app = app
        self.collection_data = collection_data
        self.logger = get_logger('ui.collection_viewer')
        self.albums = []  # 存储合集内的相册

        log_info(f"打开合集查看器: {collection_data.get('name', '')}", 'ui.collection_viewer')

        self.init_ui()
        self.load_collection_albums()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("collection_viewer")
        self.setMinimumSize(800, 600)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        # 顶部导航栏
        self.create_header(layout)

        # 相册网格
        self.create_albums_grid(layout)

    def create_header(self, parent_layout):
        """创建顶部导航栏"""
        header = QWidget()
        header.setObjectName("collection_header")
        header.setFixedHeight(80)
        header.setStyleSheet("""
            QWidget#collection_header {
                background-color: #F5F5F7;
                border-bottom: 1px solid #D2D2D7;
            }
        """)

        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(16, 16, 16, 16)

        # 返回按钮
        back_btn = QPushButton("← 返回")
        back_btn.setObjectName("back_button")
        back_btn.setFixedSize(100, 40)
        back_btn.clicked.connect(self.backClicked.emit)
        header_layout.addWidget(back_btn)

        # 合集信息
        info_layout = QVBoxLayout()
        info_layout.setContentsMargins(16, 0, 0, 0)

        # 合集名称
        name = self.collection_data.get('name', '未知合集')
        name_label = QLabel(name)
        name_label.setObjectName("collection_name")
        font = QFont()
        font.setPointSize(18)
        font.setBold(True)
        name_label.setFont(font)
        info_layout.addWidget(name_label)

        # 合集统计
        album_count = self.collection_data.get('album_count', 0)
        image_count = self.collection_data.get('image_count', 0)
        folder_size = self.collection_data.get('folder_size', '')
        if folder_size:
            stats_text = f"📚 {album_count} 个相册 | 🖼️ {image_count} 张图片 | 💾 {folder_size}"
        else:
            stats_text = f"📚 {album_count} 个相册 | 🖼️ {image_count} 张图片"

        stats_label = QLabel(stats_text)
        stats_label.setObjectName("collection_stats")
        info_layout.addWidget(stats_label)

        header_layout.addLayout(info_layout)
        header_layout.addStretch()

        parent_layout.addWidget(header)

    def create_albums_grid(self, parent_layout):
        """创建相册网格"""
        # 滚动区域
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        scroll.setObjectName("collection_scroll")

        # 内容容器
        self.content_widget = QWidget()
        scroll.setWidget(self.content_widget)

        # 网格布局
        self.grid_layout = QVBoxLayout(self.content_widget)
        self.grid_layout.setContentsMargins(16, 16, 16, 16)
        self.grid_layout.setSpacing(16)

        parent_layout.addWidget(scroll)

    def load_collection_albums(self):
        """加载合集内的相册"""
        try:
            log_info("开始加载合集内的相册", 'ui.collection_viewer')
            self.albums = []

            # 获取合集内的相册列表
            collection_albums = self.collection_data.get('albums', [])
            log_info(f"合集包含 {len(collection_albums)} 个相册", 'ui.collection_viewer')

            # 为每个相册创建卡片数据
            for album in collection_albums:
                album_card = {
                    'type': 'album',
                    'name': album.get('name', ''),
                    'folder_name': album.get('name', ''),
                    'path': album.get('path', ''),
                    'image_files': album.get('image_files', []),
                    'cover_image': album.get('cover_image', ''),
                    'image_count': album.get('image_count', 0),
                    'folder_size': album.get('folder_size', '')
                }
                self.albums.append(album_card)
                log_debug(f"加载相册: {album.get('name', '')} ({album.get('image_count', 0)} 张图片)", 'ui.collection_viewer')

            log_info(f"合集相册加载完成，共 {len(self.albums)} 个", 'ui.collection_viewer')
            self.refresh_grid()

        except Exception as e:
            log_exception(f"加载合集相册失败: {str(e)}", 'ui.collection_viewer')

    def refresh_grid(self):
        """刷新网格显示"""
        # 清除现有内容
        for i in reversed(range(self.grid_layout.count())):
            child = self.grid_layout.itemAt(i).widget()
            if child:
                child.setParent(None)

        # 创建相册卡片
        for album in self.albums:
            card = self.create_album_card(album)
            self.grid_layout.addWidget(card)

        # 添加弹性空间
        self.grid_layout.addStretch()

    def create_album_card(self, album):
        """创建相册卡片"""
        card = QFrame()
        card.setObjectName("album_card")
        card.setFixedHeight(180)
        card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        card.mousePressEvent = lambda e: self.albumClicked.emit(album.get('path', ''))

        layout = QHBoxLayout(card)
        layout.setContentsMargins(16, 16, 16, 16)

        # 左侧封面
        cover_label = QLabel()
        cover_label.setFixedSize(120, 150)
        cover_label.setStyleSheet("""
            QLabel {
                background-color: #F5F5F7;
                border: 1px solid #D2D2D7;
                border-radius: 8px;
            }
        """)
        cover_label.setAlignment(Qt.AlignmentFlag.AlignCenter)

        # 显示第一张图片
        image_files = album.get('image_files', [])
        if image_files:
            pixmap = QPixmap(image_files[0])
            if not pixmap.isNull():
                scaled_pixmap = pixmap.scaled(
                    120, 150,
                    Qt.AspectRatioMode.KeepAspectRatio,
                    Qt.TransformationMode.SmoothTransformation
                )
                cover_label.setPixmap(scaled_pixmap)
            else:
                cover_label.setText("📖")
        else:
            cover_label.setText("📖")

        # 右侧信息
        info_layout = QVBoxLayout()
        info_layout.setContentsMargins(16, 0, 0, 0)

        # 标题
        title = QLabel(album.get('name', '未知相册'))
        title.setObjectName("album_title")
        font = QFont()
        font.setPointSize(14)
        font.setBold(True)
        title.setFont(font)

        # 信息
        image_count = len(album.get('image_files', []))
        folder_size = album.get('folder_size', '')
        if folder_size:
            info_text = f"🖼️ {image_count} 张图片\n💾 {folder_size}"
        else:
            info_text = f"🖼️ {image_count} 张图片"

        info_label = QLabel(info_text)
        info_label.setObjectName("album_info")
        info_label.setStyleSheet("color: #666;")

        # 打开按钮
        open_btn = QPushButton("打开相册")
        open_btn.setObjectName("open_button")
        open_btn.setFixedSize(100, 36)
        open_btn.clicked.connect(
            lambda: self.albumClicked.emit(album.get('path', ''))
        )

        info_layout.addWidget(title)
        info_layout.addWidget(info_label)
        info_layout.addStretch()
        info_layout.addWidget(open_btn)

        layout.addWidget(cover_label)
        layout.addLayout(info_layout, 1)

        return card
