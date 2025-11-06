import tkinter as tk
from tkinter import ttk
from ...utils.logger import get_logger, log_info, log_warning, log_error

def get_safe_font(font_family, size, style=None):
    """获取安全的字体配置"""
    try:
        if style:
            return (font_family, size, style)
        else:
            return (font_family, size)
    except:
        # 如果字体不可用，使用默认字体
        log_warning(f"字体 {font_family} 不可用，使用默认字体", 'ui.style')
        if style:
            return ('Arial', size, style)
        else:
            return ('Arial', size)

class StyleManager:
    """现代化样式管理器 - 支持明暗主题切换"""

    def __init__(self, root, style=None):
        self.root = root
        self.style = style
        self.logger = get_logger('ui.style')

        # 主题模式：'light' 或 'dark'
        self.current_theme = 'light'

        # 定义明亮主题颜色
        self.light_theme = {
            # 主要背景色
            'bg_primary': '#F5F6FA',
            'bg_secondary': '#FFFFFF',
            'bg_tertiary': '#FAFBFC',
            'bg_hover': '#F0F2F5',

            # 文字颜色
            'text_primary': '#2F3349',
            'text_secondary': '#6C7293',
            'text_tertiary': '#A0A3BD',
            'text_white': '#FFFFFF',

            # 强调色
            'accent': '#5294E2',
            'accent_hover': '#4A90E2',
            'accent_active': '#3B82E0',
            'accent_light': '#E3F2FD',

            # 状态色
            'success': '#27AE60',
            'success_light': '#E8F5E8',
            'warning': '#F39C12',
            'warning_light': '#FFF3CD',
            'error': '#E74C3C',
            'error_light': '#FADBD8',

            # 卡片和容器
            'card_bg': '#FFFFFF',
            'card_hover': '#F8F9FA',
            'card_border': '#E1E8ED',
            'card_shadow': '#00000010',

            # 边框和分割线
            'border': '#E1E8ED',
            'border_light': '#F0F3F7',
            'divider': '#EBEEF3',

            # 按钮颜色
            'button_primary': '#5294E2',
            'button_primary_hover': '#4A90E2',
            'button_secondary': '#F8F9FA',
            'button_secondary_hover': '#E9ECEF',
            'button_danger': '#E74C3C',
            'button_danger_hover': '#C0392B',
            'button_collection': '#8E44AD',
            'button_collection_hover': '#7D3C98',
            'button_smart_collection': '#E67E22',
            'button_smart_collection_hover': '#D35400',

            # 输入框
            'input_bg': '#FFFFFF',
            'input_border': '#E1E8ED',
            'input_focus': '#5294E2',

            # 滚动条
            'scrollbar_bg': '#F5F6FA',
            'scrollbar_thumb': '#C1C7D0',
            'scrollbar_thumb_hover': '#A8B2C1'
        }

        # 定义暗黑主题颜色
        self.dark_theme = {
            # 主要背景色
            'bg_primary': '#1E1E2E',
            'bg_secondary': '#2A2A3E',
            'bg_tertiary': '#333347',
            'bg_hover': '#3D3D5C',

            # 文字颜色
            'text_primary': '#D4D4D4',
            'text_secondary': '#B4B4B4',
            'text_tertiary': '#888888',
            'text_white': '#FFFFFF',

            # 强调色
            'accent': '#7AA2F7',
            'accent_hover': '#8CB6FF',
            'accent_active': '#6A9AF7',
            'accent_light': '#1A2332',

            # 状态色
            'success': '#73DACA',
            'success_light': '#1A3A35',
            'warning': '#E0AF68',
            'warning_light': '#3A2F1A',
            'error': '#F7768E',
            'error_light': '#3A1A22',

            # 卡片和容器
            'card_bg': '#2A2A3E',
            'card_hover': '#333347',
            'card_border': '#414158',
            'card_shadow': '#00000030',

            # 边框和分割线
            'border': '#414158',
            'border_light': '#3D3D5C',
            'divider': '#3D3D5C',

            # 按钮颜色
            'button_primary': '#7AA2F7',
            'button_primary_hover': '#8CB6FF',
            'button_secondary': '#3D3D5C',
            'button_secondary_hover': '#4A4A6A',
            'button_danger': '#F7768E',
            'button_danger_hover': '#FF8CA0',
            'button_collection': '#BB9AF7',
            'button_collection_hover': '#C8A9FF',
            'button_smart_collection': '#E0AF68',
            'button_smart_collection_hover': '#F0C278',

            # 输入框
            'input_bg': '#2A2A3E',
            'input_border': '#414158',
            'input_focus': '#7AA2F7',

            # 滚动条
            'scrollbar_bg': '#1E1E2E',
            'scrollbar_thumb': '#414158',
            'scrollbar_thumb_hover': '#505070'
        }

        # 初始化为明亮主题
        self.colors = self.light_theme.copy()
        
        # 现代化字体配置
        self.fonts = {
            'title': get_safe_font('Segoe UI', 28, 'bold'),      # 大标题
            'heading': get_safe_font('Segoe UI', 20, 'bold'),    # 标题
            'subheading': get_safe_font('Segoe UI', 16, 'bold'), # 子标题
            'body': get_safe_font('Segoe UI', 14),               # 正文
            'body_medium': get_safe_font('Segoe UI', 14, 'bold'), # 中等正文
            'caption': get_safe_font('Segoe UI', 12),            # 说明文字
            'small': get_safe_font('Segoe UI', 11),              # 小字
            'button': get_safe_font('Segoe UI', 13, 'bold'),     # 按钮文字
            'button_small': get_safe_font('Segoe UI', 12),       # 小按钮
            'mono': get_safe_font('Consolas', 12),               # 等宽字体
        }
        
        # 尺寸和间距
        self.dimensions = {
            # 圆角
            'border_radius': 8,
            'border_radius_small': 4,
            'border_radius_large': 12,
            
            # 间距
            'padding_xs': 4,
            'padding_sm': 8,
            'padding_md': 12,
            'padding_lg': 16,
            'padding_xl': 20,
            'padding_xxl': 24,
            
            # 按钮尺寸
            'button_height': 36,
            'button_height_small': 28,
            'button_height_large': 44,
            
            # 卡片
            'card_padding': 16,
            'card_margin': 12,
            
            # 阴影
            'shadow_offset': 2,
            'shadow_blur': 8
        }
        
        log_info("样式管理器初始化完成", 'ui.style')
        self.configure_styles()

    def toggle_theme(self):
        """切换主题（明亮 <-> 暗黑）"""
        try:
            if self.current_theme == 'light':
                self.set_theme('dark')
            else:
                self.set_theme('light')
        except Exception as e:
            log_error(f"切换主题时出错: {e}", 'ui.style')

    def set_theme(self, theme_name):
        """设置主题
        Args:
            theme_name: 'light' 或 'dark'
        """
        try:
            if theme_name not in ['light', 'dark']:
                log_warning(f"未知主题: {theme_name}", 'ui.style')
                return

            if theme_name == 'light':
                self.colors = self.light_theme.copy()
            else:
                self.colors = self.dark_theme.copy()

            self.current_theme = theme_name

            # 重新配置样式
            self.configure_styles()

            log_info(f"主题已切换到: {theme_name}", 'ui.style')

        except Exception as e:
            log_error(f"设置主题时出错: {e}", 'ui.style')

    def get_theme(self):
        """获取当前主题"""
        return self.current_theme

    def is_dark_theme(self):
        """检查是否为暗黑主题"""
        return self.current_theme == 'dark'

    def configure_styles(self):
        """配置现代化样式"""
        try:
            # 设置根窗口背景
            self.root.configure(bg=self.colors['bg_primary'])

            if self.style:
                self.configure_ttk_styles()

            log_info("现代化样式配置完成", 'ui.style')
        except Exception as e:
            log_error(f"配置样式时出错: {e}", 'ui.style')
    
    def configure_ttk_styles(self):
        """配置 TTK 样式"""
        # 配置按钮样式
        self.style.configure('Modern.TButton',
                           background=self.colors['button_primary'],
                           foreground=self.colors['text_white'],
                           font=self.fonts['button'],
                           borderwidth=0,
                           focuscolor='none',
                           relief='flat')
        
        self.style.map('Modern.TButton',
                      background=[('active', self.colors['button_primary_hover']),
                                ('pressed', self.colors['accent_active'])])
        
        # 次要按钮样式
        self.style.configure('Secondary.TButton',
                           background=self.colors['button_secondary'],
                           foreground=self.colors['text_primary'],
                           font=self.fonts['button'],
                           borderwidth=1,
                           relief='solid')
        
        self.style.map('Secondary.TButton',
                      background=[('active', self.colors['button_secondary_hover'])])
        
        # 标签样式
        self.style.configure('Title.TLabel',
                           background=self.colors['bg_primary'],
                           foreground=self.colors['text_primary'],
                           font=self.fonts['title'])
        
        self.style.configure('Heading.TLabel',
                           background=self.colors['bg_primary'],
                           foreground=self.colors['text_primary'],
                           font=self.fonts['heading'])
        
        self.style.configure('Body.TLabel',
                           background=self.colors['bg_primary'],
                           foreground=self.colors['text_secondary'],
                           font=self.fonts['body'])
        
        # 框架样式
        self.style.configure('Card.TFrame',
                           background=self.colors['card_bg'],
                           relief='flat',
                           borderwidth=1)
    
    def get_button_style(self, button_type='primary'):
        """获取按钮样式配置"""
        styles = {
            'primary': {
                'bg': self.colors['button_primary'],
                'fg': self.colors['text_white'],
                'activebackground': self.colors['button_primary_hover'],
                'activeforeground': self.colors['text_white'],
                'font': self.fonts['button'],
                'relief': 'flat',
                'borderwidth': 0,
                'cursor': 'hand2'
            },
            'secondary': {
                'bg': self.colors['button_secondary'],
                'fg': self.colors['text_primary'],
                'activebackground': self.colors['button_secondary_hover'],
                'activeforeground': self.colors['text_primary'],
                'font': self.fonts['button'],
                'relief': 'flat',
                'borderwidth': 1,
                'cursor': 'hand2'
            },
            'danger': {
                'bg': self.colors['button_danger'],
                'fg': self.colors['text_white'],
                'activebackground': self.colors['button_danger_hover'],
                'activeforeground': self.colors['text_white'],
                'font': self.fonts['button'],
                'relief': 'flat',
                'borderwidth': 0,
                'cursor': 'hand2'
            },
            'collection': {
                'bg': self.colors['button_collection'],
                'fg': self.colors['text_white'],
                'activebackground': self.colors['button_collection_hover'],
                'activeforeground': self.colors['text_white'],
                'font': self.fonts['button'],
                'relief': 'flat',
                'borderwidth': 0,
                'cursor': 'hand2'
            },
            'smart_collection': {
                'bg': self.colors['button_smart_collection'],
                'fg': self.colors['text_white'],
                'activebackground': self.colors['button_smart_collection_hover'],
                'activeforeground': self.colors['text_white'],
                'font': self.fonts['button'],
                'relief': 'flat',
                'borderwidth': 0,
                'cursor': 'hand2'
            }
        }
        return styles.get(button_type, styles['primary'])
    
    def get_card_style(self):
        """获取卡片样式配置"""
        return {
            'bg': self.colors['card_bg'],
            'relief': 'flat',
            'borderwidth': 1,
            'highlightthickness': 0
        }
    
    def create_hover_effect(self, widget, enter_color, leave_color):
        """为控件添加悬浮效果"""
        def on_enter(event):
            widget.configure(bg=enter_color)
        
        def on_leave(event):
            widget.configure(bg=leave_color)
        
        widget.bind('<Enter>', on_enter)
        widget.bind('<Leave>', on_leave)