"""
PyQt6现代化图片阅读器
支持单页/双页模式、全屏、快捷键、缩放等功能
使用组件库：PrimaryButton, SecondaryButton, IconButton, Label等
"""

import sys
from pathlib import Path
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QScrollArea,
    QSlider, QFrame, QSizePolicy, QApplication,
    QSplitter, QStackedWidget, QComboBox, QCheckBox
)
from PyQt6.QtCore import Qt, pyqtSignal, QSize, QTimer
from PyQt6.QtGui import (
    QPixmap, QTransform, QWheelEvent, QKeyEvent, QMouseEvent,
    QPainter, QColor, QFont, QShortcut, QKeySequence
)

# 添加src路径
src_path = Path(__file__).parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from utils.image_utils import ImageProcessor
from ui_pyqt6.style_manager import StyleManager
from ui_pyqt6.components.library import (
    PrimaryButton, SecondaryButton, IconButton, Label
)

class ReaderView(QWidget):
    """现代化图片阅读器组件"""

    # 定义信号
    imageChanged = pyqtSignal(int)  # 图片索引变化
    windowClosed = pyqtSignal()     # 窗口关闭
    exitRequested = pyqtSignal()    # 退出阅读器

    def __init__(self, parent=None):
        super().__init__(parent)
        self.image_files = []
        self.current_index = 0
        self.scale = 1.0
        self.min_scale = 0.1
        self.max_scale = 5.0
        self.rotation = 0
        self.is_fullscreen = False
        self.reading_mode = "single"  # single 或 double
        self.auto_play_timer = None
        self.auto_play_interval = 3000  # 3秒
        self.show_controls = True
        self.controls_hide_timer = QTimer()
        self.style_manager = StyleManager()

        self.init_ui()
        self.init_shortcuts()
        self.init_auto_hide_controls()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("reader_view")
        self.setMinimumSize(1000, 700)
        self.setMouseTracking(True)

        # 主布局
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # 顶部工具栏
        self.create_top_bar(main_layout)

        # 中央显示区域
        self.create_display_area(main_layout)

        # 底部信息栏
        self.create_bottom_bar(main_layout)

    def create_top_bar(self, parent_layout):
        """创建顶部工具栏"""
        self.top_bar = QFrame()
        self.top_bar.setObjectName("top_bar")
        self.top_bar.setFixedHeight(60)
        colors = self.style_manager.get_colors()
        self.top_bar.setStyleSheet(f"""
            QFrame#top_bar {{
                background-color: rgba(0, 0, 0, 0.8);
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }}
        """)

        layout = QHBoxLayout(self.top_bar)
        layout.setContentsMargins(16, 8, 16, 8)

        # 左侧：导航按钮 - 使用组件库按钮
        nav_layout = QHBoxLayout()

        self.prev_btn = IconButton("◀", self, self.style_manager)
        self.prev_btn.setText("上一页")
        self.prev_btn.clicked.connect(self.prev_image)
        nav_layout.addWidget(self.prev_btn)

        self.next_btn = IconButton("▶", self, self.style_manager)
        self.next_btn.setText("下一页")
        self.next_btn.clicked.connect(self.next_image)
        nav_layout.addWidget(self.next_btn)

        layout.addLayout(nav_layout)

        # 中间：阅读模式选择
        mode_layout = QHBoxLayout()
        mode_label = Label("阅读模式:", self, self.style_manager)
        mode_label.setStyleSheet(f"""
            QLabel {{
                color: white;
                font-size: {self.style_manager.font_sizes['sm']}px;
            }}
        """)
        mode_layout.addWidget(mode_label)

        self.mode_combo = QComboBox()
        self.mode_combo.addItems(["单页", "双页"])
        self.mode_combo.setCurrentText("单页")
        self.mode_combo.currentTextChanged.connect(self.on_mode_changed)
        self.mode_combo.setStyleSheet(f"""
            QComboBox {{
                background-color: rgba(255, 255, 255, 0.1);
                color: white;
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 4px;
                padding: 4px 8px;
                min-width: 80px;
            }}
            QComboBox::drop-down {{
                border: none;
            }}
            QComboBox::down-arrow {{
                image: none;
                border-left: 5px solid transparent;
                border-right: 5px solid transparent;
                border-top: 5px solid white;
            }}
        """)
        mode_layout.addWidget(self.mode_combo)

        layout.addLayout(mode_layout)

        layout.addStretch()

        # 右侧：功能按钮
        func_layout = QHBoxLayout()

        # 自动播放
        self.auto_play_cb = QCheckBox("自动播放")
        self.auto_play_cb.setStyleSheet(f"""
            QCheckBox {{
                color: white;
                font-size: {self.style_manager.font_sizes['sm']}px;
            }}
        """)
        self.auto_play_cb.toggled.connect(self.toggle_auto_play)
        func_layout.addWidget(self.auto_play_cb)

        # 全屏按钮 - 使用组件库按钮
        self.fullscreen_btn = SecondaryButton("⛶ 全屏", self, self.style_manager)
        self.fullscreen_btn.clicked.connect(self.toggle_fullscreen)
        func_layout.addWidget(self.fullscreen_btn)

        # 退出按钮 - 使用组件库按钮
        self.exit_btn = SecondaryButton("✕ 退出", self, self.style_manager)
        self.exit_btn.clicked.connect(self.exit_reader)
        func_layout.addWidget(self.exit_btn)

        layout.addLayout(func_layout)

        parent_layout.addWidget(self.top_bar)

    def create_display_area(self, parent_layout):
        """创建图片显示区域"""
        # 主分割器
        self.splitter = QSplitter(Qt.Orientation.Horizontal)
        self.splitter.setChildrenCollapsible(False)

        # 图片显示容器
        self.image_container = QStackedWidget()
        self.image_container.setObjectName("image_container")

        # 单页模式
        self.single_view = SinglePageView()
        self.single_view.imageClicked.connect(self.on_image_clicked)
        self.image_container.addWidget(self.single_view)

        # 双页模式
        self.double_view = DoublePageView()
        self.double_view.imageClicked.connect(self.on_image_clicked)
        self.image_container.addWidget(self.double_view)

        self.splitter.addWidget(self.image_container)

        # 设置分割器比例
        self.splitter.setSizes([1000])
        parent_layout.addWidget(self.splitter)

    def create_bottom_bar(self, parent_layout):
        """创建底部信息栏"""
        self.bottom_bar = QFrame()
        self.bottom_bar.setObjectName("bottom_bar")
        self.bottom_bar.setFixedHeight(80)
        self.bottom_bar.setStyleSheet(f"""
            QFrame#bottom_bar {{
                background-color: rgba(0, 0, 0, 0.8);
                border-top: 1px solid rgba(255, 255, 255, 0.1);
            }}
        """)

        layout = QVBoxLayout(self.bottom_bar)
        layout.setContentsMargins(16, 8, 16, 8)

        # 第一行：页面信息 - 使用组件库Label
        info_layout = QHBoxLayout()

        self.page_label = Label("第 1 页 / 共 1 页", self, self.style_manager)
        self.page_label.setStyleSheet(f"""
            QLabel {{
                color: white;
                font-size: {self.style_manager.font_sizes['base']}px;
                font-weight: bold;
            }}
        """)
        info_layout.addWidget(self.page_label)

        info_layout.addStretch()

        # 缩放信息 - 使用组件库Label
        self.zoom_label = Label("100%", self, self.style_manager)
        self.zoom_label.setStyleSheet(f"""
            QLabel {{
                color: white;
                font-size: {self.style_manager.font_sizes['base']}px;
            }}
        """)
        info_layout.addWidget(self.zoom_label)

        layout.addLayout(info_layout)

        # 第二行：控制按钮
        control_layout = QHBoxLayout()

        # 缩放控制 - 使用组件库按钮
        self.zoom_out_btn = IconButton("🔍-", self, self.style_manager)
        self.zoom_out_btn.clicked.connect(self.zoom_out)
        control_layout.addWidget(self.zoom_out_btn)

        self.zoom_slider = QSlider(Qt.Orientation.Horizontal)
        self.zoom_slider.setRange(10, 500)
        self.zoom_slider.setValue(100)
        self.zoom_slider.setFixedWidth(200)
        self.zoom_slider.valueChanged.connect(self.on_zoom_changed)
        control_layout.addWidget(self.zoom_slider)

        self.zoom_in_btn = IconButton("🔍+", self, self.style_manager)
        self.zoom_in_btn.clicked.connect(self.zoom_in)
        control_layout.addWidget(self.zoom_in_btn)

        control_layout.addWidget(self.create_separator())

        # 适应窗口按钮 - 使用组件库按钮
        self.fit_btn = SecondaryButton("适应窗口", self, self.style_manager)
        self.fit_btn.clicked.connect(self.fit_to_window)
        control_layout.addWidget(self.fit_btn)

        # 适应宽度按钮 - 使用组件库按钮
        self.fit_width_btn = SecondaryButton("适应宽度", self, self.style_manager)
        self.fit_width_btn.clicked.connect(self.fit_to_width)
        control_layout.addWidget(self.fit_width_btn)

        control_layout.addWidget(self.create_separator())

        # 旋转按钮 - 使用组件库按钮
        self.rotate_left_btn = IconButton("⟲", self, self.style_manager)
        self.rotate_left_btn.setText("旋转")
        self.rotate_left_btn.clicked.connect(self.rotate_left)
        control_layout.addWidget(self.rotate_left_btn)

        self.rotate_right_btn = IconButton("⟳", self, self.style_manager)
        self.rotate_right_btn.setText("旋转")
        self.rotate_right_btn.clicked.connect(self.rotate_right)
        control_layout.addWidget(self.rotate_right_btn)

        control_layout.addStretch()

        layout.addLayout(control_layout)

        parent_layout.addWidget(self.bottom_bar)

    def create_separator(self):
        """创建分隔线"""
        separator = QFrame()
        separator.setFrameShape(QFrame.Shape.VLine)
        separator.setFrameShadow(QFrame.Shadow.Sunken)
        separator.setStyleSheet(f"""
            QFrame {{
                color: rgba(255, 255, 255, 0.2);
            }}
        """)
        return separator

    def init_shortcuts(self):
        """初始化快捷键"""
        # 翻页
        QShortcut(QKeySequence(Qt.Key.Key_Left), self, activated=self.prev_image)
        QShortcut(QKeySequence(Qt.Key.Key_Right), self, activated=self.next_image)
        QShortcut(QKeySequence(Qt.Key.Key_Space), self, activated=self.next_image)

        # 缩放
        QShortcut(QKeySequence("Ctrl++"), self, activated=self.zoom_in)
        QShortcut(QKeySequence("Ctrl+-"), self, activated=self.zoom_out)
        QShortcut(QKeySequence("Ctrl+0"), self, activated=self.reset_zoom)

        # 全屏
        QShortcut(QKeySequence(Qt.Key.Key_F11), self, activated=self.toggle_fullscreen)
        QShortcut(QKeySequence(Qt.Key.Key_F), self, activated=self.toggle_fullscreen)

        # 旋转
        QShortcut(QKeySequence("Ctrl+R"), self, activated=self.rotate_right)

        # 退出
        QShortcut(QKeySequence(Qt.Key.Key_Escape), self, activated=self.exit_reader)
        QShortcut(QKeySequence("Ctrl+W"), self, activated=self.exit_reader)

        # 自动播放
        QShortcut(QKeySequence(Qt.Key.Key_A), self, activated=self.toggle_auto_play)

    def init_auto_hide_controls(self):
        """初始化自动隐藏控件"""
        self.controls_hide_timer.setSingleShot(True)
        self.controls_hide_timer.timeout.connect(self.hide_controls)
        self.controls_hide_timer.start(3000)  # 3秒后隐藏

    def set_images(self, image_files):
        """设置图片文件列表"""
        self.image_files = image_files
        self.current_index = 0
        self.single_view.set_images(image_files, 0)
        self.double_view.set_images(image_files, 0)
        self.update_display()

    def update_display(self):
        """更新显示"""
        # 更新页面信息
        total = len(self.image_files)
        if total > 0:
            self.page_label.setText(f"第 {self.current_index + 1} 页 / 共 {total} 页")

        # 更新缩放信息
        self.zoom_label.setText(f"{int(self.scale * 100)}%")

        # 更新滑块
        self.zoom_slider.setValue(int(self.scale * 100))

    def on_mode_changed(self, mode_text):
        """阅读模式改变"""
        if mode_text == "单页":
            self.reading_mode = "single"
            self.image_container.setCurrentWidget(self.single_view)
        else:
            self.reading_mode = "double"
            self.image_container.setCurrentWidget(self.double_view)

        self.update_display()

    def prev_image(self):
        """上一张图片"""
        if self.current_index > 0:
            self.current_index -= 1
            self.update_display()
            self.imageChanged.emit(self.current_index)

    def next_image(self):
        """下一张图片"""
        if self.current_index < len(self.image_files) - 1:
            self.current_index += 1
            self.update_display()
            self.imageChanged.emit(self.current_index)

    def zoom_in(self):
        """放大"""
        new_scale = min(self.scale * 1.25, self.max_scale)
        self.set_scale(new_scale)

    def zoom_out(self):
        """缩小"""
        new_scale = max(self.scale / 1.25, self.min_scale)
        self.set_scale(new_scale)

    def set_scale(self, scale):
        """设置缩放比例"""
        self.scale = scale
        self.update_display()

    def on_zoom_changed(self, value):
        """缩放滑块变化"""
        self.scale = value / 100.0
        self.update_display()

    def reset_zoom(self):
        """重置缩放"""
        self.scale = 1.0
        self.update_display()

    def fit_to_window(self):
        """适应窗口"""
        # TODO: 计算适合窗口的缩放比例
        self.scale = 1.0
        self.update_display()

    def fit_to_width(self):
        """适应宽度"""
        # TODO: 计算适合宽度的缩放比例
        self.scale = 1.0
        self.update_display()

    def rotate_left(self):
        """向左旋转"""
        self.rotation = (self.rotation - 90) % 360
        self.update_display()

    def rotate_right(self):
        """向右旋转"""
        self.rotation = (self.rotation + 90) % 360
        self.update_display()

    def toggle_fullscreen(self):
        """切换全屏"""
        if self.is_fullscreen:
            self.showNormal()
        else:
            self.showFullScreen()
        self.is_fullscreen = not self.is_fullscreen

    def exit_reader(self):
        """退出阅读器"""
        self.exitRequested.emit()

    def toggle_auto_play(self):
        """切换自动播放"""
        if self.auto_play_cb.isChecked():
            if not self.auto_play_timer:
                self.auto_play_timer = QTimer()
                self.auto_play_timer.timeout.connect(self.next_image)
            self.auto_play_timer.start(self.auto_play_interval)
        else:
            if self.auto_play_timer:
                self.auto_play_timer.stop()

    def on_image_clicked(self):
        """图片点击事件"""
        # 切换控件显示状态
        self.show_controls = not self.show_controls
        if self.show_controls:
            self.top_bar.show()
            self.bottom_bar.show()
        else:
            self.top_bar.hide()
            self.bottom_bar.hide()

        # 重置隐藏计时器
        if self.show_controls:
            self.controls_hide_timer.start(3000)

    def mouseMoveEvent(self, event):
        """鼠标移动事件 - 显示控件"""
        if not self.show_controls:
            self.show_controls = True
            self.top_bar.show()
            self.bottom_bar.show()
            self.controls_hide_timer.start(3000)
        super().mouseMoveEvent(event)

    def wheelEvent(self, event: QWheelEvent):
        """鼠标滚轮事件"""
        if event.modifiers() == Qt.KeyboardModifier.ControlModifier:
            # Ctrl + 滚轮：缩放
            if event.angleDelta().y() > 0:
                self.zoom_in()
            else:
                self.zoom_out()
        else:
            # 普通滚轮：翻页
            if event.angleDelta().y() > 0:
                self.prev_image()
            else:
                self.next_image()

    def keyPressEvent(self, event: QKeyEvent):
        """键盘事件"""
        super().keyPressEvent(event)

    def hide_controls(self):
        """隐藏控件"""
        if self.show_controls:
            self.top_bar.hide()
            self.bottom_bar.hide()
            self.show_controls = False


