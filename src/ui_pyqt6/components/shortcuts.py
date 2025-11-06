"""
PyQt6快捷键管理器
处理全局快捷键
"""

from PyQt6.QtWidgets import QWidget, QShortcut
from PyQt6.QtGui import QKeySequence
from PyQt6.QtCore import QObject, pyqtSignal

class ShortcutManager(QObject):
    """快捷键管理器"""

    # 定义信号
    shortcutTriggered = pyqtSignal(str)  # 快捷键触发信号

    def __init__(self, parent=None):
        super().__init__(parent)
        self.shortcuts = {}

    def register(self, key, callback, description=""):
        """注册快捷键"""
        shortcut = QShortcut(QKeySequence(key), self.parent())
        shortcut.activated.connect(callback)
        self.shortcuts[key] = {
            'shortcut': shortcut,
            'callback': callback,
            'description': description
        }

    def unregister(self, key):
        """注销快捷键"""
        if key in self.shortcuts:
            self.shortcuts[key]['shortcut'].setEnabled(False)
            del self.shortcuts[key]

    def get_shortcuts(self):
        """获取所有快捷键"""
        return [(key, info['description']) for key, info in self.shortcuts.items()]
