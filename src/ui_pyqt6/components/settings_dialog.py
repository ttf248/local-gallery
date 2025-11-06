"""
PyQt6设置对话框
应用程序设置管理
完整功能实现
"""

import json
from pathlib import Path
from PyQt6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel,
    QPushButton, QCheckBox, QSpinBox, QTabWidget,
    QWidget, QGroupBox, QComboBox, QSlider,
    QTextEdit, QFileDialog, QMessageBox, QScrollArea
)
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QKeySequence

from .shortcut_editor import ShortcutEditor


class SettingsDialog(QDialog):
    """设置对话框"""

    def __init__(self, config_manager, parent=None):
        super().__init__(parent)
        self.config_manager = config_manager
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setWindowTitle("设置")
        self.setMinimumSize(600, 500)
        self.resize(700, 600)

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

        # 高级设置
        self.create_advanced_tab(tab_widget)

        # 扫描设置
        self.create_scan_tab(tab_widget)

        # 日志设置
        self.create_log_tab(tab_widget)

        # 按钮
        button_layout = QHBoxLayout()
        button_layout.addStretch()

        self.reset_btn = QPushButton("重置为默认")
        self.reset_btn.clicked.connect(self.reset_to_default)
        button_layout.addWidget(self.reset_btn)

        self.export_btn = QPushButton("导出配置")
        self.export_btn.clicked.connect(self.export_config)
        button_layout.addWidget(self.export_btn)

        self.import_btn = QPushButton("导入配置")
        self.import_btn.clicked.connect(self.import_config)
        button_layout.addWidget(self.import_btn)

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

        # 窗口设置
        group = QGroupBox("窗口设置")
        group_layout = QVBoxLayout(group)

        self.auto_save_window_state = QCheckBox("自动保存窗口状态")
        self.auto_save_window_state.setChecked(
            self.config_manager.get_auto_save_window_state()
        )
        group_layout.addWidget(self.auto_save_window_state)

        self.window_maximized = QCheckBox("启动时窗口最大化")
        self.window_maximized.setChecked(
            self.config_manager.get_window_maximized()
        )
        group_layout.addWidget(self.window_maximized)

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

        self.theme_combo = QComboBox()
        self.theme_combo.addItems(["浅色主题", "深色主题", "跟随系统"])
        theme_mode = self.config_manager.get_theme()
        if theme_mode == 'light':
            self.theme_combo.setCurrentIndex(0)
        elif theme_mode == 'dark':
            self.theme_combo.setCurrentIndex(1)
        else:
            self.theme_combo.setCurrentIndex(2)
        group_layout.addWidget(QLabel("主题模式:"))
        group_layout.addWidget(self.theme_combo)

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

        self.show_thumbnails = QCheckBox("显示缩略图")
        self.show_thumbnails.setChecked(
            self.config_manager.get_show_thumbnails()
        )
        group_layout.addWidget(self.show_thumbnails)

        layout.addWidget(group)

        layout.addStretch()

        parent.addTab(tab, "界面")

    def create_shortcuts_tab(self, parent):
        """创建快捷键设置选项卡"""
        tab = QWidget()
        layout = QVBoxLayout(tab)

        # 快捷键编辑器
        self.shortcut_editor = ShortcutEditor(self.config_manager)
        self.shortcut_editor.shortcutChanged.connect(self.on_shortcut_changed)
        layout.addWidget(self.shortcut_editor)

        parent.addTab(tab, "快捷键")

    def create_advanced_tab(self, parent):
        """创建高级设置选项卡"""
        tab = QWidget()
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)

        content = QWidget()
        layout = QVBoxLayout(content)

        # 性能设置
        group = QGroupBox("性能设置")
        group_layout = QVBoxLayout(group)

        # 缩略图大小
        self.thumbnail_size_spin = QSpinBox()
        self.thumbnail_size_spin.setRange(100, 500)
        self.thumbnail_size_spin.setValue(
            self.config_manager.get_image_thumbnail_size()
        )
        self.thumbnail_size_spin.setSuffix(" px")
        group_layout.addWidget(QLabel("缩略图大小:"))
        group_layout.addWidget(self.thumbnail_size_spin)

        layout.addWidget(group)

        layout.addStretch()
        scroll.setWidget(content)

        layout = QVBoxLayout(tab)
        layout.addWidget(scroll)

        parent.addTab(tab, "高级")

    def create_scan_tab(self, parent):
        """创建扫描设置选项卡"""
        tab = QWidget()
        layout = QVBoxLayout(tab)

        # 扫描选项
        group = QGroupBox("扫描选项")
        group_layout = QVBoxLayout(group)

        self.scan_recursive = QCheckBox("递归扫描子文件夹")
        self.scan_recursive.setChecked(
            self.config_manager.get_scan_recursive()
        )
        group_layout.addWidget(self.scan_recursive)

        self.scan_hidden = QCheckBox("扫描隐藏文件夹")
        self.scan_hidden.setChecked(
            self.config_manager.get_scan_hidden_folders()
        )
        group_layout.addWidget(self.scan_hidden)

        layout.addWidget(group)

        # 支持的格式
        group = QGroupBox("支持图片格式")
        group_layout = QVBoxLayout(group)

        format_info = QLabel(", ".join(self.config_manager.get_image_formats()))
        format_info.setWordWrap(True)
        format_info.setStyleSheet("QLabel { background-color: #f0f0f0; padding: 8px; }")
        group_layout.addWidget(format_info)

        layout.addWidget(group)

        layout.addStretch()

        parent.addTab(tab, "扫描")

    def on_shortcut_changed(self, action, shortcut):
        """快捷键改变回调"""
        self.config_manager.set_shortcut(action, shortcut)

    def reset_to_default(self):
        """重置为默认配置"""
        reply = QMessageBox.question(
            self,
            "重置为默认",
            "确定要重置所有设置到默认状态吗？\n这将丢失所有自定义配置！",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )

        if reply == QMessageBox.StandardButton.Yes:
            self.config_manager.reset_to_default()
            QMessageBox.information(self, "重置成功", "所有设置已重置为默认值\n重启应用后生效")
            self.reject()

    def export_config(self):
        """导出配置"""
        file_path, _ = QFileDialog.getSaveFileName(
            self,
            "导出配置",
            "comic_reader_settings.json",
            "JSON文件 (*.json)"
        )

        if file_path:
            if self.config_manager.export_config(file_path):
                QMessageBox.information(self, "导出成功", f"配置已导出到:\n{file_path}")
            else:
                QMessageBox.warning(self, "导出失败", "导出配置时出错")

    def import_config(self):
        """导入配置"""
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "导入配置",
            "",
            "JSON文件 (*.json)"
        )

        if file_path:
            reply = QMessageBox.question(
                self,
                "导入配置",
                    "确定要导入配置文件吗？\n这将覆盖当前所有设置！",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
            )

            if reply == QMessageBox.StandardButton.Yes:
                if self.config_manager.import_config(file_path):
                    QMessageBox.information(self, "导入成功", "配置已导入\n重启应用后生效")
                    self.reject()
                else:
                    QMessageBox.warning(self, "导入失败", "导入配置时出错")

    def save_settings(self):
        """保存设置"""
        try:
            # 保存常规设置
            self.config_manager.config['max_recent'] = self.max_recent_spin.value()
            self.config_manager.set_auto_save_window_state(
                self.auto_save_window_state.isChecked()
            )
            self.config_manager.set_window_maximized(
                self.window_maximized.isChecked()
            )

            # 保存界面设置
            theme_map = {0: 'light', 1: 'dark', 2: 'system'}
            self.config_manager.set_theme(
                theme_map[self.theme_combo.currentIndex()]
            )

            self.config_manager.set_auto_switch_album(
                self.auto_switch_check.isChecked()
            )
            self.config_manager.set_show_switch_notification(
                self.notification_check.isChecked()
            )
            self.config_manager.set_show_thumbnails(
                self.show_thumbnails.isChecked()
            )

            # 保存高级设置
            self.config_manager.set_image_thumbnail_size(
                self.thumbnail_size_spin.value()
            )

            # 保存扫描设置
            self.config_manager.set_scan_recursive(
                self.scan_recursive.isChecked()
            )
            self.config_manager.set_scan_hidden_folders(
                self.scan_hidden.isChecked()
            )

            # 保存日志设置
            self.config_manager.set_log_enabled(
                self.log_enabled_check.isChecked()
            )
            self.config_manager.set_log_level(
                self.log_level_combo.currentText()
            )
            self.config_manager.set_log_max_days(
                self.log_max_days_spin.value()
            )

            # 保存配置
            self.config_manager.save_config()

            QMessageBox.information(self, "保存成功", "设置已保存")
            self.accept()
        except Exception as e:
            QMessageBox.critical(self, "保存失败", f"保存设置时出错:\n{str(e)}")

    def create_log_tab(self, parent):
        """创建日志设置选项卡"""
        tab = QWidget()
        layout = QVBoxLayout(tab)

        # 日志基本设置
        basic_group = QGroupBox("基本设置")
        basic_layout = QVBoxLayout(basic_group)

        # 启用日志
        self.log_enabled_check = QCheckBox("启用日志记录")
        self.log_enabled_check.setChecked(self.config_manager.get_log_enabled())
        basic_layout.addWidget(self.log_enabled_check)

        # 日志级别
        level_layout = QHBoxLayout()
        level_layout.addWidget(QLabel("日志级别:"))
        self.log_level_combo = QComboBox()
        self.log_level_combo.addItems(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'])
        self.log_level_combo.setCurrentText(self.config_manager.get_log_level())
        level_layout.addWidget(self.log_level_combo)
        level_layout.addStretch()
        basic_layout.addLayout(level_layout)

        # 日志保留天数
        days_layout = QHBoxLayout()
        days_layout.addWidget(QLabel("日志保留天数:"))
        self.log_max_days_spin = QSpinBox()
        self.log_max_days_spin.setRange(1, 365)
        self.log_max_days_spin.setValue(self.config_manager.get_log_max_days())
        self.log_max_days_spin.setSuffix(" 天")
        days_layout.addWidget(self.log_max_days_spin)
        days_layout.addStretch()
        basic_layout.addLayout(days_layout)

        layout.addWidget(basic_group)

        # 文件路径设置
        path_group = QGroupBox("文件路径")
        path_layout = QVBoxLayout(path_group)

        # 配置文件路径
        config_path_layout = QHBoxLayout()
        config_path_layout.addWidget(QLabel("配置文件:"))
        self.config_path_label = QLabel(self.config_manager.get_config_file_path())
        self.config_path_label.setStyleSheet("color: #666;")
        self.config_path_label.setWordWrap(True)
        config_path_layout.addWidget(self.config_path_label, 1)
        self.open_config_btn = QPushButton("打开")
        self.open_config_btn.clicked.connect(self.open_config_file)
        config_path_layout.addWidget(self.open_config_btn)
        path_layout.addLayout(config_path_layout)

        # 日志文件路径
        log_path_layout = QHBoxLayout()
        log_path_layout.addWidget(QLabel("日志目录:"))
        self.log_path_label = QLabel(str(Path(self.config_manager.get_log_file_path()).parent))
        self.log_path_label.setStyleSheet("color: #666;")
        self.log_path_label.setWordWrap(True)
        log_path_layout.addWidget(self.log_path_label, 1)
        self.open_log_btn = QPushButton("打开")
        self.open_log_btn.clicked.connect(self.open_log_directory)
        log_path_layout.addWidget(self.open_log_btn)
        path_layout.addLayout(log_path_layout)

        layout.addWidget(path_group)

        layout.addStretch()
        parent.addTab(tab, "日志")

    def open_config_file(self):
        """打开配置文件"""
        import subprocess
        import platform

        config_path = self.config_manager.get_config_file_path()
        try:
            if platform.system() == 'Windows':
                subprocess.run(['explorer', '/select,', config_path], check=False)
            elif platform.system() == 'Darwin':  # macOS
                subprocess.run(['open', '-R', config_path], check=False)
            else:  # Linux
                subprocess.run(['xdg-open', str(Path(config_path).parent)], check=False)
        except Exception as e:
            QMessageBox.warning(self, "打开失败", f"无法打开配置文件:\n{str(e)}")

    def open_log_directory(self):
        """打开日志目录"""
        import subprocess
        import platform

        log_path = Path(self.config_manager.get_log_file_path()).parent
        try:
            if platform.system() == 'Windows':
                subprocess.run(['explorer', str(log_path)], check=False)
            elif platform.system() == 'Darwin':  # macOS
                subprocess.run(['open', str(log_path)], check=False)
            else:  # Linux
                subprocess.run(['xdg-open', str(log_path)], check=False)
        except Exception as e:
            QMessageBox.warning(self, "打开失败", f"无法打开日志目录:\n{str(e)}")
