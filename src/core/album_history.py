import os
import sys
from pathlib import Path
from tkinter import messagebox

# Add src to path if not already there
src_path = Path(__file__).parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from utils.image_utils import ImageProcessor
from utils.logger import get_logger, log_info, log_warning, log_error

class AlbumHistoryManager:
    """漫画历史记录管理器"""
    
    def __init__(self, app):
        self.app = app
        self.logger = get_logger('core.history')
    
    def show_recent_albums(self):
        """显示最近浏览的漫画"""
        log_info("开始显示最近浏览的漫画", 'core.history')
        recent_albums = self.app.config_manager.get_recent_albums()
        
        if not recent_albums:
            log_info("没有最近浏览记录", 'core.history')
            self._show_no_recent_message()
            return
        
        log_info(f"找到 {len(recent_albums)} 个最近浏览记录", 'core.history')
        
        # 过滤存在的路径
        valid_albums = self._filter_valid_albums(recent_albums)
        
        if valid_albums:
            log_info(f"有效的最近浏览记录: {len(valid_albums)} 个", 'core.history')
            self._display_recent_albums(valid_albums)
        else:
            log_warning("所有最近浏览的漫画都不存在", 'core.history')
            messagebox.showinfo("提示", "最近浏览的漫画都不存在了")
            self.app.status_bar.set_status("最近浏览的漫画不存在")
    
    def _show_no_recent_message(self):
        """显示无最近记录的消息"""
        messagebox.showinfo("最近浏览", 
            "暂无最近浏览的漫画\n\n"
            "💡 提示：\n"
            "• 打开任何漫画后会自动记录\n"
            "• 使用 Ctrl+R 快速访问最近浏览\n"
            "• 使用 Ctrl+F 管理收藏的漫画\n"
            "• 🏠 首页按钮返回扫描结果")
        log_info("显示无最近记录提示", 'core.history')
    
    def _filter_valid_albums(self, recent_albums):
        """过滤有效的漫画路径"""
        valid_albums = []
        for album_path in recent_albums:
            try:
                if os.path.exists(album_path):
                    image_files = ImageProcessor.get_image_files(album_path)
                    if image_files and len(image_files) > 0:
                        valid_albums.append({
                            'path': album_path,
                            'name': os.path.basename(album_path),
                            'image_files': image_files,
                            'cover_image': image_files[0],
                            'image_count': len(image_files),
                            'folder_size': ImageProcessor.get_folder_size(image_files)
                        })
                        log_info(f"验证有效: {os.path.basename(album_path)} ({len(image_files)} 张图片)", 'core.history')
                else:
                    log_warning(f"路径不存在: {album_path}", 'core.history')
            except Exception as e:
                log_error(f"处理最近漫画时出错 {album_path}: {e}", 'core.history')
                continue
        return valid_albums
    
    def _display_recent_albums(self, valid_albums):
        """显示有效的最近漫画"""
        self.app.albums = valid_albums
        self.app.album_grid.display_albums(valid_albums)
        self.app.status_bar.set_status(f"显示 {len(valid_albums)} 个最近浏览的漫画")
        total_images = sum(len(album['image_files']) for album in valid_albums)
        self.app.status_bar.set_info(f"共 {total_images} 张图片")
        
        # 如果结果很多，提示滚动
        if len(valid_albums) > 10:
            self.app.status_bar.set_status(f"显示 {len(valid_albums)} 个最近浏览的漫画（支持滚动浏览）")
        
        log_info(f"成功显示最近浏览漫画: {len(valid_albums)} 个, 总图片数: {total_images}", 'core.history')
