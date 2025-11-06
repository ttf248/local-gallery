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
            log_info("开始显示最近浏览", 'core.history')
            recent_paths = self.app.config_manager.get_recent_albums()
            log_info(f"获取到 {len(recent_paths)} 个最近浏览记录", 'core.history')

            if not recent_paths:
                log_info("没有最近浏览记录，显示空状态", 'core.history')
                self.app.status_bar.set_status("没有最近浏览的记录", "info")
                self.app.album_grid.show_empty_state()
                return

            # 构建相册数据
            albums = []
            valid_count = 0
            for path in recent_paths:
                log_debug(f"检查路径: {path}", 'core.history')
                if Path(path).exists():
                    image_files = ImageProcessor.get_image_files(path)
                    log_debug(f"  - 找到 {len(image_files)} 张图片", 'core.history')
                    album = {
                        'name': Path(path).name,
                        'folder_name': Path(path).name,
                        'path': path,
                        'folder_path': path,
                        'image_files': image_files
                    }
                    albums.append(album)
                    valid_count += 1
                else:
                    log_warning(f"最近浏览路径不存在: {path}", 'core.history')

            log_info(f"有效最近浏览: {valid_count}/{len(recent_paths)}", 'core.history')

            # 更新UI
            self.app.album_grid.update_albums(albums)

            folder_name = "最近浏览"
            self.app.status_bar.set_status(f"显示 {len(albums)} 个最近浏览的漫画", "info")
            log_info(f"最近浏览显示完成: {len(albums)} 个项目", 'core.history')

        except Exception as e:
            log_exception(f"显示最近浏览失败: {e}", 'core.history')
            self.app.status_bar.set_status("显示最近浏览失败", "error")
