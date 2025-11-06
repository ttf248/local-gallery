"""
容器组件
通用的容器布局，支持多种布局方式
"""

from PyQt6.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QGridLayout, QSizePolicy
from PyQt6.QtCore import Qt

from .base_widget import BaseWidget


class Container(BaseWidget):
    """通用容器组件"""

    def __init__(self, parent=None, layout_type='vertical', margin=0, spacing=0, style_manager=None):
        # 先设置属性，再调用父类初始化
        self.layout_type = layout_type
        self.margin = margin
        self.spacing = spacing
        self._layout = None
        super().__init__(parent, style_manager)
        # 注意：init_ui()会在BaseWidget.__init__()中自动调用

    def init_ui(self):
        """初始化UI"""
        # 创建主布局
        if self.layout_type == 'vertical':
            self._layout = QVBoxLayout(self)
        elif self.layout_type == 'horizontal':
            self._layout = QHBoxLayout(self)
        elif self.layout_type == 'grid':
            self._layout = QGridLayout(self)
        else:
            self._layout = QVBoxLayout(self)

        # 设置边距和间距
        self._layout.setContentsMargins(self.margin, self.margin, self.margin, self.margin)
        self._layout.setSpacing(self.spacing)

        # 设置大小策略
        self.setSizePolicy(
            QSizePolicy.Policy.Expanding,
            QSizePolicy.Policy.Expanding
        )

    def get_layout(self):
        """获取布局对象"""
        return self._layout

    def add_widget(self, widget, stretch=0, alignment=Qt.AlignmentFlag.AlignLeft):
        """添加子组件（垂直/水平布局）"""
        if self.layout_type in ['vertical', 'horizontal']:
            if alignment == Qt.AlignmentFlag.AlignLeft:
                self._layout.addWidget(widget, stretch)
            else:
                self._layout.addWidget(widget, stretch, alignment)

    def add_layout(self, layout):
        """添加子布局"""
        if self.layout_type in ['vertical', 'horizontal']:
            self._layout.addLayout(layout)

    def add_widget_to_grid(self, widget, row, col, row_span=1, col_span=1, alignment=Qt.AlignmentFlag.AlignLeft):
        """添加子组件到网格"""
        if self.layout_type == 'grid':
            self._layout.addWidget(widget, row, col, row_span, col_span, alignment)

    def set_spacing(self, spacing):
        """设置组件间距"""
        self.spacing = spacing
        if self._layout:
            self._layout.setSpacing(spacing)

    def set_margin(self, margin):
        """设置边距"""
        self.margin = margin
        if self._layout:
            self._layout.setContentsMargins(margin, margin, margin, margin)
