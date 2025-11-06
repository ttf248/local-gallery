"""
漫画扫描服务
异步扫描文件夹中的图片
"""

import threading
import queue
from pathlib import Path
import sys

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))
from utils.image_utils import ImageProcessor

class AlbumScannerService:
    """漫画扫描服务 - 支持异步扫描"""

    def __init__(self, app):
        self.app = app
        self.scan_thread = None
        self.cancel_flag = False
        self.scan_progress = 0
        self.scan_status = ""
        # 线程安全的进度更新队列
        self.progress_queue = queue.Queue()
        self.scan_error = None  # 扫描错误存储

    def scan_albums(self):
        """扫描漫画 - 异步版本"""
        # 防止重复扫描
        if self.scan_thread and self.scan_thread.is_alive():
            print("扫描正在进行中，请稍候...")
            return

        folder_path = self.app.folder_path
        if not folder_path:
            print("请先选择漫画文件夹")
            return

        # 使用pathlib验证路径
        path_obj = Path(folder_path)
        if not path_obj.exists():
            print("所选文件夹不存在")
            return

        # 重置取消标志
        self.cancel_flag = False

        # 启动异步扫描线程
        self.scan_thread = threading.Thread(
            target=self._scan_worker,
            args=(str(path_obj),),
            daemon=True
        )
        self.scan_thread.start()

        # 启动进度更新定时器
        self._update_progress_loop()

    def _scan_worker(self, folder_path):
        """扫描工作线程"""
        try:
            # 定义进度回调函数 - 使用线程安全队列
            def progress_callback(progress, status):
                # 将进度更新放入队列，UI线程会定期检查队列
                self.progress_queue.put((progress, status))

            # 执行扫描
            albums = ImageProcessor.scan_albums(folder_path, progress_callback)

            if self.cancel_flag:
                # 扫描被取消
                self.progress_queue.put((0, "扫描已取消"))
                return

            # 扫描完成，保存结果
            self.app.albums = albums
            self.progress_queue.put((100, f"扫描完成，找到 {len(albums)} 个项目"))

        except Exception as e:
            # 扫描出错
            self.scan_error = e
            self.progress_queue.put((0, f"扫描出错: {str(e)}"))

    def _update_progress_loop(self):
        """更新进度循环 - 从线程安全队列中读取进度"""
        if self.cancel_flag:
            return

        # 处理队列中的所有进度更新
        try:
            while True:
                try:
                    progress, status = self.progress_queue.get_nowait()
                    self.scan_progress = progress
                    self.scan_status = status
                except queue.Empty:
                    # 队列为空，退出循环
                    break
        except Exception as e:
            print(f"处理进度更新时出错: {e}")

        # 更新状态栏（只在有更新时）
        if hasattr(self, 'scan_status') and hasattr(self.app, 'status_bar'):
            self.app.status_bar.set_status(self.scan_status, "info")
            if self.scan_progress > 0:
                self.app.status_bar.set_info(f"进度: {self.scan_progress}%")

            # 如果扫描完成，更新UI
            if self.scan_progress >= 100:
                self._on_scan_complete()
                return

        # 继续检查队列（直到扫描完成）
        if not self.cancel_flag and self.scan_progress < 100:
            # 使用QTimer替代tkinter的after
            from PyQt6.QtCore import QTimer
            QTimer.singleShot(100, self._update_progress_loop)

    def cancel_scan(self):
        """取消当前扫描"""
        self.cancel_flag = True
        if hasattr(self.app, 'status_bar'):
            self.app.status_bar.set_status("扫描已取消", "warning")

    def _on_scan_complete(self):
        """扫描完成后的处理"""
        if hasattr(self.app, 'albums') and self.app.albums:
            # 更新相册网格
            if hasattr(self.app, 'album_grid'):
                self.app.album_grid.update_albums(self.app.albums)

            # 更新状态栏
            if hasattr(self.app, 'status_bar'):
                folder_name = Path(self.app.folder_path).name
                if len(folder_name) > 30:
                    display_name = folder_name[:27] + "..."
                else:
                    display_name = folder_name

                total_images = sum(len(album.get('image_files', [])) for album in self.app.albums)
                self.app.status_bar.set_status(f"扫描完成: {display_name} ({len(self.app.albums)} 个漫画)", "success")
                self.app.status_bar.set_info(f"共 {total_images} 张图片")
