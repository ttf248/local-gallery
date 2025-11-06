import tkinter as tk
from utils.image_utils import ImageProcessor
from utils.logger import get_logger, log_info, log_error, log_exception

import sys
from pathlib import Path

# Add src to path if not already there
src_path = Path(__file__).parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))


class FallbackUIManager:
    """备用UI管理器"""
    
    def __init__(self, app):
        self.app = app
        self.logger = get_logger('ui.fallback')
    
    def create_fallback_ui(self):
        """创建备用简化UI"""
        log_info("启动简化界面模式", 'ui.fallback')
        
        # 简单的顶部框架
        top_frame = tk.Frame(self.app.root, bg='lightgray')
        top_frame.pack(fill='x', padx=10, pady=5)
        
        # 路径输入
        tk.Label(top_frame, text="漫画路径:", bg='lightgray').pack(side='left')
        path_entry = tk.Entry(top_frame, textvariable=self.app.path_var, width=50)
        path_entry.pack(side='left', padx=5)
        
        # 按钮 - 移除快捷键提示
        tk.Button(top_frame, text="浏览", command=self.app.browse_folder).pack(side='left', padx=2)
        tk.Button(top_frame, text="扫描", command=self.app.scan_albums).pack(side='left', padx=2)
        tk.Button(top_frame, text="最近", command=self.app.show_recent_albums).pack(side='left', padx=2)
        tk.Button(top_frame, text="收藏", command=self.app.show_favorites).pack(side='left', padx=2)
        
        # 主内容区域
        main_frame = tk.Frame(self.app.root, bg='white')
        main_frame.pack(fill='both', expand=True, padx=10, pady=5)
        
        # 创建简单的漫画网格
        try:
            from .components.album_grid import AlbumGrid  # 从components导入
            self.app.album_grid = AlbumGrid(main_frame, self.app.open_album, self.app.toggle_favorite)
            self.app.album_grid.is_favorite = self.app.config_manager.is_favorite
            log_info("成功创建漫画网格组件", 'ui.fallback')
        except Exception as e:
            log_exception(f"创建简化漫画网格时出错: {e}", 'ui.fallback')
            # 创建最基本的显示
            self.app.album_grid = self._create_basic_album_display(main_frame)
        
        # 简单的状态显示
        self._create_simple_status_bar()
    
    def _create_basic_album_display(self, parent):
        """创建最基本的漫画显示"""
        app_instance = self.app  # 保存对主应用的引用
        logger = self.logger
        
        class BasicAlbumDisplay:
            def __init__(self, parent):
                self.parent = parent
                self.display_frame = tk.Frame(parent, bg='white')
                self.display_frame.pack(fill='both', expand=True)
                # 确保有grid_frame属性以保持兼容性
                self.grid_frame = self.display_frame
                log_info("创建基础漫画显示组件", 'ui.fallback')
            
            def display_albums(self, albums):
                """显示漫画列表（兼容性方法）"""
                self.update_albums(albums)
            
            def update_albums(self, albums):
                """更新漫画显示"""
                try:
                    # 清除现有内容
                    for widget in self.display_frame.winfo_children():
                        widget.destroy()
                    
                    if not albums or len(albums) == 0:
                        tk.Label(self.display_frame, text="暂无漫画", 
                               bg='white', fg='gray').pack(expand=True)
                        log_info("显示空漫画列表", 'ui.fallback')
                        return
                    
                    log_info(f"开始显示 {len(albums)} 个漫画", 'ui.fallback')
                    
                    # 简单列表显示
                    for album in albums:
                        try:
                            frame = tk.Frame(self.display_frame, bg='lightblue', relief='raised', bd=1)
                            frame.pack(fill='x', padx=5, pady=2)
                            
                            # 确保漫画信息完整
                            album_name = album.get('name', '未知漫画')
                            image_count = album.get('image_count', 0)
                            album_path = album.get('path', '')
                            
                            tk.Label(frame, text=f"{album_name} ({image_count} 张图片)", 
                                   bg='lightblue').pack(side='left', padx=10, pady=5)
                            
                            if album_path:
                                tk.Button(frame, text="打开", 
                                        command=lambda p=album_path: app_instance.open_album(p)).pack(side='right', padx=5)
                        except Exception as e:
                            log_error(f"显示漫画时出错: {e}", 'ui.fallback')
                            continue
                    
                    log_info(f"成功显示 {len(albums)} 个漫画", 'ui.fallback')
                except Exception as e:
                    log_exception(f"BasicAlbumDisplay.update_albums出错: {e}", 'ui.fallback')
        
        return BasicAlbumDisplay(parent)
    
    def _create_simple_status_bar(self):
        """创建简单的状态栏"""
        status_frame = tk.Frame(self.app.root, bg='lightgray', height=30)
        status_frame.pack(side='bottom', fill='x')
        status_frame.pack_propagate(False)
        
        self.app.status_var = tk.StringVar(value="使用简化界面模式")
        status_label = tk.Label(status_frame, textvariable=self.app.status_var, bg='lightgray')
        status_label.pack(side='left', padx=10, pady=5)
        
        # 创建一个简单的状态栏对象
        class SimpleStatusBar:
            def __init__(self, status_var):
                self.status_var = status_var
            def set_status(self, message):
                self.status_var.set(message)
            def set_info(self, message):
                pass  # 简化版本不显示额外信息
        
        self.app.status_bar = SimpleStatusBar(self.app.status_var)
