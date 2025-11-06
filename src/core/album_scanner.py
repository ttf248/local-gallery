import threading
import queue
from tkinter import messagebox
from pathlib import Path
from src.utils.image_utils import ImageProcessor

class AlbumScannerService:
    """漫画扫描服务 - 支持异步扫描"""

    def __init__(self, app):
        self.app = app
        self.scan_thread = None
        self.cancel_flag = False
        self.scan_progress = 0
        self.scan_status = ""

    def scan_albums(self):
        """扫描漫画 - 异步版本"""
        # 防止重复扫描
        if self.scan_thread and self.scan_thread.is_alive():
            messagebox.showinfo("提示", "扫描正在进行中，请稍候...")
            return

        folder_path = self.app.path_var.get().strip()
        if not folder_path:
            messagebox.showwarning("提示", "请先选择漫画文件夹\n\n💡 快捷键提示：\n• Ctrl+O: 选择文件夹\n• F5: 快速扫描")
            return

        # 使用pathlib验证路径
        path_obj = Path(folder_path)
        if not path_obj.exists():
            messagebox.showerror("错误", "所选文件夹不存在")
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
            # 定义进度回调函数
            def progress_callback(progress, status):
                self.scan_progress = progress
                self.scan_status = status

            # 执行扫描
            albums = ImageProcessor.scan_albums(folder_path, progress_callback)

            if self.cancel_flag:
                # 扫描被取消
                self.scan_status = "扫描已取消"
                return

            # 扫描完成，保存结果
            self.app.albums = albums
            self.scan_status = "扫描完成"
            self.scan_progress = 100

        except Exception as e:
            # 扫描出错
            self.scan_status = f"扫描出错: {str(e)}"
            self.scan_error = e

    def _update_progress_loop(self):
        """更新进度循环"""
        if self.cancel_flag:
            return

        # 更新状态栏
        if hasattr(self, 'scan_status'):
            self.app.status_bar.set_status(f"正在扫描漫画... {self.scan_progress}%")
            self.app.status_bar.set_info(self.scan_status)

        # 检查扫描是否完成
        if not self.scan_thread or not self.scan_thread.is_alive():
            # 扫描完成，处理结果
            self._handle_scan_complete()
            return

        # 继续更新
        self.app.root.after(100, self._update_progress_loop)

    def _handle_scan_complete(self):
        """处理扫描完成"""
        # 恢复鼠标指针
        self.app.root.config(cursor="")

        if self.cancel_flag:
            # 扫描被取消
            self.app.status_bar.set_status("扫描已取消")
            return

        # 检查是否有错误
        if hasattr(self, 'scan_error'):
            self._handle_scan_error(self.scan_error)
            return

        # 检查是否有结果
        if not self.app.albums:
            self._handle_no_albums_found()
            return

        # 显示结果
        self._display_scan_results()

    def cancel_scan(self):
        """取消扫描"""
        self.cancel_flag = True
        self.app.status_bar.set_status("正在取消扫描...")
    
    def _handle_no_albums_found(self):
        """处理未找到漫画的情况"""
        messagebox.showinfo("提示", "在所选文件夹中未找到包含图片的子文件夹")
        self.app.status_bar.set_status("未找到漫画")
        self.app.status_bar.set_info("")
        self.app.album_grid.display_albums([])
        
        # 清除缓存
        self.app.cached_scan_results = None
        self.app.cached_scan_path = None
    
    def _display_scan_results(self):
        """显示扫描结果 - 支持合集、智能分组和相册"""
        self.app.album_grid.display_albums(self.app.albums)

        # 缓存扫描结果
        current_path = self.app.path_var.get().strip()
        if current_path:
            self.app.cached_scan_results = self.app.albums.copy()
            self.app.cached_scan_path = current_path
            self.app.current_view_state = "scan"

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

        # 统计各类型中包含的相册数
        collection_albums = sum(item.get('album_count', 0) for item in collections)
        smart_albums = sum(item.get('album_count', 0) for item in smart_collections)

        # 使用详细的状态设置方法
        self.app.status_bar.set_detailed_scan_results(
            collections=len(collections),
            smart_collections=len(smart_collections),
            albums=len(albums),
            total_images=total_images,
            collection_albums=collection_albums,
            smart_albums=smart_albums
        )

        # 更新面包屑
        folder_name = os.path.basename(current_path) if current_path else "扫描结果"
        if hasattr(self.app, 'nav_bar'):
            self.app.nav_bar.update_breadcrumb("scan", folder_name)

        # 启动智能预加载
        self.app.root.after(500, self.app._start_intelligent_preload)

        # 如果项目很多，提示用户可以滚动和使用快捷键
        if len(self.app.albums) > 15:
            tip_text = f"找到 {len(self.app.albums)} 个项目！\n\n"

            # 添加功能说明
            if collections or smart_collections:
                tip_text += "📚 功能说明：\n"
                if collections:
                    tip_text += "• 📚 合集：手动创建的相册集合\n"
                if smart_collections:
                    tip_text += "• 🧠 智能分组：基于名称相似度自动分组\n"
                tip_text += "• 点击可查看其中的相册\n\n"

            tip_text += ("📋 浏览提示：\n"
                        "• 使用鼠标滚轮浏览所有内容\n"
                        "• 🏠 首页按钮返回扫描结果\n"
                        "• Ctrl+R 查看最近浏览的漫画\n"
                        "• Ctrl+F 管理收藏的漫画\n"
                        "• F5 重新扫描当前文件夹")
            messagebox.showinfo("扫描完成", tip_text)
    
    def _handle_scan_error(self, error):
        """处理扫描错误"""
        error_msg = f"扫描漫画时发生错误：{str(error)}"
        print(error_msg)
        messagebox.showerror("错误", error_msg)
        self.app.status_bar.set_status("扫描失败")
        self.app.status_bar.set_info("")
