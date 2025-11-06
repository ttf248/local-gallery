"""
PyQt6极简主义样式管理器
基于HTML原型图的配色方案和设计规范
"""

from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import QObject, pyqtSignal, QPropertyAnimation, QEasingCurve, QRect
from PyQt6.QtGui import QPalette, QColor, QFont, QFontDatabase


class StyleManager(QObject):
    """极简主义样式管理器 - 管理应用程序主题和样式"""

    # 定义信号
    themeChanged = pyqtSignal(str)  # 主题变化信号

    def __init__(self):
        super().__init__()
        self.is_dark = False
        self.init_colors()
        self.init_fonts()
        self.init_design_tokens()

    def init_colors(self):
        """初始化极简配色方案"""
        # 浅色主题 - 极简主义配色
        self.light_colors = {
            # 主色调
            'minimal-gray': '#F8F9FA',        # 背景色 - 干净的浅灰
            'minimal-border': '#E9ECEF',      # 边框色 - 精细分割线
            'minimal-text': '#2C3E50',        # 主文字色 - 深蓝灰
            'minimal-muted': '#6C757D',       # 辅助文字 - 中灰
            'minimal-blue': '#4A90E2',        # 强调色 - 极简蓝
            'minimal-green': '#50C878',       # 成功色 - 翠绿
            'minimal-red': '#E74C3C',         # 错误色 - 珊瑚红
            'minimal-yellow': '#F39C12',      # 警告色 - 琥珀黄

            # 功能色
            'accent': '#4A90E2',              # 强调色
            'accent-hover': '#3A7BD5',        # 强调色悬停
            'accent-pressed': '#2A6BC5',      # 强调色按下

            # 背景色系
            'bg-primary': '#FFFFFF',          # 主背景
            'bg-secondary': '#F8F9FA',        # 次要背景
            'bg-tertiary': '#F2F2F2',         # 三级背景

            # 文字色系
            'text-primary': '#2C3E50',        # 主要文字
            'text-secondary': '#6C757D',      # 次要文字
            'text-tertiary': '#ADB5BD',       # 三级文字
            'text-white': '#FFFFFF',          # 白色文字

            # 边框色系
            'border-light': '#E9ECEF',        # 浅边框
            'border-medium': '#DEE2E6',       # 中等边框
            'border-dark': '#CED4DA',         # 深边框

            # 卡片
            'card-bg': '#FFFFFF',             # 卡片背景
            'card-shadow': 'rgba(0, 0, 0, 0.08)',  # 卡片阴影

            # 状态色
            'success': '#50C878',
            'warning': '#F39C12',
            'error': '#E74C3C',
            'info': '#4A90E2',

            # 滚动条
            'scrollbar': '#CBD5E0',
            'scrollbar-hover': '#A0AEC0',
        }

        # 深色主题 - 极简深色
        self.dark_colors = {
            # 主色调
            'minimal-gray': '#1A1D23',        # 深色背景
            'minimal-border': '#2D3748',      # 深色边框
            'minimal-text': '#E2E8F0',        # 深色文字
            'minimal-muted': '#A0AEC0',       # 深色辅助文字
            'minimal-blue': '#4A90E2',        # 保持蓝色强调
            'minimal-green': '#50C878',       # 保持绿色
            'minimal-red': '#E74C3C',         # 保持红色
            'minimal-yellow': '#F39C12',      # 保持黄色

            # 功能色
            'accent': '#4A90E2',
            'accent-hover': '#5CA0F2',
            'accent-pressed': '#3A7BD5',

            # 背景色系
            'bg-primary': '#1A1D23',
            'bg-secondary': '#1E2229',
            'bg-tertiary': '#252A32',

            # 文字色系
            'text-primary': '#E2E8F0',
            'text-secondary': '#A0AEC0',
            'text-tertiary': '#718096',
            'text-white': '#FFFFFF',

            # 边框色系
            'border-light': '#2D3748',
            'border-medium': '#374151',
            'border-dark': '#4A5568',

            # 卡片
            'card-bg': '#1E2229',
            'card-shadow': 'rgba(0, 0, 0, 0.3)',

            # 状态色
            'success': '#50C878',
            'warning': '#F39C12',
            'error': '#E74C3C',
            'info': '#4A90E2',

            # 滚动条
            'scrollbar': '#4A5568',
            'scrollbar-hover': '#718096',
        }

    def init_fonts(self):
        """初始化字体系统"""
        # 字体族优先级
        self.font_families = [
            'Inter',  # 现代无衬线字体
            'PingFang SC',  # 苹果苹方
            'Microsoft YaHei',  # 微软雅黑
            'SF Pro Display',  # SF Pro（如果可用）
            'Segoe UI',  # Windows UI
            'Roboto',  # Android 字体
            'system-ui',  # 系统默认
            'sans-serif',  # 通用无衬线
        ]

        # 字体大小规范
        self.font_sizes = {
            'xs': 11,    # 极小文字
            'sm': 12,    # 小文字
            'base': 14,  # 基础文字
            'lg': 16,    # 大文字
            'xl': 18,    # 特大文字
            '2xl': 20,   # 标题小
            '3xl': 24,   # 标题中
            '4xl': 30,   # 标题大
        }

    def init_design_tokens(self):
        """初始化设计规范"""
        # 间距系统 - 基于4px基础单位
        self.spacing = {
            'xs': 4,     # 极小间距
            'sm': 8,     # 小间距
            'md': 12,    # 中等间距
            'lg': 16,    # 大间距
            'xl': 24,    # 特大间距
            '2xl': 32,   # 页面边距
            '3xl': 48,   # 区域间距
        }

        # 圆角系统
        self.border_radius = {
            'none': 0,
            'sm': 4,     # 小圆角 - 按钮、输入框
            'md': 8,     # 中等圆角 - 卡片
            'lg': 12,    # 大圆角 - 对话框
            'xl': 16,    # 特大圆角
            'full': 9999,  # 完全圆形
        }

        # 阴影系统
        self.shadows = {
            'sm': (0, 1, 2, 0, 'rgba(0, 0, 0, 0.05)'),
            'md': (0, 4, 6, -1, 'rgba(0, 0, 0, 0.1)'),
            'lg': (0, 10, 15, -3, 'rgba(0, 0, 0, 0.1)'),
            'xl': (0, 20, 25, -5, 'rgba(0, 0, 0, 0.15)'),
        }

        # 过渡动画时长
        self.transition_duration = {
            'fast': 150,    # 快速 - 点击反馈
            'normal': 200,  # 正常 - 悬停效果
            'slow': 300,    # 慢 - 页面切换
        }

    def get_colors(self):
        """获取当前配色方案"""
        return self.dark_colors if self.is_dark else self.light_colors

    def get_color(self, key):
        """获取指定颜色值"""
        return self.get_colors().get(key, '#000000')

    def toggle_theme(self):
        """切换主题"""
        self.is_dark = not self.is_dark
        app = QApplication.instance()

        if self.is_dark:
            # 应用深色主题
            app.setStyle('Fusion')
            palette = QPalette()

            # 设置深色主题调色板
            colors = self.dark_colors
            palette.setColor(QPalette.ColorRole.Window, QColor(26, 29, 35))
            palette.setColor(QPalette.ColorRole.WindowText, QColor(226, 232, 240))
            palette.setColor(QPalette.ColorRole.Base, QColor(30, 34, 41))
            palette.setColor(QPalette.ColorRole.AlternateBase, QColor(37, 42, 50))
            palette.setColor(QPalette.ColorRole.ToolTipBase, QColor(26, 29, 35))
            palette.setColor(QPalette.ColorRole.ToolTipText, QColor(226, 232, 240))
            palette.setColor(QPalette.ColorRole.Text, QColor(226, 232, 240))
            palette.setColor(QPalette.ColorRole.Button, QColor(30, 34, 41))
            palette.setColor(QPalette.ColorRole.ButtonText, QColor(226, 232, 240))
            palette.setColor(QPalette.ColorRole.BrightText, QColor(255, 255, 255))
            palette.setColor(QPalette.ColorRole.Link, QColor(74, 144, 226))
            palette.setColor(QPalette.ColorRole.Highlight, QColor(74, 144, 226))
            palette.setColor(QPalette.ColorRole.HighlightedText, QColor(255, 255, 255))

            # 设置禁用状态
            palette.setColor(QPalette.ColorRole.Disabled, QPalette.ColorRole.WindowText,
                           QColor(160, 174, 192))
            palette.setColor(QPalette.ColorRole.Disabled, QPalette.ColorRole.Text,
                           QColor(160, 174, 192))
            palette.setColor(QPalette.ColorRole.Disabled, QPalette.ColorRole.ButtonText,
                           QColor(160, 174, 192))

            app.setPalette(palette)
        else:
            # 应用浅色主题
            app.setStyle('Fusion')
            palette = QPalette()

            # 设置浅色主题调色板
            colors = self.light_colors
            palette.setColor(QPalette.ColorRole.Window, QColor(255, 255, 255))
            palette.setColor(QPalette.ColorRole.WindowText, QColor(44, 62, 80))
            palette.setColor(QPalette.ColorRole.Base, QColor(255, 255, 255))
            palette.setColor(QPalette.ColorRole.AlternateBase, QColor(248, 249, 250))
            palette.setColor(QPalette.ColorRole.ToolTipBase, QColor(255, 255, 255))
            palette.setColor(QPalette.ColorRole.ToolTipText, QColor(44, 62, 80))
            palette.setColor(QPalette.ColorRole.Text, QColor(44, 62, 80))
            palette.setColor(QPalette.ColorRole.Button, QColor(255, 255, 255))
            palette.setColor(QPalette.ColorRole.ButtonText, QColor(44, 62, 80))
            palette.setColor(QPalette.ColorRole.BrightText, QColor(255, 0, 0))
            palette.setColor(QPalette.ColorRole.Link, QColor(74, 144, 226))
            palette.setColor(QPalette.ColorRole.Highlight, QColor(74, 144, 226))
            palette.setColor(QPalette.ColorRole.HighlightedText, QColor(255, 255, 255))

            # 设置禁用状态
            palette.setColor(QPalette.ColorRole.Disabled, QPalette.ColorRole.WindowText,
                           QColor(173, 181, 189))
            palette.setColor(QPalette.ColorRole.Disabled, QPalette.ColorRole.Text,
                           QColor(173, 181, 189))
            palette.setColor(QPalette.ColorRole.Disabled, QPalette.ColorRole.ButtonText,
                           QColor(173, 181, 189))

            app.setPalette(palette)

        self.themeChanged.emit('dark' if self.is_dark else 'light')

    def get_font(self, size_key='base', weight=QFont.Weight.Normal):
        """获取字体"""
        font = QFont(self.font_families[0])  # 使用Inter字体
        font.setPointSize(self.font_sizes.get(size_key, 14))
        font.setWeight(weight)
        return font

    def get_stylesheet(self, component_type):
        """获取组件样式表"""
        colors = self.get_colors()

        styles = {
            'main_window': f"""
                QMainWindow {{
                    background-color: {colors['bg-primary']};
                    color: {colors['text-primary']};
                }}
            """,

            'sidebar': f"""
                QWidget {{
                    background-color: {colors['bg-secondary']};
                    color: {colors['text-primary']};
                    border: none;
                }}
                QPushButton {{
                    background-color: transparent;
                    color: {colors['text-secondary']};
                    border: none;
                    padding: {self.spacing['md']}px {self.spacing['lg']}px;
                    text-align: left;
                    font-size: {self.font_sizes['sm']}px;
                    border-radius: {self.border_radius['sm']}px;
                }}
                QPushButton:hover {{
                    background-color: {colors['bg-tertiary']};
                    color: {colors['text-primary']};
                }}
                QPushButton:pressed {{
                    background-color: {colors['bg-tertiary']};
                }}
                QPushButton:checked {{
                    background-color: {colors['accent']};
                    color: {colors['text-white']};
                    border-radius: {self.border_radius['sm']}px;
                    font-weight: 500;
                }}
                QLabel {{
                    color: {colors['text-secondary']};
                    font-size: {self.font_sizes['xs']}px;
                    font-weight: 500;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }}
            """,

            'toolbar': f"""
                QWidget {{
                    background-color: {colors['bg-primary']};
                    color: {colors['text-primary']};
                    border-bottom: 1px solid {colors['border-light']};
                }}
                QPushButton {{
                    background-color: {colors['bg-secondary']};
                    color: {colors['text-primary']};
                    border: 1px solid {colors['border-light']};
                    padding: {self.spacing['sm']}px {self.spacing['lg']}px;
                    border-radius: {self.border_radius['sm']}px;
                    font-size: {self.font_sizes['sm']}px;
                }}
                QPushButton:hover {{
                    background-color: {colors['bg-tertiary']};
                    border-color: {colors['accent']};
                }}
                QPushButton:pressed {{
                    background-color: {colors['accent-pressed']};
                    color: {colors['text-white']};
                }}
                QLineEdit {{
                    background-color: {colors['bg-secondary']};
                    color: {colors['text-primary']};
                    border: 1px solid {colors['border-light']};
                    padding: {self.spacing['sm']}px {self.spacing['md']}px;
                    border-radius: {self.border_radius['sm']}px;
                    font-size: {self.font_sizes['sm']}px;
                    selection-background-color: {colors['accent']};
                }}
                QLineEdit:focus {{
                    border-color: {colors['accent']};
                }}
                QComboBox {{
                    background-color: {colors['bg-secondary']};
                    color: {colors['text-primary']};
                    border: 1px solid {colors['border-light']};
                    padding: {self.spacing['sm']}px {self.spacing['md']}px;
                    border-radius: {self.border_radius['sm']}px;
                    font-size: {self.font_sizes['sm']}px;
                }}
                QComboBox:hover {{
                    border-color: {colors['accent']};
                }}
                QComboBox::drop-down {{
                    border: none;
                    width: 20px;
                }}
                QComboBox::down-arrow {{
                    image: none;
                    border-left: 5px solid transparent;
                    border-right: 5px solid transparent;
                    border-top: 5px solid {colors['text-secondary']};
                    margin-right: 5px;
                }}
            """,

            'album_card': f"""
                QFrame {{
                    background-color: {colors['card-bg']};
                    border: 1px solid {colors['border-light']};
                    border-radius: {self.border_radius['md']}px;
                }}
                QFrame:hover {{
                    border-color: {colors['accent']};
                    transform: translateY(-2px);
                }}
            """,

            'minimal_card': f"""
                QFrame {{
                    background-color: {colors['card-bg']};
                    border: 1px solid {colors['border-light']};
                    border-radius: {self.border_radius['md']}px;
                }}
                QFrame:hover {{
                    border-color: {colors['accent']};
                    border-width: 1px;
                }}
            """,

            'grid_layout': f"""
                QWidget#grid_container {{
                    background-color: {colors['bg-secondary']};
                }}
                QScrollArea {{
                    background-color: {colors['bg-secondary']};
                    border: none;
                }}
                QScrollBar:vertical {{
                    background-color: {colors['bg-secondary']};
                    width: 10px;
                    border-radius: 5px;
                }}
                QScrollBar::handle:vertical {{
                    background-color: {colors['scrollbar']};
                    border-radius: 5px;
                    min-height: 20px;
                }}
                QScrollBar::handle:vertical:hover {{
                    background-color: {colors['scrollbar-hover']};
                }}
                QScrollBar::add-line:vertical,
                QScrollBar::sub-line:vertical {{
                    height: 0;
                }}
            """,

            'status_bar': f"""
                QStatusBar {{
                    background-color: {colors['bg-secondary']};
                    color: {colors['text-secondary']};
                    border-top: 1px solid {colors['border-light']};
                    font-size: {self.font_sizes['sm']}px;
                }}
            """,

            'button_primary': f"""
                QPushButton {{
                    background-color: {colors['accent']};
                    color: {colors['text-white']};
                    border: none;
                    padding: {self.spacing['sm']}px {self.spacing['lg']}px;
                    border-radius: {self.border_radius['sm']}px;
                    font-size: {self.font_sizes['sm']}px;
                    font-weight: 500;
                }}
                QPushButton:hover {{
                    background-color: {colors['accent-hover']};
                }}
                QPushButton:pressed {{
                    background-color: {colors['accent-pressed']};
                }}
                QPushButton:disabled {{
                    background-color: {colors['border-medium']};
                    color: {colors['text-tertiary']};
                }}
            """,

            'button_secondary': f"""
                QPushButton {{
                    background-color: transparent;
                    color: {colors['accent']};
                    border: 1px solid {colors['accent']};
                    padding: {self.spacing['sm']}px {self.spacing['lg']}px;
                    border-radius: {self.border_radius['sm']}px;
                    font-size: {self.font_sizes['sm']}px;
                    font-weight: 500;
                }}
                QPushButton:hover {{
                    background-color: {colors['accent']};
                    color: {colors['text-white']};
                }}
                QPushButton:pressed {{
                    background-color: {colors['accent-pressed']};
                }}
                QPushButton:disabled {{
                    border-color: {colors['border-medium']};
                    color: {colors['text-tertiary']};
                }}
            """,

            'input_field': f"""
                QLineEdit {{
                    background-color: {colors['bg-primary']};
                    color: {colors['text-primary']};
                    border: 1px solid {colors['border-light']};
                    padding: {self.spacing['sm']}px {self.spacing['md']}px;
                    border-radius: {self.border_radius['sm']}px;
                    font-size: {self.font_sizes['sm']}px;
                }}
                QLineEdit:focus {{
                    border-color: {colors['accent']};
                }}
                QLineEdit:disabled {{
                    background-color: {colors['bg-tertiary']};
                    color: {colors['text-tertiary']};
                }}
            """,
        }

        return styles.get(component_type, '')

    def set_animated_property(self, widget, property_name, start_value, end_value, duration=200):
        """设置动画属性"""
        animation = QPropertyAnimation(widget, property_name.encode())
        animation.setDuration(duration)
        animation.setStartValue(start_value)
        animation.setEndValue(end_value)
        animation.setEasingCurve(QEasingCurve.Type.OutCubic)
        animation.start()
        return animation

    def apply_hover_effect(self, widget):
        """应用悬停效果"""
        # 可以在子类中实现自定义悬停效果
        pass

    def get_spacing(self, key):
        """获取间距值"""
        return self.spacing.get(key, 8)

    def get_border_radius(self, key):
        """获取圆角值"""
        return self.border_radius.get(key, 4)
