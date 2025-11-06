import os
import sys
from pathlib import Path
from tkinter import messagebox, Toplevel
from PIL import Image, ImageTk
import tkinter as tk

# Add src to path if not already there
src_path = Path(__file__).parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from utils.image_utils import ImageProcessor
from ui.components.image_viewer import ImageViewer  # 直接从components导入
from ui.components.style_manager import get_safe_font  # 直接从components导入
from utils.logger import get_logger, log_info, log_warning, log_error, log_exception

class AlbumViewerManager:
    """漫画查看器管理器"""
    
    def __init__(self, app):
        self.app = app
        self.logger = get_logger('core.viewer')
    
    def open_album(self, folder_path, album_list=None, current_album_index=None, start_at_last=False):
        """打开漫画查看"""
        try:
            log_info(f"打开漫画: {os.path.basename(folder_path)}", 'core.viewer')
            image_files = ImageProcessor.get_image_files(folder_path)
            
            if not image_files:
                log_warning(f"文件夹中没有找到图片: {folder_path}", 'core.viewer')
                messagebox.showinfo("提示", "该文件夹中没有找到图片")
                return
            
            log_info(f"找到 {len(image_files)} 张图片", 'core.viewer')
            
            # 添加到最近浏览
            self.app.config_manager.add_recent_album(folder_path)
                
            # 创建图片查看器窗口
            album_window = self._create_album_window(folder_path)
            
            # 创建图片查看器
            try:
                viewer = ImageViewer(album_window, image_files, self.app.config_manager, 
                                   album_list=album_list, current_album_index=current_album_index, 
                                   album_viewer_manager=self)
                
                # 如果需要从最后一张开始，设置索引
                if start_at_last:
                    viewer.current_index = len(image_files) - 1
                    viewer.load_current_image()
                    log_info("从最后一张图片开始查看", 'core.viewer')
                
                # 更新主窗口状态
                album_name = os.path.basename(folder_path)
                self.app.status_bar.set_status(f"已打开漫画: {album_name}")
                self.app.status_bar.set_info(f"{len(image_files)} 张图片")
                
                log_info(f"成功创建图片查看器: {album_name}", 'core.viewer')
                
            except Exception as e:
                log_exception(f"创建图片查看器失败: {e}", 'core.viewer')
                # 创建简单的图片查看器
                self._create_simple_viewer(album_window, image_files, os.path.basename(folder_path),
                                          album_list=album_list, current_album_index=current_album_index, 
                                          start_at_last=start_at_last)
            
        except Exception as e:
            log_exception(f"打开漫画时发生错误: {e}", 'core.viewer')
            messagebox.showerror("错误", f"打开漫画时发生错误：{str(e)}")
            self.app.status_bar.set_status("打开漫画失败")
    
    def _create_album_window(self, folder_path):
        """创建漫画窗口"""
        album_window = Toplevel(self.app.root)
        album_name = os.path.basename(folder_path)
        album_window.title(f"📸 漫画查看器 - {album_name}")
        album_window.geometry("1300x900")  # 增大漫画查看窗口
        album_window.minsize(1000, 700)  # 增大最小尺寸
        
        # 设置窗口图标和属性
        album_window.configure(bg='#1D1D1F')
        
        # 居中显示窗口
        album_window.transient(self.app.root)
        album_window.grab_set()
        
        log_info(f"创建漫画查看窗口: {album_name}", 'core.viewer')
        return album_window
    
    def _create_simple_viewer(self, window, image_files, album_name, album_list=None, current_album_index=None, start_at_last=False):
        """创建简单的图片查看器"""
        try:
            log_info(f"创建简单图片查看器: {album_name}", 'core.viewer')
            window.title(f"简单查看器 - {album_name}")
            window.configure(bg='black')
            
            # 当前图片索引
            current_index = [len(image_files) - 1 if start_at_last else 0]
            
            # 图片显示标签
            image_label = tk.Label(window, bg='black')
            image_label.pack(fill='both', expand=True)
            
            # 控制按钮
            control_frame = tk.Frame(window, bg='gray', height=50)
            control_frame.pack(side='bottom', fill='x')
            control_frame.pack_propagate(False)
            
            def load_image():
                try:
                    if image_files and 0 <= current_index[0] < len(image_files):
                        image_path = image_files[current_index[0]]
                        
                        # 加载图片
                        with Image.open(image_path) as img:
                            # 调整大小
                            window.update()
                            width = window.winfo_width() or 800
                            height = (window.winfo_height() or 600) - 50
                            
                            img.thumbnail((width, height), Image.Resampling.LANCZOS)
                            photo = ImageTk.PhotoImage(img)
                            
                            image_label.configure(image=photo)
                            image_label.image = photo
                        
                        # 更新标题
                        filename = os.path.basename(image_path)
                        window.title(f"📸 {filename} ({current_index[0]+1}/{len(image_files)})")
                        
                except Exception as e:
                    print(f"简单查看器加载图片失败: {e}")
                    image_label.configure(image='', text=f"无法加载图片\n{e}")
            
            def prev_image():
                if current_index[0] > 0:
                    current_index[0] -= 1
                    load_image()
                    log_info(f"切换到上一张图片: {current_index[0]+1}/{len(image_files)}", 'core.viewer')
                elif album_list and current_album_index is not None:
                    # 检查边界情况
                    if current_album_index <= 0:
                        # 已经是第一个相册，显示提示
                        if hasattr(self, 'app') and hasattr(self.app, 'config_manager'):
                            if self.app.config_manager.get_show_switch_notification():
                                messagebox.showinfo("提示", "已经是第一个相册了")
                        log_info("已到达第一个相册的边界", 'core.viewer')
                        return
                    
                    # 切换到上一个相册的最后一张
                    try:
                        # 显示切换提示
                        if hasattr(self, 'app') and hasattr(self.app, 'config_manager'):
                            if self.app.config_manager.get_show_switch_notification():
                                prev_album_name = os.path.basename(album_list[current_album_index - 1])
                                messagebox.showinfo("切换相册", f"正在切换到上一个相册：{prev_album_name}")
                        
                        prev_album_path = album_list[current_album_index - 1]
                        log_info(f"切换到上一个相册: {os.path.basename(prev_album_path)}", 'core.viewer')
                        window.destroy()
                        self.open_album(prev_album_path, album_list=album_list, 
                                      current_album_index=current_album_index - 1, start_at_last=True)
                    except Exception as e:
                        log_exception(f"简单查看器切换到上一个相册失败: {e}", 'core.viewer')
            
            def next_image():
                if current_index[0] < len(image_files) - 1:
                    current_index[0] += 1
                    load_image()
                    log_info(f"切换到下一张图片: {current_index[0]+1}/{len(image_files)}", 'core.viewer')
                elif album_list and current_album_index is not None:
                    # 检查边界情况
                    if current_album_index >= len(album_list) - 1:
                        # 已经是最后一个相册，显示提示
                        if hasattr(self, 'app') and hasattr(self.app, 'config_manager'):
                            if self.app.config_manager.get_show_switch_notification():
                                messagebox.showinfo("提示", "已经是最后一个相册了")
                        log_info("已到达最后一个相册的边界", 'core.viewer')
                        return
                    
                    # 切换到下一个相册的第一张
                    try:
                        # 显示切换提示
                        if hasattr(self, 'app') and hasattr(self.app, 'config_manager'):
                            if self.app.config_manager.get_show_switch_notification():
                                next_album_name = os.path.basename(album_list[current_album_index + 1])
                                messagebox.showinfo("切换相册", f"正在切换到下一个相册：{next_album_name}")
                        
                        next_album_path = album_list[current_album_index + 1]
                        log_info(f"切换到下一个相册: {os.path.basename(next_album_path)}", 'core.viewer')
                        window.destroy()
                        self.open_album(next_album_path, album_list=album_list, 
                                      current_album_index=current_album_index + 1, start_at_last=False)
                    except Exception as e:
                        log_exception(f"简单查看器切换到下一个相册失败: {e}", 'core.viewer')
            
            # 按钮 - 添加快捷键提示  
            tk.Button(control_frame, text="上一张 (←)", command=prev_image).pack(side='left', padx=5, pady=5)
            tk.Button(control_frame, text="下一张 (→)", command=next_image).pack(side='left', padx=5, pady=5)
            tk.Button(control_frame, text="关闭 (ESC)", command=window.destroy).pack(side='right', padx=5, pady=5)
            
            # 添加快捷键说明标签
            help_text = "快捷键: ← → 切换图片 | ESC 关闭"
            if album_list and len(album_list) > 1:
                help_text = "快捷键: ← → 切换图片/相册 | ESC 关闭"
            
            help_label = tk.Label(control_frame, 
                text=help_text, 
                bg='gray', fg='white', font=get_safe_font('Arial', 9))
            help_label.pack(pady=2)
            
            # 键盘绑定
            def on_key(event):
                if event.keysym == 'Left':
                    prev_image()
                elif event.keysym == 'Right':
                    next_image()
                elif event.keysym == 'Escape':
                    window.destroy()
            
            window.bind('<Key>', on_key)
            window.focus_set()
            
            # 加载第一张图片
            window.after(100, load_image)
            log_info("简单图片查看器创建完成", 'core.viewer')
            
        except Exception as e:
            log_exception(f"创建简单查看器失败: {e}", 'core.viewer')
            messagebox.showerror("错误", "无法创建图片查看器")
            window.destroy()
