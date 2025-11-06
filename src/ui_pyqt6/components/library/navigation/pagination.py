"""
分页组件
用于分页导航
"""

from PyQt6.QtWidgets import QWidget, QHBoxLayout, QPushButton, QLabel
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


class Pagination(BaseWidget):
    """分页组件"""

    # 定义信号
    pageChanged = pyqtSignal(int)  # 页码改变信号

    def __init__(self, current_page=1, total_pages=1, parent=None, style_manager=None):
        super().__init__(parent, style_manager)
        self.current_page = current_page
        self.total_pages = total_pages
        self.init_ui()
        self.update()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("pagination")
        self.setMaximumHeight(48)

        # 主布局
        layout = QHBoxLayout(self)
        layout.setContentsMargins(16, 8, 16, 8)
        layout.setSpacing(4)

    def update(self):
        """更新分页显示"""
        # 清除现有内容
        for i in reversed(range(self.layout().count())):
            child = self.layout().itemAt(i).widget()
            if child:
                child.setParent(None)

        colors = self.style_manager.get_colors()

        # 上一页按钮
        self.prev_btn = IconButton("←", self, self.style_manager)
        self.prev_btn.setEnabled(self.current_page > 1)
        self.prev_btn.clicked.connect(self.prev_page)
        self.layout().addWidget(self.prev_btn)

        # 页码按钮
        self.create_page_buttons()

        # 下一页按钮
        self.next_btn = IconButton("→", self, self.style_manager)
        self.next_btn.setEnabled(self.current_page < self.total_pages)
        self.next_btn.clicked.connect(self.next_page)
        self.layout().addWidget(self.next_btn)

        # 分页信息
        info = QLabel(f"第 {self.current_page} 页 / 共 {self.total_pages} 页")
        info.setFont(self.get_font('sm'))
        info.setStyleSheet(f"""
            QLabel {{
                color: {colors['text-secondary']};
                font-size: {self.style_manager.font_sizes['sm']}px;
                padding: 8px 16px;
            }}
        """)
        self.layout().addWidget(info)

        self.layout().addStretch()

    def create_page_buttons(self):
        """创建页码按钮"""
        colors = self.style_manager.get_colors()

        # 计算显示的页码范围
        start_page = max(1, self.current_page - 2)
        end_page = min(self.total_pages, self.current_page + 2)

        for page in range(start_page, end_page + 1):
            page_btn = QPushButton(str(page))
            page_btn.setFont(self.get_font('sm'))
            page_btn.setFixedSize(32, 32)
            page_btn.setCursor(Qt.CursorShape.PointingHandCursor)

            if page == self.current_page:
                page_btn.setStyleSheet(f"""
                    QPushButton {{
                        background-color: {colors['minimal-blue']};
                        color: white;
                        border: 1px solid {colors['minimal-blue']};
                        border-radius: 6px;
                        font-weight: 500;
                    }}
                """)
            else:
                page_btn.setStyleSheet(f"""
                    QPushButton {{
                        background-color: {colors['bg-primary']};
                        color: {colors['text-primary']};
                        border: 1px solid {colors['border-light']};
                        border-radius: 6px;
                    }}
                    QPushButton:hover {{
                        background-color: {colors['bg-hover']};
                        border-color: {colors['minimal-blue']};
                    }}
                """)

            page_btn.clicked.connect(lambda checked, p=page: self.set_page(p))
            self.layout().addWidget(page_btn)

    def prev_page(self):
        """上一页"""
        if self.current_page > 1:
            self.set_page(self.current_page - 1)

    def next_page(self):
        """下一页"""
        if self.current_page < self.total_pages:
            self.set_page(self.current_page + 1)

    def set_page(self, page):
        """设置当前页码"""
        if 1 <= page <= self.total_pages and page != self.current_page:
            self.current_page = page
            self.update()
            self.pageChanged.emit(page)

    def set_total_pages(self, total_pages):
        """设置总页数"""
        self.total_pages = total_pages
        if self.current_page > total_pages:
            self.current_page = total_pages
        self.update()
