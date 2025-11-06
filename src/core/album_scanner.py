"""
漫画扫描服务
异步扫描文件夹中的图片
"""

import threading
import queue
from pathlib import Path
import sys
import traceback

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))
from utils.image_utils import ImageProcessor
from utils.logger import get_logger, log_info, log_warning, log_error, log_exception, log_debug

class AlbumScannerService:
    """漫画扫描服务 - 支持异步扫描"""

    def __init__(self, app, config_manager=None):
        self.app = app
        self.config_manager = config_manager
        self.logger = get_logger('core.scanner')
        self.scan_thread = None
        self.cancel_flag = False
        self.scan_progress = 0
        self.scan_status = ""
        # 线程安全的进度更新队列
        self.progress_queue = queue.Queue()
        self.scan_error = None  # 扫描错误存储
        log_debug("AlbumScannerService 初始化完成", 'core.scanner')

    def scan_albums(self):
        """扫描漫画 - 异步版本"""
        log_info("开始扫描漫画", 'core.scanner')

        # 防止重复扫描
        if self.scan_thread and self.scan_thread.is_alive():
            log_warning("扫描正在进行中，跳过新请求", 'core.scanner')
            return

        folder_path = self.app.folder_path
        if not folder_path:
            log_warning("未选择漫画文件夹，无法扫描", 'core.scanner')
            return

        # 使用pathlib验证路径
        path_obj = Path(folder_path)
        if not path_obj.exists():
            log_error(f"所选文件夹不存在: {folder_path}", 'core.scanner')
            return

        log_info(f"扫描文件夹: {folder_path}", 'core.scanner')

        # 重置取消标志
        self.cancel_flag = False
        self.scan_error = None
        self.scan_progress = 0
        self.scan_status = "初始化中..."

        # 启动异步扫描线程
        log_debug(f"启动扫描线程: {path_obj}", 'core.scanner')
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
        thread_id = threading.get_ident()
        log_info(f"[线程 {thread_id}] 开始扫描工作", 'core.scanner')

        try:
            # 定义进度回调函数 - 使用线程安全队列
            def progress_callback(progress, status):
                # 将进度更新放入队列，UI线程会定期检查队列
                log_debug(f"[线程 {thread_id}] 进度更新: {progress}% - {status}", 'core.scanner')
                self.progress_queue.put((progress, status))

            # 获取扫描配置
            scan_config = self._get_scan_config()
            log_info(f"[线程 {thread_id}] 扫描配置: {scan_config}", 'core.scanner')

            # 执行扫描 - 传递配置参数
            log_info(f"[线程 {thread_id}] 开始扫描图片...", 'core.scanner')
            albums = ImageProcessor.scan_albums(
                folder_path,
                progress_callback,
                recursive=scan_config['recursive'],
                include_hidden=scan_config['include_hidden'],
                image_formats=scan_config['image_formats']
            )

            if self.cancel_flag:
                # 扫描被取消
                log_warning(f"[线程 {thread_id}] 扫描被取消", 'core.scanner')
                self.progress_queue.put((0, "扫描已取消"))
                return

            # 扫描完成，保存结果
            log_info(f"[线程 {thread_id}] 扫描完成，找到 {len(albums)} 个项目", 'core.scanner')

            # 详细统计信息
            collections = [item for item in albums if item.get('type') == 'collection']
            smart_collections = [item for item in albums if item.get('type') == 'smart_collection']
            single_albums = [item for item in albums if item.get('type') == 'album']

            if collections:
                log_info(f"[线程 {thread_id}] 找到 {len(collections)} 个合集", 'core.scanner')
            if smart_collections:
                log_info(f"[线程 {thread_id}] 找到 {len(smart_collections)} 个智能分组", 'core.scanner')
            if single_albums:
                log_info(f"[线程 {thread_id}] 找到 {len(single_albums)} 个独立相册", 'core.scanner')

            self.app.albums = albums
            self.progress_queue.put((100, f"扫描完成，找到 {len(albums)} 个项目"))

        except Exception as e:
            # 扫描出错 - 记录详细错误信息
            self.scan_error = e
            log_exception(f"[线程 {thread_id}] 扫描漫画时发生错误: {str(e)}", 'core.scanner')
            log_error(f"[线程 {thread_id}] 错误类型: {type(e).__name__}", 'core.scanner')
            log_error(f"[线程 {thread_id}] 错误详情: {traceback.format_exc()}", 'core.scanner')
            self.progress_queue.put((0, f"扫描出错: {str(e)}"))

            # 使用新的状态栏功能
            if hasattr(self.app, 'status_bar'):
                self.app.status_bar.show_error(str(e))

    def _update_progress_loop(self):
        """更新进度循环 - 从线程安全队列中读取进度"""
        if self.cancel_flag:
            log_debug("取消标志已设置，停止进度更新", 'core.scanner')
            return

        # 处理队列中的所有进度更新
        try:
            processed_count = 0
            while True:
                try:
                    progress, status = self.progress_queue.get_nowait()
                    self.scan_progress = progress
                    self.scan_status = status
                    processed_count += 1
                    log_debug(f"处理进度: {progress}% - {status}", 'core.scanner')
                except queue.Empty:
                    # 队列为空，退出循环
                    break

            if processed_count > 0:
                log_info(f"进度更新: {self.scan_progress}% - {self.scan_status}", 'core.scanner')

        except Exception as e:
            log_exception(f"处理进度更新时出错: {str(e)}", 'core.scanner')

        # 更新状态栏（只在有更新时）
        if hasattr(self, 'scan_status') and hasattr(self.app, 'status_bar'):
            # 使用新的状态栏功能
            if self.scan_progress > 0 and self.scan_progress < 100:
                self.app.status_bar.show_scan_progress(self.scan_progress, self.scan_status)
                log_debug(f"更新状态栏: {self.scan_status} ({self.scan_progress}%)", 'core.scanner')
            else:
                self.app.status_bar.set_status(self.scan_status, "info")

            # 如果扫描完成，更新UI
            if self.scan_progress >= 100:
                log_info("扫描完成，触发UI更新", 'core.scanner')
                self._on_scan_complete()
                return

        # 继续检查队列（直到扫描完成）
        if not self.cancel_flag and self.scan_progress < 100:
            # 使用QTimer替代tkinter的after
            from PyQt6.QtCore import QTimer
            QTimer.singleShot(100, self._update_progress_loop)
            log_debug("调度下一次进度更新", 'core.scanner')

    def cancel_scan(self):
        """取消当前扫描"""
        log_warning("取消扫描请求", 'core.scanner')
        self.cancel_flag = True
        if hasattr(self.app, 'status_bar'):
            self.app.status_bar.set_status("扫描已取消", "warning")

    def _on_scan_complete(self):
        """扫描完成后的处理"""
        log_debug("扫描完成回调", 'core.scanner')

        if self.cancel_flag:
            log_debug("扫描被取消，不执行完成处理", 'core.scanner')
            return

        # 检查是否有错误 - 正确检查None值
        if getattr(self, 'scan_error', None) is not None:
            log_error("扫描过程中出现错误，调用错误处理", 'core.scanner')
            self._handle_scan_error(self.scan_error)
            return

        # 检查是否有结果
        if not self.app.albums:
            log_warning("未找到任何相册", 'core.scanner')
            self._handle_no_albums_found()
            return

        # 显示结果 - 恢复完整的合集处理逻辑
        log_info("开始显示扫描结果", 'core.scanner')
        self._display_scan_results()

    def _handle_no_albums_found(self):
        """处理未找到漫画的情况"""
        log_warning("未找到任何漫画相册", 'core.scanner')
        if hasattr(self.app, 'status_bar'):
            self.app.status_bar.set_status("未找到漫画", "info")
            self.app.status_bar.set_info("")
        if hasattr(self.app, 'album_grid'):
            self.app.album_grid.show_empty_state()

    def _display_scan_results(self):
        """显示扫描结果 - 支持合集、智能分组和相册"""
        log_info("开始显示扫描结果", 'core.scanner')
        try:
            if not hasattr(self.app, 'album_grid'):
                log_error("album_grid组件不存在，无法显示结果", 'core.scanner')
                return

            # 更新相册网格
            if self.app.albums is not None:
                log_info(f"更新相册网格，显示 {len(self.app.albums)} 个项目", 'core.scanner')
                self.app.album_grid.update_albums(self.app.albums)
            else:
                log_error("albums为None，无法显示", 'core.scanner')
                return

            # 缓存扫描结果
            if self.app.folder_path:
                self.app.cached_scan_results = self.app.albums.copy() if self.app.albums else []
                self.app.cached_scan_path = self.app.folder_path
                self.app.current_view_state = "scan"
                log_debug("缓存扫描结果", 'core.scanner')

            # 统计不同类型的项目
            collections = [item for item in self.app.albums if item.get('type') == 'collection']
            smart_collections = [item for item in self.app.albums if item.get('type') == 'smart_collection']
            albums = [item for item in self.app.albums if item.get('type') == 'album']

            # 计算总图片数
            total_images = 0
            for item in self.app.albums:
                if item.get('type') in ['collection', 'smart_collection']:
                    total_images += item.get('image_count', 0)
                else:
                    total_images += len(item.get('image_files', []))

            log_info(f"统计结果: 总计 {len(self.app.albums)} 个项目, {total_images} 张图片", 'core.scanner')

            # 使用新的状态栏功能
            if hasattr(self.app, 'status_bar'):
                # 统计各类型中包含的相册数
                collection_albums = sum(item.get('album_count', 0) for item in collections)
                smart_albums = sum(item.get('album_count', 0) for item in smart_collections)

                # 使用show_scan_complete显示完成信息
                self.app.status_bar.show_scan_complete(len(self.app.albums), total_images)

                # 设置详细信息
                info_parts = []
                if collections:
                    info_parts.append(f"📚 合集: {len(collections)} ({collection_albums} 个相册)")
                if smart_collections:
                    info_parts.append(f"🧠 智能分组: {len(smart_collections)} ({smart_albums} 个相册)")
                if albums:
                    info_parts.append(f"📖 相册: {len(albums)}")

                if info_parts:
                    info_text = " | ".join(info_parts)
                    self.app.status_bar.set_operation(info_text, "success")
                    log_info(f"状态栏更新: {info_text}", 'core.scanner')

        except Exception as e:
            log_exception(f"显示扫描结果时出错: {str(e)}", 'core.scanner')
            if hasattr(self.app, 'status_bar'):
                self.app.status_bar.set_status("显示结果时出错", "error")

    def _get_scan_config(self):
        """获取扫描配置"""
        if not self.config_manager:
            # 使用默认值
            log_info("使用默认扫描配置", 'core.scanner')
            return {
                'recursive': True,
                'include_hidden': False,
                'image_formats': ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff']
            }

        config = {
            'recursive': self.config_manager.get_scan_recursive(),
            'include_hidden': self.config_manager.get_scan_hidden_folders(),
            'image_formats': [f'.{fmt.lower()}' for fmt in self.config_manager.get_image_formats()]
        }
        log_info(f"从配置管理器获取扫描配置: {config}", 'core.scanner')
        return config

    def _handle_scan_error(self, error):
        """处理扫描错误"""
        if error is None:
            log_error("扫描错误信息为None，请检查代码逻辑", 'core.scanner')
            if hasattr(self.app, 'status_bar'):
                self.app.status_bar.set_status("扫描过程发生未知错误", "error")
            return

        log_exception(f"扫描漫画时发生错误: {str(error)}", 'core.scanner')
        log_error(f"错误类型: {type(error).__name__}", 'core.scanner')

        if hasattr(self.app, 'status_bar'):
            self.app.status_bar.set_status("扫描失败", "error")
            self.app.status_bar.set_info("")

        # 尝试记录更多错误上下文
        if hasattr(self, 'scan_thread') and self.scan_thread:
            log_error(f"扫描线程ID: {self.scan_thread.ident}", 'core.scanner')
        if hasattr(self, 'app') and self.app and hasattr(self.app, 'folder_path'):
            log_error(f"扫描路径: {self.app.folder_path}", 'core.scanner')
