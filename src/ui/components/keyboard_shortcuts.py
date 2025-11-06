import tkinter as tk
from utils.logger import get_logger, log_info, log_error

import sys
from pathlib import Path

# Add src to path if not already there
src_path = Path(__file__).parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))



def get_safe_font(font_family, size, style=None):
    """获取安全的字体配置"""
    try:
        if style:
            return (font_family, size, style)
        else:
            return (font_family, size)
    except:
        if style:
            return ('Arial', size, style)
        else:
            return ('Arial', size)


class StyleManager:
    """简化的样式管理器（用于快捷键组件）"""

    def __init__(self, parent, style=None):
        self.parent = parent
        self.style = style
        self.colors = {
            'bg_primary': '#F5F6FA',
            'bg_secondary': '#FFFFFF',
            'text_primary': '#2F3349',
            'text_secondary': '#6C7293',
            'accent': '#5294E2',
            'button_primary': '#5294E2',
            'button_primary_hover': '#4A90E2',
            'text_white': '#FFFFFF'
        }
        self.fonts = {
            'heading': ('Segoe UI', 20, 'bold'),
            'body': ('Segoe UI', 14),
            'button': ('Segoe UI', 13, 'bold')
        }


class KeyboardShortcuts:
    """现代化快捷键管理器"""

    def __init__(self, parent, style_manager=None):
        self.parent = parent
        self.logger = get_logger('ui.shortcuts')

        # 回调函数映射
        self.shortcuts = {}  # {key_combination: callback}
        self.descriptions = {}  # {key_combination: description}

        # 当前状态
        self.enabled = True
        self.ctrl_pressed = False
        self.alt_pressed = False
        self.shift_pressed = False

        # 使用传入的样式管理器或创建新实例
        if style_manager:
            self.style_manager = style_manager
        else:
            from tkinter import ttk
            style = ttk.Style()
            self.style_manager = StyleManager(parent, style)

        # 绑定键盘事件
        self.bind_events()

        log_info("快捷键管理器初始化完成", 'ui.shortcuts')

    def bind_events(self):
        """绑定键盘事件"""
        try:
            # 绑定到根窗口
            self.parent.bind('<KeyPress>', self.on_key_press)
            self.parent.bind('<KeyRelease>', self.on_key_release)

            # 绑定特殊按键
            self.parent.bind('<Control-Key>', self.on_ctrl_key)
            self.parent.bind('<Alt-Key>', self.on_alt_key)

            # 确保焦点在主窗口
            self.parent.focus_set()

        except Exception as e:
            log_error(f"绑定键盘事件时出错: {e}", 'ui.shortcuts')

    def on_key_press(self, event):
        """处理按键按下事件"""
        try:
            if not self.enabled:
                return

            # 更新修饰键状态
            self.ctrl_pressed = (event.state & 0x0004) != 0
            self.alt_pressed = (event.state & 0x0008) != 0
            self.shift_pressed = (event.state & 0x0001) != 0

            # 获取按键名称
            key_name = self.get_key_name(event)

            # 构造快捷键组合
            shortcut = self.build_shortcut(event, key_name)

            # 检查是否有对应的回调
            if shortcut in self.shortcuts:
                callback = self.shortcuts[shortcut]
                if callback:
                    callback()
                    return "break"  # 阻止默认行为

        except Exception as e:
            log_error(f"处理按键按下事件时出错: {e}", 'ui.shortcuts')

    def on_key_release(self, event):
        """处理按键释放事件"""
        try:
            # 更新修饰键状态
            self.ctrl_pressed = (event.state & 0x0004) != 0
            self.alt_pressed = (event.state & 0x0008) != 0
            self.shift_pressed = (event.state & 0x0001) != 0

        except Exception as e:
            log_error(f"处理按键释放事件时出错: {e}", 'ui.shortcuts')

    def on_ctrl_key(self, event):
        """处理Ctrl+按键组合"""
        try:
            if not self.enabled:
                return

            # 构造Ctrl+按键组合
            key_name = event.keysym.lower()
            shortcut = f"Ctrl+{key_name.capitalize()}"

            # 检查是否有对应的回调
            if shortcut in self.shortcuts:
                callback = self.shortcuts[shortcut]
                if callback:
                    callback()
                    return "break"

        except Exception as e:
            log_error(f"处理Ctrl+按键时出错: {e}", 'ui.shortcuts')

    def on_alt_key(self, event):
        """处理Alt+按键组合"""
        try:
            if not self.enabled:
                return

            # 构造Alt+按键组合
            key_name = event.keysym.lower()
            shortcut = f"Alt+{key_name.capitalize()}"

            # 检查是否有对应的回调
            if shortcut in self.shortcuts:
                callback = self.shortcuts[shortcut]
                if callback:
                    callback()
                    return "break"

        except Exception as e:
            log_error(f"处理Alt+按键时出错: {e}", 'ui.shortcuts')

    def get_key_name(self, event):
        """获取按键名称"""
        key = event.keysym.lower()

        # 处理特殊按键
        special_keys = {
            'space': 'Space',
            'return': 'Enter',
            'escape': 'Esc',
            'delete': 'Del',
            'backspace': 'BackSpace',
            'tab': 'Tab',
            'prior': 'PageUp',
            'next': 'PageDown',
            'left': 'Left',
            'right': 'Right',
            'up': 'Up',
            'down': 'Down',
            'home': 'Home',
            'end': 'End',
            'insert': 'Ins',
            'multiply': '*',
            'add': '+',
            'subtract': '-',
            'divide': '/'
        }

        if key in special_keys:
            return special_keys[key]

        # 处理功能键
        if key.startswith('f') and len(key) <= 3:
            return key.upper()

        # 处理单字符
        if len(key) == 1:
            return key.upper()

        return key

    def build_shortcut(self, event, key_name):
        """构建快捷键组合字符串"""
        parts = []

        # 添加修饰键
        if self.ctrl_pressed or (event.state & 0x0004) != 0:
            parts.append('Ctrl')
        if self.alt_pressed or (event.state & 0x0008) != 0:
            parts.append('Alt')
        if self.shift_pressed or (event.state & 0x0001) != 0:
            parts.append('Shift')

        # 添加主键
        parts.append(key_name)

        return '+'.join(parts)

    def register(self, shortcut, callback, description=""):
        """注册快捷键
        Args:
            shortcut: 快捷键组合，如 'Ctrl+O', 'Ctrl+Shift+N'
            callback: 回调函数
            description: 快捷键描述
        """
        try:
            self.shortcuts[shortcut] = callback
            if description:
                self.descriptions[shortcut] = description

            log_info(f"快捷键已注册: {shortcut} - {description}", 'ui.shortcuts')

        except Exception as e:
            log_error(f"注册快捷键时出错: {e}", 'ui.shortcuts')

    def unregister(self, shortcut):
        """取消注册快捷键"""
        try:
            if shortcut in self.shortcuts:
                del self.shortcuts[shortcut]
            if shortcut in self.descriptions:
                del self.descriptions[shortcut]

            log_info(f"快捷键已取消注册: {shortcut}", 'ui.shortcuts')

        except Exception as e:
            log_error(f"取消注册快捷键时出错: {e}", 'ui.shortcuts')

    def clear_all(self):
        """清除所有快捷键"""
        try:
            self.shortcuts.clear()
            self.descriptions.clear()
            log_info("所有快捷键已清除", 'ui.shortcuts')

        except Exception as e:
            log_error(f"清除快捷键时出错: {e}", 'ui.shortcuts')

    def enable(self):
        """启用快捷键"""
        self.enabled = True
        log_info("快捷键已启用", 'ui.shortcuts')

    def disable(self):
        """禁用快捷键"""
        self.enabled = False
        log_info("快捷键已禁用", 'ui.shortcuts')

    def get_all_shortcuts(self):
        """获取所有快捷键"""
        return [(shortcut, desc) for shortcut, desc in self.descriptions.items()]

    def show_shortcuts_help(self):
        """显示快捷键帮助对话框"""
        try:
            # 创建帮助窗口
            help_window = tk.Toplevel(self.parent)
            help_window.title("快捷键帮助")
            help_window.geometry("500x600")
            help_window.configure(bg=self.style_manager.colors['bg_primary'])

            # 设置模态
            help_window.transient(self.parent)
            help_window.grab_set()

            # 标题
            title_label = tk.Label(
                help_window,
                text="⌨️ 快捷键帮助",
                font=self.style_manager.fonts['heading'],
                bg=self.style_manager.colors['bg_primary'],
                fg=self.style_manager.colors['text_primary']
            )
            title_label.pack(pady=(20, 10))

            # 快捷键列表
            list_frame = tk.Frame(
                help_window,
                bg=self.style_manager.colors['bg_primary']
            )
            list_frame.pack(fill='both', expand=True, padx=20, pady=10)

            # 创建滚动区域
            canvas = tk.Canvas(list_frame, bg=self.style_manager.colors['bg_primary'])
            scrollbar = tk.Scrollbar(list_frame, orient='vertical', command=canvas.yview)
            scrollable_frame = tk.Frame(canvas, bg=self.style_manager.colors['bg_primary'])

            scrollable_frame.bind(
                "<Configure>",
                lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
            )

            canvas.create_window((0, 0), window=scrollable_frame, anchor="nw")
            canvas.configure(yscrollcommand=scrollbar.set)

            # 显示快捷键
            if self.descriptions:
                for shortcut, description in sorted(self.descriptions.items()):
                    # 快捷键项
                    item_frame = tk.Frame(
                        scrollable_frame,
                        bg=self.style_manager.colors['bg_secondary'],
                        relief='flat',
                        bd=1
                    )
                    item_frame.pack(fill='x', pady=2, padx=5)

                    # 快捷键标签
                    key_label = tk.Label(
                        item_frame,
                        text=shortcut,
                        font=self.style_manager.fonts['button'],
                        bg=self.style_manager.colors['bg_secondary'],
                        fg=self.style_manager.colors['accent'],
                        width=20,
                        anchor='w'
                    )
                    key_label.pack(side='left', padx=10, pady=8)

                    # 描述标签
                    desc_label = tk.Label(
                        item_frame,
                        text=description,
                        font=self.style_manager.fonts['body'],
                        bg=self.style_manager.colors['bg_secondary'],
                        fg=self.style_manager.colors['text_primary'],
                        anchor='w'
                    )
                    desc_label.pack(side='left', fill='x', expand=True, padx=10, pady=8)
            else:
                no_shortcuts_label = tk.Label(
                    scrollable_frame,
                    text="暂无快捷键",
                    font=self.style_manager.fonts['body'],
                    bg=self.style_manager.colors['bg_primary'],
                    fg=self.style_manager.colors['text_secondary']
                )
                no_shortcuts_label.pack(pady=20)

            canvas.pack(side="left", fill="both", expand=True)
            scrollbar.pack(side="right", fill="y")

            # 关闭按钮
            close_btn = tk.Button(
                help_window,
                text="关闭",
                command=help_window.destroy,
                bg=self.style_manager.colors['button_primary'],
                fg=self.style_manager.colors['text_white'],
                relief='flat',
                bd=0,
                font=self.style_manager.fonts['button'],
                cursor='hand2',
                padx=20,
                pady=8
            )
            close_btn.pack(pady=(10, 20))

            # 悬浮效果
            def on_enter(event):
                close_btn.configure(bg=self.style_manager.colors['button_primary_hover'])

            def on_leave(event):
                close_btn.configure(bg=self.style_manager.colors['button_primary'])

            close_btn.bind('<Enter>', on_enter)
            close_btn.bind('<Leave>', on_leave)

        except Exception as e:
            log_error(f"显示快捷键帮助时出错: {e}", 'ui.shortcuts')

    # 预设快捷键
    def register_common_shortcuts(self):
        """注册常用快捷键"""
        try:
            # 文件操作
            self.register('Ctrl+O', None, "打开文件夹")
            self.register('Ctrl+S', None, "扫描漫画")
            self.register('Ctrl+F', None, "搜索")
            self.register('Ctrl+W', None, "关闭")
            self.register('Ctrl+Q', None, "退出程序")

            # 编辑操作
            self.register('Ctrl+Z', None, "撤销")
            self.register('Ctrl+Y', None, "重做")
            self.register('Ctrl+A', None, "全选")
            self.register('Ctrl+C', None, "复制")
            self.register('Ctrl+V', None, "粘贴")

            # 视图操作
            self.register('F5', None, "刷新")
            self.register('F11', None, "全屏")
            self.register('Ctrl+=', None, "放大")
            self.register('Ctrl+-', None, "缩小")
            self.register('Ctrl+0', None, "重置缩放")

            # 导航
            self.register('Ctrl+H', None, "回到主页")
            self.register('Ctrl+R', None, "最近访问")
            self.register('Ctrl+D', None, "我的收藏")

            # 工具
            self.register('Ctrl+,', None, "设置")
            self.register('F1', None, "帮助")
            self.register('Ctrl+/', None, "显示快捷键")

        except Exception as e:
            log_error(f"注册常用快捷键时出错: {e}", 'ui.shortcuts')
