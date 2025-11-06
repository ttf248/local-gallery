"""
PyQt6快捷键编辑器组件
自定义快捷键设置界面
"""

from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel,
    QLineEdit, QPushButton, QTableWidget, QTableWidgetItem,
    QHeaderView, QMessageBox
)
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QKeySequence


class ShortcutEditor(QWidget):
    """快捷键编辑器"""

    shortcutChanged = pyqtSignal(str, str)  # (action, shortcut)

    def __init__(self, config_manager, parent=None):
        super().__init__(parent)
        self.config_manager = config_manager
        self.shortcuts = self.config_manager.get_shortcuts()
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        layout = QVBoxLayout(self)

        # 说明文字
        info_label = QLabel("点击快捷键列来设置新的快捷键，双击可重置为默认")
        info_label.setWordWrap(True)
        layout.addWidget(info_label)

        # 快捷键表格
        self.table = QTableWidget()
        self.table.setColumnCount(2)
        self.table.setHorizontalHeaderLabels(["操作", "快捷键"])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        self.table.setAlternatingRowColors(True)
        layout.addWidget(self.table)

        # 填充表格
        self.populate_table()

        # 按钮
        button_layout = QHBoxLayout()
        button_layout.addStretch()

        self.reset_btn = QPushButton("重置为默认")
        self.reset_btn.clicked.connect(self.reset_to_default)
        button_layout.addWidget(self.reset_btn)

        layout.addLayout(button_layout)

    def populate_table(self):
        """填充快捷键表格"""
        shortcuts_map = {
            'open_folder': '打开文件夹',
            'scan_albums': '扫描漫画',
            'open_recent': '最近浏览',
            'open_favorites': '我的收藏',
            'toggle_favorite': '收藏/取消收藏',
            'fullscreen': '全屏',
            'next_image': '下一张图片',
            'prev_image': '上一张图片',
            'zoom_in': '放大',
            'zoom_out': '缩小',
            'reset_zoom': '重置缩放',
            'rotate_right': '顺时针旋转',
            'rotate_left': '逆时针旋转',
        }

        self.table.setRowCount(len(shortcuts_map))
        row = 0
        for action, description in shortcuts_map.items():
            # 操作名称
            self.table.setItem(row, 0, QTableWidgetItem(description))

            # 快捷键
            shortcut_item = QTableWidgetItem(self.shortcuts.get(action, ''))
            shortcut_item.setData(Qt.ItemDataRole.UserRole, action)
            self.table.setItem(row, 1, shortcut_item)

            row += 1

    def mouseDoubleClickEvent(self, event):
        """双击编辑快捷键"""
        item = self.table.itemAt(event.pos())
        if item and item.column() == 1:
            action = item.data(Qt.ItemDataRole.UserRole)
            self.edit_shortcut(item, action)
        super().mouseDoubleClickEvent(event)

    def edit_shortcut(self, item, action):
        """编辑快捷键"""
        # 创建行编辑器
        line_edit = QLineEdit(item.text())
        line_edit.setFocus()

        def finish_edit():
            shortcut_text = line_edit.text()
            # 验证快捷键格式
            if self.validate_shortcut(shortcut_text):
                item.setText(shortcut_text)
                self.cellWidget().setParent(None)
                self.shortcutChanged.emit(action, shortcut_text)
            else:
                QMessageBox.warning(self, "无效快捷键", "请输入有效的快捷键格式，如：Ctrl+O, F5, Ctrl+Shift+R")

        line_edit.returnPressed.connect(finish_edit)
        line_edit.editingFinished.connect(finish_edit)

        # 替换单元格内容
        current_widget = self.table.cellWidget(item.row(), 1)
        if current_widget:
            current_widget.setParent(None)
        self.table.setCellWidget(item.row(), 1, line_edit)
        line_edit.selectAll()
        line_edit.setFocus()

    def validate_shortcut(self, shortcut_text):
        """验证快捷键格式"""
        if not shortcut_text:
            return True  # 允许清空

        try:
            QKeySequence(shortcut_text)
            return True
        except:
            return False

    def reset_to_default(self):
        """重置为默认快捷键"""
        reply = QMessageBox.question(
            self,
            "重置快捷键",
            "确定要重置所有快捷键为默认吗？",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )

        if reply == QMessageBox.StandardButton.Yes:
            self.config_manager.reset_shortcuts()
            self.shortcuts = self.config_manager.get_shortcuts()
            self.populate_table()
            QMessageBox.information(self, "重置成功", "快捷键已重置为默认值")
