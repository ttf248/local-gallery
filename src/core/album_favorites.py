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

class AlbumFavoritesManager:
    """漫画收藏管理器"""
    
    def __init__(self, app):
        self.app = app
        self.logger = get_logger('core.favorites')
    
    def show_favorites(self):
        """显示收藏的漫画"""
        log_info("开始显示收藏的漫画", 'core.favorites')
        favorites = self.app.config_manager.get_favorites()
        
        if not favorites:
            log_info("没有收藏记录", 'core.favorites')
            self._show_no_favorites_message()
            return
        
        log_info(f"找到 {len(favorites)} 个收藏记录", 'core.favorites')
        
        # 过滤存在的路径
        valid_albums = self._filter_valid_favorites(favorites)
        
        if valid_albums:
            log_info(f"有效的收藏记录: {len(valid_albums)} 个", 'core.favorites')
            self._display_favorite_albums(valid_albums)
        else:
            log_warning("所有收藏的漫画都不存在", 'core.favorites')
            messagebox.showinfo("提示", "收藏的漫画都不存在了")
            self.app.status_bar.set_status("收藏的漫画不存在")
    
    def _show_no_favorites_message(self):
        """显示无收藏的消息"""
        messagebox.showinfo("收藏夹", 
            "暂无收藏的漫画\n\n"
            "💡 使用方法：\n"
            "• 在漫画列表中点击 ⭐ 按钮收藏\n"
            "• 使用 Ctrl+F 快速访问收藏夹\n"
            "• 再次点击 ⭐ 按钮可取消收藏\n"
            "• 🏠 首页按钮返回扫描结果")
        log_info("显示无收藏提示", 'core.favorites')
    
    def _filter_valid_favorites(self, favorites):
        """过滤有效的收藏路径"""
        valid_albums = []
        for album_path in favorites:
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
                        log_info(f"验证有效收藏: {os.path.basename(album_path)} ({len(image_files)} 张图片)", 'core.favorites')
                else:
                    log_warning(f"收藏路径不存在: {album_path}", 'core.favorites')
            except Exception as e:
                log_error(f"处理收藏漫画时出错 {album_path}: {e}", 'core.favorites')
                continue
        return valid_albums
    
    def _display_favorite_albums(self, valid_albums):
        """显示有效的收藏漫画"""
        self.app.albums = valid_albums
        self.app.album_grid.display_albums(valid_albums)
        self.app.status_bar.set_status(f"显示 {len(valid_albums)} 个收藏的漫画")
        total_images = sum(len(album['image_files']) for album in valid_albums)
        self.app.status_bar.set_info(f"共 {total_images} 张图片")
        
        # 如果结果很多，提示滚动
        if len(valid_albums) > 10:
            self.app.status_bar.set_status(f"显示 {len(valid_albums)} 个收藏的漫画（支持滚动浏览）")
        
        log_info(f"成功显示收藏漫画: {len(valid_albums)} 个, 总图片数: {total_images}", 'core.favorites')
