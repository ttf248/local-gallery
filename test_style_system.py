#!/usr/bin/env python
"""
极简主义样式系统测试脚本
验证配色、字体、组件等是否正确应用
"""

import sys
from pathlib import Path

# 添加src路径
src_path = Path(__file__).parent / 'src'
sys.path.insert(0, str(src_path))

from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QPushButton, QLabel, QLineEdit, QComboBox, QFrame, QScrollArea
)
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QFont

from ui_pyqt6.style_manager import StyleManager


class StyleTestWindow(QMainWindow):
    """样式系统测试窗口"""

    def __init__(self):
        super().__init__()
        self.style_manager = StyleManager()
        self.init_ui()
        self.apply_styles()

    def init_ui(self):
        """初始化UI"""
        self.setWindowTitle("极简主义样式系统 - 测试")
        self.setMinimumSize(1200, 800)

        # 主容器
        main_widget = QWidget()
        self.setCentralWidget(main_widget)
        layout = QVBoxLayout(main_widget)
        layout.setSpacing(20)
        layout.setContentsMargins(32, 32, 32, 32)

        # 标题
        title = QLabel("极简主义样式系统测试")
        title.setObjectName("title")
        title.setFont(self.style_manager.get_font('3xl', QFont.Weight.Bold))
        layout.addWidget(title)

        # 配色展示
        self.create_color_section(layout)

        # 按钮展示
        self.create_button_section(layout)

        # 输入框展示
        self.create_input_section(layout)

        # 卡片展示
        self.create_card_section(layout)

        # 主题切换按钮
        switch_btn = QPushButton("切换主题 (浅色/深色)")
        switch_btn.setObjectName("primary")
        switch_btn.clicked.connect(self.style_manager.toggle_theme)
        switch_btn.clicked.connect(self.apply_styles)
        layout.addWidget(switch_btn)

        # 添加弹性空间
        layout.addStretch()

    def create_color_section(self, parent):
        """创建配色展示区域"""
        section_label = QLabel("配色方案")
        section_label.setFont(self.style_manager.get_font('xl', QFont.Weight.SemiBold))
        parent.addWidget(section_label)

        colors = self.style_manager.get_colors()
        color_keys = [
            'minimal-gray', 'minimal-border', 'minimal-text',
            'minimal-muted', 'minimal-blue', 'minimal-green',
            'minimal-red', 'minimal-yellow'
        ]

        color_layout = QHBoxLayout()
        for key in color_keys:
            color_widget = QWidget()
            color_widget.setFixedSize(100, 80)
            color_widget.setStyleSheet(f"""
                QWidget {{
                    background-color: {colors[key]};
                    border: 1px solid #E9ECEF;
                    border-radius: 8px;
                }}
            """)
            color_layout.addWidget(color_widget)

        parent.addLayout(color_layout)

    def create_button_section(self, parent):
        """创建按钮展示区域"""
        section_label = QLabel("按钮样式")
        section_label.setFont(self.style_manager.get_font('xl', QFont.Weight.SemiBold))
        parent.addWidget(section_label)

        button_layout = QHBoxLayout()
        button_layout.setSpacing(12)

        # 主按钮
        primary_btn = QPushButton("主按钮")
        primary_btn.setObjectName("primary")
        button_layout.addWidget(primary_btn)

        # 次要按钮
        secondary_btn = QPushButton("次要按钮")
        secondary_btn.setObjectName("secondary")
        button_layout.addWidget(secondary_btn)

        # 文字按钮
        text_btn = QPushButton("文字按钮")
        text_btn.setObjectName("text-button")
        button_layout.addWidget(text_btn)

        parent.addLayout(button_layout)

    def create_input_section(self, parent):
        """创建输入框展示区域"""
        section_label = QLabel("输入框样式")
        section_label.setFont(self.style_manager.get_font('xl', QFont.Weight.SemiBold))
        parent.addWidget(section_label)

        input_layout = QHBoxLayout()
        input_layout.setSpacing(12)

        # 文本输入框
        line_edit = QLineEdit("文本输入框")
        line_edit.setObjectName("input")
        input_layout.addWidget(line_edit)

        # 下拉菜单
        combo_box = QComboBox()
        combo_box.addItems(["选项1", "选项2", "选项3"])
        combo_box.setMinimumWidth(120)
        input_layout.addWidget(combo_box)

        parent.addLayout(input_layout)

    def create_card_section(self, parent):
        """创建卡片展示区域"""
        section_label = QLabel("卡片样式")
        section_label.setFont(self.style_manager.get_font('xl', QFont.Weight.SemiBold))
        parent.addWidget(section_label)

        card_layout = QHBoxLayout()
        card_layout.setSpacing(16)

        # 创建多个卡片
        for i in range(3):
            card = QFrame()
            card.setObjectName("album-card")
            card.setFixedSize(200, 150)

            card_layout_inner = QVBoxLayout(card)
            card_layout_inner.setContentsMargins(16, 16, 16, 16)

            # 卡片内容
            title = QLabel(f"卡片标题 {i+1}")
            title.setObjectName("title")
            title.setFont(self.style_manager.get_font('base', QFont.Weight.Medium))

            desc = QLabel("这是一段描述文字")
            desc.setObjectName("author")
            desc.setFont(self.style_manager.get_font('sm'))

            card_layout_inner.addWidget(title)
            card_layout_inner.addWidget(desc)
            card_layout_inner.addStretch()

            card_layout.addWidget(card)

        parent.addLayout(card_layout)

    def apply_styles(self):
        """应用样式"""
        # 应用主窗口样式
        self.setStyleSheet(self.style_manager.get_stylesheet('main_window'))

        # 应用按钮样式
        primary_btn = self.findChild(QPushButton, "primary")
        if primary_btn:
            primary_btn.setStyleSheet(self.style_manager.get_stylesheet('button_primary'))

        secondary_btn = self.findChild(QPushButton, "secondary")
        if secondary_btn:
            secondary_btn.setStyleSheet(self.style_manager.get_stylesheet('button_secondary'))

        text_btn = self.findChild(QPushButton, "text-button")
        if text_btn:
            text_btn.setObjectName("text-button")

        # 应用输入框样式
        line_edit = self.findChild(QLineEdit, "input")
        if line_edit:
            line_edit.setStyleSheet(self.style_manager.get_stylesheet('input_field'))

        # 应用卡片样式
        cards = self.findChildren(QFrame, "album-card")
        for card in cards:
            card.setStyleSheet(self.style_manager.get_stylesheet('minimal_card'))


def main():
    """主函数"""
    app = QApplication(sys.argv)

    # 设置应用属性
    app.setApplicationName("样式系统测试")
    app.setApplicationVersion("2.0.0")

    # 创建测试窗口
    window = StyleTestWindow()
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
