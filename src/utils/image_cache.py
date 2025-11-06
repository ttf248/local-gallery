import os
import hashlib
import threading
import queue
import heapq
import itertools
from pathlib import Path
from PIL import Image, ImageTk
from concurrent.futures import ThreadPoolExecutor
from .logger import get_logger, log_info, log_error, log_exception

class PriorityLoadQueue:
    """优化的优先级加载队列 - 使用堆而不是重建队列"""

    def __init__(self):
        self.queue = []  # 最小堆
        self.entry_finder = {}  # 快速查找
        self.counter = itertools.count()  # 用于处理相同优先级的任务

    def put(self, item, priority=0):
        """添加任务到队列（带优先级）"""
        if item in self.entry_finder:
            self.remove(item)
        count = next(self.counter)
        entry = [priority, count, item]
        self.entry_finder[item] = entry
        heapq.heappush(self.queue, entry)

    def remove(self, item):
        """从队列中移除任务"""
        entry = self.entry_finder.pop(item)
        entry[-1] = '__removed__'

    def get(self, timeout=None):
        """从队列获取任务"""
        if not self.queue:
            raise queue.Empty
        while self.queue:
            priority, count, item = heapq.heappop(self.queue)
            if item != '__removed__':
                del self.entry_finder[item]
                return item
        raise queue.Empty

    def get_nowait(self):
        """非阻塞获取任务"""
        return self.get(timeout=0)

    def empty(self):
        """检查队列是否为空"""
        return len(self.entry_finder) == 0

    def qsize(self):
        """获取队列大小"""
        return len(self.entry_finder)


