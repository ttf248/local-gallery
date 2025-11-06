"""
PyQt6样式管理器
管理应用程序的样式、主题和颜色
"""

from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import QObject, pyqtSignal
from PyQt6.QtGui import QPalette, QColor

class StyleManager(QObject):
    """样式管理器 - 管理应用程序主题和样式"""

    # 定义信号
    themeChanged = pyqtSignal(str)  # 主题变化信号

    def __init__(self):
        super().__init__()
        self.is_dark = False
        self.init_colors()

    def init_colors(self):
        """初始化颜色方案"""
        # 浅色主题
        self.light_colors = {
            'bg_primary': '#FFFFFF',
            'bg_secondary': '#F5F5F7',
            'bg_tertiary': '#F2F2F2',
            'text_primary': '#1D1D1F',
            'text_secondary': '#86868B',
            'text_tertiary': '#6E6E73',
            'border': '#D2D2D7',
            'accent': '#007AFF',
            'accent_hover': '#0051D5',
            'success': '#34C759',
            'warning': '#FF9500',
            'error': '#FF3B30',
            'card_bg': '#FFFFFF',
            'card_shadow': 'rgba(0, 0, 0, 0.1)',
        }

        # 深色主题
        self.dark_colors = {
            'bg_primary': '#000000',
            'bg_secondary': '#1C1C1E',
            'bg_tertiary': '#2C2C2E',
            'text_primary': '#FFFFFF',
            'text_secondary': '#EBEBF5',
            'text_tertiary': '#8E8E93',
            'border': '#38383A',
            'accent': '#0A84FF',
            'accent_hover': '#409CFF',
            'success': '#30D158',
            'warning': '#FF9F0A',
            'error': '#FF453A',
            'card_bg': '#1C1C1E',
            'card_shadow': 'rgba(255, 255, 255, 0.1)',
        }

    def get_colors(self):
        """获取当前颜色方案"""
        return self.dark_colors if self.is_dark else self.light_colors

    def toggle_theme(self):
        """切换主题"""
        self.is_dark = not self.is_dark
        app = QApplication.instance()

        if self.is_dark:
            # 应用暗色主题
            app.setStyle('Fusion')
            palette = QPalette()
            palette.setColor(QPalette.ColorRole.Window, QColor(28, 28, 30))
            palette.setColor(QPalette.ColorRole.WindowText, QColor(255, 255, 255))
            palette.setColor(QPalette.ColorRole.Base, QColor(18, 18, 18))
            palette.setColor(QPalette.ColorRole.AlternateBase, QColor(28, 28, 30))
            palette.setColor(QPalette.ColorRole.ToolTipBase, QColor(0, 0, 0))
            palette.setColor(QPalette.ColorRole.ToolTipText, QColor(255, 255, 255))
            palette.setColor(QPalette.ColorRole.Text, QColor(255, 255, 255))
            palette.setColor(QPalette.ColorRole.Button, QColor(28, 28, 30))
            palette.setColor(QPalette.ColorRole.ButtonText, QColor(255, 255, 255))
            palette.setColor(QPalette.ColorRole.BrightText, QColor(255, 0, 0))
            palette.setColor(QPalette.ColorRole.Link, QColor(10, 132, 255))
            palette.setColor(QPalette.ColorRole.Highlight, QColor(10, 132, 255))
            palette.setColor(QPalette.ColorRole.HighlightedText, QColor(0, 0, 0))
            app.setPalette(palette)
        else:
            # 应用浅色主题
            app.setStyle('Fusion')
            app.setPalette(app.style().standardPalette())

        self.themeChanged.emit('dark' if self.is_dark else 'light')

    def get_stylesheet(self, component_type):
        """获取组件样式表"""
        colors = self.get_colors()

        styles = {
            'main_window': f"""
                QMainWindow {{
                    background-color: {colors['bg_primary']};
                }}
            """,

            'sidebar': f"""
                QWidget {{
                    background-color: {colors['bg_secondary']};
                    color: {colors['text_primary']};
                    border: none;
                }}
                QPushButton {{
                    background-color: transparent;
                    color: {colors['text_secondary']};
                    border: none;
                    padding: 12px 16px;
                    text-align: left;
                    font-size: 14px;
                }}
                QPushButton:hover {{
                    background-color: {colors['bg_tertiary']};
                    color: {colors['text_primary']};
                }}
                QPushButton:pressed {{
                    background-color: {colors['bg_tertiary']};
                }}
                QPushButton:checked {{
                    background-color: {colors['accent']};
                    color: white;
                    border-radius: 6px;
                }}
            """,

            'toolbar': f"""
                QWidget {{
                    background-color: {colors['bg_primary']};
                    color: {colors['text_primary']};
                    border-bottom: 1px solid {colors['border']};
                }}
                QPushButton {{
                    background-color: {colors['bg_secondary']};
                    color: {colors['text_primary']};
                    border: 1px solid {colors['border']};
                    padding: 8px 16px;
                    border-radius: 6px;
                    font-size: 14px;
                }}
                QPushButton:hover {{
                    background-color: {colors['bg_tertiary']};
                }}
                QPushButton:pressed {{
                    background-color: {colors['accent']};
                    color: white;
                }}
                QLineEdit {{
                    background-color: {colors['bg_secondary']};
                    color: {colors['text_primary']};
                    border: 1px solid {colors['border']};
                    padding: 8px 12px;
                    border-radius: 6px;
                    font-size: 14px;
                }}
                QComboBox {{
                    background-color: {colors['bg_secondary']};
                    color: {colors['text_primary']};
                    border: 1px solid {colors['border']};
                    padding: 8px 12px;
                    border-radius: 6px;
                    font-size: 14px;
                }}
            """,

            'album_card': f"""
                QWidget {{
                    background-color: {colors['card_bg']};
                    border: 1px solid {colors['border']};
                    border-radius: 12px;
                }}
                QWidget:hover {{
                    border-color: {colors['accent']};
                }}
            """,

            'compact_grid': f"""
                QWidget#compact_album_grid {{
                    background-color: {colors['bg_secondary']};
                }}
                QScrollArea#compact_scroll {{
                    background-color: {colors['bg_secondary']};
                    border: none;
                }}
                QScrollBar:vertical {{
                    background-color: {colors['bg_secondary']};
                    width: 10px;
                    border-radius: 5px;
                }}
                QScrollBar::handle:vertical {{
                    background-color: {colors['scrollbar']};
                    border-radius: 5px;
                    min-height: 20px;
                }}
                QScrollBar::handle:vertical:hover {{
                    background-color: {colors['scrollbar_hover']};
                }}
            """,

            'compact_album_card': f"""
                QFrame#compact_album_card {{
                    background-color: {colors['card_bg']};
                    border: 1px solid {colors['border']};
                    border-radius: 10px;
                }}
                QFrame#compact_album_card:hover {{
                    border-color: {colors['accent']};
                }}
            """,

            'status_bar': f"""
                QStatusBar {{
                    background-color: {colors['bg_secondary']};
                    color: {colors['text_secondary']};
                    border-top: 1px solid {colors['border']};
                }}
            """,
        }

        return styles.get(component_type, '')
