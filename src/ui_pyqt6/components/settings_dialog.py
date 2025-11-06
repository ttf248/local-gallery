"""
PyQt6设置对话框
应用程序设置管理
使用组件库：Card, Label, Button, Tag等
完整功能实现
"""

import json
import sys
from pathlib import Path
from PyQt6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout,
    QPushButton, QCheckBox, QSpinBox, QTabWidget,
    QWidget, QComboBox, QSlider,
    QTextEdit, QFileDialog, QMessageBox, QScrollArea
)
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QKeySequence

# 添加src路径
src_path = Path(__file__).parent.parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from ui_pyqt6.style_manager import StyleManager
from ui_pyqt6.components.library import (
    Label, PrimaryButton, SecondaryButton, IconButton, Tag, Card
)

from .shortcut_editor import ShortcutEditor


class SettingsDialog(QDialog):
    """设置对话框"""

    def __init__(self, config_manager, parent=None):
        super().__init__(parent)
        self.config_manager = config_manager
        self.style_manager = StyleManager()
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

        # 按钮 - 使用组件库按钮
        button_layout = QHBoxLayout()
        button_layout.addStretch()

        self.reset_btn = SecondaryButton("重置为默认", self, self.style_manager)
        self.reset_btn.clicked.connect(self.reset_to_default)
        button_layout.addWidget(self.reset_btn)

        self.export_btn = SecondaryButton("导出配置", self, self.style_manager)
        self.export_btn.clicked.connect(self.export_config)
        button_layout.addWidget(self.export_btn)

        self.import_btn = SecondaryButton("导入配置", self, self.style_manager)
        self.import_btn.clicked.connect(self.import_config)
        button_layout.addWidget(self.import_btn)

        self.save_btn = PrimaryButton("保存", self, self.style_manager)
        self.save_btn.clicked.connect(self.save_settings)
        button_layout.addWidget(self.save_btn)

        self.cancel_btn = SecondaryButton("取消", self, self.style_manager)
        self.cancel_btn.clicked.connect(self.reject)
        button_layout.addWidget(self.cancel_btn)

        layout.addLayout(button_layout)

    def create_general_tab(self, parent):
        """创建常规设置选项卡"""
        tab = QWidget()
        layout = QVBoxLayout(tab)

        # 最近浏览设置 - 使用Card容器
        recent_card = Card(self, self.style_manager)
        recent_layout = QVBoxLayout(recent_card)
        recent_layout.setContentsMargins(12, 12, 12, 12)
        recent_layout.setSpacing(8)

        # 标题
        title = Label("最近浏览", self, self.style_manager)
        title.set_font_size('base')
        title.set_bold(True)
        recent_layout.addWidget(title)

        self.max_recent_spin = QSpinBox()
        self.max_recent_spin.setRange(1, 100)
        self.max_recent_spin.setValue(self.config_manager.config.get('max_recent', 10))
        self.max_recent_spin.setSuffix(" 个")
        self.max_recent_spin.setFont(self.style_manager.get_font('sm'))

        max_recent_label = Label("最大显示数量:", self, self.style_manager)
        max_recent_label.set_font_size('sm')
        recent_layout.addWidget(max_recent_label)
        recent_layout.addWidget(self.max_recent_spin)

        layout.addWidget(recent_card)

        # 窗口设置 - 使用Card容器
        window_card = Card(self, self.style_manager)
        window_layout = QVBoxLayout(window_card)
        window_layout.setContentsMargins(12, 12, 12, 12)
        window_layout.setSpacing(8)

        # 标题
        title = Label("窗口设置", self, self.style_manager)
        title.set_font_size('base')
        title.set_bold(True)
        window_layout.addWidget(title)

        self.auto_save_window_state = QCheckBox("自动保存窗口状态")
        self.auto_save_window_state.setChecked(
            self.config_manager.get_auto_save_window_state()
        )
        self.auto_save_window_state.setFont(self.style_manager.get_font('sm'))
        window_layout.addWidget(self.auto_save_window_state)

        self.window_maximized = QCheckBox("启动时窗口最大化")
        self.window_maximized.setChecked(
            self.config_manager.get_window_maximized()
        )
        self.window_maximized.setFont(self.style_manager.get_font('sm'))
        window_layout.addWidget(self.window_maximized)

        layout.addWidget(window_card)

        layout.addStretch()

        parent.addTab(tab, "常规")

    def create_interface_tab(self, parent):
        """创建界面设置选项卡"""
        tab = QWidget()
        layout = QVBoxLayout(tab)

        # 主题设置 - 使用Card容器
        theme_card = Card(self, self.style_manager)
        theme_layout = QVBoxLayout(theme_card)
        theme_layout.setContentsMargins(12, 12, 12, 12)
        theme_layout.setSpacing(8)

        # 标题
        title = Label("主题", self, self.style_manager)
        title.set_font_size('base')
        title.set_bold(True)
        theme_layout.addWidget(title)

        self.theme_combo = QComboBox()
        self.theme_combo.addItems(["浅色主题", "深色主题", "跟随系统"])
        theme_mode = self.config_manager.get_theme()
        if theme_mode == 'light':
            self.theme_combo.setCurrentIndex(0)
        elif theme_mode == 'dark':
            self.theme_combo.setCurrentIndex(1)
        else:
            self.theme_combo.setCurrentIndex(2)
        self.theme_combo.setFont(self.style_manager.get_font('sm'))

        theme_mode_label = Label("主题模式:", self, self.style_manager)
        theme_mode_label.set_font_size('sm')
        theme_layout.addWidget(theme_mode_label)
        theme_layout.addWidget(self.theme_combo)

        layout.addWidget(theme_card)

        # 相册切换设置 - 使用Card容器
        album_card = Card(self, self.style_manager)
        album_layout = QVBoxLayout(album_card)
        album_layout.setContentsMargins(12, 12, 12, 12)
        album_layout.setSpacing(8)

        # 标题
        title = Label("相册切换", self, self.style_manager)
        title.set_font_size('base')
        title.set_bold(True)
        album_layout.addWidget(title)

        self.auto_switch_check = QCheckBox("启用相册间自动切换")
        self.auto_switch_check.setChecked(
            self.config_manager.get_auto_switch_album()
        )
        self.auto_switch_check.setFont(self.style_manager.get_font('sm'))
        album_layout.addWidget(self.auto_switch_check)

        self.notification_check = QCheckBox("显示切换提示")
        self.notification_check.setChecked(
            self.config_manager.get_show_switch_notification()
        )
        self.notification_check.setFont(self.style_manager.get_font('sm'))
        album_layout.addWidget(self.notification_check)

        self.show_thumbnails = QCheckBox("显示缩略图")
        self.show_thumbnails.setChecked(
            self.config_manager.get_show_thumbnails()
        )
        self.show_thumbnails.setFont(self.style_manager.get_font('sm'))
        album_layout.addWidget(self.show_thumbnails)

        layout.addWidget(album_card)

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

        # 性能设置 - 使用Card容器
        perf_card = Card(self, self.style_manager)
        perf_layout = QVBoxLayout(perf_card)
        perf_layout.setContentsMargins(12, 12, 12, 12)
        perf_layout.setSpacing(8)

        # 标题
        title = Label("性能设置", self, self.style_manager)
        title.set_font_size('base')
        title.set_bold(True)
        perf_layout.addWidget(title)

        # 缩略图大小
        self.thumbnail_size_spin = QSpinBox()
        self.thumbnail_size_spin.setRange(100, 500)
        self.thumbnail_size_spin.setValue(
            self.config_manager.get_image_thumbnail_size()
        )
        self.thumbnail_size_spin.setSuffix(" px")
        self.thumbnail_size_spin.setFont(self.style_manager.get_font('sm'))

        thumbnail_label = Label("缩略图大小:", self, self.style_manager)
        thumbnail_label.set_font_size('sm')
        perf_layout.addWidget(thumbnail_label)
        perf_layout.addWidget(self.thumbnail_size_spin)

        layout.addWidget(perf_card)

        layout.addStretch()
        scroll.setWidget(content)

        layout = QVBoxLayout(tab)
        layout.addWidget(scroll)

        parent.addTab(tab, "高级")

    def create_scan_tab(self, parent):
        """创建扫描设置选项卡"""
        tab = QWidget()
        layout = QVBoxLayout(tab)

        # 扫描选项 - 使用Card容器
        scan_card = Card(self, self.style_manager)
        scan_layout = QVBoxLayout(scan_card)
        scan_layout.setContentsMargins(12, 12, 12, 12)
        scan_layout.setSpacing(8)

        # 标题
        title = Label("扫描选项", self, self.style_manager)
        title.set_font_size('base')
        title.set_bold(True)
        scan_layout.addWidget(title)

        self.scan_recursive = QCheckBox("递归扫描子文件夹")
        self.scan_recursive.setChecked(
            self.config_manager.get_scan_recursive()
        )
        self.scan_recursive.setFont(self.style_manager.get_font('sm'))
        scan_layout.addWidget(self.scan_recursive)

        self.scan_hidden = QCheckBox("扫描隐藏文件夹")
        self.scan_hidden.setChecked(
            self.config_manager.get_scan_hidden_folders()
        )
        self.scan_hidden.setFont(self.style_manager.get_font('sm'))
        scan_layout.addWidget(self.scan_hidden)

        layout.addWidget(scan_card)

        # 支持的格式 - 使用Card容器
        format_card = Card(self, self.style_manager)
        format_layout = QVBoxLayout(format_card)
        format_layout.setContentsMargins(12, 12, 12, 12)
        format_layout.setSpacing(8)

        # 标题
        title = Label("支持图片格式", self, self.style_manager)
        title.set_font_size('base')
        title.set_bold(True)
        format_layout.addWidget(title)

        # 格式标签容器
        formats_layout = QHBoxLayout()
        formats_layout.setSpacing(8)

        for fmt in self.config_manager.get_image_formats():
            tag = Tag(
                text=fmt,
                bg_color=self.style_manager.get_colors()['bg-tertiary'],
                text_color=self.style_manager.get_colors()['text-secondary'],
                parent=self,
                style_manager=self.style_manager
            )
            formats_layout.addWidget(tag)

        formats_layout.addStretch()
        format_layout.addLayout(formats_layout)

        layout.addWidget(format_card)

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

        # 日志基本设置 - 使用Card容器
        basic_card = Card(self, self.style_manager)
        basic_layout = QVBoxLayout(basic_card)
        basic_layout.setContentsMargins(12, 12, 12, 12)
        basic_layout.setSpacing(8)

        # 标题
        title = Label("基本设置", self, self.style_manager)
        title.set_font_size('base')
        title.set_bold(True)
        basic_layout.addWidget(title)

        # 启用日志
        self.log_enabled_check = QCheckBox("启用日志记录")
        self.log_enabled_check.setChecked(self.config_manager.get_log_enabled())
        self.log_enabled_check.setFont(self.style_manager.get_font('sm'))
        basic_layout.addWidget(self.log_enabled_check)

        # 日志级别
        level_layout = QHBoxLayout()
        level_label = Label("日志级别:", self, self.style_manager)
        level_label.set_font_size('sm')
        level_layout.addWidget(level_label)

        self.log_level_combo = QComboBox()
        self.log_level_combo.addItems(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'])
        self.log_level_combo.setCurrentText(self.config_manager.get_log_level())
        self.log_level_combo.setFont(self.style_manager.get_font('sm'))
        level_layout.addWidget(self.log_level_combo)
        level_layout.addStretch()
        basic_layout.addLayout(level_layout)

        # 日志保留天数
        days_layout = QHBoxLayout()
        days_label = Label("日志保留天数:", self, self.style_manager)
        days_label.set_font_size('sm')
        days_layout.addWidget(days_label)

        self.log_max_days_spin = QSpinBox()
        self.log_max_days_spin.setRange(1, 365)
        self.log_max_days_spin.setValue(self.config_manager.get_log_max_days())
        self.log_max_days_spin.setSuffix(" 天")
        self.log_max_days_spin.setFont(self.style_manager.get_font('sm'))
        days_layout.addWidget(self.log_max_days_spin)
        days_layout.addStretch()
        basic_layout.addLayout(days_layout)

        layout.addWidget(basic_card)

        # 文件路径设置 - 使用Card容器
        path_card = Card(self, self.style_manager)
        path_layout = QVBoxLayout(path_card)
        path_layout.setContentsMargins(12, 12, 12, 12)
        path_layout.setSpacing(8)

        # 标题
        title = Label("文件路径", self, self.style_manager)
        title.set_font_size('base')
        title.set_bold(True)
        path_layout.addWidget(title)

        # 配置文件路径
        config_path_layout = QHBoxLayout()
        config_path_label = Label("配置文件:", self, self.style_manager)
        config_path_label.set_font_size('sm')
        config_path_layout.addWidget(config_path_label)

        self.config_path_label = Label(self.config_manager.get_config_file_path(), self, self.style_manager)
        self.config_path_label.set_font_size('sm')
        self.config_path_label.set_text_color(self.style_manager.get_colors()['text-tertiary'])
        self.config_path_label.setWordWrap(True)
        config_path_layout.addWidget(self.config_path_label, 1)

        self.open_config_btn = IconButton("📁", self, self.style_manager)
        self.open_config_btn.setText("打开")
        self.open_config_btn.clicked.connect(self.open_config_file)
        config_path_layout.addWidget(self.open_config_btn)
        path_layout.addLayout(config_path_layout)

        # 日志文件路径
        log_path_layout = QHBoxLayout()
        log_path_label = Label("日志目录:", self, self.style_manager)
        log_path_label.set_font_size('sm')
        log_path_layout.addWidget(log_path_label)

        self.log_path_label = Label(str(Path(self.config_manager.get_log_file_path()).parent), self, self.style_manager)
        self.log_path_label.set_font_size('sm')
        self.log_path_label.set_text_color(self.style_manager.get_colors()['text-tertiary'])
        self.log_path_label.setWordWrap(True)
        log_path_layout.addWidget(self.log_path_label, 1)

        self.open_log_btn = IconButton("📁", self, self.style_manager)
        self.open_log_btn.setText("打开")
        self.open_log_btn.clicked.connect(self.open_log_directory)
        log_path_layout.addWidget(self.open_log_btn)
        path_layout.addLayout(log_path_layout)

        layout.addWidget(path_card)

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
