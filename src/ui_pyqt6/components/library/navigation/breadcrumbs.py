"""
面包屑导航组件
显示当前位置的层级路径
"""

from PyQt6.QtWidgets import QWidget, QHBoxLayout, QLabel
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QFont

import sys
from pathlib import Path

# 添加src路径
src_path = Path(__file__).parent.parent.parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from ..base.base_widget import BaseWidget
from ..buttons.icon_button import IconButton


class Breadcrumbs(BaseWidget):
    """面包屑导航组件"""

    # 定义信号
    itemClicked = pyqtSignal(str)  # 项目点击信号

    def __init__(self, items=None, parent=None, style_manager=None):
        # 先设置属性，再调用父类初始化
        self.items = items or []
        super().__init__(parent, style_manager)
        # 注意：init_ui()会在BaseWidget.__init__()中自动调用

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("breadcrumbs")
        self.setMaximumHeight(32)

        # 主布局
        layout = QHBoxLayout(self)
        layout.setContentsMargins(8, 4, 8, 4)
        layout.setSpacing(4)

        self.update_items()

    def update_items(self):
        """更新面包屑项目"""
        # 清除现有项目
        for i in reversed(range(self.layout().count())):
            child = self.layout().itemAt(i).widget()
            if child:
                child.setParent(None)

        # 添加新项目
        colors = self.style_manager.get_colors()

        for i, item in enumerate(self.items):
            if i > 0:
                # 添加分隔符
                separator = QLabel("›")
                separator.setFont(self.get_font('sm'))
                separator.setStyleSheet(f"""
                    QLabel {{
                        color: {colors['text-tertiary']};
                        font-size: {self.style_manager.font_sizes['sm']}px;
                    }}
                """)
                self.layout().addWidget(separator)

            # 添加项目
            item_label = QLabel(item)
            item_label.setFont(self.get_font('sm'))
            item_label.setCursor(Qt.CursorShape.PointingHandCursor)
            item_label.setStyleSheet(f"""
                QLabel {{
                    color: {colors['minimal-blue']};
                    font-size: {self.style_manager.font_sizes['sm']}px;
                    padding: 2px 8px;
                    border-radius: 4px;
                }}
                QLabel:hover {{
                    background-color: {colors['bg-hover']};
                }}
            """)
            item_label.mousePressEvent = lambda e, text=item: self.on_item_clicked(text)

            self.layout().addWidget(item_label)

        self.layout().addStretch()

    def on_item_clicked(self, text):
        """项目点击事件"""
        self.itemClicked.emit(text)

    def set_items(self, items):
        """设置面包屑项目"""
        self.items = items
        self.update_items()
