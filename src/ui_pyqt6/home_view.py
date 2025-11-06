"""
PyQt6主页视图
现代化3-5列自适应网格布局
支持卡片悬停效果和流畅动画
"""

from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QScrollArea, QFrame,
    QLabel, QPushButton, QGridLayout, QSizePolicy, QSpacerItem,
    QApplication, QGraphicsDropShadowEffect
)
from PyQt6.QtCore import Qt, pyqtSignal, QSize, QPropertyAnimation, QEasingCurve, QRect, pyqtProperty
from PyQt6.QtGui import QFont, QPixmap, QPainter, QColor, QBrush, QPen

class HomeView(QWidget):
    """主页视图组件 - 现代化网格布局"""

    # 定义信号
    albumClicked = pyqtSignal(str)  # 传入相册路径
    favoriteClicked = pyqtSignal(str)  # 传入相册路径

    def __init__(self, config_manager=None, parent=None):
        super().__init__(parent)
        self.config_manager = config_manager
        self.albums = []
        self.all_albums = []
        self.columns = 4  # 默认4列
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("home_view")
        self.setMinimumSize(800, 600)

        # 主布局
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # 工具栏区域
        self.create_toolbar(main_layout)

        # 网格滚动区域
        self.create_grid_area(main_layout)

    def create_toolbar(self, parent_layout):
        """创建顶部工具栏"""
        toolbar = QFrame()
        toolbar.setObjectName("home_toolbar")
        toolbar.setFixedHeight(60)
        toolbar.setStyleSheet("""
            QFrame#home_toolbar {
                background-color: qlineargradient(x1:0, y1:0, x2:0, y2:1,
                    stop:0 #F5F5F7, stop:1 #FFFFFF);
                border-bottom: 1px solid #E5E5E7;
            }
        """)

        layout = QHBoxLayout(toolbar)
        layout.setContentsMargins(16, 8, 16, 8)

        # 标题
        title = QLabel("📚 我的漫画库")
        title.setObjectName("home_title")
        font = QFont()
        font.setPointSize(18)
        font.setBold(True)
        title.setFont(font)
        layout.addWidget(title)

        layout.addStretch()

        # 视图控制
        self.grid_btn = QPushButton("⊞ 网格")
        self.grid_btn.setObjectName("view_button")
        self.grid_btn.setCheckable(True)
        self.grid_btn.setChecked(True)
        self.grid_btn.setFixedSize(80, 32)
        layout.addWidget(self.grid_btn)

        self.list_btn = QPushButton("☰ 列表")
        self.list_btn.setObjectName("view_button")
        self.list_btn.setCheckable(True)
        self.list_btn.setFixedSize(80, 32)
        layout.addWidget(self.list_btn)

        parent_layout.addWidget(toolbar)

    def create_grid_area(self, parent_layout):
        """创建网格滚动区域"""
        # 滚动区域
        self.scroll_area = QScrollArea()
        self.scroll_area.setWidgetResizable(True)
        self.scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.scroll_area.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self.scroll_area.setObjectName("home_scroll")
        self.scroll_area.setStyleSheet("""
            QScrollArea#home_scroll {
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
        self.grid_layout.setContentsMargins(16, 16, 16, 16)
        self.grid_layout.setHorizontalSpacing(16)
        self.grid_layout.setVerticalSpacing(16)

        self.scroll_area.setWidget(self.grid_widget)
        parent_layout.addWidget(self.scroll_area)

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

        # 动态计算列数
        viewport_width = self.scroll_area.viewport().width()
        card_width = 220  # 卡片宽度
        spacing = 16  # 间距
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
        card = ModernAlbumCard(album, self.config_manager)
        card.albumClicked.connect(self.albumClicked.emit)
        card.favoriteClicked.connect(self.favoriteClicked.emit)
        return card

    def show_empty_state(self):
        """显示空状态"""
        # 清除现有内容
        for i in reversed(range(self.grid_layout.count())):
            child = self.grid_layout.itemAt(i).widget()
            if child:
                child.setParent(None)

        # 居中显示空状态
        empty_frame = QFrame()
        empty_frame.setObjectName("empty_frame")
        empty_frame.setFixedSize(400, 300)
        empty_frame.setStyleSheet("""
            QFrame#empty_frame {
                background-color: white;
                border-radius: 16px;
                border: 1px solid #E5E5E7;
            }
        """)

        layout = QVBoxLayout(empty_frame)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)

        # 图标
        icon_label = QLabel("📚")
        icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        icon_label.setStyleSheet("font-size: 72px;")
        layout.addWidget(icon_label)

        # 文本
        text_label = QLabel("开始你的漫画之旅")
        text_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        font = QFont()
        font.setPointSize(20)
        font.setBold(True)
        text_label.setFont(font)
        layout.addWidget(text_label)

        sub_text = QLabel("选择文件夹扫描漫画，或浏览最近和收藏")
        sub_text.setAlignment(Qt.AlignmentFlag.AlignCenter)
        sub_text.setStyleSheet("color: #8E8E93; margin-top: 8px;")
        layout.addWidget(sub_text)

        # 添加阴影效果
        effect = QGraphicsDropShadowEffect()
        effect.setBlurRadius(20)
        effect.setOffset(0, 8)
        effect.setColor(QColor(0, 0, 0, 30))
        empty_frame.setGraphicsEffect(effect)

        # 居中显示
        self.grid_layout.addWidget(empty_frame, 0, 0, Qt.AlignmentFlag.AlignCenter)
        self.grid_layout.setColumnStretch(self.columns // 2, 1)

    def resizeEvent(self, event):
        """窗口大小变化时重新计算网格"""
        super().resizeEvent(event)
        if self.albums:  # 只有在有数据时才重新布局
            self.refresh_grid()


class ModernAlbumCard(QFrame):
    """现代化相册卡片组件"""

    albumClicked = pyqtSignal(str)
    favoriteClicked = pyqtSignal(str)

    def __init__(self, album, config_manager):
        super().__init__()
        self.album = album
        self.config_manager = config_manager
        self.is_hovered = False
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("album_card")
        self.setFixedSize(220, 280)
        self.setStyleSheet("""
            QFrame#album_card {
                background-color: white;
                border-radius: 12px;
                border: 1px solid #E5E5E7;
            }
            QFrame#album_card:hover {
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

        # 封面区域
        cover_frame = QFrame()
        cover_frame.setObjectName("cover_frame")
        cover_frame.setFixedSize(196, 180)
        cover_frame.setStyleSheet("""
            QFrame#cover_frame {
                background-color: #F5F5F7;
                border-radius: 8px;
                border: 1px solid #E5E5E7;
            }
        """)

        cover_layout = QVBoxLayout(cover_frame)
        cover_layout.setContentsMargins(0, 0, 0, 0)

        # 封面图片
        self.cover_label = QLabel()
        self.cover_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.cover_label.setFixedSize(196, 180)
        self.cover_label.setStyleSheet("""
            QLabel {
                border-radius: 8px;
            }
        """)

        # 设置封面
        self.set_cover_image()

        cover_layout.addWidget(self.cover_label, alignment=Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(cover_frame, alignment=Qt.AlignmentFlag.AlignCenter)

        # 标题
        title = QLabel(self.album.get('name', '未知相册'))
        title.setObjectName("card_title")
        title.setWordWrap(True)
        title.setAlignment(Qt.AlignmentFlag.AlignLeft)
        title.setStyleSheet("""
            QLabel#card_title {
                color: #1D1D1F;
                font-size: 14px;
                font-weight: bold;
                padding: 4px 0;
            }
        """)
        layout.addWidget(title)

        # 底部信息栏
        bottom_layout = QHBoxLayout()
        bottom_layout.setContentsMargins(0, 0, 0, 0)

        # 统计信息
        info = self.get_album_info()
        info_label = QLabel(info)
        info_label.setObjectName("card_info")
        info_label.setStyleSheet("""
            QLabel#card_info {
                color: #8E8E93;
                font-size: 12px;
            }
        """)
        bottom_layout.addWidget(info_label)

        bottom_layout.addStretch()

        # 收藏按钮
        self.fav_btn = QPushButton("♡")
        self.fav_btn.setObjectName("fav_button")
        self.fav_btn.setFixedSize(32, 32)
        self.fav_btn.setStyleSheet("""
            QPushButton#fav_button {
                border: none;
                border-radius: 16px;
                font-size: 16px;
                background-color: transparent;
            }
            QPushButton#fav_button:hover {
                background-color: #FFF2E8;
            }
        """)
        self.fav_btn.clicked.connect(self.on_favorite_clicked)
        bottom_layout.addWidget(self.fav_btn)

        layout.addLayout(bottom_layout)

    def set_cover_image(self):
        """设置封面图片"""
        album_type = self.album.get('type', 'album')

        if album_type == 'collection':
            if self.album.get('cover_image'):
                pixmap = QPixmap(self.album.get('cover_image'))
            else:
                pixmap = None
            icon_text = "📚"
        elif album_type == 'smart_collection':
            pixmap = None
            icon_text = "🧠"
        else:
            image_files = self.album.get('image_files', [])
            if image_files:
                pixmap = QPixmap(image_files[0])
            else:
                pixmap = None
            icon_text = "📖"

        if pixmap and not pixmap.isNull():
            scaled = pixmap.scaled(
                196, 180,
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation
            )
            self.cover_label.setPixmap(scaled)
        else:
            self.cover_label.setText(icon_text)
            self.cover_label.setStyleSheet("""
                QLabel {
                    border-radius: 8px;
                    font-size: 64px;
                    color: #C7C7CC;
                }
            """)

    def get_album_info(self):
        """获取相册信息文本"""
        album_type = self.album.get('type', 'album')

        if album_type == 'collection':
            album_count = self.album.get('album_count', 0)
            image_count = self.album.get('image_count', 0)
            return f"📚 {album_count} 册 | 🖼️ {image_count}"
        elif album_type == 'smart_collection':
            album_count = self.album.get('album_count', 0)
            image_count = self.album.get('image_count', 0)
            return f"🧠 {album_count} 册 | 🖼️ {image_count}"
        else:
            image_count = len(self.album.get('image_files', []))
            return f"🖼️ {image_count} 张"

    def enterEvent(self, event):
        """鼠标进入事件"""
        self.is_hovered = True
        self.animate_card(True)
        super().enterEvent(event)

    def leaveEvent(self, event):
        """鼠标离开事件"""
        self.is_hovered = False
        self.animate_card(False)
        super().leaveEvent(event)

    def mousePressEvent(self, event):
        """鼠标点击事件"""
        if event.button() == Qt.MouseButton.LeftButton:
            self.albumClicked.emit(self.album.get('path', ''))
        super().mousePressEvent(event)

    def animate_card(self, hover):
        """卡片动画效果"""
        if hover:
            # 悬停时上移并加深阴影
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
        else:
            # 恢复原始状态
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

    def on_favorite_clicked(self):
        """收藏按钮点击"""
        self.favoriteClicked.emit(self.album.get('path', ''))