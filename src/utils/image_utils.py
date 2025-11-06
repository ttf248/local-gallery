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
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

class ImageProcessor:
    """图片处理器，负责图片的扫描、加载和处理"""

    IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff']

    # 全局扫描控制
    _scan_lock = threading.Lock()
    _cancel_flag = False
    _scanned_count = 0
    _max_albums = 1000  # 最大扫描相册数，避免长时间扫描
    
    @classmethod
    def scan_albums(cls, root_path, progress_callback=None):
        """扫描漫画文件夹，支持并发扫描

        Args:
            root_path: 根目录路径
            progress_callback: 进度回调函数，接收(progress, status)参数
        """
        # 重置扫描状态
        with cls._scan_lock:
            cls._cancel_flag = False
            cls._scanned_count = 0

        albums = []

        try:
            # 使用pathlib处理路径，更好地支持Unicode
            root_path = Path(root_path)

            if not root_path.exists():
                print(f"路径不存在: {root_path}")
                return albums

            # 快速获取所有子文件夹（只扫描第一层）
            if progress_callback:
                progress_callback(5, "正在扫描目录结构...")

            # 只扫描第一层子文件夹，避免深层扫描
            subdirs = []
            try:
                for item in root_path.iterdir():
                    if item.is_dir():
                        subdirs.append(item)
                        # 限制最大扫描数量，避免长时间扫描
                        if len(subdirs) >= cls._max_albums:
                            print(f"达到最大扫描数量限制：{cls._max_albums}")
                            break
            except Exception as e:
                print(f"遍历目录时出错: {e}")

            if not subdirs:
                if progress_callback:
                    progress_callback(100, "未找到子文件夹")
                return albums

            total_items = len(subdirs)
            if progress_callback:
                progress_callback(10, f"找到 {total_items} 个子文件夹，开始并发扫描...")

            # 使用线程池并发扫描
            albums_lock = threading.Lock()
            scanned_lock = threading.Lock()

            def scan_single_folder(folder_path):
                """扫描单个文件夹"""
                # 检查是否取消
                with cls._scan_lock:
                    if cls._cancel_flag:
                        return []

                try:
                    # 获取图片文件（快速模式）
                    image_files = cls.get_image_files(str(folder_path), skip_size_check=True)

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

                        # 更新扫描计数
                        with scanned_lock:
                            cls._scanned_count += 1
                            current_count = cls._scanned_count

                        # 更新进度
                        if progress_callback and current_count % 10 == 0:
                            progress = min(10 + int((current_count / total_items) * 70), 80)
                            progress_callback(progress, f"已扫描 {current_count}/{total_items} 个文件夹")

                        return [album_info]
                    else:
                        # 检查是否包含子相册（限制深度）
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

                            with scanned_lock:
                                cls._scanned_count += 1

                            return [collection_info]

                except Exception as e:
                    print(f"扫描文件夹时出错 {folder_path}: {e}")

                return []

            # 使用线程池并发执行
            max_workers = min(8, os.cpu_count() or 4)  # 限制最大线程数
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                # 提交所有任务
                future_to_folder = {
                    executor.submit(scan_single_folder, folder): folder
                    for folder in subdirs
                }

                # 收集结果
                for future in as_completed(future_to_folder):
                    folder = future_to_folder[future]
                    try:
                        result = future.result()
                        with albums_lock:
                            albums.extend(result)

                        # 检查是否达到上限
                        with cls._scan_lock:
                            if cls._cancel_flag or cls._scanned_count >= cls._max_albums:
                                break

                    except Exception as e:
                        print(f"处理扫描结果时出错: {e}")

            # 智能分组阶段
            if progress_callback:
                progress_callback(85, "正在智能分组...")

            # 智能分组（启用快速模式）
            albums = cls.create_smart_groups(albums, enable_fast_mode=True)

            # 完成
            if progress_callback:
                progress_callback(100, f"扫描完成，找到 {len(albums)} 个项目")

            print(f"扫描完成：共找到 {len(albums)} 个项目（相册+合集）")

        except Exception as e:
            print(f"扫描根目录时出错 {root_path}: {e}")
            if progress_callback:
                progress_callback(0, f"扫描出错: {str(e)}")

        return albums

    @classmethod
    def cancel_scan(cls):
        """取消当前扫描"""
        with cls._scan_lock:
            cls._cancel_flag = True
        print("扫描已取消")

    @classmethod
    def _scan_folder_recursive(cls, folder_path, albums, max_depth=3, current_depth=0):
        """递归扫描文件夹（优化版）

        Args:
            folder_path: 文件夹路径
            albums: 存储结果的列表
            max_depth: 最大递归深度（避免扫描过深）
            current_depth: 当前递归深度
        """
        if current_depth >= max_depth:
            return

        try:
            for item in folder_path.iterdir():
                if item.is_dir():
                    try:
                        # 获取当前文件夹中的图片文件（启用快速模式）
                        image_files = cls.get_image_files(str(item), skip_size_check=True)

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

                        # 递归扫描子文件夹（限制深度）
                        cls._scan_folder_recursive(item, albums, max_depth, current_depth + 1)

                    except Exception as e:
                        print(f"处理文件夹时出错 {item}: {e}")
                        continue
                        
        except Exception as e:
            print(f"递归扫描文件夹时出错 {folder_path}: {e}")
    
    @classmethod
    def create_smart_groups(cls, albums, enable_fast_mode=True):
        """智能分组：基于路径名称相似度和作者信息创建智能合集

        Args:
            albums: 相册列表
            enable_fast_mode: 启用快速模式（跳过耗时的相似度计算）
        """
        if len(albums) < 2:
            return albums

        # 分离已有的合集和单个相册
        collections = [album for album in albums if album.get('type') == 'collection']
        single_albums = [album for album in albums if album.get('type') == 'album']

        if len(single_albums) < 2:
            return albums

        # 快速模式：如果相册数量很多，跳过耗时的智能分组
        if enable_fast_mode and len(single_albums) > 100:
            print(f"相册数量较多（{len(single_albums)}），跳过智能分组以提升性能")
            return albums + single_albums

        # 首先按作者进行分组（相对快速）
        author_groups = cls._group_by_author(single_albums)

        # 对剩余相册进行名称相似度分组
        remaining_albums = []
        for group in author_groups:
            if len(group) == 1:
                remaining_albums.extend(group)

        # 合并结果：保留原有合集 + 作者分组 + 未分组的单个相册
        result = collections

        # 添加作者分组
        for group in author_groups:
            if len(group) >= 2:  # 至少2个相册才创建智能合集
                smart_collection = cls._create_smart_collection(group)
                result.append(smart_collection)

        # 只在相册数量不多时进行名称分组（避免O(n²)性能问题）
        if remaining_albums and len(remaining_albums) <= 50:
            name_groups = cls._group_similar_albums_fast(remaining_albums)

            # 添加名称分组
            for group in name_groups:
                if len(group) >= 2:  # 至少2个相册才创建智能合集
                    smart_collection = cls._create_smart_collection(group)
                    result.append(smart_collection)
                else:
                    # 单个相册保持原样
                    result.extend(group)
        else:
            # 未分组的单个相册保持原样
            result.extend(remaining_albums)
        
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
        """根据名称相似度对相册进行分组（完整版，O(n²)）"""
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
    def _group_similar_albums_fast(cls, albums):
        """根据名称相似度对相册进行分组（快速版，使用哈希分组）"""
        groups = []
        used_indices = set()

        # 快速分组策略：基于关键词分组，而非逐个比较
        # 提取每个相册名称的关键词（前3个字符或完整名称如果较短）
        keyword_groups = {}

        for i, album in enumerate(albums):
            name = album['name']
            # 提取前3个字符作为关键词（快速分组）
            keyword = name[:3].lower() if len(name) >= 3 else name.lower()

            if keyword not in keyword_groups:
                keyword_groups[keyword] = []
            keyword_groups[keyword].append((i, album))

        # 处理每个关键词组
        for keyword, album_list in keyword_groups.items():
            if len(album_list) < 2:
                continue

            # 对组内的相册进行详细的相似度计算
            current_group = []
            group_indices = set()

            for idx, album in album_list:
                if idx in group_indices:
                    continue

                # 创建新组
                subgroup = [album]
                group_indices.add(idx)

                # 与组内其他相册比较
                for other_idx, other_album in album_list:
                    if other_idx in group_indices or other_idx == idx:
                        continue

                    # 使用简化的相似度计算
                    similarity = cls._calculate_name_similarity_fast(album['name'], other_album['name'])
                    if similarity >= 0.5:  # 降低阈值以获得更多分组
                        subgroup.append(other_album)
                        group_indices.add(other_idx)

                if len(subgroup) >= 2:
                    current_group.extend(subgroup)

            if current_group:
                groups.append(current_group)

        return groups

    @classmethod
    def _calculate_name_similarity_fast(cls, name1, name2):
        """快速计算名称相似度（简化算法）"""
        # 去除数字和特殊字符，只保留字母
        import re
        clean1 = re.sub(r'[^a-zA-Z]', '', name1.lower())
        clean2 = re.sub(r'[^a-zA-Z]', '', name2.lower())

        # 如果清理后的名称为空，返回0
        if not clean1 or not clean2:
            return 0.0

        # 如果完全相同
        if clean1 == clean2:
            return 1.0

        # 检查是否是子串
        if clean1 in clean2 or clean2 in clean1:
            return 0.8

        # 计算公共前缀长度比例
        common_prefix = 0
        min_len = min(len(clean1), len(clean2))
        for i in range(min_len):
            if clean1[i] == clean2[i]:
                common_prefix += 1
            else:
                break

        # 基于公共前缀的相似度
        return common_prefix / max(len(clean1), len(clean2))
    
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
    def get_image_files(cls, folder_path, skip_size_check=True):
        """获取文件夹中的所有图片文件，优化性能

        Args:
            folder_path: 文件夹路径
            skip_size_check: 是否跳过文件大小检查（提升性能）
        """
        image_files = []

        try:
            folder_path = Path(folder_path)

            if not folder_path.exists():
                return image_files

            # 预定义扩展名集合，提升查找速度
            extensions = cls.IMAGE_EXTENSIONS

            # 遍历文件夹中的所有文件
            for file_path in folder_path.iterdir():
                if file_path.is_file():
                    # 快速扩展名检查（使用 in 而不是 endswith）
                    if file_path.suffix.lower() in extensions:
                        try:
                            # 跳过文件大小检查以提升性能
                            # 大多数文件系统会缓存文件信息，而且检查必要性不大
                            if skip_size_check:
                                image_files.append(str(file_path))
                            else:
                                # 原有的文件大小检查逻辑（保留以备需要）
                                if file_path.stat().st_size > 0:
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
