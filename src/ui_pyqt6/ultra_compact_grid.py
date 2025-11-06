"""
PyQt6超紧凑相册网格组件
极致空间利用率，一屏显示大量内容
类似 Windows 文件管理器缩略图视图
"""

from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QScrollArea, QFrame, QLabel,
    QPushButton, QGridLayout, QSizePolicy, QGraphicsDropShadowEffect
)
from PyQt6.QtCore import Qt, pyqtSignal, QPropertyAnimation, QEasingCurve, QRect
from PyQt6.QtGui import QFont, QPixmap, QColor

class UltraCompactGrid(QWidget):
    """超紧凑相册网格组件"""

    # 定义信号
    albumClicked = pyqtSignal(str)  # 传入相册路径
    favoriteClicked = pyqtSignal(str)  # 传入相册路径

    def __init__(self, config_manager=None, parent=None):
        super().__init__(parent)
        self.config_manager = config_manager
        self.albums = []
        self.columns = 6  # 默认6列
        self.card_width = 140  # 卡片宽度
        self.card_height = 160  # 卡片高度
        self.min_columns = 4  # 最小列数
        self.max_columns = 10  # 最大列数
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("ultra_compact_grid")
        self.setMinimumSize(600, 400)

        # 主布局
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # 滚动区域
        self.scroll_area = QScrollArea()
        self.scroll_area.setWidgetResizable(True)
        self.scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.scroll_area.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self.scroll_area.setObjectName("ultra_compact_scroll")
        self.scroll_area.setStyleSheet("""
            QScrollArea#ultra_compact_scroll {
                background-color: #F5F5F7;
                border: none;
            }
            QScrollBar:vertical {
                background-color: #F5F5F7;
                width: 10px;
                border-radius: 5px;
            }
            QScrollBar::handle:vertical {
                background-color: #C7C7CC;
                border-radius: 5px;
                min-height: 20px;
            }
            QScrollBar::handle:vertical:hover {
                background-color: #AFB0B5;
            }
        """)

        # 网格容器
        self.grid_widget = QWidget()
        self.grid_layout = QGridLayout(self.grid_widget)
        self.grid_layout.setContentsMargins(12, 12, 12, 12)
        self.grid_layout.setHorizontalSpacing(10)  # 列间距
        self.grid_layout.setVerticalSpacing(10)    # 行间距
        self.grid_layout.setColumnStretch(0, 1)

        self.scroll_area.setWidget(self.grid_widget)
        main_layout.addWidget(self.scroll_area)

    def update_albums(self, albums):
        """更新相册列表"""
        self.albums = albums
        self.refresh_grid()

    def refresh_grid(self):
        """刷新网格显示"""
        # 清除现有内容
        for i in reversed(range(self.grid_layout.count())):
            child = self.grid_layout.itemAt(i).widget()
            if child:
                child.setParent(None)

        if not self.albums:
            self.show_empty_state()
            return

        # 动态计算列数
        self.calculate_columns()

        # 创建相册卡片
        for i, album in enumerate(self.albums):
            row = i // self.columns
            col = i % self.columns
            card = self.create_ultra_compact_card(album)
            self.grid_layout.addWidget(card, row, col)

    def calculate_columns(self):
        """动态计算最优列数"""
        viewport_width = self.scroll_area.viewport().width()
        available_width = viewport_width - 24  # 减去左右边距
        card_with_spacing = self.card_width + 10  # 卡片宽度 + 列间距

        calculated_columns = available_width // card_with_spacing
        self.columns = max(self.min_columns, min(self.max_columns, calculated_columns))
        self.grid_layout.setColumnCount(self.columns)

    def create_ultra_compact_card(self, album):
        """创建超紧凑型相册卡片"""
        card = UltraCompactCard(album, self.card_width, self.card_height)
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

        # 居中显示
        empty_frame = QFrame()
        empty_frame.setObjectName("empty_frame")
        empty_frame.setFixedSize(350, 200)
        empty_frame.setStyleSheet("""
            QFrame#empty_frame {
                background-color: white;
                border-radius: 12px;
                border: 1px solid #E5E5E7;
            }
        """)

        # 添加阴影
        effect = QGraphicsDropShadowEffect()
        effect.setBlurRadius(20)
        effect.setOffset(0, 4)
        effect.setColor(QColor(0, 0, 0, 20))
        empty_frame.setGraphicsEffect(effect)

        layout = QVBoxLayout(empty_frame)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)

        # 图标
        icon_label = QLabel("📚")
        icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        icon_label.setStyleSheet("font-size: 48px;")
        layout.addWidget(icon_label)

        # 文本
        text_label = QLabel("暂无漫画")
        text_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        font = QFont()
        font.setPointSize(16)
        font.setBold(True)
        text_label.setFont(font)
        layout.addWidget(text_label)

        sub_text = QLabel("请选择文件夹扫描漫画")
        sub_text.setAlignment(Qt.AlignmentFlag.AlignCenter)
        sub_text.setStyleSheet("color: #8E8E93; margin-top: 6px;")
        layout.addWidget(sub_text)

        # 居中显示在网格中
        center_row = 0
        center_col = self.columns // 2 if self.columns > 0 else 0
        self.grid_layout.addWidget(empty_frame, center_row, center_col, Qt.AlignmentFlag.AlignCenter)

    def resizeEvent(self, event):
        """窗口大小变化时重新计算网格"""
        super().resizeEvent(event)
        if self.albums:
            self.refresh_grid()


