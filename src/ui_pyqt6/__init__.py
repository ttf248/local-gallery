"""
PyQt6 UI模块
漫画阅读器 - PyQt6界面实现
"""

__version__ = '1.0.0'
__author__ = 'Comic Reader Team'

# 导出主要类
from .main_window import MainWindow
from .app import ComicReaderApp

__all__ = [
    'MainWindow',
    'ComicReaderApp',
]
