import tkinter as tk
import os
from utils.image_utils import ImageProcessor, SlideshowManager
from PIL import Image, ImageTk
import threading
from concurrent.futures import ThreadPoolExecutor
from .style_manager import StyleManager, get_safe_font
from .status_bar import StatusBar
from tkinter import messagebox

import sys
from pathlib import Path

# Add src to path if not already there
src_path = Path(__file__).parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))



class ImageViewer:
    """图片查看器"""
    
    def __init__(self, parent, image_files, config_manager, album_list=None, current_album_index=None, album_viewer_manager=None):
        self.parent = parent
        self.image_files = image_files
        self.config_manager = config_manager
        self.current_index = 0
        self.current_image = None
        self.zoom_factor = 1.0
        self.is_fullscreen = False
        self.rotation = 0  # 旋转角度
        
        # 相册切换相关
        self.album_list = album_list  # 相册列表
        self.current_album_index = current_album_index  # 当前相册在列表中的索引
        self.album_viewer_manager = album_viewer_manager  # 相册查看器管理器
        
        # 设置窗口属性
        self.parent.configure(bg='#1D1D1F')
        
        self.create_widgets()
        self.bind_events()
        # 延迟加载图片，确保窗口已完全创建
        self.parent.after(100, self.load_current_image)
    
    def create_widgets(self):
        """创建查看器组件"""
        # 顶部工具栏
        self.toolbar = tk.Frame(self.parent, bg='#2C2C2E', height=60)
        self.toolbar.pack(side='top', fill='x')
        self.toolbar.pack_propagate(False)
        
        # 工具栏内容
        toolbar_content = tk.Frame(self.toolbar, bg='#2C2C2E')
        toolbar_content.pack(fill='both', expand=True, padx=15, pady=10)
        
        # 左侧文件信息
        left_frame = tk.Frame(toolbar_content, bg='#2C2C2E')
        left_frame.pack(side='left', fill='y')
        
        self.file_info_var = tk.StringVar()
        info_label = tk.Label(left_frame, textvariable=self.file_info_var,
                             font=get_safe_font('Arial', 12, 'bold'),
                             bg='#2C2C2E', fg='white')
        info_label.pack(anchor='w')
        
        # 更新快捷键提示，添加相册切换说明
        shortcut_text = "⌨️ 快捷键: ←→切换图片/相册 +/-缩放 R旋转 F11全屏 I信息 H帮助 ESC退出"
        if self.album_list and len(self.album_list) > 1:
            shortcut_text += " | 📚 支持相册间自动切换"
        
        shortcut_label = tk.Label(left_frame, text=shortcut_text,
                                 font=get_safe_font('Arial', 9),
                                 bg='#2C2C2E', fg='#8E8E93')
        shortcut_label.pack(anchor='w', pady=(2, 0))
        
        # 右侧控制按钮
        btn_frame = tk.Frame(toolbar_content, bg='#2C2C2E')
        btn_frame.pack(side='right', fill='y')
        
        # 按钮样式
        btn_style = {
            'font': get_safe_font('Arial', 10),
            'bg': '#48484A',
            'fg': 'white',
            'relief': 'flat',
            'padx': 12,
            'pady': 6,
            'cursor': 'hand2'
        }
        
        # 控制按钮
        tk.Button(btn_frame, text="⏮️ 第一张", command=self.goto_first_image, **btn_style).pack(side='left', padx=2)
        tk.Button(btn_frame, text="⬅️ 上一张", command=self.prev_image, **btn_style).pack(side='left', padx=2)
        tk.Button(btn_frame, text="➡️ 下一张", command=self.next_image, **btn_style).pack(side='left', padx=2)
        tk.Button(btn_frame, text="⏭️ 最后一张", command=self.goto_last_image, **btn_style).pack(side='left', padx=2)
        
        # 分隔线
        separator = tk.Frame(btn_frame, bg='#6C6C70', width=1, height=30)
        separator.pack(side='left', padx=8)
        
        # 缩放按钮
        tk.Button(btn_frame, text="🔍+ 放大", command=self.zoom_in, **btn_style).pack(side='left', padx=2)
        tk.Button(btn_frame, text="🔍- 缩小", command=self.zoom_out, **btn_style).pack(side='left', padx=2)
        tk.Button(btn_frame, text="📐 重置", command=self.reset_zoom, **btn_style).pack(side='left', padx=2)
        
        # 分隔线
        separator2 = tk.Frame(btn_frame, bg='#6C6C70', width=1, height=30)
        separator2.pack(side='left', padx=8)
        
        # 旋转按钮
        tk.Button(btn_frame, text="↺ 左转", command=self.rotate_left, **btn_style).pack(side='left', padx=2)
        tk.Button(btn_frame, text="↻ 右转", command=self.rotate_right, **btn_style).pack(side='left', padx=2)
        tk.Button(btn_frame, text="🔄 重置", command=self.reset_rotation, **btn_style).pack(side='left', padx=2)
        
        # 分隔线
        separator3 = tk.Frame(btn_frame, bg='#6C6C70', width=1, height=30)
        separator3.pack(side='left', padx=8)
        
        # 功能按钮
        tk.Button(btn_frame, text="🖥️ 全屏", command=self.toggle_fullscreen, **btn_style).pack(side='left', padx=2)
        tk.Button(btn_frame, text="▶️ 幻灯片", command=self.start_slideshow, **btn_style).pack(side='left', padx=2)
        tk.Button(btn_frame, text="ℹ️ 信息", command=self.show_image_info, **btn_style).pack(side='left', padx=2)
        tk.Button(btn_frame, text="❓ 帮助", command=self.show_help, **btn_style).pack(side='left', padx=2)
        
        # 主显示区域
        self.main_frame = tk.Frame(self.parent, bg='#1D1D1F')
        self.main_frame.pack(fill='both', expand=True)
        
        # 创建Canvas用于显示图片
        self.canvas = tk.Canvas(self.main_frame, bg='#1D1D1F', highlightthickness=0)
        self.canvas.pack(fill='both', expand=True)
        
        # 绑定Canvas事件
        self.canvas.bind('<Configure>', self.on_window_resize)
        
        # 状态栏
        self.status_frame = tk.Frame(self.parent, bg='#2C2C2E', height=30)
        self.status_frame.pack(side='bottom', fill='x')
        self.status_frame.pack_propagate(False)
        
        self.status_var = tk.StringVar()
        status_label = tk.Label(self.status_frame, textvariable=self.status_var,
                               font=get_safe_font('Arial', 10),
                               bg='#2C2C2E', fg='#8E8E93')
        status_label.pack(side='left', padx=15, pady=5)
    
    def bind_events(self):
        """绑定键盘和鼠标事件"""
        # 确保窗口可以接收焦点
        self.parent.focus_set()
        
        # 绑定键盘事件
        self.parent.bind('<Key>', self.on_key_press)
        self.parent.bind('<Left>', lambda e: self.prev_image())
        self.parent.bind('<Right>', lambda e: self.next_image())
        self.parent.bind('<Home>', lambda e: self.goto_first_image())
        self.parent.bind('<End>', lambda e: self.goto_last_image())
        self.parent.bind('<plus>', lambda e: self.zoom_in())
        self.parent.bind('<minus>', lambda e: self.zoom_out())
        self.parent.bind('<F11>', lambda e: self.toggle_fullscreen())
        self.parent.bind('<Escape>', lambda e: self.parent.quit())
        
        # 绑定鼠标滚轮事件
        self.canvas.bind('<MouseWheel>', self.on_mouse_wheel)
        
        # 绑定窗口大小变化事件
        self.parent.bind('<Configure>', self.on_window_resize)
    
    def on_key_press(self, event):
        """处理键盘按键事件"""
        key = event.keysym.lower()
        
        if key == 'r':
            self.rotate_right()
        elif key == 'i':
            self.show_image_info()
        elif key == 'h':
            self.show_help()
        elif key == 'space':
            self.start_slideshow()
        elif key == 'equal':  # + 键（不按Shift）
            self.zoom_in()
    
    def load_current_image(self):
        """加载当前图片"""
        if not self.image_files or self.current_index >= len(self.image_files):
            return
        
        try:
            image_path = self.image_files[self.current_index]
            
            # 更新文件信息
            filename = os.path.basename(image_path)
            file_info = f"{self.current_index + 1}/{len(self.image_files)} - {filename}"
            
            # 如果有相册列表信息，添加相册位置信息
            if self.album_list and self.current_album_index is not None:
                album_info = f" | 相册 {self.current_album_index + 1}/{len(self.album_list)}"
                file_info += album_info
            
            self.file_info_var.set(file_info)
            
            # 加载图片
            with Image.open(image_path) as img:
                # 应用旋转
                if self.rotation != 0:
                    img = img.rotate(-self.rotation, expand=True)
                
                # 获取Canvas尺寸
                canvas_width = self.canvas.winfo_width()
                canvas_height = self.canvas.winfo_height()
                
                if canvas_width <= 1 or canvas_height <= 1:
                    # Canvas还没有正确初始化，延迟加载
                    self.parent.after(100, self.load_current_image)
                    return
                
                # 计算缩放后的尺寸
                img_width, img_height = img.size
                
                # 应用用户缩放
                display_width = int(img_width * self.zoom_factor)
                display_height = int(img_height * self.zoom_factor)
                
                # 如果图片太大，自动适应Canvas
                if self.zoom_factor == 1.0:  # 只在默认缩放时自动适应
                    scale_x = canvas_width / img_width
                    scale_y = canvas_height / img_height
                    scale = min(scale_x, scale_y, 1.0)  # 不放大，只缩小
                    
                    display_width = int(img_width * scale)
                    display_height = int(img_height * scale)
                
                # 调整图片大小
                if display_width != img_width or display_height != img_height:
                    img = img.resize((display_width, display_height), Image.Resampling.LANCZOS)
                
                # 转换为PhotoImage
                self.current_image = ImageTk.PhotoImage(img)
                
                # 清空Canvas并显示图片
                self.canvas.delete('all')
                
                # 计算居中位置
                x = (canvas_width - display_width) // 2
                y = (canvas_height - display_height) // 2
                
                self.canvas.create_image(x, y, anchor='nw', image=self.current_image)
                
                # 更新状态栏
                status_text = f"尺寸: {img_width}×{img_height} | 缩放: {self.zoom_factor:.1f}x | 旋转: {self.rotation}°"
                self.status_var.set(status_text)
                
        except Exception as e:
            print(f"加载图片失败: {e}")
            # 显示错误信息
            self.canvas.delete('all')
            self.canvas.create_text(
                self.canvas.winfo_width()//2, 
                self.canvas.winfo_height()//2,
                text=f"无法加载图片\n{str(e)}", 
                fill='white', 
                font=get_safe_font('Arial', 16),
                justify='center'
            )
    
    def prev_image(self):
        """上一张图片"""
        if self.current_index > 0:
            self.current_index -= 1
            self.load_current_image()
        else:
            # 已经是第一张图片，尝试切换到上一个相册的最后一张
            self._switch_to_previous_album()
    
    def next_image(self):
        """下一张图片"""
        if self.current_index < len(self.image_files) - 1:
            self.current_index += 1
            self.load_current_image()
        else:
            # 已经是最后一张图片，尝试切换到下一个相册的第一张
            self._switch_to_next_album()
    
    def goto_first_image(self):
        """跳转到第一张图片"""
        self.current_index = 0
        self.load_current_image()
    
    def goto_last_image(self):
        """跳转到最后一张图片"""
        self.current_index = len(self.image_files) - 1
        self.load_current_image()
    
    def zoom_in(self):
        """放大图片"""
        self.zoom_factor = min(self.zoom_factor * 1.2, 5.0)
        self.load_current_image()
    
    def zoom_out(self):
        """缩小图片"""
        self.zoom_factor = max(self.zoom_factor / 1.2, 0.1)
        self.load_current_image()
    
    def reset_zoom(self):
        """重置缩放"""
        self.zoom_factor = 1.0
        self.load_current_image()
    
    def rotate_left(self):
        """向左旋转90度"""
        self.rotation = (self.rotation - 90) % 360
        self.load_current_image()
    
    def rotate_right(self):
        """向右旋转90度"""
        self.rotation = (self.rotation + 90) % 360
        self.load_current_image()
    
    def reset_rotation(self):
        """重置旋转"""
        self.rotation = 0
        self.load_current_image()
    
    def toggle_fullscreen(self):
        """切换全屏模式"""
        self.is_fullscreen = not self.is_fullscreen
        self.parent.attributes('-fullscreen', self.is_fullscreen)
        
        if self.is_fullscreen:
            self.toolbar.pack_forget()
            self.status_frame.pack_forget()
        else:
            self.toolbar.pack(side='top', fill='x', before=self.main_frame)
            self.status_frame.pack(side='bottom', fill='x')
        
        # 重新加载图片以适应新的窗口大小
        self.parent.after(100, self.load_current_image)
    
    def start_slideshow(self):
        """开始幻灯片播放"""
        try:
            slideshow = SlideshowManager(self.parent, self.image_files, self.current_index)
            slideshow.start()
        except Exception as e:
            print(f"启动幻灯片失败: {e}")
            messagebox.showerror("错误", f"无法启动幻灯片播放\n{str(e)}")
    
    def show_image_info(self):
        """显示图片信息"""
        if not self.image_files or self.current_index >= len(self.image_files):
            return
        
        try:
            image_path = self.image_files[self.current_index]
            
            # 获取文件信息
            file_stat = os.stat(image_path)
            file_size = file_stat.st_size
            
            # 格式化文件大小
            if file_size < 1024:
                size_str = f"{file_size} B"
            elif file_size < 1024 * 1024:
                size_str = f"{file_size / 1024:.1f} KB"
            else:
                size_str = f"{file_size / (1024 * 1024):.1f} MB"
            
            # 获取图片信息
            with Image.open(image_path) as img:
                width, height = img.size
                format_name = img.format or "未知"
                mode = img.mode
            
            # 构建信息文本
            info_text = f"""文件信息:
文件名: {os.path.basename(image_path)}
路径: {image_path}
文件大小: {size_str}

图片信息:
尺寸: {width} × {height} 像素
格式: {format_name}
颜色模式: {mode}

当前状态:
缩放: {self.zoom_factor:.1f}x
旋转: {self.rotation}°
位置: {self.current_index + 1} / {len(self.image_files)}"""
            
            # 显示信息对话框
            messagebox.showinfo("图片信息", info_text)
            
        except Exception as e:
            messagebox.showerror("错误", f"无法获取图片信息\n{str(e)}")
    
    def show_help(self):
        """显示帮助信息"""
        help_text = """图片查看器 - 快捷键帮助

导航:
← / → : 上一张 / 下一张图片
Home / End : 第一张 / 最后一张图片

相册切换:
在第一张图片时按 ← : 切换到上一个相册的最后一张
在最后一张图片时按 → : 切换到下一个相册的第一张

缩放:
+ / - : 放大 / 缩小
鼠标滚轮 : 缩放

旋转:
R : 向右旋转90度

功能:
F11 : 切换全屏模式
Space : 开始幻灯片播放
I : 显示图片信息
H : 显示此帮助
ESC : 退出查看器

鼠标操作:
滚轮 : 缩放图片"""
        
        messagebox.showinfo("帮助", help_text)
    
    def _switch_to_previous_album(self):
        """切换到上一个相册的最后一张图片"""
        if not (self.album_list and self.current_album_index is not None and self.album_viewer_manager):
            return
            
        # 检查边界情况
        if self.current_album_index <= 0:
            # 已经是第一个相册，显示提示
            if hasattr(self.album_viewer_manager, 'app') and hasattr(self.album_viewer_manager.app, 'config_manager'):
                if self.album_viewer_manager.app.config_manager.get_show_switch_notification():
                    messagebox.showinfo("提示", "已经是第一个相册了")
            return
            
        try:
            # 显示切换提示
            if hasattr(self.album_viewer_manager, 'app') and hasattr(self.album_viewer_manager.app, 'config_manager'):
                if self.album_viewer_manager.app.config_manager.get_show_switch_notification():
                    prev_album_name = os.path.basename(self.album_list[self.current_album_index - 1])
                    messagebox.showinfo("切换相册", f"正在切换到上一个相册：{prev_album_name}")
            
            # 获取上一个相册路径
            prev_album_path = self.album_list[self.current_album_index - 1]
            
            # 关闭当前窗口
            self.parent.destroy()
            
            # 打开上一个相册，并跳转到最后一张图片
            self.album_viewer_manager.open_album(
                prev_album_path, 
                album_list=self.album_list, 
                current_album_index=self.current_album_index - 1,
                start_at_last=True
            )
            
        except Exception as e:
            print(f"切换到上一个相册失败: {e}")
            messagebox.showerror("错误", f"无法切换到上一个相册: {str(e)}")
    
    def _switch_to_next_album(self):
        """切换到下一个相册的第一张图片"""
        if not (self.album_list and self.current_album_index is not None and self.album_viewer_manager):
            return
            
        # 检查边界情况
        if self.current_album_index >= len(self.album_list) - 1:
            # 已经是最后一个相册，显示提示
            if hasattr(self.album_viewer_manager, 'app') and hasattr(self.album_viewer_manager.app, 'config_manager'):
                if self.album_viewer_manager.app.config_manager.get_show_switch_notification():
                    messagebox.showinfo("提示", "已经是最后一个相册了")
            return
            
        try:
            # 显示切换提示
            if hasattr(self.album_viewer_manager, 'app') and hasattr(self.album_viewer_manager.app, 'config_manager'):
                if self.album_viewer_manager.app.config_manager.get_show_switch_notification():
                    next_album_name = os.path.basename(self.album_list[self.current_album_index + 1])
                    messagebox.showinfo("切换相册", f"正在切换到下一个相册：{next_album_name}")
            
            # 获取下一个相册路径
            next_album_path = self.album_list[self.current_album_index + 1]
            
            # 关闭当前窗口
            self.parent.destroy()
            
            # 打开下一个相册，从第一张图片开始
            self.album_viewer_manager.open_album(
                next_album_path, 
                album_list=self.album_list, 
                current_album_index=self.current_album_index + 1,
                start_at_last=False
            )
            
        except Exception as e:
            print(f"切换到下一个相册失败: {e}")
            messagebox.showerror("错误", f"无法切换到下一个相册: {str(e)}")
    
    def on_mouse_wheel(self, event):
        """处理鼠标滚轮事件"""
        if event.delta > 0:
            self.zoom_in()
        else:
            self.zoom_out()
    
    def on_window_resize(self, event):
        """处理窗口大小变化"""
        # 只在主窗口大小变化时重新加载图片
        if event.widget == self.parent:
            self.parent.after(100, self.load_current_image)