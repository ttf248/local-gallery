"""
漫画查看器管理器
TODO: 迁移到PyQt6
"""

import os
import sys
from pathlib import Path

# Add src to path if not already there
src_path = Path(__file__).parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from utils.image_utils import ImageProcessor
from utils.logger import get_logger, log_info, log_warning, log_error, log_exception

class AlbumViewerManager:
    """漫画查看器管理器 - 待迁移到PyQt6"""

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
                # TODO: 迁移到PyQt6消息框
                print("该文件夹中没有找到图片")
                return

            log_info(f"找到 {len(image_files)} 张图片", 'core.viewer')

            # 添加到最近浏览
            self.app.config_manager.add_recent_album(folder_path)

            # TODO: 迁移到PyQt6
            # 创建图片查看器窗口
            log_info("图片查看器功能需要迁移到PyQt6", 'core.viewer')

            # 更新主窗口状态
            album_name = os.path.basename(folder_path)
            # TODO: 适配PyQt6主窗口
            # self.app.status_bar.set_status(f"已打开漫画: {album_name}")
            # self.app.status_bar.set_info(f"{len(image_files)} 张图片")

            log_info(f"漫画查看: {album_name} ({len(image_files)} 张图片)", 'core.viewer')

        except Exception as e:
            log_exception(f"打开漫画时发生错误: {e}", 'core.viewer')
            # TODO: 迁移到PyQt6消息框
            print(f"打开漫画时发生错误: {e}")
            # self.app.status_bar.set_status("打开漫画失败")
