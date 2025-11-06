"""
漫画卡片组件
显示漫画信息的卡片
"""

from PyQt6.QtWidgets import (
    QFrame, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QSizePolicy
)
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QFont, QPixmap

import sys
from pathlib import Path

# 添加src路径
src_path = Path(__file__).parent.parent.parent.parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from core.config import ConfigManager
from ..base.base_widget import BaseWidget
from ..buttons.icon_button import IconButton
from ..display.label import Label


class AlbumCard(BaseWidget):
    """漫画卡片组件"""

    # 定义信号
    clicked = pyqtSignal(str)  # 专辑路径
    favoriteClicked = pyqtSignal(str)  # 收藏按钮

    def __init__(self, album_data, config_manager=None, parent=None, style_manager=None):
        super().__init__(parent, style_manager)
        self.album_data = album_data
        self.config_manager = config_manager
        self.is_favorite = False
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("album-card")
        self.setFixedSize(180, 260)
        self.setFrameShape(QFrame.Shape.Box)
        self.setLineWidth(0)

        # 主布局
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
        # 封面容器
        cover_frame = QFrame()
        cover_frame.setObjectName("album-cover")
        cover_frame.setFixedSize(164, 200)

        # 封面标签
        self.cover_label = Label("", cover_frame)
        self.cover_label.setObjectName("cover-image")
        self.cover_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.cover_label.setFixedSize(164, 200)
        self.cover_label.setStyleSheet(f"""
            QLabel {{
                background-color: {self.get_color('bg-tertiary')};
                border: 1px solid {self.get_color('border-light')};
                border-radius: {self.get_border_radius('sm')}px;
            }}
        """)

        # 占位符图标
        placeholder = Label("🖼️", self.cover_label)
        placeholder.setFont(QFont("Segoe UI Emoji", 48))
        placeholder.setAlignment(Qt.AlignmentFlag.AlignCenter)
        placeholder.setGeometry(0, 0, 164, 200)

        # 页数标签
        self.page_count_label = Label("120页", cover_frame)
        self.page_count_label.setObjectName("page-count")
        self.page_count_label.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignTop)
        self.page_count_label.setFixedSize(50, 20)
        self.page_count_label.setStyleSheet(f"""
            QLabel {{
                background-color: rgba(255, 255, 255, 0.9);
                color: {self.get_color('text-secondary')};
                border-radius: {self.get_border_radius('sm')}px;
                padding: 2px 6px;
                font-size: {self.style_manager.font_sizes['xs']}px;
            }}
        """)
        self.page_count_label.move(110, 5)

        parent_layout.addWidget(cover_frame)

    def create_info_area(self, parent_layout):
        """创建信息区域"""
        info_layout = QVBoxLayout()
        info_layout.setContentsMargins(4, 0, 4, 0)
        info_layout.setSpacing(4)

        # 标题
        self.title_label = Label(self.album_data.get('name', '未命名'))
        self.title_label.setObjectName("album-title")
        self.title_label.setFont(self.get_font('base', QFont.Weight.Medium))
        self.title_label.setMaximumHeight(20)
        info_layout.addWidget(self.title_label)

        # 作者
        self.author_label = Label(self.album_data.get('author', '未知作者'))
        self.author_label.setObjectName("album-author")
        self.author_label.setFont(self.get_font('sm'))
        self.author_label.setMaximumHeight(18)
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

        star_icon = Label("⭐", None, self.style_manager)
        star_icon.setFont(QFont("Segoe UI Emoji", 12))
        rating_layout.addWidget(star_icon)

        self.rating_label = Label("9.2", None, self.style_manager)
        self.rating_label.setObjectName("album-rating")
        self.rating_label.setFont(self.get_font('sm'))
        rating_layout.addWidget(self.rating_label)

        action_layout.addLayout(rating_layout)

        action_layout.addStretch()

        # 收藏按钮
        self.favorite_btn = IconButton("♥", self, self.style_manager)
        self.favorite_btn.setCheckable(True)
        self.favorite_btn.clicked.connect(self.on_favorite_clicked)
        action_layout.addWidget(self.favorite_btn)

        # 播放按钮
        self.play_btn = IconButton("▶", self, self.style_manager)
        self.play_btn.setObjectName("play-button")
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
            self.favorite_btn.setStyleSheet(f"""
                QPushButton {{
                    color: {self.get_color('minimal-red')};
                    border: none;
                    font-size: 16px;
                }}
            """)
        else:
            self.favorite_btn.setStyleSheet(f"""
                QPushButton {{
                    color: {self.get_color('text-tertiary')};
                    border: none;
                    font-size: 16px;
                }}
            """)

    def set_rating(self, rating):
        """设置评分"""
        self.rating_label.setText(f"{rating:.1f}")

    def set_page_count(self, count):
        """设置页数"""
        self.page_count_label.setText(f"{count}页")

    def on_enter(self):
        """鼠标进入时的悬停效果"""
        colors = self.style_manager.get_colors()
        self.setStyleSheet(f"""
            QFrame {{
                background-color: {colors['card-bg']};
                border: 1px solid {colors['accent']};
                border-radius: {self.get_border_radius('md')}px;
            }}
        """)

    def on_leave(self):
        """鼠标离开时的效果"""
        colors = self.style_manager.get_colors()
        self.setStyleSheet(f"""
            QFrame {{
                background-color: {colors['card-bg']};
                border: 1px solid {colors['border-light']};
                border-radius: {self.get_border_radius('md')}px;
            }}
        """)
