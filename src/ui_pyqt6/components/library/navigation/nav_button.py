"""
导航按钮组件
用于侧边栏导航菜单
"""

from PyQt6.QtWidgets import QPushButton
from PyQt6.QtCore import Qt, pyqtSignal, QPropertyAnimation, QEasingCurve, QRect
from PyQt6.QtGui import QFont, QIcon

import sys
from pathlib import Path

# 添加src路径
src_path = Path(__file__).parent.parent.parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from ..base.base_widget import BaseWidget
from ..display.label import Label


class NavButton(BaseWidget, QPushButton):
    """导航按钮组件"""

    # 定义信号
    clicked = pyqtSignal()

    def __init__(self, text, icon=None, is_active=False, parent=None, style_manager=None):
        # 初始化两个基类
        BaseWidget.__init__(self, parent, style_manager)
        QPushButton.__init__(self, text, parent)

        self.text = text
        self.icon = icon
        self.is_active = is_active
        self.animation = None

        self.setObjectName("nav-button")
        self.setMinimumHeight(40)
        self.setFont(self.get_font('sm'))
        self.setCursor(Qt.CursorShape.PointingHandCursor)

        # 初始化UI
        if self.icon:
            self.create_icon_layout()
        else:
            self.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
            self.setText(self.text)

        # 连接信号
        self.clicked.connect(self.on_clicked)

    def create_icon_layout(self):
        """创建图标布局"""
        # 使用内联样式显示图标
        self.setStyleSheet(f"""
            QPushButton {{
                text-align: left;
                padding-left: 16px;
                font-size: {self.style_manager.font_sizes['sm']}px;
            }}
        """)
        # 设置图标和文字
        if self.icon:
            self.setText(f"{self.icon}  {self.text}")

    def on_clicked(self):
        """按钮点击事件"""
        self.clicked.emit()

    def set_active(self, active):
        """设置激活状态"""
        self.is_active = active
        self.update_style()

    def update_style(self):
        """更新样式"""
        colors = self.style_manager.get_colors()

        if self.is_active:
            self.setStyleSheet(f"""
                QPushButton {{
                    background-color: {colors['minimal-blue']};
                    color: white;
                    border: none;
                    border-left: 4px solid {colors['minimal-blue']};
                    padding-left: 12px;
                    font-weight: 500;
                }}
                QPushButton:hover {{
                    background-color: {colors['minimal-blue-hover']};
                }}
            """)
        else:
            self.setStyleSheet(f"""
                QPushButton {{
                    background-color: transparent;
                    color: {colors['text-primary']};
                    border: none;
                    padding-left: 16px;
                    font-weight: 400;
                }}
                QPushButton:hover {{
                    background-color: {colors['bg-hover']};
                }}
            """)

    def enterEvent(self, event):
        """鼠标进入事件"""
        if not self.is_active:
            self.setStyleSheet(f"""
                QPushButton {{
                    background-color: {self.style_manager.get_colors()['bg-hover']};
                    color: {self.style_manager.get_colors()['text-primary']};
                    border: none;
                    padding-left: 16px;
                }}
            """)
        super().enterEvent(event)

    def leaveEvent(self, event):
        """鼠标离开事件"""
        self.update_style()
        super().leaveEvent(event)
