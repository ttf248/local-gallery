"""
PyQt6现代化合集查看器
展示合集内的所有相册，采用网格布局
包含合集信息、封面、描述等详细信息
"""

import os
import sys
from pathlib import Path
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QScrollArea, QFrame, QGridLayout, QSizePolicy, QTextEdit,
    QGraphicsDropShadowEffect, QApplication
)
from PyQt6.QtCore import Qt, pyqtSignal, QSize, QPropertyAnimation, QEasingCurve, QRect
from PyQt6.QtGui import QFont, QPixmap, QColor, QPalette

class CollectionView(QWidget):
    """现代化合集查看器组件"""

    # 定义信号
    albumClicked = pyqtSignal(str)  # 传入相册路径
    backClicked = pyqtSignal()  # 返回信号
    favoriteClicked = pyqtSignal(str)  # 收藏信号

    def __init__(self, app, collection_data, parent=None):
        super().__init__(parent)
        self.app = app
        self.collection_data = collection_data
        self.albums = []
        self.columns = 4  # 默认4列
        self.init_ui()
        self.load_collection_albums()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("collection_view")
        self.setMinimumSize(900, 700)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # 顶部导航栏
        self.create_header(layout)

        # 滚动内容区
        self.create_content_area(layout)

    def create_header(self, parent_layout):
        """创建顶部导航栏"""
        # 导航栏背景
        header_bg = QFrame()
        header_bg.setObjectName("header_bg")
        header_bg.setFixedHeight(100)
        header_bg.setStyleSheet("""
            QFrame#header_bg {
                background: qlineargradient(x1:0, y1:0, x2:0, y2:1,
                    stop:0 #F5F5F7, stop:1 #FFFFFF);
                border-bottom: 1px solid #E5E5E7;
            }
        """)

        # 添加阴影
        effect = QGraphicsDropShadowEffect()
        effect.setBlurRadius(10)
        effect.setOffset(0, 2)
        effect.setColor(QColor(0, 0, 0, 10))
        header_bg.setGraphicsEffect(effect)

        header_layout = QHBoxLayout(header_bg)
        header_layout.setContentsMargins(20, 16, 20, 16)

        # 左侧：返回按钮
        back_btn = QPushButton("← 返回")
        back_btn.setObjectName("back_button")
        back_btn.setFixedSize(100, 36)
        back_btn.setStyleSheet("""
            QPushButton#back_button {
                background-color: white;
                border: 1px solid #E5E5E7;
                border-radius: 8px;
                color: #1D1D1F;
                font-size: 14px;
                font-weight: bold;
            }
            QPushButton#back_button:hover {
                background-color: #F5F5F7;
                border-color: #D1D1D6;
            }
            QPushButton#back_button:pressed {
                background-color: #EBEBF0;
            }
        """)
        back_btn.clicked.connect(self.backClicked.emit)
        header_layout.addWidget(back_btn)

        # 中间：合集信息
        info_layout = QVBoxLayout()
        info_layout.setContentsMargins(20, 0, 0, 0)
        info_layout.setSpacing(4)

        # 合集名称
        name = self.collection_data.get('name', '未知合集')
        name_label = QLabel(name)
        name_label.setObjectName("collection_name")
        font = QFont()
        font.setPointSize(20)
        font.setBold(True)
        name_label.setFont(font)
        info_layout.addWidget(name_label)

        # 合集统计和描述
        stats_layout = QHBoxLayout()

        # 统计信息
        album_count = self.collection_data.get('album_count', 0)
        image_count = self.collection_data.get('image_count', 0)
        folder_size = self.collection_data.get('folder_size', '')

        if folder_size:
            stats_text = f"📚 {album_count} 个相册  •  🖼️ {image_count} 张图片  •  💾 {folder_size}"
        else:
            stats_text = f"📚 {album_count} 个相册  •  🖼️ {image_count} 张图片"

        stats_label = QLabel(stats_text)
        stats_label.setObjectName("collection_stats")
        stats_label.setStyleSheet("color: #8E8E93; font-size: 13px;")
        stats_layout.addWidget(stats_label)

        stats_layout.addStretch()
        info_layout.addLayout(stats_layout)

        header_layout.addLayout(info_layout)
        header_layout.addStretch()

        # 右侧：操作按钮
        action_layout = QHBoxLayout()

        # 收藏按钮
        self.fav_btn = QPushButton("☆ 收藏")
        self.fav_btn.setObjectName("fav_button")
        self.fav_btn.setFixedSize(100, 36)
        self.fav_btn.clicked.connect(
            lambda: self.favoriteClicked.emit(self.collection_data.get('path', ''))
        )
        action_layout.addWidget(self.fav_btn)

        header_layout.addLayout(action_layout)

        parent_layout.addWidget(header_bg)

    def create_content_area(self, parent_layout):
        """创建内容滚动区域"""
        # 滚动区域
        self.scroll_area = QScrollArea()
        self.scroll_area.setWidgetResizable(True)
        self.scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.scroll_area.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self.scroll_area.setObjectName("collection_scroll")
        self.scroll_area.setStyleSheet("""
            QScrollArea#collection_scroll {
                background-color: #F5F5F7;
                border: none;
            }
            QScrollBar:vertical {
                background-color: #F5F5F7;
                width: 12px;
                border-radius: 6px;
            }
            QScrollBar::handle:vertical {
                background-color: #C7C7CC;
                border-radius: 6px;
                min-height: 20px;
            }
            QScrollBar::handle:vertical:hover {
                background-color: #AFB0B5;
            }
        """)

        # 网格容器
        self.grid_widget = QWidget()
        self.grid_layout = QGridLayout(self.grid_widget)
        self.grid_layout.setContentsMargins(20, 20, 20, 20)
        self.grid_layout.setHorizontalSpacing(16)
        self.grid_layout.setVerticalSpacing(16)

        self.scroll_area.setWidget(self.grid_widget)
        parent_layout.addWidget(self.scroll_area)

    def load_collection_albums(self):
        """加载合集内的相册"""
        try:
            self.albums = []

            # 获取合集内的相册列表
            collection_albums = self.collection_data.get('albums', [])

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

            self.refresh_grid()

        except Exception as e:
            print(f"加载合集相册失败: {e}")

    def refresh_grid(self):
        """刷新网格显示"""
        # 清除现有内容
        for i in reversed(range(self.grid_layout.count())):
            child = self.grid_layout.itemAt(i).widget()
            if child:
                child.setParent(None)

        # 动态计算列数
        viewport_width = self.scroll_area.viewport().width()
        card_width = 200
        spacing = 16
        self.columns = max(3, min(5, (viewport_width + spacing) // (card_width + spacing)))
        self.grid_layout.setColumnCount(self.columns)

        # 创建相册卡片
        for i, album in enumerate(self.albums):
            row = i // self.columns
            col = i % self.columns
            card = self.create_album_card(album)
            self.grid_layout.addWidget(card, row, col)

    def create_album_card(self, album):
        """创建相册卡片"""
        card = CollectionAlbumCard(album)
        card.albumClicked.connect(self.albumClicked.emit)
        return card

    def resizeEvent(self, event):
        """窗口大小变化时重新计算网格"""
        super().resizeEvent(event)
        if self.albums:
            self.refresh_grid()


class CollectionAlbumCard(QFrame):
    """合集内的相册卡片组件"""

    albumClicked = pyqtSignal(str)

    def __init__(self, album):
        super().__init__()
        self.album = album
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("collection_album_card")
        self.setFixedSize(200, 240)
        self.setStyleSheet("""
            QFrame#collection_album_card {
                background-color: white;
                border-radius: 12px;
                border: 1px solid #E5E5E7;
            }
            QFrame#collection_album_card:hover {
                border-color: #007AFF;
            }
        """)

        # 添加阴影效果
        effect = QGraphicsDropShadowEffect()
        effect.setBlurRadius(20)
        effect.setOffset(0, 4)
        effect.setColor(QColor(0, 0, 0, 20))
        self.setGraphicsEffect(effect)

        # 鼠标事件
        self.setMouseTracking(True)

        # 主布局
        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(8)

        # 封面
        cover_label = QLabel()
        cover_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        cover_label.setFixedSize(176, 140)
        cover_label.setStyleSheet("""
            QLabel {
                background-color: #F5F5F7;
                border: 1px solid #E5E5E7;
                border-radius: 8px;
            }
        """)

        # 设置封面
        image_files = self.album.get('image_files', [])
        if image_files:
            pixmap = QPixmap(image_files[0])
            if not pixmap.isNull():
                scaled = pixmap.scaled(
                    176, 140,
                    Qt.AspectRatioMode.KeepAspectRatio,
                    Qt.TransformationMode.SmoothTransformation
                )
                cover_label.setPixmap(scaled)
            else:
                cover_label.setText("📖")
                cover_label.setStyleSheet("""
                    QLabel {
                        background-color: #F5F5F7;
                        border: 1px solid #E5E5E7;
                        border-radius: 8px;
                        font-size: 48px;
                        color: #C7C7CC;
                    }
                """)
        else:
            cover_label.setText("📖")
            cover_label.setStyleSheet("""
                QLabel {
                    background-color: #F5F5F7;
                    border: 1px solid #E5E5E7;
                    border-radius: 8px;
                    font-size: 48px;
                    color: #C7C7CC;
                }
            """)

        layout.addWidget(cover_label, alignment=Qt.AlignmentFlag.AlignCenter)

        # 标题
        title = QLabel(self.album.get('name', '未知相册'))
        title.setObjectName("album_title")
        title.setWordWrap(True)
        title.setAlignment(Qt.AlignmentFlag.AlignLeft)
        title.setStyleSheet("""
            QLabel#album_title {
                color: #1D1D1F;
                font-size: 13px;
                font-weight: bold;
            }
        """)
        layout.addWidget(title)

        # 信息
        image_count = len(self.album.get('image_files', []))
        info_label = QLabel(f"🖼️ {image_count} 张")
        info_label.setObjectName("album_info")
        info_label.setStyleSheet("""
            QLabel#album_info {
                color: #8E8E93;
                font-size: 12px;
            }
        """)
        layout.addWidget(info_label)

    def enterEvent(self, event):
        """鼠标进入事件"""
        effect = QGraphicsDropShadowEffect()
        effect.setBlurRadius(30)
        effect.setOffset(0, 8)
        effect.setColor(QColor(0, 122, 255, 40))
        self.setGraphicsEffect(effect)

        # 缩放动画
        self.animation = QPropertyAnimation(self, b"geometry")
        self.animation.setDuration(200)
        self.animation.setEasingCurve(QEasingCurve.Type.OutCubic)
        rect = self.geometry()
        self.animation.setStartValue(rect)
        self.animation.setEndValue(QRect(rect.x(), rect.y() - 4, rect.width(), rect.height()))
        self.animation.start()
        super().enterEvent(event)

    def leaveEvent(self, event):
        """鼠标离开事件"""
        effect = QGraphicsDropShadowEffect()
        effect.setBlurRadius(20)
        effect.setOffset(0, 4)
        effect.setColor(QColor(0, 0, 0, 20))
        self.setGraphicsEffect(effect)

        # 缩放动画
        self.animation = QPropertyAnimation(self, b"geometry")
        self.animation.setDuration(200)
        self.animation.setEasingCurve(QEasingCurve.Type.OutCubic)
        rect = self.geometry()
        self.animation.setStartValue(rect)
        self.animation.setEndValue(QRect(rect.x(), rect.y() + 4, rect.width(), rect.height()))
        self.animation.start()
        super().leaveEvent(event)

    def mousePressEvent(self, event):
        """鼠标点击事件"""
        if event.button() == Qt.MouseButton.LeftButton:
            self.albumClicked.emit(self.album.get('path', ''))
        super().mousePressEvent(event)