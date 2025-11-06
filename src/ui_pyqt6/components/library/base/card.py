"""
卡片组件
通用的卡片容器，支持悬停效果
"""

from PyQt6.QtWidgets import QFrame, QVBoxLayout, QHBoxLayout
from PyQt6.QtCore import Qt, QPropertyAnimation, QEasingCurve
from PyQt6.QtGui import QColor

from .base_widget import BaseWidget


class Card(BaseWidget):
    """通用卡片组件"""

    def __init__(self, parent=None, padding=16, spacing=8, style_manager=None):
        super().__init__(parent, style_manager)
        self.padding = padding
        self.spacing = spacing
        self.layout = None
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        # 创建卡片框架
        self.card_frame = QFrame(self)
        self.card_frame.setObjectName("card")

        # 设置大小策略
        self.setSizePolicy(
            QSizePolicy.Policy.Expanding,
            QSizePolicy.Policy.Expanding
        )

        # 创建主布局
        self.layout = QVBoxLayout(self.card_frame)
        self.layout.setContentsMargins(
            self.padding, self.padding, self.padding, self.padding
        )
        self.layout.setSpacing(self.spacing)

        # 应用样式
        self.apply_card_style()

    def apply_card_style(self):
        """应用卡片样式"""
        self.card_frame.setFrameShape(QFrame.Shape.Box)
        self.card_frame.setLineWidth(0)

    def on_enter(self):
        """鼠标进入时的悬停效果"""
        # 边框颜色动画
        self.animate_property(
            b"stylesheet",
            "",
            self.get_hover_stylesheet()
        )

    def on_leave(self):
        """鼠标离开时的效果"""
        # 恢复原始样式
        self.animate_property(
            b"stylesheet",
            "",
            self.get_normal_stylesheet()
        )

    def get_normal_stylesheet(self) -> str:
        """获取正常状态的样式表"""
        colors = self.style_manager.get_colors()
        radius = self.get_border_radius('md')

        return f"""
            QFrame#card {{
                background-color: {colors['card-bg']};
                border: 1px solid {colors['border-light']};
                border-radius: {radius}px;
            }}
        """

    def get_hover_stylesheet(self) -> str:
        """获取悬停状态的样式表"""
        colors = self.style_manager.get_colors()
        radius = self.get_border_radius('md')

        return f"""
            QFrame#card {{
                background-color: {colors['card-bg']};
                border: 1px solid {colors['accent']};
                border-radius: {radius}px;
            }}
        """

    def get_layout(self) -> QVBoxLayout:
        """获取卡片内部布局"""
        return self.layout

    def add_widget(self, widget):
        """向卡片添加子组件"""
        if self.layout:
            self.layout.addWidget(widget)

    def add_layout(self, layout):
        """向卡片添加子布局"""
        if self.layout:
            self.layout.addLayout(layout)

    def set_fixed_size(self, width, height):
        """设置固定大小"""
        self.setFixedSize(width, height)
        self.card_frame.setFixedSize(width, height)