class UltraCompactCard(QFrame):
    """超紧凑型相册卡片组件"""

    albumClicked = pyqtSignal(str)
    favoriteClicked = pyqtSignal(str)

    def __init__(self, album, width, height):
        super().__init__()
        self.album = album
        self.card_width = width
        self.card_height = height
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("ultra_compact_card")
        self.setFixedSize(self.card_width, self.card_height)
        self.setStyleSheet("""
            QFrame#ultra_compact_card {
                background-color: white;
                border-radius: 8px;
                border: 1px solid #E5E5E7;
            }
            QFrame#ultra_compact_card:hover {
                border-color: #007AFF;
            }
        """)

        # 添加阴影效果
        effect = QGraphicsDropShadowEffect()
        effect.setBlurRadius(12)
        effect.setOffset(0, 2)
        effect.setColor(QColor(0, 0, 0, 12))
        self.setGraphicsEffect(effect)

        # 鼠标事件
        self.setMouseTracking(True)

        # 主布局（垂直排列）
        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(4)

        # 封面区域（占据60%高度）
        cover_frame = self.create_cover_area()
        layout.addWidget(cover_frame)

        # 标题（占据25%高度）
        title = self.create_title_label()
        layout.addWidget(title)

        # 统计信息（占据15%高度）
        info = self.create_info_label()
        layout.addWidget(info)

    def create_cover_area(self):
        """创建封面区域"""
        cover_frame = QFrame()
        cover_frame.setObjectName("cover_frame")
        cover_height = int(self.card_height * 0.60)  # 60%高度
        cover_frame.setFixedSize(self.card_width - 16, cover_height)
        cover_frame.setStyleSheet("""
            QFrame#cover_frame {
                background-color: #F5F5F7;
                border: 1px solid #E5E5E7;
                border-radius: 6px;
            }
        """)

        cover_layout = QVBoxLayout(cover_frame)
        cover_layout.setContentsMargins(0, 0, 0, 0)

        # 封面标签
        cover_label = QLabel()
        cover_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        cover_label.setFixedSize(self.card_width - 16, cover_height)

        # 设置封面内容
        self.set_cover_content(cover_label)

        cover_layout.addWidget(cover_label, alignment=Qt.AlignmentFlag.AlignCenter)
        return cover_frame

    def set_cover_content(self, label):
        """设置封面内容"""
        album_type = self.album.get('type', 'album')
        image_files = self.album.get('image_files', [])

        if album_type == 'collection':
            # 合集
            cover_image = self.album.get('cover_image')
            if cover_image:
                pixmap = QPixmap(cover_image)
            else:
                pixmap = None
            icon_text = "📚"
        elif album_type == 'smart_collection':
            # 智能分组
            pixmap = None
            icon_text = "🧠"
        else:
            # 普通相册
            if image_files:
                pixmap = QPixmap(image_files[0])
            else:
                pixmap = None
            icon_text = "📖"

        if pixmap and not pixmap.isNull():
            # 有图片，显示图片
            cover_height = int(self.card_height * 0.60)
            cover_width = self.card_width - 16
            scaled = pixmap.scaled(
                cover_width, cover_height,
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation
            )
            label.setPixmap(scaled)
            label.setStyleSheet("""
                QLabel {
                    border-radius: 6px;
                }
            """)
        else:
            # 没有图片，显示图标
            label.setText(icon_text)
            label.setStyleSheet(f"""
                QLabel {{
                    border-radius: 6px;
                    font-size: {int(self.card_height * 0.2)}px;
                    color: #C7C7CC;
                }}
            """)

    def create_title_label(self):
        """创建标题标签"""
        title = QLabel(self.album.get('name', '未知相册'))
        title.setObjectName("ultra_title")
        title.setWordWrap(True)
        title.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignTop)
        title.setMaximumHeight(35)  # 限制高度，最多2行
        title.setStyleSheet("""
            QLabel#ultra_title {
                color: #1D1D1F;
                font-size: 11px;
                font-weight: bold;
            }
        """)
        return title

    def create_info_label(self):
        """创建信息标签"""
        info_text = self.get_album_info()
        info = QLabel(info_text)
        info.setObjectName("ultra_info")
        info.setWordWrap(True)
        info.setAlignment(Qt.AlignmentFlag.AlignLeft)
        info.setMaximumHeight(25)
        info.setStyleSheet("""
            QLabel#ultra_info {
                color: #8E8E93;
                font-size: 9px;
            }
        """)
        return info

    def get_album_info(self):
        """获取相册信息文本"""
        album_type = self.album.get('type', 'album')

        if album_type == 'collection':
            # 合集信息
            album_count = self.album.get('album_count', 0)
            return f"📚 {album_count} 册"
        elif album_type == 'smart_collection':
            # 智能分组信息
            album_count = self.album.get('album_count', 0)
            return f"🧠 {album_count} 册"
        else:
            # 普通相册信息
            image_count = len(self.album.get('image_files', []))
            folder_size = self.album.get('folder_size', '')
            if folder_size:
                # 只显示大小，不显示图片数，节省空间
                return f"{folder_size}"
            else:
                return f"🖼️ {image_count}"

    def enterEvent(self, event):
        """鼠标进入事件"""
        # 增强阴影
        effect = QGraphicsDropShadowEffect()
        effect.setBlurRadius(20)
        effect.setOffset(0, 4)
        effect.setColor(QColor(0, 122, 255, 25))
        self.setGraphicsEffect(effect)

        # 缩放动画
        self.animation = QPropertyAnimation(self, b"geometry")
        self.animation.setDuration(150)
        self.animation.setEasingCurve(QEasingCurve.Type.OutCubic)
        rect = self.geometry()
        self.animation.setStartValue(rect)
        self.animation.setEndValue(QRect(rect.x(), rect.y() - 2, rect.width(), rect.height()))
        self.animation.start()
        super().enterEvent(event)

    def leaveEvent(self, event):
        """鼠标离开事件"""
        # 恢复阴影
        effect = QGraphicsDropShadowEffect()
        effect.setBlurRadius(12)
        effect.setOffset(0, 2)
        effect.setColor(QColor(0, 0, 0, 12))
        self.setGraphicsEffect(effect)

        # 缩放动画
        self.animation = QPropertyAnimation(self, b"geometry")
        self.animation.setDuration(150)
        self.animation.setEasingCurve(QEasingCurve.Type.OutCubic)
        rect = self.geometry()
        self.animation.setStartValue(rect)
        self.animation.setEndValue(QRect(rect.x(), rect.y() + 2, rect.width(), rect.height()))
        self.animation.start()
        super().leaveEvent(event)

    def mousePressEvent(self, event):
        """鼠标点击事件"""
        if event.button() == Qt.MouseButton.LeftButton:
            self.albumClicked.emit(self.album.get('path', ''))
        super().mousePressEvent(event)

    def contextMenuEvent(self, event):
        """右键菜单事件（可选）"""
        # TODO: 添加右键菜单（收藏、删除等）
        super().contextMenuEvent(event)