"""
PyQt6相册网格组件
瀑布流卡片布局
"""

from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QScrollArea, QFrame,
    QLabel, QPushButton, QGridLayout, QSizePolicy
)
from PyQt6.QtCore import Qt, pyqtSignal, QSize
from PyQt6.QtGui import QFont, QPixmap, QIcon

class AlbumGrid(QWidget):
    """相册网格组件"""

    # 定义信号
    albumClicked = pyqtSignal(str)  # 传入相册路径
    favoriteClicked = pyqtSignal(str)  # 传入相册路径

    def __init__(self, parent=None):
        super().__init__(parent)
        self.albums = []
        self.all_albums = []
        self.current_filter = "全部"
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("album_grid")

        # 创建滚动区域
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        scroll.setObjectName("scroll_area")

        # 内容容器
        self.content_widget = QWidget()
        scroll.setWidget(self.content_widget)

        # 网格布局
        self.grid_layout = QVBoxLayout(self.content_widget)
        self.grid_layout.setContentsMargins(16, 16, 16, 16)
        self.grid_layout.setSpacing(16)

        # 主布局
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.addWidget(scroll)

    def update_albums(self, albums):
        """更新相册列表"""
        self.albums = albums
        self.all_albums = albums.copy()
        self.refresh_grid()

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
        card.setFixedHeight(200)
        card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        card.mousePressEvent = lambda e: self.albumClicked.emit(album.get('path', ''))

        layout = QHBoxLayout(card)
        layout.setContentsMargins(16, 16, 16, 16)

        # 左侧封面（占位符）
        cover_label = QLabel()
        cover_label.setFixedSize(120, 160)
        cover_label.setStyleSheet("""
            QLabel {
                background-color: #F5F5F7;
                border: 1px solid #D2D2D7;
                border-radius: 8px;
            }
        """)
        cover_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        cover_label.setText("📚")

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
        info_text = f"📁 {album.get('folder_name', '')}\n"
        info_text += f"🖼️ {len(album.get('image_files', []))} 张图片"
        info_label = QLabel(info_text)
        info_label.setObjectName("album_info")

        info_layout.addWidget(title)
        info_layout.addWidget(info_label)
        info_layout.addStretch()

        # 收藏按钮
        fav_btn = QPushButton("⭐")
        fav_btn.setObjectName("favorite_button")
        fav_btn.setToolTip("收藏/取消收藏")
        fav_btn.clicked.connect(
            lambda: self.favoriteClicked.emit(album.get('path', ''))
        )

        layout.addWidget(cover_label)
        layout.addLayout(info_layout, 1)
        layout.addWidget(fav_btn)

        return card

    def apply_filter(self, filter_text):
        """应用筛选"""
        self.current_filter = filter_text

        if filter_text == "全部":
            self.albums = self.all_albums.copy()
        else:
            # TODO: 实现具体的筛选逻辑
            self.albums = self.all_albums.copy()

        self.refresh_grid()

    def show_empty_state(self):
        """显示空状态"""
        # 清除现有内容
        for i in reversed(range(self.grid_layout.count())):
            child = self.grid_layout.itemAt(i).widget()
            if child:
                child.setParent(None)

        # 显示空状态提示
        empty_label = QLabel("📚\n\n请选择文件夹开始浏览漫画")
        empty_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        empty_label.setObjectName("empty_state")
        font = QFont()
        font.setPointSize(16)
        empty_label.setFont(font)

        self.grid_layout.addWidget(empty_label)
        self.grid_layout.addStretch()
