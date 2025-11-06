import tkinter as tk
from tkinter import ttk
from .style_manager import get_safe_font
from utils.logger import get_logger, log_info, log_error

import sys
from pathlib import Path

# Add src to path if not already there
src_path = Path(__file__).parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))



class Sidebar:
    """现代化侧边栏导航组件"""

    def __init__(self, parent, style_manager=None):
        self.parent = parent
        self.logger = get_logger('ui.sidebar')

        # 回调函数
        self.home_callback = None
        self.browse_callback = None
        self.scan_callback = None
        self.recent_callback = None
        self.favorites_callback = None
        self.settings_callback = None

        # 回调存储（用于后续绑定）
        self._callbacks_store = {}  # {item_id: callback}

        # 使用传入的样式管理器或创建新实例
        if style_manager:
            self.style_manager = style_manager
        else:
            from tkinter import ttk
            style = ttk.Style()
            self.style_manager = StyleManager(parent, style)

        # 侧边栏宽度
        self.sidebar_width = 240
        self.collapsed_width = 64

        # 当前状态
        self.is_collapsed = False
        self.active_item = "home"

        # 标签 widgets 引用
        self.label_widgets = {}

        # 设置按钮引用
        self.settings_btn = None
        self.settings_content = None

        # 创建UI
        try:
            self.create_widgets()
            log_info("侧边栏组件创建成功", 'ui.sidebar')
        except Exception as e:
            log_error(f"创建侧边栏组件时出错: {e}", 'ui.sidebar')
            raise

    def create_widgets(self):
        """创建侧边栏UI组件"""
        try:
            # 主容器
            self.sidebar_frame = tk.Frame(
                self.parent,
                bg=self.style_manager.colors['bg_secondary'],
                width=self.sidebar_width
            )
            self.sidebar_frame.pack(side='left', fill='y', padx=(0, 2))
            self.sidebar_frame.pack_propagate(False)

            # 顶部Logo区域
            self.create_header()

            # 导航菜单区域
            self.create_navigation()

            # 底部操作区域
            self.create_footer()

        except Exception as e:
            print(f"创建侧边栏UI时出错: {e}")
            import traceback
            traceback.print_exc()

    def create_header(self):
        """创建顶部Logo区域"""
        try:
            header_frame = tk.Frame(
                self.sidebar_frame,
                bg=self.style_manager.colors['bg_secondary'],
                height=80
            )
            header_frame.pack(fill='x', padx=12, pady=(12, 8))
            header_frame.pack_propagate(False)

            # Logo和标题
            self.logo_frame = tk.Frame(
                header_frame,
                bg=self.style_manager.colors['bg_secondary']
            )
            self.logo_frame.pack(expand=True, fill='both')

            # Logo图标
            self.logo_label = tk.Label(
                self.logo_frame,
                text="📚",
                font=('Segoe UI', 32),
                bg=self.style_manager.colors['bg_secondary'],
                fg=self.style_manager.colors['accent']
            )
            self.logo_label.pack(pady=(10, 4))

            # 应用名称
            self.app_name_label = tk.Label(
                self.logo_frame,
                text="漫画扫描器",
                font=self.style_manager.fonts['subheading'],
                bg=self.style_manager.colors['bg_secondary'],
                fg=self.style_manager.colors['text_primary']
            )
            self.app_name_label.pack()

            # 折叠按钮
            self.toggle_btn = tk.Button(
                self.sidebar_frame,
                text="◀",
                command=self.toggle_collapse,
                bg=self.style_manager.colors['bg_secondary'],
                fg=self.style_manager.colors['text_secondary'],
                relief='flat',
                borderwidth=0,
                font=('Segoe UI', 12),
                cursor='hand2'
            )
            self.toggle_btn.place(x=8, y=8, width=24, height=24)

        except Exception as e:
            print(f"创建头部区域时出错: {e}")

    def create_navigation(self):
        """创建导航菜单"""
        try:
            nav_frame = tk.Frame(
                self.sidebar_frame,
                bg=self.style_manager.colors['bg_secondary']
            )
            nav_frame.pack(fill='both', expand=True, padx=8, pady=8)

            # 导航菜单项
            self.nav_items = {}

            # 主要导航（先不传递回调，暂用 None）
            main_nav = [
                ("home", "🏠", "主页"),
                ("browse", "📁", "浏览文件夹"),
                ("scan", "🔍", "扫描漫画"),
            ]

            for item_id, icon, label in main_nav:
                self.create_nav_item(nav_frame, item_id, icon, label)

            # 分隔线
            separator1 = tk.Frame(
                nav_frame,
                bg=self.style_manager.colors['border'],
                height=1
            )
            separator1.pack(fill='x', pady=12)

            # 辅助导航（先不传递回调，暂用 None）
            auxiliary_nav = [
                ("recent", "🕐", "最近访问"),
                ("favorites", "⭐", "我的收藏"),
            ]

            for item_id, icon, label in auxiliary_nav:
                self.create_nav_item(nav_frame, item_id, icon, label)

            # 设置默认激活项
            self.set_active_item("home")

        except Exception as e:
            print(f"创建导航菜单时出错: {e}")
            import traceback
            traceback.print_exc()

    def create_nav_item(self, parent, item_id, icon, label):
        """创建单个导航项"""
        try:
            # 导航项容器
            item_frame = tk.Frame(
                parent,
                bg=self.style_manager.colors['bg_secondary'],
                height=48
            )
            item_frame.pack(fill='x', pady=2)
            item_frame.pack_propagate(False)

            # 激活指示器
            indicator = tk.Frame(
                item_frame,
                bg=self.style_manager.colors['accent'],
                width=3,
                height=0  # 初始高度为0，展开时设置
            )
            indicator.place(x=0, y=0)

            # 点击区域（覆盖整个导航项）
            click_frame = tk.Frame(
                item_frame,
                bg=self.style_manager.colors['bg_hover'] if hasattr(self.style_manager.colors, 'bg_hover') else self.style_manager.colors['card_bg'],
                relief='flat',
                cursor='hand2'
            )
            click_frame.pack(fill='both', expand=True, padx=(8, 8))

            # 图标和标签容器
            content_frame = tk.Frame(
                click_frame,
                bg=self.style_manager.colors['bg_hover'] if hasattr(self.style_manager.colors, 'bg_hover') else self.style_manager.colors['card_bg']
            )
            content_frame.pack(expand=True, fill='both', padx=12)

            # 图标
            icon_label = tk.Label(
                content_frame,
                text=icon,
                font=('Segoe UI', 18),
                bg=self.style_manager.colors['bg_hover'] if hasattr(self.style_manager.colors, 'bg_hover') else self.style_manager.colors['card_bg'],
                fg=self.style_manager.colors['text_secondary']
            )
            icon_label.pack(side='left', pady=12)

            # 标签（折叠时不显示）
            self.label_widgets[item_id] = tk.Label(
                content_frame,
                text=label,
                font=self.style_manager.fonts['body'],
                bg=self.style_manager.colors['bg_hover'] if hasattr(self.style_manager.colors, 'bg_hover') else self.style_manager.colors['card_bg'],
                fg=self.style_manager.colors['text_primary'],
                anchor='w'
            )
            # 只有在展开状态下才显示标签
            if not self.is_collapsed:
                self.label_widgets[item_id].pack(side='left', fill='x', expand=True, padx=(12, 0))

            # 绑定悬浮事件（点击事件稍后绑定）
            def on_enter(event, widget=click_frame):
                widget.configure(bg=self.style_manager.colors['card_hover'])

            def on_leave(event, widget=click_frame):
                if self.active_item != item_id:
                    widget.configure(bg=self.style_manager.colors['bg_hover'] if hasattr(self.style_manager.colors, 'bg_hover') else self.style_manager.colors['card_bg'])

            click_frame.bind('<Enter>', on_enter)
            click_frame.bind('<Leave>', on_leave)

            # 保存导航项引用
            self.nav_items[item_id] = {
                'frame': item_frame,
                'indicator': indicator,
                'click_frame': click_frame,
                'icon_label': icon_label,
                'label_widget': self.label_widgets.get(item_id)
            }

        except Exception as e:
            print(f"创建导航项 {item_id} 时出错: {e}")
            import traceback
            traceback.print_exc()

    def create_footer(self):
        """创建底部操作区域"""
        try:
            footer_frame = tk.Frame(
                self.sidebar_frame,
                bg=self.style_manager.colors['bg_secondary'],
                height=60
            )
            footer_frame.pack(fill='x', padx=8, pady=(8, 12))
            footer_frame.pack_propagate(False)

            # 设置按钮
            settings_btn = tk.Frame(
                footer_frame,
                bg=self.style_manager.colors['bg_secondary'],
                relief='flat',
                cursor='hand2'
            )
            settings_btn.pack(fill='x', pady=4)

            settings_content = tk.Frame(
                settings_btn,
                bg=self.style_manager.colors['bg_secondary']
            )
            settings_content.pack(expand=True, fill='both', padx=8, pady=4)

            settings_icon = tk.Label(
                settings_content,
                text="⚙️",
                font=('Segoe UI', 16),
                bg=self.style_manager.colors['bg_secondary'],
                fg=self.style_manager.colors['text_secondary']
            )
            settings_icon.pack(side='left', pady=8)

            self.settings_label = tk.Label(
                settings_content,
                text="设置",
                font=self.style_manager.fonts['body'],
                bg=self.style_manager.colors['bg_secondary'],
                fg=self.style_manager.colors['text_primary'],
                anchor='w'
            )
            # 只有在展开状态下才显示标签
            if not self.is_collapsed:
                self.settings_label.pack(side='left', fill='x', expand=True, padx=(12, 0))

            # 保存设置按钮引用（稍后绑定事件）
            self.settings_btn = settings_btn
            self.settings_content = settings_content

            # 绑定悬浮事件（点击事件稍后绑定）
            def on_enter(event):
                settings_content.configure(bg=self.style_manager.colors['card_hover'])

            def on_leave(event):
                settings_content.configure(bg=self.style_manager.colors['bg_secondary'])

            settings_btn.bind('<Enter>', on_enter)
            settings_btn.bind('<Leave>', on_leave)

        except Exception as e:
            print(f"创建底部区域时出错: {e}")

    def set_active_item(self, item_id):
        """设置激活的导航项"""
        try:
            # 恢复之前的激活项
            if self.active_item in self.nav_items:
                prev_item = self.nav_items[self.active_item]
                prev_item['click_frame'].configure(
                    bg=self.style_manager.colors['bg_hover'] if hasattr(self.style_manager.colors, 'bg_hover') else self.style_manager.colors['card_bg']
                )
                prev_item['indicator'].configure(height=0)

            # 激活新的导航项
            if item_id in self.nav_items:
                current_item = self.nav_items[item_id]
                current_item['click_frame'].configure(
                    bg=self.style_manager.colors['accent_light']
                )
                current_item['indicator'].configure(height=48)

                # 更新图标颜色
                current_item['icon_label'].configure(
                    fg=self.style_manager.colors['accent']
                )

            self.active_item = item_id

        except Exception as e:
            print(f"设置激活导航项时出错: {e}")

    def toggle_collapse(self):
        """折叠/展开侧边栏"""
        try:
            self.is_collapsed = not self.is_collapsed

            if self.is_collapsed:
                # 折叠
                self.sidebar_frame.configure(width=self.collapsed_width)
                # 隐藏标签
                if hasattr(self, 'label_widgets'):
                    for label in self.label_widgets.values():
                        label.pack_forget()
                # 隐藏设置标签
                if hasattr(self, 'settings_label'):
                    self.settings_label.pack_forget()
                # 更新按钮图标
                self.toggle_btn.configure(text="▶")
            else:
                # 展开
                self.sidebar_frame.configure(width=self.sidebar_width)
                # 显示标签
                if hasattr(self, 'label_widgets'):
                    for label in self.label_widgets.values():
                        label.pack(side='left', fill='x', expand=True, padx=(12, 0))
                # 显示设置标签
                if hasattr(self, 'settings_label'):
                    self.settings_label.pack(side='left', fill='x', expand=True, padx=(12, 0))
                # 更新按钮图标
                self.toggle_btn.configure(text="◀")

        except Exception as e:
            print(f"切换侧边栏状态时出错: {e}")

    def _bind_nav_item_click(self, item_id):
        """绑定导航项的点击事件"""
        try:
            if item_id not in self.nav_items:
                return

            item = self.nav_items[item_id]
            click_frame = item['click_frame']

            # 获取回调函数
            callback_map = {
                'home': self.home_callback,
                'browse': self.browse_callback,
                'scan': self.scan_callback,
                'recent': self.recent_callback,
                'favorites': self.favorites_callback,
                'settings': self.settings_callback
            }

            callback_func = callback_map.get(item_id)

            # 绑定点击事件
            def on_click(event, cb=callback_func, item=item_id):
                if cb:
                    cb()
                self.set_active_item(item)
                return "break"  # 阻止事件传播

            # 移除旧的绑定（如果有）
            click_frame.unbind('<Button-1>')

            # 绑定新的点击事件
            click_frame.bind('<Button-1>', on_click)

        except Exception as e:
            print(f"绑定导航项点击事件时出错: {e}")

    def _bind_all_nav_clicks(self):
        """绑定所有导航项的点击事件"""
        for item_id in self.nav_items.keys():
            self._bind_nav_item_click(item_id)

        # 绑定设置按钮
        self._bind_settings_click()

    def _bind_settings_click(self):
        """绑定设置按钮的点击事件"""
        try:
            if not self.settings_btn or not self.settings_callback:
                return

            def on_click(event):
                if self.settings_callback:
                    self.settings_callback()
                return "break"

            self.settings_btn.unbind('<Button-1>')
            self.settings_btn.bind('<Button-1>', on_click)

        except Exception as e:
            print(f"绑定设置按钮点击事件时出错: {e}")

    # 回调设置方法
    def set_callbacks(self, **callbacks):
        """设置所有回调函数"""
        for name, callback in callbacks.items():
            if hasattr(self, f"{name}_callback"):
                setattr(self, f"{name}_callback", callback)

        # 绑定所有导航项的点击事件
        self._bind_all_nav_clicks()

    def set_home_callback(self, callback):
        """设置主页回调"""
        self.home_callback = callback
        self._bind_nav_item_click('home')

    def set_browse_callback(self, callback):
        """设置浏览回调"""
        self.browse_callback = callback
        self._bind_nav_item_click('browse')

    def set_scan_callback(self, callback):
        """设置扫描回调"""
        self.scan_callback = callback
        self._bind_nav_item_click('scan')

    def set_recent_callback(self, callback):
        """设置最近访问回调"""
        self.recent_callback = callback
        self._bind_nav_item_click('recent')

    def set_favorites_callback(self, callback):
        """设置收藏回调"""
        self.favorites_callback = callback
        self._bind_nav_item_click('favorites')

    def set_settings_callback(self, callback):
        """设置设置回调"""
        self.settings_callback = callback
        self._bind_settings_click()
