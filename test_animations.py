"""
动画集成测试
测试按钮和卡片的动画效果
"""

import sys
from pathlib import Path

# 添加src路径
src_path = Path(__file__).parent / "src"
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from PyQt6.QtWidgets import QApplication, QMainWindow, QVBoxLayout, QHBoxLayout, QWidget, QScrollArea
from PyQt6.QtCore import Qt

from ui_pyqt6.style_manager import StyleManager
from ui_pyqt6.components.library import (
    PrimaryButton, SecondaryButton, IconButton, Card, Label
)


class AnimationTestWindow(QMainWindow):
    """动画测试窗口"""

    def __init__(self):
        super().__init__()
        self.style_manager = StyleManager()
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setWindowTitle("动画效果测试")
        self.setMinimumSize(800, 600)

        # 创建滚动区域
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)

        # 主容器
        main_widget = QWidget()
        main_layout = QVBoxLayout(main_widget)
        main_layout.setSpacing(20)
        main_layout.setContentsMargins(20, 20, 20, 20)

        # 标题
        title = Label("动画效果测试", main_widget, self.style_manager)
        title.set_font_size('xl')
        title.set_bold(True)
        main_layout.addWidget(title)

        # 按钮测试区域
        button_card = Card(main_widget, self.style_manager)
        button_layout = QVBoxLayout(button_card)
        button_layout.setSpacing(10)

        button_title = Label("按钮动画测试", main_widget, self.style_manager)
        button_title.set_font_size('lg')
        button_title.set_bold(True)
        button_layout.addWidget(button_title)

        # 按钮组
        btn_row1 = QHBoxLayout()
        btn_row1.setSpacing(10)

        self.primary_btn = PrimaryButton("主按钮", main_widget, self.style_manager)
        self.secondary_btn = SecondaryButton("次要按钮", main_widget, self.style_manager)
        self.icon_btn = IconButton("📁", main_widget, self.style_manager)
        self.icon_btn.setText("图标按钮")

        btn_row1.addWidget(self.primary_btn)
        btn_row1.addWidget(self.secondary_btn)
        btn_row1.addWidget(self.icon_btn)
        btn_row1.addStretch()

        button_layout.addLayout(btn_row1)

        # 测试按钮
        test_row = QHBoxLayout()
        test_row.setSpacing(10)

        self.test_fade_in = SecondaryButton("测试淡入", main_widget, self.style_manager)
        self.test_fade_out = SecondaryButton("测试淡出", main_widget, self.style_manager)
        self.test_zoom = SecondaryButton("测试缩放", main_widget, self.style_manager)
        self.test_pulse = SecondaryButton("测试脉冲", main_widget, self.style_manager)

        test_row.addWidget(self.test_fade_in)
        test_row.addWidget(self.test_fade_out)
        test_row.addWidget(self.test_zoom)
        test_row.addWidget(self.test_pulse)
        test_row.addStretch()

        button_layout.addLayout(test_row)

        main_layout.addWidget(button_card)

        # 卡片测试区域
        card_test = Card(main_widget, self.style_manager)
        card_layout = QVBoxLayout(card_test)
        card_layout.setSpacing(10)

        card_title = Label("卡片动画测试", main_widget, self.style_manager)
        card_title.set_font_size('lg')
        card_title.set_bold(True)
        card_layout.addWidget(card_title)

        card_desc = Label("将鼠标悬停在这些卡片上，查看缩放和阴影效果", main_widget, self.style_manager)
        card_desc.set_font_size('sm')
        card_desc.set_text_color(self.style_manager.get_colors()['text-secondary'])
        card_layout.addWidget(card_desc)

        # 创建多个测试卡片
        cards_row = QHBoxLayout()
        cards_row.setSpacing(10)

        for i in range(4):
            test_card = Card(main_widget, padding=20, spacing=5, style_manager=self.style_manager)
            test_card.setFixedSize(120, 100)
            test_layout = test_card.get_layout()

            card_label = Label(f"卡片 {i+1}", main_widget, self.style_manager)
            card_label.set_font_size('sm')
            card_label.set_bold(True)
            test_layout.addWidget(card_label)

            card_text = Label("悬停查看效果", main_widget, self.style_manager)
            card_text.set_font_size('xs')
            card_text.set_text_color(self.style_manager.get_colors()['text-tertiary'])
            test_layout.addWidget(card_text)

            cards_row.addWidget(test_card)

        cards_row.addStretch()
        card_layout.addLayout(cards_row)

        main_layout.addWidget(card_test)

        # 过渡效果测试区域
        transition_card = Card(main_widget, self.style_manager)
        transition_layout = QVBoxLayout(transition_card)
        transition_layout.setSpacing(10)

        transition_title = Label("过渡效果测试", main_widget, self.style_manager)
        transition_title.set_font_size('lg')
        transition_title.set_bold(True)
        transition_layout.addWidget(transition_title)

        transition_row = QHBoxLayout()
        transition_row.setSpacing(10)

        self.test_slide = SecondaryButton("滑动切换", main_widget, self.style_manager)
        self.test_fade = SecondaryButton("淡入淡出", main_widget, self.style_manager)
        self.test_zoom_transition = SecondaryButton("缩放切换", main_widget, self.style_manager)

        transition_row.addWidget(self.test_slide)
        transition_row.addWidget(self.test_fade)
        transition_row.addWidget(self.test_zoom_transition)
        transition_row.addStretch()

        transition_layout.addLayout(transition_row)

        main_layout.addWidget(transition_card)

        main_layout.addStretch()

        # 设置中心窗口
        scroll.setWidget(main_widget)
        self.setCentralWidget(scroll)

        # 连接测试信号
        self.test_fade_in.clicked.connect(self.test_fade_in_animation)
        self.test_fade_out.clicked.connect(self.test_fade_out_animation)
        self.test_zoom.clicked.connect(self.test_zoom_animation)
        self.test_pulse.clicked.connect(self.test_pulse_animation)

    def test_fade_in_animation(self):
        """测试淡入动画"""
        self.primary_btn.animate_fade_in(300)

    def test_fade_out_animation(self):
        """测试淡出动画"""
        self.secondary_btn.animate_fade_out(300)

    def test_zoom_animation(self):
        """测试缩放动画"""
        self.icon_btn.animate_zoom_in(300)

    def test_pulse_animation(self):
        """测试脉冲动画"""
        self.primary_btn.animate_pulse(1000)


def main():
    """主函数"""
    app = QApplication(sys.argv)
    window = AnimationTestWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
