"""
漫画收藏管理器
显示收藏的漫画
"""

import os
import sys
from pathlib import Path

# Add src to path if not already there
src_path = Path(__file__).parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from utils.logger import get_logger, log_info, log_warning, log_error, log_exception
from utils.image_utils import ImageProcessor

class AlbumFavoritesManager:
    """漫画收藏管理器"""

    def __init__(self, app):
        self.app = app
        self.logger = get_logger('core.favorites')

    def show_favorites(self):
        """显示收藏的漫画"""
        try:
            favorite_paths = self.app.config_manager.get_favorites()
            if not favorite_paths:
                self.app.status_bar.set_status("没有收藏的漫画", "info")
                self.app.album_grid.show_empty_state()
                return

            # 构建相册数据
            albums = []
            for path in favorite_paths:
                if Path(path).exists():
                    album = {
                        'name': Path(path).name,
                        'folder_name': Path(path).name,
                        'path': path,
                        'folder_path': path,
                        'image_files': ImageProcessor.get_image_files(path)
                    }
                    albums.append(album)

            # 更新UI
            self.app.album_grid.update_albums(albums)

            folder_name = "我的收藏"
            self.app.status_bar.set_status(f"显示 {len(albums)} 个收藏的漫画", "info")

        except Exception as e:
            log_exception(f"显示收藏失败: {e}", 'core.favorites')
            self.app.status_bar.set_status("显示收藏失败", "error")
