"""
进度条组件
显示任务进度
"""

from PyQt6.QtWidgets import QWidget, QVBoxLayout, QLabel
from PyQt6.QtCore import Qt, QPropertyAnimation, QEasingCurve, pyqtSignal
from PyQt6.QtGui import QPainter, QColor, QPen

import sys
from pathlib import Path

# 添加src路径
src_path = Path(__file__).parent.parent.parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from ..base.base_widget import BaseWidget
from ..display.label import Label


class ProgressBar(BaseWidget):
    """进度条组件"""

    # 定义信号
    valueChanged = pyqtSignal(int)  # 值改变信号

    def __init__(self, minimum=0, maximum=100, value=0, show_text=True, parent=None, style_manager=None):
        # 先设置属性，再调用父类初始化
        self.minimum = minimum
        self.maximum = maximum
        self.value = value
        self.show_text = show_text
        super().__init__(parent, style_manager)
        # 注意：init_ui()会在BaseWidget.__init__()中自动调用

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("progress-bar")
        self.setFixedHeight(24)

        # 主布局
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        if self.show_text:
            # 带文字的进度条
            self.text_label = Label("", self)
            self.text_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.text_label.setFont(self.get_font('sm'))
            self.text_label.setStyleSheet(f"""
                QLabel {{
                    color: {self.style_manager.get_colors()['text-primary']};
                    font-size: {self.style_manager.font_sizes['sm']}px;
                }}
            """)
            layout.addWidget(self.text_label)
            self.setFixedHeight(32)

        self.update()

    def paintEvent(self, event):
        """绘制事件"""
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        colors = self.style_manager.get_colors()

        # 绘制背景
        rect = self.rect()
        painter.fillRect(rect, QColor(colors['bg-tertiary']))

        # 计算进度宽度
        if self.maximum > self.minimum:
            progress_width = int((self.value - self.minimum) / (self.maximum - self.minimum) * rect.width())
        else:
            progress_width = 0

        # 绘制进度
        if progress_width > 0:
            progress_rect = rect.adjusted(0, 0, -(rect.width() - progress_width), 0)
            painter.fillRect(progress_rect, QColor(colors['minimal-blue']))

    def update(self):
        """更新显示"""
        if self.show_text and hasattr(self, 'text_label'):
            percentage = self.get_percentage()
            self.text_label.setText(f"{percentage:.0f}%")

        # 设置样式
        colors = self.style_manager.get_colors()
        self.setStyleSheet(f"""
            QWidget {{
                background-color: {colors['bg-tertiary']};
                border-radius: 4px;
            }}
        """)

        self.update()  # 触发重绘

    def get_percentage(self):
        """获取百分比"""
        if self.maximum > self.minimum:
            return (self.value - self.minimum) / (self.maximum - self.minimum) * 100
        return 0

    def set_value(self, value):
        """设置值"""
        if value != self.value:
            self.value = max(self.minimum, min(value, self.maximum))
            self.update()
            self.valueChanged.emit(self.value)

    def set_range(self, minimum, maximum):
        """设置范围"""
        self.minimum = minimum
        self.maximum = maximum
        if self.value < minimum or self.value > maximum:
            self.value = max(minimum, min(self.value, maximum))
        self.update()

    def value(self):
        """获取当前值"""
        return self.value

    def minimum(self):
        """获取最小值"""
        return self.minimum

    def maximum(self):
        """获取最大值"""
        return self.maximum
