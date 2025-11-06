"""
空状态组件
用于显示空数据时的提示信息
"""

from PyQt6.QtWidgets import QWidget, QVBoxLayout, QPushButton
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QFont

import sys
from pathlib import Path

# 添加src路径
src_path = Path(__file__).parent.parent.parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from ..base.base_widget import BaseWidget
from ..display.label import Label
from ..buttons.primary_button import PrimaryButton


class EmptyState(BaseWidget):
    """空状态组件"""

    # 定义信号
    actionClicked = pyqtSignal()

    def __init__(self, title="暂无数据", description="", action_text=None, icon="📭", parent=None, style_manager=None):
        # 先设置属性，再调用父类初始化
        self.title = title
        self.description = description
        self.action_text = action_text
        self.icon = icon
        super().__init__(parent, style_manager)
        # 注意：init_ui()会在BaseWidget.__init__()中自动调用

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("empty-state")
        self.setMinimumHeight(300)

        # 主布局
        layout = QVBoxLayout(self)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.setContentsMargins(32, 32, 32, 32)
        layout.setSpacing(16)

        # 图标
        self.icon_label = Label(self.icon, self)
        self.icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.icon_label.setFont(QFont("Segoe UI Emoji", 64))
        self.icon_label.setStyleSheet(f"""
            QLabel {{
                color: {self.style_manager.get_colors()['text-tertiary']};
                margin-bottom: 8px;
            }}
        """)
        layout.addWidget(self.icon_label)

        # 标题
        self.title_label = Label(self.title, self)
        self.title_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.title_label.setFont(self.get_font('lg', QFont.Weight.Medium))
        self.title_label.setStyleSheet(f"""
            QLabel {{
                color: {self.style_manager.get_colors()['text-secondary']};
                margin-bottom: 8px;
            }}
        """)
        layout.addWidget(self.title_label)

        # 描述
        if self.description:
            self.desc_label = Label(self.description, self)
            self.desc_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.desc_label.setFont(self.get_font('sm'))
            self.desc_label.setWordWrap(True)
            self.desc_label.setStyleSheet(f"""
                QLabel {{
                    color: {self.style_manager.get_colors()['text-tertiary']};
                    margin-bottom: 16px;
                }}
            """)
            layout.addWidget(self.desc_label)

        # 操作按钮
        if self.action_text:
            self.action_btn = PrimaryButton(self.action_text, self, self.style_manager)
            self.action_btn.clicked.connect(self.actionClicked.emit)
            layout.addWidget(self.action_btn)

        layout.addStretch()

    def set_title(self, title):
        """设置标题"""
        self.title = title
        self.title_label.setText(title)

    def set_description(self, description):
        """设置描述"""
        self.description = description
        if hasattr(self, 'desc_label'):
            self.desc_label.setText(description)

    def set_action_text(self, action_text):
        """设置操作按钮文字"""
        self.action_text = action_text
        if hasattr(self, 'action_btn'):
            self.action_btn.setText(action_text)

    def set_icon(self, icon):
        """设置图标"""
        self.icon = icon
        self.icon_label.setText(icon)
