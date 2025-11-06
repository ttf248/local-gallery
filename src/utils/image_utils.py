"""
简化的图片处理器 - 优化多线程扫描逻辑
移除复杂的锁机制和全局状态，简化智能分组算法
"""
import os
import glob
import sys
from pathlib import Path
import threading
import time
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
import queue


class ImageProcessor:
    """图片处理器 - 简化版"""

    IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff']

    @classmethod
    def scan_albums(cls, root_path, progress_callback=None):
        """扫描漫画文件夹 - 简化多线程版本

        Args:
            root_path: 根目录路径
            progress_callback: 进度回调函数，接收(progress, status)参数
        """
        albums = []
        root_path = Path(root_path)

        if not root_path.exists():
            if progress_callback:
                progress_callback(0, f"路径不存在: {root_path}")
            return albums

        # 获取所有子文件夹
        subdirs = []
        for item in root_path.iterdir():
            if item.is_dir():
                subdirs.append(item)

        if not subdirs:
            if progress_callback:
                progress_callback(100, "未找到子文件夹")
            return albums

        total_items = len(subdirs)
        if progress_callback:
            progress_callback(10, f"找到 {total_items} 个文件夹，开始扫描...")

        # 使用线程池并发扫描 - 简化版
        scanned_count = 0  # 局部计数器，不需要锁
        albums_lock = threading.Lock()  # 只用一个锁保护albums列表

        def scan_single_folder(folder_path):
            """扫描单个文件夹"""
            try:
                # 获取图片文件
                image_files = cls.get_image_files(str(folder_path))

                if image_files:
                    # 这是一个包含图片的相册
                    folder_size = cls.get_folder_size(image_files)
                    album_info = {
                        'path': str(folder_path),
                        'name': folder_path.name,
                        'image_files': image_files,
                        'cover_image': image_files[0],
                        'image_count': len(image_files),
                        'folder_size': folder_size,
                        'type': 'album'
                    }
                    return [album_info]
                else:
                    # 检查是否包含子相册（递归深度限制为2）
                    sub_albums = []
                    cls._scan_folder_recursive(folder_path, sub_albums, max_depth=2)

                    if sub_albums:
                        total_images = sum(len(album['image_files']) for album in sub_albums)
                        total_size_bytes = sum(cls._parse_size_to_bytes(album['folder_size']) for album in sub_albums)

                        cover_image = sub_albums[0]['cover_image'] if sub_albums else None

                        collection_info = {
                            'path': str(folder_path),
                            'name': folder_path.name,
                            'albums': sub_albums,
                            'cover_image': cover_image,
                            'album_count': len(sub_albums),
                            'image_count': total_images,
                            'folder_size': cls.format_size(total_size_bytes),
                            'type': 'collection'
                        }
                        return [collection_info]

            except Exception as e:
                print(f"扫描文件夹时出错 {folder_path}: {e}")

            return []

        # 并发执行扫描任务
        max_workers = min(8, os.cpu_count() or 4)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # 提交所有任务
            future_to_folder = {executor.submit(scan_single_folder, folder): folder
                              for folder in subdirs}

            # 收集结果
            for future in as_completed(future_to_folder):
                try:
                    result = future.result()
                    with albums_lock:
                        albums.extend(result)
                    scanned_count += 1

                    # 更新进度 - 每20%更新一次，减少开销
                    if progress_callback and scanned_count % max(1, total_items // 5) == 0:
                        progress = min(10 + int((scanned_count / total_items) * 70), 80)
                        progress_callback(progress, f"已扫描 {scanned_count}/{total_items} 个文件夹")

                except Exception as e:
                    print(f"处理扫描结果时出错: {e}")

        # 智能分组 - 简化版
        if progress_callback:
            progress_callback(85, "正在智能分组...")

        albums = cls.create_smart_groups_simple(albums)

        # 完成
        if progress_callback:
            progress_callback(100, f"扫描完成，找到 {len(albums)} 个项目")

        print(f"扫描完成：共找到 {len(albums)} 个项目（相册+合集）")
        return albums

    @classmethod
    def create_smart_groups_simple(cls, albums):
        """简化版智能分组 - 只基于方括号内的作者信息分组"""
        if len(albums) < 2:
            return albums

        # 分离已有的合集和单个相册
        collections = [album for album in albums if album.get('type') == 'collection']
        single_albums = [album for album in albums if album.get('type') == 'album']

        # 只根据作者信息分组（提取第一个方括号内的内容）
        author_groups = {}
        for album in single_albums:
            author = cls._extract_author_from_name(album['name'])
            if author:
                if author not in author_groups:
                    author_groups[author] = []
                author_groups[author].append(album)
            else:
                # 没有作者信息的单独放着
                author_groups.setdefault('其他', []).append(album)

        # 创建分组合集
        result = collections
        for author, group_albums in author_groups.items():
            if len(group_albums) >= 2:
                # 创建智能分组合集
                total_images = sum(album['image_count'] for album in group_albums)
                total_size_bytes = sum(cls._parse_size_to_bytes(album['folder_size']) for album in group_albums)

                # 选择封面：图片数量最多的相册
                cover_album = max(group_albums, key=lambda x: x['image_count'])

                smart_collection = {
                    'path': f"[智能分组] {author}",
                    'name': author,
                    'albums': group_albums,
                    'cover_image': cover_album['cover_image'],
                    'album_count': len(group_albums),
                    'image_count': total_images,
                    'folder_size': cls.format_size(total_size_bytes),
                    'type': 'smart_collection'
                }
                result.append(smart_collection)
            else:
                # 单个相册保持原样
                result.extend(group_albums)

        return result

    @classmethod
    def _extract_author_from_name(cls, name):
        """从相册名称中提取作者信息 - 提取第一个方括号内的字符"""
        import re
        author_match = re.search(r'\[([^\]]+)\]', name)
        if author_match:
            author = author_match.group(1).strip()
            return author if author else None
        return None

    @classmethod
    def _scan_folder_recursive(cls, folder_path, albums, max_depth=3, current_depth=0):
        """递归扫描文件夹（简化版）"""
        if current_depth >= max_depth:
            return

        try:
            for item in folder_path.iterdir():
                if item.is_dir():
                    try:
                        # 获取图片文件
                        image_files = cls.get_image_files(str(item))

                        if image_files and len(image_files) > 0:
                            folder_size = cls.get_folder_size(image_files)

                            album_info = {
                                'path': str(item),
                                'name': item.name,
                                'image_files': image_files,
                                'cover_image': image_files[0],
                                'image_count': len(image_files),
                                'folder_size': folder_size
                            }
                            albums.append(album_info)

                        # 递归扫描子文件夹
                        cls._scan_folder_recursive(item, albums, max_depth, current_depth + 1)

                    except Exception as e:
                        print(f"处理文件夹时出错 {item}: {e}")
                        continue

        except Exception as e:
            print(f"递归扫描文件夹时出错 {folder_path}: {e}")

    @classmethod
    def get_image_files(cls, folder_path):
        """获取文件夹中的所有图片文件（简化版）"""
        image_files = []

        try:
            folder_path = Path(folder_path)
            if not folder_path.exists():
                return image_files

            # 遍历文件夹中的所有文件
            for file_path in folder_path.iterdir():
                if file_path.is_file():
                    if file_path.suffix.lower() in cls.IMAGE_EXTENSIONS:
                        try:
                            image_files.append(str(file_path))
                        except Exception as e:
                            print(f"检查文件时出错 {file_path}: {e}")
                            continue

        except Exception as e:
            print(f"读取文件夹时出错 {folder_path}: {e}")

        # 按文件名排序
        try:
            image_files.sort(key=lambda x: Path(x).name.lower())
        except Exception as e:
            print(f"排序文件时出错: {e}")

        return image_files

    @classmethod
    def get_folder_size(cls, image_files):
        """计算文件夹大小"""
        total_size = 0
        for file_path in image_files:
            try:
                total_size += os.path.getsize(file_path)
            except OSError:
                continue
        return cls.format_size(total_size)

    @classmethod
    def format_size(cls, size_bytes):
        """格式化文件大小"""
        if size_bytes == 0:
            return "0B"
        size_names = ["B", "KB", "MB", "GB"]
        i = 0
        while size_bytes >= 1024 and i < len(size_names) - 1:
            size_bytes /= 1024.0
            i += 1
        return f"{size_bytes:.1f}{size_names[i]}"

    @classmethod
    def _parse_size_to_bytes(cls, size_str):
        """将格式化的大小字符串转换回字节数"""
        try:
            if not size_str or size_str == "0B":
                return 0

            import re
            match = re.match(r'([0-9.]+)([A-Z]+)', size_str.upper())
            if not match:
                return 0

            value = float(match.group(1))
            unit = match.group(2)

            multipliers = {'B': 1, 'KB': 1024, 'MB': 1024**2, 'GB': 1024**3}
            return int(value * multipliers.get(unit, 1))
        except Exception:
            return 0


class SlideshowManager:
    """幻灯片管理器 - 自动播放图片"""

    def __init__(self, image_viewer, interval=3):
        self.image_viewer = image_viewer
        self.interval = interval
        self.is_playing = False
        self.timer = None

    def start_slideshow(self):
        """开始幻灯片播放"""
        if not self.is_playing:
            self.is_playing = True
            self._next_slide()

    def stop_slideshow(self):
        """停止幻灯片播放"""
        self.is_playing = False
        if self.timer:
            self.timer.cancel()

    def _next_slide(self):
        """播放下一张"""
        if self.is_playing:
            self.image_viewer.next_image()
            self.timer = threading.Timer(self.interval, self._next_slide)
            self.timer.start()

    def set_interval(self, interval):
        """设置播放间隔"""
        self.interval = interval
        if self.is_playing:
            self.stop_slideshow()
            self.start_slideshow()

