"""
PyQt6应用程序主类
替代Tkinter的PhotoAlbumApp
"""

import sys
from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QIcon, QFont

class ComicReaderApp(QApplication):
    """漫画阅读器主应用程序"""

    def __init__(self, argv):
        super().__init__(argv)

        # 设置应用程序属性
        self.setApplicationName("Comic Reader")
        self.setApplicationVersion("2.0.0")
        self.setOrganizationName("Comic Reader Team")

        # 设置高DPI支持
        self.setAttribute(Qt.ApplicationAttribute.AA_EnableHighDpiScaling, True)
        self.setAttribute(Qt.ApplicationAttribute.AA_UseHighDpiPixmaps, True)

        # 设置默认字体
        self.setFont(QFont("Microsoft YaHei", 9))

    def run(self):
        """运行应用程序"""
        return self.exec()
