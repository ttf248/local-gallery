import tkinter as tk
from tkinter import ttk
from .style_manager import get_safe_font, StyleManager
from utils.logger import get_logger, log_info, log_error, log_exception

import sys
from pathlib import Path

# Add src to path if not already there
src_path = Path(__file__).parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))


class NavigationBar:
    """现代化导航栏组件"""
    
    def __init__(self, parent, browse_callback, scan_callback, path_var, recent_callback, favorites_callback, style_manager=None):
        self.parent = parent
        self.browse_callback = browse_callback
        self.scan_callback = scan_callback
        self.path_var = path_var
        self.recent_callback = recent_callback
        self.favorites_callback = favorites_callback
        self.logger = get_logger('ui.navigation')
        
        # 新增回调
        self.home_callback = None  # 将由app_manager设置
        self.settings_callback = None  # 将由app_manager设置
        
        # 筛选相关变量
        self.filter_var = None
        self.filter_combobox = None
        self.filter_callback = None  # 筛选回调函数
        
        # 使用传入的样式管理器或创建新实例
        if style_manager:
            self.style_manager = style_manager
        else:
            from tkinter import ttk
            style = ttk.Style()
            self.style_manager = StyleManager(parent, style)
        
        # 确保样式管理器正确初始化
        self._ensure_style_manager()
        
        try:
            self.create_widgets()
            log_info("导航栏组件创建成功", 'ui.navigation')
        except Exception as e:
            log_exception(f"创建导航栏组件时出错: {e}", 'ui.navigation')
    
    def _ensure_style_manager(self):
        """确保样式管理器正确初始化，提供默认配置"""
        # 检查是否有colors属性
        if not hasattr(self.style_manager, 'colors') or not self.style_manager.colors:
            # 提供默认颜色配置
            self.style_manager.colors = {
                'bg': '#f5f5f5',
                'card_bg': '#ffffff',
                'text_primary': '#333333',
                'text_secondary': '#666666',
                'text_tertiary': '#999999',
                'accent': '#007acc',
                'accent_light': '#e6f3ff',
                'button_primary': '#007acc',
                'button_primary_hover': '#005999',
                'button_secondary': '#f0f0f0',
                'button_secondary_hover': '#e0e0e0',
                'bg_tertiary': '#f8f9fa'
            }
        
        # 检查是否有fonts属性
        if not hasattr(self.style_manager, 'fonts') or not self.style_manager.fonts:
            # 提供默认字体配置
            self.style_manager.fonts = {
                'body': ('Segoe UI', 10),
                'caption': ('Segoe UI', 9),
                'small': ('Segoe UI', 8),
                'mono': ('Consolas', 9)
            }
        
        # 检查是否有dimensions属性
        if not hasattr(self.style_manager, 'dimensions') or not self.style_manager.dimensions:
            # 提供默认尺寸配置
            self.style_manager.dimensions = {
                'padding_sm': 4,
                'padding_lg': 12,
                'padding_xl': 16
            }
        
        # 确保方法存在
        if not hasattr(self.style_manager, 'get_button_style'):
            self.style_manager.get_button_style = self._default_get_button_style
        
        if not hasattr(self.style_manager, 'create_hover_effect'):
            self.style_manager.create_hover_effect = self._default_create_hover_effect
    
    def _default_get_button_style(self, button_type):
        """默认按钮样式"""
        if button_type == 'primary':
            return {
                'bg': self.style_manager.colors['button_primary'],
                'fg': 'white',
                'font': self.style_manager.fonts['body'],
                'relief': 'flat',
                'borderwidth': 0,
                'cursor': 'hand2'
            }
        else:
            return {
                'bg': self.style_manager.colors['button_secondary'],
                'fg': self.style_manager.colors['text_primary'],
                'font': self.style_manager.fonts['body'],
                'relief': 'flat',
                'borderwidth': 0,
                'cursor': 'hand2'
            }
    
    def _default_create_hover_effect(self, widget, hover_color, normal_color):
        """默认悬浮效果"""
        def on_enter(e):
            try:
                widget.configure(bg=hover_color)
            except:
                pass
        
        def on_leave(e):
            try:
                widget.configure(bg=normal_color)
            except:
                pass
        
        widget.bind('<Enter>', on_enter)
        widget.bind('<Leave>', on_leave)
    
    def create_widgets(self):
        """创建现代化导航栏组件"""
        try:
            # 导航栏主框架 - 使用卡片样式
            self.nav_frame = tk.Frame(self.parent, 
                                    bg=self.style_manager.colors.get('card_bg', '#ffffff'), 
                                    height=120,  # 增加高度以容纳面包屑
                                    relief='flat',
                                    bd=1)
            self.nav_frame.pack(side='top', fill='x', padx=16, pady=(16, 8))
            self.nav_frame.pack_propagate(False)
            
            # 内容框架
            content_frame = tk.Frame(self.nav_frame, bg=self.style_manager.colors.get('card_bg', '#ffffff'))
            content_frame.pack(fill='both', expand=True, 
                              padx=self.style_manager.dimensions.get('padding_xl', 16), 
                              pady=self.style_manager.dimensions.get('padding_lg', 12))
            
            # 面包屑导航区域
            self.breadcrumb_frame = tk.Frame(content_frame, bg=self.style_manager.colors.get('card_bg', '#ffffff'))
            self.breadcrumb_frame.pack(side='top', fill='x', pady=(0, 8))
            
            # 创建面包屑导航
            self.create_breadcrumb()
            
            # 顶部按钮区域
            button_frame = tk.Frame(content_frame, bg=self.style_manager.colors.get('card_bg', '#ffffff'))
            button_frame.pack(side='top', fill='x')
            
            # 创建现代化按钮
            self.create_modern_buttons(button_frame)
            
            # 路径显示区域
            path_frame = tk.Frame(content_frame, bg=self.style_manager.colors.get('card_bg', '#ffffff'))
            path_frame.pack(side='bottom', fill='x', pady=(12, 0))
            
            # 路径标签和显示
            self.create_path_display(path_frame)
        except Exception as e:
            print(f"创建导航栏组件时出错: {e}")
            # 创建简化版本
            self._create_simple_widgets()
    
    def _create_simple_widgets(self):
        """创建简化版导航栏（错误恢复）"""
        log_info("使用简化版导航栏界面", 'ui.navigation')
        self.nav_frame = tk.Frame(self.parent, bg='#ffffff', height=80)
        self.nav_frame.pack(side='top', fill='x', padx=16, pady=(16, 8))
        
        # 简单按钮
        tk.Button(self.nav_frame, text='选择文件夹', command=self.browse_callback).pack(side='left', padx=5)
        tk.Button(self.nav_frame, text='扫描漫画', command=self.scan_callback).pack(side='left', padx=5)
        tk.Button(self.nav_frame, text='最近浏览', command=self.recent_callback).pack(side='left', padx=5)
        tk.Button(self.nav_frame, text='我的收藏', command=self.favorites_callback).pack(side='left', padx=5)
        
        # 简单路径显示
        tk.Label(self.nav_frame, textvariable=self.path_var).pack(side='bottom', fill='x')
        log_info("简化版导航栏创建完成", 'ui.navigation')
    
    def create_breadcrumb(self):
        """创建面包屑导航"""
        # 清空现有面包屑
        for widget in self.breadcrumb_frame.winfo_children():
            widget.destroy()
        
        # 面包屑容器
        breadcrumb_container = tk.Frame(self.breadcrumb_frame, bg=self.style_manager.colors['card_bg'])
        breadcrumb_container.pack(side='left')
        
        # 首页按钮
        home_btn = tk.Button(breadcrumb_container,
                           text="🏠 首页",
                           command=self.go_home,
                           font=self.style_manager.fonts['caption'],
                           bg=self.style_manager.colors['card_bg'],
                           fg=self.style_manager.colors['accent'],
                           relief='flat',
                           borderwidth=0,
                           padx=8,
                           pady=4,
                           cursor='hand2')
        home_btn.pack(side='left')
        
        self.style_manager.create_hover_effect(
            home_btn,
            self.style_manager.colors['accent_light'],
            self.style_manager.colors['card_bg']
        )
        
        # 分隔符和当前位置将由update_breadcrumb动态更新
        self.current_location_label = tk.Label(breadcrumb_container,
                                             text="",
                                             font=self.style_manager.fonts['caption'],
                                             bg=self.style_manager.colors['card_bg'],
                                             fg=self.style_manager.colors['text_secondary'])
        self.current_location_label.pack(side='left', padx=(4, 0))
    
    def update_breadcrumb(self, location_type="home", location_name=""):
        """更新面包屑显示"""
        if location_type == "home":
            self.current_location_label.configure(text="")
        elif location_type == "recent":
            self.current_location_label.configure(text=" > 📝 最近浏览")
            # 预加载最近浏览的封面
            self._preload_recent_covers()
        elif location_type == "favorites":
            self.current_location_label.configure(text=" > ⭐ 我的收藏")
            # 预加载收藏的封面
            self._preload_favorite_covers()
        elif location_type == "scan":
            folder_name = location_name or "扫描结果"
            if len(folder_name) > 20:
                folder_name = folder_name[:17] + "..."
            self.current_location_label.configure(text=f" > 📁 {folder_name}")
    
    def _preload_recent_covers(self):
        """预加载最近浏览的封面"""
        try:
            # 获取图片缓存实例
            from utils.image_cache import get_image_cache
            cache = get_image_cache()
            
            # 这里可以从历史记录中获取路径列表
            # 为了演示，我们延迟执行，等待实际数据加载
            self.parent.after(1000, lambda: self._do_preload_recent())
            
        except Exception as e:
            from utils.logger import log_error
            log_error(f"预加载最近浏览封面失败: {e}", 'ui.navigation')
    
    def _preload_favorite_covers(self):
        """预加载收藏的封面"""
        try:
            # 获取图片缓存实例
            from utils.image_cache import get_image_cache
            cache = get_image_cache()
            
            # 延迟执行，等待实际数据加载
            self.parent.after(1000, lambda: self._do_preload_favorites())
            
        except Exception as e:
            from utils.logger import log_error
            log_error(f"预加载收藏封面失败: {e}", 'ui.navigation')
    
    def _do_preload_recent(self):
        """执行最近浏览预加载"""
        try:
            # 这里可以与history manager协作获取最近路径
            pass
        except Exception as e:
            print(f"执行最近浏览预加载失败: {e}")
    
    def _do_preload_favorites(self):
        """执行收藏预加载"""
        try:
            # 这里可以与favorites manager协作获取收藏路径
            pass
        except Exception as e:
            print(f"执行收藏预加载失败: {e}")

    def go_home(self):
        """返回首页（扫描结果）"""
        if self.home_callback:
            self.home_callback()
    
    def create_modern_buttons(self, parent):
        """创建现代化导航按钮"""
        # 按钮配置：文本、回调函数、类型、快捷键（仅显示）
        buttons_config = [
            {
                'text': '📁 选择文件夹',
                'command': self.browse_callback,
                'type': 'primary',
                'shortcut': 'Ctrl+O'
            },
            {
                'text': '🔍 扫描漫画',
                'command': self.scan_callback,
                'type': 'primary',
                'shortcut': 'Ctrl+S'
            },
            {
                'text': '🕒 最近浏览',
                'command': self.recent_callback,
                'type': 'secondary',
                'shortcut': 'Ctrl+R'
            },
            {
                'text': '⭐ 我的收藏',
                'command': self.favorites_callback,
                'type': 'secondary',
                'shortcut': 'Ctrl+F'
            },
            {
                'text': '⚙️ 设置',
                'command': lambda: self.settings_callback() if self.settings_callback else None,
                'type': 'secondary',
                'shortcut': 'Ctrl+,',
            }
        ]
        
        self.buttons = []
        
        for i, config in enumerate(buttons_config):
            # 创建按钮容器
            btn_container = tk.Frame(parent, bg=self.style_manager.colors['card_bg'])
            btn_container.pack(side='left', padx=(0, 12) if i < len(buttons_config) - 1 else (0, 0))
            
            # 获取按钮样式
            btn_style = self.style_manager.get_button_style(config['type'])
            
            # 创建按钮
            btn = tk.Button(btn_container, 
                          text=config['text'],
                          command=config['command'],
                          **btn_style,
                          padx=self.style_manager.dimensions['padding_lg'],
                          pady=self.style_manager.dimensions['padding_sm'])
            btn.pack()
            
            # 添加悬浮效果
            if config['type'] == 'primary':
                self.style_manager.create_hover_effect(
                    btn, 
                    self.style_manager.colors['button_primary_hover'],
                    self.style_manager.colors['button_primary']
                )
            else:
                self.style_manager.create_hover_effect(
                    btn, 
                    self.style_manager.colors['button_secondary_hover'],
                    self.style_manager.colors['button_secondary']
                )
            
            # 快捷键标签
            if config.get('shortcut'):
                shortcut_label = tk.Label(btn_container, 
                                        text=config['shortcut'],
                                        font=self.style_manager.fonts['small'],
                                        bg=self.style_manager.colors['card_bg'],
                                        fg=self.style_manager.colors['text_tertiary'])
                shortcut_label.pack(pady=(2, 0))
            
            self.buttons.append(btn)
        
        # 创建筛选区域
        filter_frame = tk.Frame(parent, bg=self.style_manager.colors['card_bg'])
        filter_frame.pack(side='right', padx=(12, 0))
        
        # 筛选标签
        filter_label = tk.Label(filter_frame,
                               text="🔽 筛选:",
                               font=self.style_manager.fonts['caption'],
                               bg=self.style_manager.colors['card_bg'],
                               fg=self.style_manager.colors['text_secondary'])
        filter_label.pack(side='left', padx=(0, 8))
        
        # 筛选下拉菜单
        self.filter_var = tk.StringVar(value="全部")
        filter_options = ["全部", "📚 合集", "🧠 智能分组", "📖 单独相册"]
        
        self.filter_combobox = ttk.Combobox(filter_frame,
                                           textvariable=self.filter_var,
                                           values=filter_options,
                                           state="readonly",
                                           width=12,
                                           font=self.style_manager.fonts['caption'])
        self.filter_combobox.pack(side='left')
        
        # 绑定筛选事件
        self.filter_combobox.bind('<<ComboboxSelected>>', self._on_filter_changed)
    
    def _on_filter_changed(self, event=None):
        """处理筛选变化事件"""
        try:
            if self.filter_callback:
                filter_value = self.filter_var.get()
                self.filter_callback(filter_value)
                log_info(f"筛选条件已更改为: {filter_value}", 'ui.navigation')
        except Exception as e:
            log_error(f"处理筛选变化时出错: {e}", 'ui.navigation')
    
    def set_filter_callback(self, callback):
        """设置筛选回调函数"""
        self.filter_callback = callback
    
    def get_current_filter(self):
        """获取当前筛选条件"""
        if self.filter_var:
            return self.filter_var.get()
        return "全部"
    
    def create_path_display(self, parent):
        """创建路径显示区域"""
        # 路径容器
        path_container = tk.Frame(parent, 
                                bg=self.style_manager.colors['bg_tertiary'],
                                relief='flat',
                                bd=1)
        path_container.pack(fill='x', pady=(8, 0))
        
        # 内容框架
        path_content = tk.Frame(path_container, bg=self.style_manager.colors['bg_tertiary'])
        path_content.pack(fill='x', padx=12, pady=8)
        
        # 路径图标和标签
        path_icon = tk.Label(path_content, 
                           text="📍",
                           font=self.style_manager.fonts['body'],
                           bg=self.style_manager.colors['bg_tertiary'],
                           fg=self.style_manager.colors['text_secondary'])
        path_icon.pack(side='left')
        
        path_label = tk.Label(path_content, 
                            text="当前路径:",
                            font=self.style_manager.fonts['body'],
                            bg=self.style_manager.colors['bg_tertiary'],
                            fg=self.style_manager.colors['text_secondary'])
        path_label.pack(side='left', padx=(4, 8))
        
        # 路径显示 - 支持长路径省略
        self.path_display = tk.Label(path_content, 
                                   textvariable=self.path_var,
                                   font=self.style_manager.fonts['mono'],
                                   bg=self.style_manager.colors['bg_tertiary'],
                                   fg=self.style_manager.colors['text_primary'],
                                   anchor='w',
                                   justify='left')
        self.path_display.pack(side='left', fill='x', expand=True)
        
        # 路径复制按钮
        copy_btn = tk.Button(path_content,
                           text="📋",
                           command=self.copy_path_to_clipboard,
                           font=self.style_manager.fonts['small'],
                           bg=self.style_manager.colors['bg_tertiary'],
                           fg=self.style_manager.colors['text_secondary'],
                           relief='flat',
                           borderwidth=0,
                           padx=4,
                           cursor='hand2')
        copy_btn.pack(side='right')
        
        self.style_manager.create_hover_effect(
            copy_btn,
            self.style_manager.colors['accent_light'],
            self.style_manager.colors['bg_tertiary']
        )
    
    def copy_path_to_clipboard(self):
        """复制当前路径到剪贴板"""
        try:
            path = self.path_var.get()
            if path:
                self.parent.clipboard_clear()
                self.parent.clipboard_append(path)
                log_info(f"路径已复制到剪贴板: {path}", 'ui.navigation')
        except Exception as e:
            log_error(f"复制路径到剪贴板时出错: {e}", 'ui.navigation')
    
    def update_button_states(self, has_path=False, is_scanning=False):
        """更新按钮状态"""
        try:
            if len(self.buttons) >= 2:
                # 扫描按钮只在有路径时启用
                scan_btn = self.buttons[1]
                if has_path and not is_scanning:
                    scan_btn.configure(state='normal')
                else:
                    scan_btn.configure(state='disabled')
                
                # 扫描时禁用选择文件夹按钮
                browse_btn = self.buttons[0]
                if is_scanning:
                    browse_btn.configure(state='disabled')
                else:
                    browse_btn.configure(state='normal')
            
            log_info(f"按钮状态更新 - 有路径: {has_path}, 扫描中: {is_scanning}", 'ui.navigation')
        except Exception as e:
            log_error(f"更新按钮状态时出错: {e}", 'ui.navigation')