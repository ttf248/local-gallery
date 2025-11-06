"""
加载指示器组件
显示加载状态的动画
"""

from PyQt6.QtWidgets import QWidget, QVBoxLayout, QLabel
from PyQt6.QtCore import Qt, QTimer, pyqtSignal
from PyQt6.QtGui import QFont, QPainter, QColor

import sys
from pathlib import Path

# 添加src路径
src_path = Path(__file__).parent.parent.parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from ..base.base_widget import BaseWidget


class LoadingIndicator(BaseWidget):
    """加载指示器组件"""

    def __init__(self, size="medium", text="加载中...", parent=None, style_manager=None):
        super().__init__(parent, style_manager)
        self.size = size
        self.text = text
        self.angle = 0
        self.timer = QTimer()
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("loading-indicator")

        # 设置尺寸
        size_map = {
            "small": (24, 24),
            "medium": (48, 48),
            "large": (72, 72)
        }
        self.setFixedSize(*size_map.get(self.size, (48, 48)))

        # 启动动画
        self.timer.timeout.connect(self.rotate)
        self.timer.start(50)  # 每50ms更新一次

    def paintEvent(self, event):
        """绘制事件"""
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        colors = self.style_manager.get_colors()
        color = QColor(colors['minimal-blue'])

        # 绘制圆形边框
        rect = self.rect().adjusted(2, 2, -2, -2)
        painter.setPen(Qt.PenStyle.SolidLine)
        painter.setBrush(Qt.BrushStyle.NoBrush)
        painter.drawEllipse(rect)

        # 绘制旋转的弧形
        painter.setPen(color)
        pen = painter.pen()
        pen.setWidth(3)
        pen.setCapStyle(Qt.PenCapStyle.RoundCap)
        painter.setPen(pen)

        # 计算弧形位置
        start_angle = int(self.angle * 16)  # Qt使用1/16度单位
        span_angle = 90 * 16  # 90度弧形

        painter.drawArc(rect, start_angle, span_angle)

    def rotate(self):
        """旋转动画"""
        self.angle = (self.angle + 30) % 360
        self.update()  # 触发重绘

    def stop(self):
        """停止动画"""
        self.timer.stop()

    def start(self):
        """开始动画"""
        self.timer.start(50)


class LoadingSpinner(LoadingIndicator):
    """加载旋转器 - 带文字的版本"""

    def __init__(self, size="medium", text="加载中...", parent=None, style_manager=None):
        super().__init__(size, "", parent, style_manager)
        self.text = text
        self.init_ui_with_text()

    def init_ui_with_text(self):
        """初始化带文字的UI"""
        # 主布局
        layout = QVBoxLayout(self)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(8)

        # 旋转指示器
        self.spinner = LoadingIndicator(self.size, "", self, self.style_manager)
        layout.addWidget(self.spinner)

        # 文字标签
        if self.text:
            self.text_label = QLabel(self.text)
            self.text_label.setFont(self.style_manager.get_font('sm'))
            self.text_label.setStyleSheet(f"""
                QLabel {{
                    color: {self.style_manager.get_colors()['text-secondary']};
                    font-size: {self.style_manager.font_sizes['sm']}px;
                }}
            """)
            layout.addWidget(self.text_label)

        layout.addStretch()

    def stop(self):
        """停止动画"""
        super().stop()
        if hasattr(self, 'spinner'):
            self.spinner.stop()

    def start(self):
        """开始动画"""
        super().start()
        if hasattr(self, 'spinner'):
            self.spinner.start()

    def set_text(self, text):
        """设置文字"""
        self.text = text
        if hasattr(self, 'text_label'):
            self.text_label.setText(text)
