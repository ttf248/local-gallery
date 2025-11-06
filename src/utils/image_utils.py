import os
import glob
import sys
from PIL import Image, ImageTk, ExifTags
from pathlib import Path
import threading
import time
import difflib
import re
import os

class ImageProcessor:
    """图片处理器，负责图片的扫描、加载和处理"""
    
    IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff']
    
    @classmethod
    def scan_albums(cls, root_path, progress_callback=None):
        """扫描漫画文件夹，支持合集功能

        Args:
            root_path: 根目录路径
            progress_callback: 进度回调函数，接收(progress, status)参数
        """
        albums = []

        try:
            # 使用pathlib处理路径，更好地支持Unicode
            root_path = Path(root_path)

            if not root_path.exists():
                print(f"路径不存在: {root_path}")
                return albums

            # 获取所有子文件夹
            subdirs = [item for item in root_path.iterdir() if item.is_dir()]
            total_items = len(subdirs)

            # 扫描根目录的直接子文件夹
            for index, item in enumerate(subdirs):
                # 更新进度
                progress = int((index / total_items) * 80)  # 扫描阶段80%
                if progress_callback:
                    progress_callback(progress, f"扫描: {item.name}")

                if item.is_dir():
                    # 检查这个文件夹是否包含图片（作为单个相册）
                    image_files = cls.get_image_files(str(item))

                    if image_files:
                        # 这是一个包含图片的相册
                        folder_size = cls.get_folder_size(image_files)
                        album_info = {
                            'path': str(item),
                            'name': item.name,
                            'image_files': image_files,
                            'cover_image': image_files[0],
                            'image_count': len(image_files),
                            'folder_size': folder_size,
                            'type': 'album'  # 标记为单个相册
                        }
                        albums.append(album_info)
                    else:
                        # 检查是否包含子相册（作为合集）
                        sub_albums = []
                        cls._scan_folder_recursive(item, sub_albums)

                        if sub_albums:
                            # 这是一个合集，包含多个相册
                            total_images = sum(len(album['image_files']) for album in sub_albums)
                            total_size_bytes = sum(cls._parse_size_to_bytes(album['folder_size']) for album in sub_albums)

                            # 使用第一个相册的第一张图作为合集封面
                            cover_image = sub_albums[0]['cover_image'] if sub_albums else None

                            collection_info = {
                                'path': str(item),
                                'name': item.name,
                                'albums': sub_albums,  # 包含的相册列表
                                'cover_image': cover_image,
                                'album_count': len(sub_albums),
                                'image_count': total_images,
                                'folder_size': cls.format_size(total_size_bytes),
                                'type': 'collection'  # 标记为合集
                            }
                            albums.append(collection_info)

            # 智能分组阶段
            if progress_callback:
                progress_callback(85, "正在智能分组...")

            # 智能分组：对非合集的相册进行相似度分析
            albums = cls.create_smart_groups(albums)

            # 完成
            if progress_callback:
                progress_callback(100, "扫描完成")

        except Exception as e:
            print(f"扫描根目录时出错 {root_path}: {e}")
            if progress_callback:
                progress_callback(0, f"扫描出错: {str(e)}")

        return albums
    
    @classmethod
    def _scan_folder_recursive(cls, folder_path, albums):
        """递归扫描文件夹"""
        try:
            for item in folder_path.iterdir():
                if item.is_dir():
                    try:
                        # 获取当前文件夹中的图片文件
                        image_files = cls.get_image_files(str(item))
                        
                        if image_files and len(image_files) > 0:
                            # 计算文件夹大小
                            folder_size = cls.get_folder_size(image_files)
                            
                            # 确保有封面图片
                            cover_image = image_files[0] if image_files else None
                            
                            album_info = {
                                'path': str(item),
                                'name': item.name,
                                'image_files': image_files,
                                'cover_image': cover_image,
                                'image_count': len(image_files),
                                'folder_size': folder_size
                            }
                            albums.append(album_info)
                        
                        # 递归扫描子文件夹
                        cls._scan_folder_recursive(item, albums)
                        
                    except Exception as e:
                        print(f"处理文件夹时出错 {item}: {e}")
                        continue
                        
        except Exception as e:
            print(f"递归扫描文件夹时出错 {folder_path}: {e}")
    
    @classmethod
    def create_smart_groups(cls, albums):
        """智能分组：基于路径名称相似度和作者信息创建智能合集"""
        if len(albums) < 2:
            return albums
        
        # 分离已有的合集和单个相册
        collections = [album for album in albums if album.get('type') == 'collection']
        single_albums = [album for album in albums if album.get('type') == 'album']
        
        if len(single_albums) < 2:
            return albums
        
        # 首先按作者进行分组
        author_groups = cls._group_by_author(single_albums)
        
        # 对剩余相册进行名称相似度分组
        remaining_albums = []
        for group in author_groups:
            if len(group) == 1:
                remaining_albums.extend(group)
        
        name_groups = cls._group_similar_albums(remaining_albums) if remaining_albums else []
        
        # 合并结果：保留原有合集 + 作者分组 + 名称分组 + 未分组的单个相册
        result = collections
        
        # 添加作者分组
        for group in author_groups:
            if len(group) >= 2:  # 至少2个相册才创建智能合集
                smart_collection = cls._create_smart_collection(group)
                result.append(smart_collection)
        
        # 添加名称分组
        for group in name_groups:
            if len(group) >= 2:  # 至少2个相册才创建智能合集
                smart_collection = cls._create_smart_collection(group)
                result.append(smart_collection)
            else:
                # 单个相册保持原样
                result.extend(group)
        
        return result
    
    @classmethod
    def _group_by_author(cls, albums):
        """根据作者信息对相册进行分组"""
        author_groups = {}
        ungrouped_albums = []
        
        for album in albums:
            author = cls._extract_author_from_name(album['name'])
            if author:
                if author not in author_groups:
                    author_groups[author] = []
                author_groups[author].append(album)
            else:
                ungrouped_albums.append(album)
        
        # 返回分组结果：作者分组 + 未分组的相册（作为单独的组）
        groups = list(author_groups.values())
        for album in ungrouped_albums:
            groups.append([album])
        
        return groups
    
    @classmethod
    def _extract_author_from_name(cls, name):
        """从相册名称中提取作者信息 - 识别第一个方括号内的字符作为作者信息"""
        import re
        
        # 匹配第一个方括号内的内容作为作者信息
        author_match = re.search(r'\[([^\]]+)\]', name)
        if author_match:
            author = author_match.group(1).strip()
            # 直接返回第一个方括号内的内容作为作者信息
            return author if author else None
        
        return None
    
    @classmethod
    def _group_similar_albums(cls, albums):
        """根据名称相似度对相册进行分组"""
        groups = []
        used_indices = set()
        
        for i, album in enumerate(albums):
            if i in used_indices:
                continue
            
            # 创建新组，包含当前相册
            current_group = [album]
            used_indices.add(i)
            
            # 查找与当前相册相似的其他相册
            for j, other_album in enumerate(albums):
                if j in used_indices or i == j:
                    continue
                
                similarity = cls._calculate_name_similarity(album['name'], other_album['name'])
                if similarity >= 0.6:  # 相似度阈值
                    current_group.append(other_album)
                    used_indices.add(j)
            
            groups.append(current_group)
        
        return groups
    
    @classmethod
    def _calculate_name_similarity(cls, name1, name2):
        """计算两个名称的相似度"""
        # 预处理名称：移除特殊字符、数字、空格，转为小写
        clean_name1 = cls._clean_name_for_comparison(name1)
        clean_name2 = cls._clean_name_for_comparison(name2)
        
        if not clean_name1 or not clean_name2:
            return 0.0
        
        # 使用difflib计算序列相似度
        similarity = difflib.SequenceMatcher(None, clean_name1, clean_name2).ratio()
        
        # 额外检查：如果一个名称是另一个的子串，提高相似度
        if clean_name1 in clean_name2 or clean_name2 in clean_name1:
            similarity = max(similarity, 0.8)
        
        # 检查共同的关键词
        words1 = set(clean_name1.split())
        words2 = set(clean_name2.split())
        if words1 and words2:
            word_similarity = len(words1.intersection(words2)) / len(words1.union(words2))
            similarity = max(similarity, word_similarity * 0.9)
        
        return similarity
    
    @classmethod
    def _clean_name_for_comparison(cls, name):
        """清理名称用于比较"""
        # 移除常见的版本号、集数等模式
        patterns_to_remove = [
            r'\b(第|第\d+|\d+)\s*[卷册集话回期部季]\b',  # 第X卷、第X集等
            r'\b(vol|volume|ch|chapter|ep|episode)\s*\d+\b',  # vol1, chapter1等
            r'\b\d{1,3}\b',  # 单独的数字
            r'[\[\(（].*?[\]\)）]',  # 括号内容
            r'[_\-\s]+',  # 连字符、下划线、空格
        ]
        
        cleaned = name.lower()
        for pattern in patterns_to_remove:
            cleaned = re.sub(pattern, ' ', cleaned, flags=re.IGNORECASE)
        
        # 移除多余空格并返回
        return ' '.join(cleaned.split())
    
    @classmethod
    def _create_smart_collection(cls, albums):
        """创建智能分组合集"""
        if not albums:
            return None
        
        # 找到最具代表性的名称作为合集名称
        collection_name = cls._generate_collection_name(albums)
        
        # 计算合集统计信息
        total_images = sum(album['image_count'] for album in albums)
        total_size_bytes = sum(cls._parse_size_to_bytes(album['folder_size']) for album in albums)
        
        # 选择封面：优先选择图片数量最多的相册的封面
        cover_album = max(albums, key=lambda x: x['image_count'])
        cover_image = cover_album['cover_image']
        
        # 创建虚拟路径（用于标识这是智能分组）
        base_path = Path(albums[0]['path']).parent
        virtual_path = str(base_path / f"[智能分组] {collection_name}")
        
        return {
            'path': virtual_path,
            'name': collection_name,  # 直接使用生成的名称，不重复添加前缀
            'albums': albums,
            'cover_image': cover_image,
            'album_count': len(albums),
            'image_count': total_images,
            'folder_size': cls.format_size(total_size_bytes),
            'type': 'smart_collection'  # 标记为智能分组合集
        }
    
    @classmethod
    def _generate_collection_name(cls, albums):
        """为智能分组生成合集名称"""
        if not albums:
            return "未知合集"
        
        if len(albums) == 1:
            return albums[0]['name']
        
        # 获取所有相册的清理后名称
        cleaned_names = [cls._clean_name_for_comparison(album['name']) for album in albums]
        
        # 找到所有名称的公共部分
        common_words = set(cleaned_names[0].split())
        for name in cleaned_names[1:]:
            common_words &= set(name.split())
        
        if common_words:
            # 过滤掉过短的词汇（如单个字符）
            meaningful_words = [word for word in common_words if len(word) > 1]
            if meaningful_words:
                # 按原始顺序排列公共词汇
                first_name_words = cleaned_names[0].split()
                ordered_words = [word for word in first_name_words if word in meaningful_words]
                collection_name = ' '.join(ordered_words)
            else:
                # 如果没有有意义的公共词汇，使用第一个相册的主要部分
                collection_name = cls._extract_main_title(albums[0]['name'])
        else:
            # 如果没有公共词汇，提取第一个相册的主要标题
            collection_name = cls._extract_main_title(albums[0]['name'])
        
        # 确保名称不为空
        if not collection_name.strip():
            collection_name = "相关系列"
        
        return collection_name.strip()
    
    @classmethod
    def _extract_main_title(cls, name):
        """从相册名称中提取主要标题"""
        # 移除常见的数字标识和特殊符号
        main_title = re.sub(r'[\[\]\(\)（）].*?[\[\]\(\)（）]', '', name)  # 移除括号内容
        main_title = re.sub(r'第\d+[卷册话集部]', '', main_title)  # 移除"第X卷"等
        main_title = re.sub(r'[vV]\d+', '', main_title)  # 移除版本号
        main_title = re.sub(r'\d+$', '', main_title)  # 移除末尾数字
        main_title = re.sub(r'[_\-]+', ' ', main_title)  # 替换连接符为空格
        main_title = re.sub(r'\s+', ' ', main_title)  # 合并多个空格
        
        return main_title.strip()
    
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
            
            # 提取数字和单位
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
    
    @classmethod
    def get_image_files(cls, folder_path):
        """获取文件夹中的所有图片文件，支持Unicode路径"""
        image_files = []
        
        try:
            folder_path = Path(folder_path)
            
            if not folder_path.exists():
                return image_files
            
            # 遍历文件夹中的所有文件
            for file_path in folder_path.iterdir():
                if file_path.is_file():
                    # 检查文件扩展名
                    if file_path.suffix.lower() in cls.IMAGE_EXTENSIONS:
                        try:
                            # 验证文件是否可读
                            if file_path.exists() and file_path.stat().st_size > 0:
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
    def create_thumbnail(cls, image_path, size=(200, 200)):
        """创建缩略图，支持Unicode路径"""
        try:
            # 使用pathlib处理路径
            image_path = Path(image_path)
            
            if not image_path.exists():
                print(f"图片文件不存在: {image_path}")
                return None
                
            # 打开图片
            with Image.open(str(image_path)) as img:
                # 转换为RGB模式（处理RGBA和其他模式）
                if img.mode in ('RGBA', 'LA', 'P'):
                    # 创建白色背景
                    background = Image.new('RGB', img.size, (255, 255, 255))
                    if img.mode == 'P':
                        img = img.convert('RGBA')
                    background.paste(img, mask=img.split()[-1] if img.mode in ('RGBA', 'LA') else None)
                    img = background
                elif img.mode != 'RGB':
                    img = img.convert('RGB')
                
                # 创建缩略图 - 保持比例
                img.thumbnail(size, Image.Resampling.LANCZOS)
                return img.copy()
                
        except Exception as e:
            print(f"创建缩略图时出错 {image_path}: {e}")
            return None
    
    @classmethod
    def load_image_with_mode(cls, image_path, window_width, window_height, mode="fit", rotation=0):
        """加载图片并按指定模式调整大小"""
        try:
            image_path = Path(image_path)
            
            if not image_path.exists():
                return None, 0, 0, 0, 0
                
            with Image.open(str(image_path)) as img:
                orig_width, orig_height = img.size
                
                # 转换颜色模式
                if img.mode in ('RGBA', 'LA', 'P'):
                    background = Image.new('RGB', img.size, (255, 255, 255))
                    if img.mode == 'P':
                        img = img.convert('RGBA')
                    background.paste(img, mask=img.split()[-1] if img.mode in ('RGBA', 'LA') else None)
                    img = background
                elif img.mode != 'RGB':
                    img = img.convert('RGB')
                
                # 旋转图片
                if rotation != 0:
                    img = img.rotate(rotation, expand=True)
                
                # 根据模式调整大小
                if mode == "fit":
                    # 适应窗口，保持比例
                    img.thumbnail((window_width, window_height), Image.Resampling.LANCZOS)
                elif mode == "fill":
                    # 填充窗口，可能裁剪
                    ratio = max(window_width/img.width, window_height/img.height)
                    new_width = int(img.width * ratio)
                    new_height = int(img.height * ratio)
                    img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                elif mode == "original":
                    # 保持原始大小
                    pass
                
                # 转换为PhotoImage
                from PIL import ImageTk
                photo = ImageTk.PhotoImage(img)
                return photo, img.width, img.height, orig_width, orig_height
                
        except Exception as e:
            print(f"加载图片失败 {image_path}: {e}")
            return None, 0, 0, 0, 0
    
    @classmethod
    def auto_rotate_image(cls, img):
        """根据EXIF信息自动旋转图片"""
        try:
            exif = img._getexif()
            if exif is not None:
                for tag, value in exif.items():
                    if ExifTags.TAGS.get(tag) == 'Orientation':
                        if value == 3:
                            img = img.rotate(180, expand=True)
                        elif value == 6:
                            img = img.rotate(270, expand=True)
                        elif value == 8:
                            img = img.rotate(90, expand=True)
                        break
        except (AttributeError, KeyError, TypeError):
            pass
        return img
    
    @classmethod
    def get_image_exif(cls, image_path):
        """获取图片EXIF信息"""
        try:
            img = Image.open(image_path)
            exif_data = {}
            
            if hasattr(img, '_getexif'):
                exif = img._getexif()
                if exif is not None:
                    for tag_id, value in exif.items():
                        tag = ExifTags.TAGS.get(tag_id, tag_id)
                        exif_data[tag] = value
            
            # 添加文件信息
            stat = os.stat(image_path)
            exif_data['文件大小'] = cls.format_size(stat.st_size)
            exif_data['修改时间'] = time.ctime(stat.st_mtime)
            exif_data['图片尺寸'] = f"{img.width}x{img.height}"
            
            return exif_data
        except Exception as e:
            print(f"无法获取EXIF信息 {image_path}: {e}")
            return {}

class SlideshowManager:
    """幻灯片管理器"""
    
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
    
    def set_interval(self, interval):
        """设置播放间隔"""
        self.interval = interval
