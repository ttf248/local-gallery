import tkinter as tk
from tkinter import ttk
from .style_manager import get_safe_font
from ...utils.logger import get_logger, log_info, log_error


class Toolbar:
    """现代化顶部工具栏组件"""

    def __init__(self, parent, style_manager=None):
        self.parent = parent
        self.logger = get_logger('ui.toolbar')

        # 回调函数
        self.browse_callback = None
        self.scan_callback = None
        self.filter_callback = None
        self.view_mode_callback = None
        self.theme_callback = None
        self.settings_callback = None

        # 搜索相关
        self.search_var = tk.StringVar()
        self.search_callback = None

        # 筛选相关
        self.filter_var = tk.StringVar(value="全部")
        self.view_mode_var = tk.StringVar(value="grid")

        # 使用传入的样式管理器或创建新实例
        if style_manager:
            self.style_manager = style_manager
        else:
            from tkinter import ttk
            style = ttk.Style()
            self.style_manager = StyleManager(parent, style)

        # 创建UI
        try:
            self.create_widgets()
            log_info("工具栏组件创建成功", 'ui.toolbar')
        except Exception as e:
            log_error(f"创建工具栏组件时出错: {e}", 'ui.toolbar')
            raise

    def create_widgets(self):
        """创建工具栏UI组件"""
        try:
            # 主容器
            self.toolbar_frame = tk.Frame(
                self.parent,
                bg=self.style_manager.colors['bg_primary'],
                height=64
            )
            self.toolbar_frame.pack(side='top', fill='x', padx=(0, 0), pady=(0, 0))
            self.toolbar_frame.pack_propagate(False)

            # 创建内部容器
            self.create_container()

            # 绑定搜索事件
            self.bind_events()

        except Exception as e:
            print(f"创建工具栏UI时出错: {e}")
            import traceback
            traceback.print_exc()

    def create_container(self):
        """创建内部容器"""
        try:
            # 内部容器使用grid布局
            self.container = tk.Frame(
                self.toolbar_frame,
                bg=self.style_manager.colors['bg_primary']
            )
            self.container.pack(fill='both', expand=True, padx=16, pady=8)

            # 配置网格权重
            self.container.grid_columnconfigure(0, weight=0)  # 左侧按钮
            self.container.grid_columnconfigure(1, weight=1)  # 搜索框
            self.container.grid_columnconfigure(2, weight=0)  # 右侧按钮

            # 创建左侧操作按钮
            self.create_left_buttons()

            # 创建中间搜索框
            self.create_search_box()

            # 创建右侧控制按钮
            self.create_right_buttons()

        except Exception as e:
            print(f"创建工具栏容器时出错: {e}")

    def create_left_buttons(self):
        """创建左侧操作按钮"""
        try:
            left_frame = tk.Frame(
                self.container,
                bg=self.style_manager.colors['bg_primary']
            )
            left_frame.grid(row=0, column=0, sticky='w', padx=(0, 16))

            # 浏览文件夹按钮
            browse_btn = self.create_button(
                left_frame,
                text="📁 浏览文件夹",
                command=self.browse_callback,
                style='primary'
            )
            browse_btn.pack(side='left', padx=(0, 8))

            # 扫描按钮
            scan_btn = self.create_button(
                left_frame,
                text="🔍 扫描漫画",
                command=self.scan_callback,
                style='secondary'
            )
            scan_btn.pack(side='left')

        except Exception as e:
            print(f"创建左侧按钮时出错: {e}")

    def create_search_box(self):
        """创建搜索框"""
        try:
            search_frame = tk.Frame(
                self.container,
                bg=self.style_manager.colors['bg_primary']
            )
            search_frame.grid(row=0, column=1, sticky='ew', padx=16)

            # 搜索容器
            search_container = tk.Frame(
                search_frame,
                bg=self.style_manager.colors['bg_tertiary'],
                relief='flat',
                bd=1
            )
            search_container.pack(fill='x', expand=True)

            # 搜索图标
            search_icon = tk.Label(
                search_container,
                text="🔍",
                font=('Segoe UI', 14),
                bg=self.style_manager.colors['bg_tertiary'],
                fg=self.style_manager.colors['text_tertiary']
            )
            search_icon.pack(side='left', padx=(12, 8), pady=8)

            # 搜索输入框
            self.search_entry = tk.Entry(
                search_container,
                textvariable=self.search_var,
                font=self.style_manager.fonts['body'],
                bg=self.style_manager.colors['bg_tertiary'],
                fg=self.style_manager.colors['text_primary'],
                relief='flat',
                bd=0,
                highlightthickness=0,
                insertbackground=self.style_manager.colors['text_primary']
            )
            self.search_entry.pack(side='left', fill='x', expand=True, padx=(0, 8), pady=8)

            # 清空搜索按钮
            clear_btn = tk.Button(
                search_container,
                text="✕",
                command=self.clear_search,
                bg=self.style_manager.colors['bg_tertiary'],
                fg=self.style_manager.colors['text_tertiary'],
                relief='flat',
                bd=0,
                font=('Segoe UI', 12),
                cursor='hand2',
                width=2
            )
            clear_btn.pack(side='right', padx=(0, 8), pady=8)

            # 清空按钮悬浮效果
            def on_clear_enter(event):
                clear_btn.configure(fg=self.style_manager.colors['error'])

            def on_clear_leave(event):
                clear_btn.configure(fg=self.style_manager.colors['text_tertiary'])

            clear_btn.bind('<Enter>', on_clear_enter)
            clear_btn.bind('<Leave>', on_clear_leave)

        except Exception as e:
            print(f"创建搜索框时出错: {e}")

    def create_right_buttons(self):
        """创建右侧控制按钮"""
        try:
            right_frame = tk.Frame(
                self.container,
                bg=self.style_manager.colors['bg_primary']
            )
            right_frame.grid(row=0, column=2, sticky='e', padx=(16, 0))

            # 筛选下拉框
            filter_frame = tk.Frame(
                right_frame,
                bg=self.style_manager.colors['bg_primary']
            )
            filter_frame.pack(side='left', padx=8)

            filter_label = tk.Label(
                filter_frame,
                text="筛选:",
                font=self.style_manager.fonts['caption'],
                bg=self.style_manager.colors['bg_primary'],
                fg=self.style_manager.colors['text_secondary']
            )
            filter_label.pack(side='left', padx=(0, 8), pady=16)

            # 创建筛选下拉框
            self.filter_combobox = ttk.Combobox(
                filter_frame,
                textvariable=self.filter_var,
                values=["全部", "📚 合集", "🧠 智能分组", "📖 单独相册"],
                state='readonly',
                font=self.style_manager.fonts['body'],
                width=16
            )
            self.filter_combobox.pack(side='left', padx=(0, 8), pady=8)
            self.filter_combobox.bind('<<ComboboxSelected>>', self.on_filter_changed)

            # 视图模式按钮
            view_frame = tk.Frame(
                right_frame,
                bg=self.style_manager.colors['bg_primary']
            )
            view_frame.pack(side='left', padx=8)

            # 网格视图按钮
            self.grid_btn = tk.Button(
                view_frame,
                text="▦",
                command=lambda: self.set_view_mode('grid'),
                bg=self.style_manager.colors['bg_secondary'],
                fg=self.style_manager.colors['text_primary'],
                relief='flat',
                bd=0,
                font=('Segoe UI', 16),
                cursor='hand2',
                width=3,
                height=1
            )
            self.grid_btn.pack(side='left', padx=(0, 4), pady=8)

            # 列表视图按钮
            self.list_btn = tk.Button(
                view_frame,
                text="☰",
                command=lambda: self.set_view_mode('list'),
                bg=self.style_manager.colors['bg_tertiary'],
                fg=self.style_manager.colors['text_secondary'],
                relief='flat',
                bd=0,
                font=('Segoe UI', 16),
                cursor='hand2',
                width=3,
                height=1
            )
            self.list_btn.pack(side='left', padx=4, pady=8)

            # 主题切换按钮
            theme_btn = tk.Button(
                right_frame,
                text="🌙",
                command=self.toggle_theme,
                bg=self.style_manager.colors['bg_tertiary'],
                fg=self.style_manager.colors['text_primary'],
                relief='flat',
                bd=0,
                font=('Segoe UI', 16),
                cursor='hand2',
                width=3,
                height=1
            )
            theme_btn.pack(side='left', padx=(16, 0), pady=8)

            # 设置按钮
            settings_btn = tk.Button(
                right_frame,
                text="⚙",
                command=self.settings_callback,
                bg=self.style_manager.colors['bg_tertiary'],
                fg=self.style_manager.colors['text_primary'],
                relief='flat',
                bd=0,
                font=('Segoe UI', 16),
                cursor='hand2',
                width=3,
                height=1
            )
            settings_btn.pack(side='left', padx=8, pady=8)

        except Exception as e:
            print(f"创建右侧按钮时出错: {e}")

    def create_button(self, parent, text, command, style='primary'):
        """创建按钮"""
        try:
            if style == 'primary':
                bg = self.style_manager.colors['button_primary']
                fg = self.style_manager.colors['text_white']
                hover_bg = self.style_manager.colors['button_primary_hover']
            elif style == 'secondary':
                bg = self.style_manager.colors['button_secondary']
                fg = self.style_manager.colors['text_primary']
                hover_bg = self.style_manager.colors['button_secondary_hover']
            else:
                bg = self.style_manager.colors['bg_secondary']
                fg = self.style_manager.colors['text_primary']
                hover_bg = self.style_manager.colors['card_hover']

            btn = tk.Button(
                parent,
                text=text,
                command=command,
                bg=bg,
                fg=fg,
                relief='flat',
                bd=0,
                font=self.style_manager.fonts['button'],
                cursor='hand2',
                padx=16,
                pady=8
            )

            # 悬浮效果
            def on_enter(event):
                btn.configure(bg=hover_bg)

            def on_leave(event):
                btn.configure(bg=bg)

            btn.bind('<Enter>', on_enter)
            btn.bind('<Leave>', on_leave)

            return btn

        except Exception as e:
            print(f"创建按钮时出错: {e}")
            return tk.Frame(parent)

    def bind_events(self):
        """绑定事件"""
        try:
            # 搜索框回车事件
            self.search_entry.bind('<Return>', self.on_search)
            self.search_entry.bind('<KeyRelease>', self.on_search_keyrelease)

        except Exception as e:
            print(f"绑定事件时出错: {e}")

    def on_search(self, event):
        """搜索事件处理"""
        try:
            if self.search_callback:
                self.search_callback(self.search_var.get())
        except Exception as e:
            print(f"搜索时出错: {e}")

    def on_search_keyrelease(self, event):
        """搜索框按键释放事件（用于实时搜索）"""
        try:
            if self.search_callback:
                # 延迟搜索，避免频繁调用
                if hasattr(self, '_search_timer'):
                    self.parent.after_cancel(self._search_timer)
                self._search_timer = self.parent.after(300, lambda: self.search_callback(self.search_var.get()))
        except Exception as e:
            print(f"实时搜索时出错: {e}")

    def on_filter_changed(self, event):
        """筛选条件改变事件"""
        try:
            if self.filter_callback:
                self.filter_callback(self.filter_var.get())
        except Exception as e:
            print(f"筛选时出错: {e}")

    def clear_search(self):
        """清空搜索"""
        try:
            self.search_var.set('')
            if self.search_callback:
                self.search_callback('')
            self.search_entry.focus_set()
        except Exception as e:
            print(f"清空搜索时出错: {e}")

    def set_view_mode(self, mode):
        """设置视图模式"""
        try:
            self.view_mode_var.set(mode)

            if mode == 'grid':
                # 网格视图激活
                self.grid_btn.configure(
                    bg=self.style_manager.colors['button_primary'],
                    fg=self.style_manager.colors['text_white']
                )
                self.list_btn.configure(
                    bg=self.style_manager.colors['bg_tertiary'],
                    fg=self.style_manager.colors['text_secondary']
                )
            else:
                # 列表视图激活
                self.list_btn.configure(
                    bg=self.style_manager.colors['button_primary'],
                    fg=self.style_manager.colors['text_white']
                )
                self.grid_btn.configure(
                    bg=self.style_manager.colors['bg_tertiary'],
                    fg=self.style_manager.colors['text_secondary']
                )

            if self.view_mode_callback:
                self.view_mode_callback(mode)

        except Exception as e:
            print(f"设置视图模式时出错: {e}")

    def toggle_theme(self):
        """切换主题"""
        try:
            if self.theme_callback:
                self.theme_callback()
        except Exception as e:
            print(f"切换主题时出错: {e}")

    # 回调设置方法
    def set_callbacks(self, **callbacks):
        """设置所有回调函数"""
        for name, callback in callbacks.items():
            if hasattr(self, f"{name}_callback"):
                setattr(self, f"{name}_callback", callback)

    def set_browse_callback(self, callback):
        """设置浏览回调"""
        self.browse_callback = callback

    def set_scan_callback(self, callback):
        """设置扫描回调"""
        self.scan_callback = callback

    def set_search_callback(self, callback):
        """设置搜索回调"""
        self.search_callback = callback

    def set_filter_callback(self, callback):
        """设置筛选回调"""
        self.filter_callback = callback

    def set_view_mode_callback(self, callback):
        """设置视图模式回调"""
        self.view_mode_callback = callback

    def set_theme_callback(self, callback):
        """设置主题切换回调"""
        self.theme_callback = callback

    def set_settings_callback(self, callback):
        """设置设置回调"""
        self.settings_callback = callback

    # 公共方法
    def get_search_text(self):
        """获取搜索文本"""
        return self.search_var.get()

    def set_search_text(self, text):
        """设置搜索文本"""
        self.search_var.set(text)

    def get_filter_value(self):
        """获取筛选值"""
        return self.filter_var.get()

    def set_filter_value(self, value):
        """设置筛选值"""
        self.filter_var.set(value)