class SinglePageView(QWidget):
    """单页显示视图"""

    imageClicked = pyqtSignal()

    def __init__(self):
        super().__init__()
        self.image_files = []
        self.current_index = 0
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("single_page_view")
        self.setStyleSheet("""
            QWidget#single_page_view {
                background-color: #1C1C1E;
            }
        """)

        # 滚动区域
        self.scroll_area = QScrollArea()
        self.scroll_area.setWidgetResizable(True)
        self.scroll_area.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)

        # 图片标签
        self.image_label = QLabel()
        self.image_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.image_label.setMouseTracking(True)
        self.image_label.mousePressEvent = lambda e: self.imageClicked.emit()

        self.scroll_area.setWidget(self.image_label)

        # 布局
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self.scroll_area)

    def set_images(self, image_files, start_index):
        """设置图片"""
        self.image_files = image_files
        self.current_index = start_index
        self.load_current_image()

    def load_current_image(self):
        """加载当前图片"""
        if not self.image_files or self.current_index < 0 or self.current_index >= len(self.image_files):
            return

        image_path = self.image_files[self.current_index]
        pixmap = QPixmap(str(image_path))

        if not pixmap.isNull():
            self.image_label.setPixmap(pixmap)


class DoublePageView(QWidget):
    """双页显示视图"""

    imageClicked = pyqtSignal()

    def __init__(self):
        super().__init__()
        self.image_files = []
        self.current_index = 0
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("double_page_view")
        self.setStyleSheet("""
            QWidget#double_page_view {
                background-color: #1C1C1E;
            }
        """)

        # 水平布局：左右两页
        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # 左页
        self.left_label = QLabel()
        self.left_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.left_label.setStyleSheet("border-right: 1px solid rgba(255, 255, 255, 0.1);")
        self.left_label.mousePressEvent = lambda e: self.imageClicked.emit()
        layout.addWidget(self.left_label, 1)

        # 右页
        self.right_label = QLabel()
        self.right_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.right_label.mousePressEvent = lambda e: self.imageClicked.emit()
        layout.addWidget(self.right_label, 1)

    def set_images(self, image_files, start_index):
        """设置图片"""
        self.image_files = image_files
        self.current_index = start_index
        self.load_current_pages()

    def load_current_pages(self):
        """加载当前双页"""
        if not self.image_files:
            return

        # 加载左页
        if self.current_index < len(self.image_files):
            left_path = self.image_files[self.current_index]
            left_pixmap = QPixmap(str(left_path))
            if not left_pixmap.isNull():
                self.left_label.setPixmap(left_pixmap)

        # 加载右页
        if self.current_index + 1 < len(self.image_files):
            right_path = self.image_files[self.current_index + 1]
            right_pixmap = QPixmap(str(right_path))
            if not right_pixmap.isNull():
                self.right_label.setPixmap(right_pixmap)