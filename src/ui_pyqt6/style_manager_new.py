"""
PyQt6现代化样式管理器
管理应用程序的样式、主题和动画效果
"""

from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import QObject, pyqtSignal
from PyQt6.QtGui import QPalette, QColor

class ModernStyleManager(QObject):
    """现代化样式管理器 - 管理应用程序主题、动画和样式"""

    # 定义信号
    themeChanged = pyqtSignal(str)  # 主题变化信号

    def __init__(self):
        super().__init__()
        self.is_dark = False
        self.init_colors()

    def init_colors(self):
        """初始化颜色方案"""
        # 浅色主题 - 现代极简风格
        self.light_colors = {
            'bg_primary': '#FFFFFF',
            'bg_secondary': '#F5F5F7',
            'bg_tertiary': '#F2F2F2',
            'text_primary': '#1D1D1F',
            'text_secondary': '#86868B',
            'text_tertiary': '#6E6E73',
            'border': '#E5E5E7',
            'border_hover': '#D1D1D6',
            'accent': '#007AFF',
            'accent_hover': '#0051D5',
            'accent_light': '#E3F2FD',
            'success': '#34C759',
            'warning': '#FF9500',
            'error': '#FF3B30',
            'card_bg': '#FFFFFF',
            'card_shadow': 'rgba(0, 0, 0, 0.08)',
            'card_shadow_hover': 'rgba(0, 0, 0, 0.15)',
            'scrollbar': '#C7C7CC',
            'scrollbar_hover': '#AFB0B5',
        }

        # 深色主题 - 护眼深色模式
        self.dark_colors = {
            'bg_primary': '#000000',
            'bg_secondary': '#1C1C1E',
            'bg_tertiary': '#2C2C2E',
            'text_primary': '#FFFFFF',
            'text_secondary': '#EBEBF5',
            'text_tertiary': '#8E8E93',
            'border': '#38383A',
            'border_hover': '#48484A',
            'accent': '#0A84FF',
            'accent_hover': '#409CFF',
            'accent_light': 'rgba(10, 132, 255, 0.15)',
            'success': '#30D158',
            'warning': '#FF9F0A',
            'error': '#FF453A',
            'card_bg': '#1C1C1E',
            'card_shadow': 'rgba(255, 255, 255, 0.05)',
            'card_shadow_hover': 'rgba(255, 255, 255, 0.1)',
            'scrollbar': '#48484A',
            'scrollbar_hover': '#5A5A5C',
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
                    border-radius: 8px;
                }}
                QPushButton:hover {{
                    background-color: {colors['bg_tertiary']};
                    color: {colors['text_primary']};
                }}
                QPushButton:pressed {{
                    background-color: {colors['accent_light']};
                    color: {colors['accent']};
                }}
                QPushButton:checked {{
                    background-color: {colors['accent']};
                    color: white;
                    font-weight: bold;
                }}
            """,

            'toolbar': f"""
                QWidget {{
                    background: qlineargradient(x1:0, y1:0, x2:0, y2:1,
                        stop:0 {colors['bg_primary']}, stop:1 {colors['bg_secondary']});
                    color: {colors['text_primary']};
                    border-bottom: 1px solid {colors['border']};
                }}
                QPushButton {{
                    background-color: {colors['card_bg']};
                    color: {colors['text_primary']};
                    border: 1px solid {colors['border']};
                    padding: 8px 16px;
                    border-radius: 8px;
                    font-size: 14px;
                }}
                QPushButton:hover {{
                    background-color: {colors['bg_tertiary']};
                    border-color: {colors['border_hover']};
                }}
                QPushButton:pressed {{
                    background-color: {colors['accent']};
                    color: white;
                    border-color: {colors['accent']};
                }}
                QLineEdit {{
                    background-color: {colors['bg_secondary']};
                    color: {colors['text_primary']};
                    border: 1px solid {colors['border']};
                    padding: 8px 12px;
                    border-radius: 8px;
                    font-size: 14px;
                }}
                QLineEdit:focus {{
                    border-color: {colors['accent']};
                }}
                QComboBox {{
                    background-color: {colors['bg_secondary']};
                    color: {colors['text_primary']};
                    border: 1px solid {colors['border']};
                    padding: 8px 12px;
                    border-radius: 8px;
                    font-size: 14px;
                }}
            """,

            'home_view': f"""
                QWidget#home_view {{
                    background-color: {colors['bg_secondary']};
                }}
                QFrame#album_card {{
                    background-color: {colors['card_bg']};
                    border: 1px solid {colors['border']};
                    border-radius: 12px;
                }}
                QFrame#album_card:hover {{
                    border-color: {colors['accent']};
                }}
            """,

            'collection_view': f"""
                QWidget#collection_view {{
                    background-color: {colors['bg_secondary']};
                }}
                QFrame#collection_album_card {{
                    background-color: {colors['card_bg']};
                    border: 1px solid {colors['border']};
                    border-radius: 12px;
                }}
                QFrame#collection_album_card:hover {{
                    border-color: {colors['accent']};
                }}
            """,

            'reader_view': f"""
                QWidget#reader_view {{
                    background-color: #1C1C1E;
                }}
                QFrame#top_bar, QFrame#bottom_bar {{
                    background-color: rgba(0, 0, 0, 0.85);
                }}
                QPushButton#nav_button, QPushButton#control_button, QPushButton#func_button {{
                    background-color: rgba(255, 255, 255, 0.1);
                    color: white;
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    padding: 6px 12px;
                    border-radius: 6px;
                    font-size: 13px;
                }}
                QPushButton#nav_button:hover, QPushButton#control_button:hover, QPushButton#func_button:hover {{
                    background-color: rgba(255, 255, 255, 0.2);
                }}
                QPushButton#nav_button:pressed, QPushButton#control_button:pressed, QPushButton#func_button:pressed {{
                    background-color: {colors['accent']};
                    border-color: {colors['accent']};
                }}
                QSlider::groove:horizontal {{
                    border: none;
                    height: 4px;
                    background: rgba(255, 255, 255, 0.2);
                    border-radius: 2px;
                }}
                QSlider::handle:horizontal {{
                    background: white;
                    border: 2px solid {colors['accent']};
                    width: 16px;
                    height: 16px;
                    margin: -6px 0;
                    border-radius: 8px;
                }}
                QSlider::sub-page:horizontal {{
                    background: {colors['accent']};
                    border-radius: 2px;
                }}
            """,

            'status_bar': f"""
                QStatusBar {{
                    background-color: {colors['bg_secondary']};
                    color: {colors['text_secondary']};
                    border-top: 1px solid {colors['border']};
                }}
            """,

            'scrollbar': f"""
                QScrollBar:vertical {{
                    background-color: {colors['bg_secondary']};
                    width: 12px;
                    border-radius: 6px;
                }}
                QScrollBar::handle:vertical {{
                    background-color: {colors['scrollbar']};
                    border-radius: 6px;
                    min-height: 20px;
                }}
                QScrollBar::handle:vertical:hover {{
                    background-color: {colors['scrollbar_hover']};
                }}
                QScrollBar::add-line:vertical,
                QScrollBar::sub-line:vertical {{
                    height: 0;
                }}
            """,
        }

        return styles.get(component_type, '')

    def get_animation_style(self, element_type):
        """获取动画样式"""
        animations = {
            'card_hover': """
                QFrame {
                    transition: all 0.3s cubic-bezier(0.4, 0.0, 0.2, 1);
                }
            """,
            'button_press': """
                QPushButton {
                    transition: all 0.15s ease-out;
                }
            """,
            'fade_in': """
                QWidget {
                    animation: fadeIn 0.3s ease-in;
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            """,
        }
        return animations.get(element_type, '')