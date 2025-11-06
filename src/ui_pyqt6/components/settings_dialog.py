"""
PyQt6设置对话框
应用程序设置管理
"""

from PyQt6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel,
    QPushButton, QCheckBox, QSpinBox, QTabWidget,
    QWidget, QGroupBox, QComboBox
)
from PyQt6.QtCore import Qt

class SettingsDialog(QDialog):
    """设置对话框"""

    def __init__(self, config_manager, parent=None):
        super().__init__(parent)
        self.config_manager = config_manager
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setWindowTitle("设置")
        self.setFixedSize(500, 400)

        layout = QVBoxLayout(self)

        # 创建选项卡
        tab_widget = QTabWidget()
        layout.addWidget(tab_widget)

        # 常规设置
        self.create_general_tab(tab_widget)

        # 界面设置
        self.create_interface_tab(tab_widget)

        # 快捷键设置
        self.create_shortcuts_tab(tab_widget)

        # 按钮
        button_layout = QHBoxLayout()
        button_layout.addStretch()

        self.save_btn = QPushButton("保存")
        self.save_btn.clicked.connect(self.save_settings)
        button_layout.addWidget(self.save_btn)

        self.cancel_btn = QPushButton("取消")
        self.cancel_btn.clicked.connect(self.reject)
        button_layout.addWidget(self.cancel_btn)

        layout.addLayout(button_layout)

    def create_general_tab(self, parent):
        """创建常规设置选项卡"""
        tab = QWidget()
        layout = QVBoxLayout(tab)

        # 最近浏览设置
        group = QGroupBox("最近浏览")
        group_layout = QVBoxLayout(group)

        self.max_recent_spin = QSpinBox()
        self.max_recent_spin.setRange(1, 100)
        self.max_recent_spin.setValue(self.config_manager.config.get('max_recent', 10))
        self.max_recent_spin.setSuffix(" 个")
        group_layout.addWidget(QLabel("最大显示数量:"))
        group_layout.addWidget(self.max_recent_spin)

        layout.addWidget(group)

        layout.addStretch()

        parent.addTab(tab, "常规")

    def create_interface_tab(self, parent):
        """创建界面设置选项卡"""
        tab = QWidget()
        layout = QVBoxLayout(tab)

        # 主题设置
        group = QGroupBox("主题")
        group_layout = QVBoxLayout(group)

        self.auto_switch_combo = QComboBox()
        self.auto_switch_combo.addItems(["浅色主题", "深色主题", "跟随系统"])
        group_layout.addWidget(QLabel("主题模式:"))
        group_layout.addWidget(self.auto_switch_combo)

        layout.addWidget(group)

        # 相册切换设置
        group = QGroupBox("相册切换")
        group_layout = QVBoxLayout(group)

        self.auto_switch_check = QCheckBox("启用相册间自动切换")
        self.auto_switch_check.setChecked(
            self.config_manager.get_auto_switch_album()
        )
        group_layout.addWidget(self.auto_switch_check)

        self.notification_check = QCheckBox("显示切换提示")
        self.notification_check.setChecked(
            self.config_manager.get_show_switch_notification()
        )
        group_layout.addWidget(self.notification_check)

        layout.addWidget(group)

        layout.addStretch()

        parent.addTab(tab, "界面")

    def create_shortcuts_tab(self, parent):
        """创建快捷键设置选项卡"""
        tab = QWidget()
        layout = QVBoxLayout(tab)

        info_label = QLabel("快捷键设置功能开发中...")
        info_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(info_label)

        layout.addStretch()

        parent.addTab(tab, "快捷键")

    def save_settings(self):
        """保存设置"""
        try:
            # 保存常规设置
            self.config_manager.config['max_recent'] = self.max_recent_spin.value()

            # 保存界面设置
            self.config_manager.set_auto_switch_album(
                self.auto_switch_check.isChecked()
            )
            self.config_manager.set_show_switch_notification(
                self.notification_check.isChecked()
            )

            # 保存配置
            self.config_manager.save_config()

            self.accept()
        except Exception as e:
            print(f"保存设置失败: {e}")
