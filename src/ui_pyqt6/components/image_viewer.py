"""
PyQt6图片查看器组件
专业级图片浏览和缩放功能
"""

import sys
from pathlib import Path
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QScrollArea,
    QPushButton, QSlider, QFrame, QSizePolicy, QApplication
)
from PyQt6.QtCore import Qt, pyqtSignal, QSize
from PyQt6.QtGui import QPixmap, QTransform, QWheelEvent, QKeyEvent, QMouseEvent

# 添加src路径
src_path = Path(__file__).parent.parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from utils.image_utils import ImageProcessor

class ImageViewer(QWidget):
    """图片查看器组件"""

    # 定义信号
    imageChanged = pyqtSignal(int)  # 图片索引变化
    windowClosed = pyqtSignal()     # 窗口关闭

    def __init__(self, parent=None):
        super().__init__(parent)
        self.image_files = []
        self.current_index = 0
        self.scale = 1.0
        self.rotation = 0
        self.is_fullscreen = False

        # 缩放范围
        self.min_scale = 0.1
        self.max_scale = 5.0

        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("image_viewer")
        self.setMinimumSize(800, 600)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        # 创建图片显示区域
        self.create_image_area()

        # 创建控制栏
        self.create_control_bar()

    def create_image_area(self):
        """创建图片显示区域"""
        # 滚动区域
        self.scroll_area = QScrollArea()
        self.scroll_area.setWidgetResizable(True)
        self.scroll_area.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.scroll_area.setObjectName("scroll_area")

        # 图片标签
        self.image_label = QLabel()
        self.image_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.image_label.setObjectName("image_label")
        self.image_label.setMinimumSize(400, 400)
        self.image_label.setSizePolicy(
            QSizePolicy.Policy.Expanding,
            QSizePolicy.Policy.Expanding
        )

        self.scroll_area.setWidget(self.image_label)
        layout().addWidget(self.scroll_area)

    def create_control_bar(self):
        """创建控制栏"""
        self.control_bar = QFrame()
        self.control_bar.setObjectName("control_bar")
        self.control_bar.setFixedHeight(60)

        layout = QHBoxLayout(self.control_bar)
        layout.setContentsMargins(16, 8, 16, 8)

        # 左侧控制
        self.prev_btn = QPushButton("◀ 上一张")
        self.prev_btn.clicked.connect(self.prev_image)
        layout.addWidget(self.prev_btn)

        self.next_btn = QPushButton("下一张 ▶")
        self.next_btn.clicked.connect(self.next_image)
        layout.addWidget(self.next_btn)

        layout.addWidget(self.create_separator())

        # 缩放控制
        self.zoom_out_btn = QPushButton("🔍-")
        self.zoom_out_btn.clicked.connect(self.zoom_out)
        layout.addWidget(self.zoom_out_btn)

        self.zoom_slider = QSlider(Qt.Orientation.Horizontal)
        self.zoom_slider.setRange(10, 500)
        self.zoom_slider.setValue(100)
        self.zoom_slider.valueChanged.connect(self.on_zoom_changed)
        self.zoom_slider.setFixedWidth(150)
        layout.addWidget(self.zoom_slider)

        self.zoom_in_btn = QPushButton("🔍+")
        self.zoom_in_btn.clicked.connect(self.zoom_in)
        layout.addWidget(self.zoom_in_btn)

        layout.addWidget(self.create_separator())

        # 旋转控制
        self.rotate_left_btn = QPushButton("⟲")
        self.rotate_left_btn.clicked.connect(self.rotate_left)
        layout.addWidget(self.rotate_left_btn)

        self.rotate_btn = QPushButton("⟳")
        self.rotate_btn.clicked.connect(self.rotate_right)
        layout.addWidget(self.rotate_btn)

        layout.addWidget(self.create_separator())

        # 右侧控制
        self.fit_btn = QPushButton("适应窗口")
        self.fit_btn.clicked.connect(self.fit_to_window)
        layout.addWidget(self.fit_btn)

        self.fullscreen_btn = QPushButton("⛶ 全屏")
        self.fullscreen_btn.clicked.connect(self.toggle_fullscreen)
        layout.addWidget(self.fullscreen_btn)

        layout().addWidget(self.control_bar)

    def create_separator(self):
        """创建分隔线"""
        separator = QFrame()
        separator.setFrameShape(QFrame.Shape.VLine)
        separator.setFrameShadow(QFrame.Shadow.Sunken)
        return separator

    def set_images(self, image_files):
        """设置图片文件列表"""
        self.image_files = image_files
        self.current_index = 0
        self.load_current_image()

    def load_current_image(self):
        """加载当前图片"""
        if not self.image_files or self.current_index < 0 or self.current_index >= len(self.image_files):
            return

        try:
            image_path = self.image_files[self.current_index]
            pixmap = QPixmap(str(image_path))

            if not pixmap.isNull():
                # 应用缩放和旋转
                self.update_displayed_image(pixmap)
                self.update_controls()
        except Exception as e:
            print(f"加载图片失败: {e}")

    def update_displayed_image(self, pixmap):
        """更新显示的图片"""
        if pixmap.isNull():
            return

        # 创建变换
        transform = QTransform()
        transform.scale(self.scale, self.scale)
        transform.rotate(self.rotation)

        # 应用变换
        transformed_pixmap = pixmap.transformed(transform, Qt.TransformationMode.SmoothTransformation)

        # 设置图片
        self.image_label.setPixmap(transformed_pixmap)

    def update_controls(self):
        """更新控件状态"""
        # 更新图片信息
        if self.image_files:
            info_text = f"第 {self.current_index + 1} 张 / 共 {len(self.image_files)} 张"
            # TODO: 更新状态栏或显示区域
        else:
            info_text = "没有图片"

    def prev_image(self):
        """上一张图片"""
        if self.current_index > 0:
            self.current_index -= 1
            self.load_current_image()
            self.imageChanged.emit(self.current_index)

    def next_image(self):
        """下一张图片"""
        if self.current_index < len(self.image_files) - 1:
            self.current_index += 1
            self.load_current_image()
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
        self.zoom_slider.setValue(int(scale * 100))
        self.load_current_image()

    def on_zoom_changed(self, value):
        """缩放滑块变化"""
        self.scale = value / 100.0
        self.load_current_image()

    def rotate_left(self):
        """向左旋转"""
        self.rotation = (self.rotation - 90) % 360
        self.load_current_image()

    def rotate_right(self):
        """向右旋转"""
        self.rotation = (self.rotation + 90) % 360
        self.load_current_image()

    def fit_to_window(self):
        """适应窗口"""
        # TODO: 实现适应窗口逻辑
        self.scale = 1.0
        self.rotation = 0
        self.zoom_slider.setValue(100)
        self.load_current_image()

    def toggle_fullscreen(self):
        """切换全屏"""
        if self.is_fullscreen:
            self.showNormal()
        else:
            self.showFullScreen()
        self.is_fullscreen = not self.is_fullscreen

    def wheelEvent(self, event: QWheelEvent):
        """鼠标滚轮事件"""
        if event.angleDelta().y() > 0:
            self.zoom_in()
        else:
            self.zoom_out()

    def keyPressEvent(self, event: QKeyEvent):
        """键盘事件"""
        key = event.key()

        if key == Qt.Key.Key_Left or key == Qt.Key.Key_A:
            self.prev_image()
        elif key == Qt.Key.Key_Right or key == Qt.Key.Key_D:
            self.next_image()
        elif key == Qt.Key.Key_Plus or key == Qt.Key.Key_Equal:
            self.zoom_in()
        elif key == Qt.Key.Key_Minus:
            self.zoom_out()
        elif key == Qt.Key.Key_R:
            self.rotate_right()
        elif key == Qt.Key.Key_F11 or key == Qt.Key.Key_F:
            self.toggle_fullscreen()
        elif key == Qt.Key.Key_Escape:
            if self.is_fullscreen:
                self.toggle_fullscreen()
            else:
                self.close()
        else:
            super().keyPressEvent(event)
