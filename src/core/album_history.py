"""
漫画历史记录管理器
显示最近浏览的漫画
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

class AlbumHistoryManager:
    """漫画历史记录管理器"""

    def __init__(self, app):
        self.app = app
        self.logger = get_logger('core.history')

    def show_recent_albums(self):
        """显示最近浏览的漫画"""
        try:
            recent_paths = self.app.config_manager.get_recent_albums()
            if not recent_paths:
                self.app.status_bar.set_status("没有最近浏览的记录", "info")
                self.app.album_grid.show_empty_state()
                return

            # 构建相册数据
            albums = []
            for path in recent_paths:
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

            folder_name = "最近浏览"
            self.app.status_bar.set_status(f"显示 {len(albums)} 个最近浏览的漫画", "info")

        except Exception as e:
            log_exception(f"显示最近浏览失败: {e}", 'core.history')
            self.app.status_bar.set_status("显示最近浏览失败", "error")