class ImageCache:
    """异步图片缓存管理器"""

    def __init__(self, cache_dir=None, max_memory_items=100, max_workers=2):
        """初始化缓存管理器

        Args:
            cache_dir: 磁盘缓存目录
            max_memory_items: 内存中最大缓存项数
            max_workers: 最大工作线程数
        """
        self.logger = get_logger('image_cache')

        # 缓存目录
        if cache_dir is None:
            cache_dir = Path.home() / '.comic_reader' / 'cache'
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        # 内存缓存 - LRU实现
        self.memory_cache = {}
        self.access_order = []
        self.max_memory_items = max_memory_items

        # 异步加载队列 - 使用优化的优先级队列
        self.load_queue = PriorityLoadQueue()
        self.executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix='ImageCache')
        
        # 回调管理
        self.callbacks = {}  # {cache_key: [callback_list]}
        self.loading_set = set()  # 正在加载的项目
        
        # 启动工作线程
        self._start_workers()
        
        log_info(f"图片缓存管理器初始化完成，缓存目录: {self.cache_dir}", 'image_cache')
    
    def _start_workers(self):
        """启动工作线程"""
        for i in range(2):  # 启动2个工作线程
            thread = threading.Thread(target=self._worker, daemon=True)
            thread.start()
    
    def _worker(self):
        """工作线程主循环"""
        while True:
            try:
                task = self.load_queue.get(timeout=1)
                # 检查是否是哨兵对象（退出信号）
                if task[0] is None and task[1] is None and task[2] is None:
                    break

                self._process_load_task(task)
            except queue.Empty:
                continue
            except Exception as e:
                log_error(f"工作线程处理任务时出错: {e}", 'image_cache')
    
    def _process_load_task(self, task):
        """处理加载任务"""
        try:
            image_path, size, cache_key = task
            
            # 检查磁盘缓存
            cached_path = self._get_cache_path(cache_key)
            
            if cached_path.exists():
                # 从磁盘缓存加载
                try:
                    with Image.open(cached_path) as img:
                        photo = ImageTk.PhotoImage(img)
                        self._cache_loaded_image(cache_key, photo)
                        return
                except Exception as e:
                    log_error(f"从磁盘缓存加载图片失败: {e}", 'image_cache')
                    # 删除损坏的缓存文件
                    cached_path.unlink(missing_ok=True)
            
            # 从原始文件加载
            self._load_and_cache_image(image_path, size, cache_key, cached_path)
            
        except Exception as e:
            log_exception(f"处理加载任务时出错: {e}", 'image_cache')
            self._notify_load_error(cache_key, e)
        finally:
            self.loading_set.discard(cache_key)
    
    def _load_and_cache_image(self, image_path, size, cache_key, cached_path):
        """加载并缓存图片"""
        try:
            # 安全地加载图片
            with Image.open(image_path) as img:
                # 检查图片尺寸是否合理
                width, height = img.size
                max_pixels = 50 * 1024 * 1024  # 50兆像素
                if width * height > max_pixels:
                    raise ValueError(f"图片尺寸超出限制: {width*height} > {max_pixels}")
                
                # 安全加载图片
                img.load()
                original_img = img.copy()
            
            # 创建缩略图
            thumbnail = original_img.copy()
            thumbnail.thumbnail(size, Image.Resampling.LANCZOS)
            
            # 保存到磁盘缓存
            try:
                thumbnail.save(cached_path, 'PNG', optimize=True)
            except Exception as e:
                log_error(f"保存缓存文件失败: {e}", 'image_cache')
            
            # 创建PhotoImage并缓存到内存
            photo = ImageTk.PhotoImage(thumbnail)
            self._cache_loaded_image(cache_key, photo)
            
        except Exception as e:
            log_error(f"加载图片失败 {image_path}: {e}", 'image_cache')
            self._notify_load_error(cache_key, e)
    
    def _cache_loaded_image(self, cache_key, photo):
        """将加载的图片缓存到内存并通知回调"""
        # 缓存到内存
        self._add_to_memory_cache(cache_key, photo)
        
        # 通知所有等待的回调
        if cache_key in self.callbacks:
            callbacks = self.callbacks.pop(cache_key, [])
            for callback in callbacks:
                try:
                    # 在主线程中执行回调
                    callback[0].after_idle(callback[1], photo)
                except Exception as e:
                    log_error(f"执行回调时出错: {e}", 'image_cache')
    
    def _notify_load_error(self, cache_key, error):
        """通知加载错误"""
        if cache_key in self.callbacks:
            callbacks = self.callbacks.pop(cache_key, [])
            for callback in callbacks:
                try:
                    # 在主线程中执行错误回调
                    if len(callback) > 2 and callback[2]:
                        callback[0].after_idle(callback[2], error)
                except Exception as e:
                    log_error(f"执行错误回调时出错: {e}", 'image_cache')
    
    def _add_to_memory_cache(self, key, value):
        """添加到内存缓存（LRU）"""
        if key in self.memory_cache:
            # 更新访问顺序
            self.access_order.remove(key)
        elif len(self.memory_cache) >= self.max_memory_items:
            # 移除最久未使用的项
            oldest_key = self.access_order.pop(0)
            del self.memory_cache[oldest_key]
        
        self.memory_cache[key] = value
        self.access_order.append(key)
    
    def _get_from_memory_cache(self, key):
        """从内存缓存获取（更新LRU）"""
        if key in self.memory_cache:
            # 更新访问顺序
            self.access_order.remove(key)
            self.access_order.append(key)
            return self.memory_cache[key]
        return None
    
    def _get_cache_path(self, cache_key):
        """获取缓存文件路径"""
        return self.cache_dir / f"{cache_key}.png"
    
    def _generate_cache_key(self, image_path, size):
        """生成缓存键"""
        # 使用文件路径、修改时间和尺寸生成唯一键
        try:
            stat = os.stat(image_path)
            key_data = f"{image_path}_{stat.st_mtime}_{size[0]}x{size[1]}"
            return hashlib.md5(key_data.encode()).hexdigest()
        except Exception:
            # 如果获取文件信息失败，使用路径和尺寸
            key_data = f"{image_path}_{size[0]}x{size[1]}"
            return hashlib.md5(key_data.encode()).hexdigest()
    
    def load_image_async(self, image_path, size, widget, success_callback, error_callback=None):
        """异步加载图片
        
        Args:
            image_path: 图片路径
            size: 目标尺寸 (width, height)
            widget: 用于在主线程中执行回调的widget
            success_callback: 成功回调 callback(photo)
            error_callback: 错误回调 callback(error)
        """
        cache_key = self._generate_cache_key(image_path, size)
        
        # 检查内存缓存
        cached_photo = self._get_from_memory_cache(cache_key)
        if cached_photo:
            # 立即执行回调
            widget.after_idle(success_callback, cached_photo)
            return
        
        # 添加到回调列表
        if cache_key not in self.callbacks:
            self.callbacks[cache_key] = []
        self.callbacks[cache_key].append((widget, success_callback, error_callback))
        
        # 如果还没有开始加载，添加到队列
        if cache_key not in self.loading_set:
            self.loading_set.add(cache_key)
            task = (image_path, size, cache_key)
            self.load_queue.put(task)
    
    def clear_memory_cache(self):
        """清空内存缓存"""
        self.memory_cache.clear()
        self.access_order.clear()
        log_info("内存缓存已清空", 'image_cache')
    
    def clear_disk_cache(self):
        """清空磁盘缓存"""
        try:
            import shutil
            shutil.rmtree(self.cache_dir)
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            log_info("磁盘缓存已清空", 'image_cache')
        except Exception as e:
            log_error(f"清空磁盘缓存失败: {e}", 'image_cache')
    
    def get_cache_size(self):
        """获取缓存大小信息"""
        memory_size = len(self.memory_cache)
        disk_size = 0
        disk_files = 0
        
        try:
            for cache_file in self.cache_dir.glob('*.png'):
                disk_files += 1
                disk_size += cache_file.stat().st_size
        except Exception as e:
            log_error(f"计算磁盘缓存大小失败: {e}", 'image_cache')
        
        return {
            'memory_items': memory_size,
            'disk_files': disk_files,
            'disk_size_mb': disk_size / (1024 * 1024)
        }
    
    def shutdown(self):
        """关闭缓存管理器"""
        try:
            # 停止工作线程
            for _ in range(2):
                try:
                    # 使用哨兵对象停止线程
                    self.load_queue.put((None, None, None), priority=-999)
                except Exception as e:
                    log_error(f"停止工作线程时出错: {e}", 'image_cache')
            
            # 关闭线程池
            try:
                self.executor.shutdown(wait=True)
            except Exception as e:
                log_error(f"关闭线程池时出错: {e}", 'image_cache')
            
            # 清理回调
            try:
                self.callbacks.clear()
                self.loading_set.clear()
            except Exception as e:
                log_error(f"清理回调时出错: {e}", 'image_cache')
            
            log_info("图片缓存管理器已关闭", 'image_cache')
            
        except Exception as e:
            log_error(f"关闭缓存管理器时出错: {e}", 'image_cache')

    def preload_images(self, image_paths, size, widget, priority=False):
        """预加载图片列表（批量加载）

        Args:
            image_paths: 图片路径列表
            size: 目标尺寸 (width, height)
            widget: 用于在主线程中执行回调的widget
            priority: 是否优先加载
        """
        try:
            preload_count = 0
            # 优先级：数值越小优先级越高（使用堆队列）
            priority_value = -1 if priority else 0

            for image_path in image_paths:
                try:
                    cache_key = self._generate_cache_key(image_path, size)

                    # 检查是否已在内存缓存中
                    if cache_key in self.memory_cache:
                        continue

                    # 检查是否正在加载
                    if cache_key in self.loading_set:
                        continue

                    # 添加到加载队列
                    self.loading_set.add(cache_key)
                    task = (image_path, size, cache_key)

                    # 使用优先级添加任务（O(log n)而不是O(n)）
                    self.load_queue.put(task, priority=priority_value)

                    preload_count += 1

                except Exception as e:
                    log_error(f"添加预加载任务失败 {image_path}: {e}", 'image_cache')
                    continue

            log_info(f"预加载 {preload_count} 张图片，优先级: {priority}", 'image_cache')

        except Exception as e:
            log_error(f"预加载图片失败: {e}", 'image_cache')

    def preload_album_covers(self, album_paths, size=(320, 350), widget=None):
        """预加载相册封面
        
        Args:
            album_paths: 相册路径列表
            size: 封面尺寸
            widget: widget引用
        """
        try:
            cover_paths = []
            for album_path in album_paths:
                try:
                    # 查找每个相册的第一张图片
                    cover_path = self._find_album_cover(album_path)
                    if cover_path:
                        cover_paths.append(cover_path)
                except Exception as e:
                    log_error(f"查找相册封面失败 {album_path}: {e}", 'image_cache')
                    continue
            
            if cover_paths:
                # 使用低优先级预加载封面
                self.preload_images(cover_paths, size, widget or self._dummy_widget(), priority=False)
                log_info(f"开始预加载 {len(cover_paths)} 个相册封面", 'image_cache')
                
        except Exception as e:
            log_error(f"预加载相册封面失败: {e}", 'image_cache')
    
    def _find_album_cover(self, album_path):
        """查找相册的封面图片"""
        try:
            image_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff'}
            
            # 按文件名排序查找第一张图片
            files = []
            for file in os.listdir(album_path):
                if any(file.lower().endswith(ext) for ext in image_extensions):
                    files.append(os.path.join(album_path, file))
            
            if files:
                files.sort()
                return files[0]
            
            return None
            
        except Exception as e:
            log_error(f"查找封面图片失败 {album_path}: {e}", 'image_cache')
            return None
    
    def _dummy_widget(self):
        """创建一个虚拟widget用于预加载"""
        try:
            import tkinter as tk
            dummy = tk.Frame()
            dummy.after_idle = lambda callback, *args: None  # 空回调
            return dummy
        except:
            return None

    def cleanup_old_cache(self, max_age_days=30):
        """清理过期的磁盘缓存文件"""
        try:
            import time
            current_time = time.time()
            max_age_seconds = max_age_days * 24 * 3600
            
            cleaned_count = 0
            cleaned_size = 0
            
            for cache_file in self.cache_dir.glob('*.png'):
                try:
                    file_stat = cache_file.stat()
                    file_age = current_time - file_stat.st_mtime
                    if file_age > max_age_seconds:
                        cleaned_size += file_stat.st_size
                        cache_file.unlink()
                        cleaned_count += 1
                except Exception as e:
                    log_error(f"删除缓存文件失败 {cache_file}: {e}", 'image_cache')
            
            if cleaned_count > 0:
                cleaned_mb = cleaned_size / (1024 * 1024)
                log_info(f"清理了 {cleaned_count} 个过期缓存文件，释放空间 {cleaned_mb:.1f}MB", 'image_cache')
            
            return cleaned_count
            
        except Exception as e:
            log_error(f"清理过期缓存失败: {e}", 'image_cache')
            return 0

    def get_cache_stats(self):
        """获取缓存统计信息"""
        try:
            memory_size = len(self.memory_cache)
            disk_size = 0
            disk_files = 0
            loading_count = len(self.loading_set)
            pending_callbacks = len(self.callbacks)
            
            try:
                for cache_file in self.cache_dir.glob('*.png'):
                    disk_files += 1
                    disk_size += cache_file.stat().st_size
            except Exception as e:
                log_error(f"计算磁盘缓存大小失败: {e}", 'image_cache')
            
            return {
                'memory_items': memory_size,
                'disk_files': disk_files,
                'disk_size_mb': disk_size / (1024 * 1024),
                'loading_count': loading_count,
                'pending_callbacks': pending_callbacks,
                'queue_size': self.load_queue.qsize()
            }
            
        except Exception as e:
            log_error(f"获取缓存统计失败: {e}", 'image_cache')
            return {}

# 全局缓存实例
_global_cache = None

def get_image_cache():
    """获取全局图片缓存实例"""
    global _global_cache
    if _global_cache is None:
        _global_cache = ImageCache()
    return _global_cache

def _create_fallback_cache():
    """创建备用缓存（当主缓存创建失败时）"""
    class FallbackCache:
        def load_image_async(self, image_path, size, widget, success_callback, error_callback=None):
            """简单的同步加载实现"""
            try:
                from PIL import Image, ImageTk
                with Image.open(image_path) as img:
                    img.thumbnail(size, Image.Resampling.LANCZOS)
                    photo = ImageTk.PhotoImage(img)
                    widget.after_idle(success_callback, photo)
            except Exception as e:
                if error_callback:
                    widget.after_idle(error_callback, e)
        
        def preload_images(self, image_paths, size, widget, priority=False):
            """备用缓存不支持预加载"""
            pass
        
        def preload_album_covers(self, album_paths, size=(320, 350), widget=None):
            """备用缓存不支持预加载"""
            pass
        
        def shutdown(self):
            pass
        
        def clear_memory_cache(self):
            pass
        
        def cleanup_old_cache(self, max_age_days=30):
            return 0
        
        def get_cache_stats(self):
            return {}
    
    return FallbackCache()
