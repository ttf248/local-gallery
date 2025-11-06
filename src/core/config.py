import json
import os
import sys
from pathlib import Path

# Add src to path if not already there
src_path = Path(__file__).parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from utils.logger import get_logger, log_info, log_warning, log_error, log_exception

class ConfigManager:
    """配置管理器，支持Unicode路径"""
    
    def __init__(self):
        self.logger = get_logger('core.config')
        
        # 使用pathlib处理配置目录
        self.config_dir = Path.home() / '.comic_reader'
        self.config_file = self.config_dir / 'settings.json'
        
        # 确保配置目录存在
        self.config_dir.mkdir(exist_ok=True)
        log_info(f"配置目录: {self.config_dir}", 'core.config')
        
        # 默认配置
        self.default_config = {
            'last_path': '',
            'recent_albums': [],
            'favorites': [],
            'max_recent': 10,
            'auto_switch_album': True,  # 是否启用自动切换相册
            'show_switch_notification': True,  # 是否显示切换提示

            # 主题设置
            'theme': 'light',  # light, dark, system

            # 窗口设置
            'window_geometry': None,  # 窗口几何信息
            'sidebar_width': 240,
            'window_maximized': False,

            # 图片查看器设置
            'image_zoom_mode': 'fit_window',  # fit_window, original_size
            'image_smooth': True,  # 图片平滑缩放
            'image_preload': True,  # 预加载下一张图片

            # 快捷键设置
            'shortcuts': {
                'open_folder': 'Ctrl+O',
                'scan_albums': 'F5',
                'open_recent': 'Ctrl+R',
                'open_favorites': 'Ctrl+F',
                'toggle_favorite': 'Ctrl+D',
                'fullscreen': 'F11',
                'next_image': 'Right',
                'prev_image': 'Left',
                'zoom_in': 'Ctrl++',
                'zoom_out': 'Ctrl+-',
                'reset_zoom': 'Ctrl+0',
                'rotate_right': 'Ctrl+R',
                'rotate_left': 'Ctrl+Shift+R',
            },

            # 高级设置
            'image_cache_size': 100,  # MB
            'image_thumbnail_size': 200,  # px
            'auto_save_window_state': True,
            'show_thumbnails': True,
            'slideshow_interval': 3,  # seconds

            # 扫描设置
            'scan_recursive': True,
            'scan_hidden_folders': False,
            'image_formats': ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff'],
        }
        
        # 加载配置
        self.config = self.load_config()
        log_info("配置管理器初始化完成", 'core.config')
    
    def load_config(self):
        """加载配置文件"""
        try:
            if self.config_file.exists():
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                    # 合并默认配置
                    for key, value in self.default_config.items():
                        if key not in config:
                            config[key] = value
                    log_info(f"成功加载配置文件: {self.config_file}", 'core.config')
                    return config
        except Exception as e:
            log_exception(f"加载配置文件失败: {e}", 'core.config')
        
        log_info("使用默认配置", 'core.config')
        return self.default_config.copy()
    
    def save_config(self):
        """保存配置文件"""
        try:
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(self.config, f, indent=2, ensure_ascii=False)
            log_info("配置文件保存成功", 'core.config')
        except Exception as e:
            log_exception(f"保存配置文件失败: {e}", 'core.config')
    
    def get_last_path(self):
        """获取上次使用的路径"""
        last_path = self.config.get('last_path', '')
        # 验证路径是否存在
        if last_path and Path(last_path).exists():
            return last_path
        return ''
    
    def set_last_path(self, path):
        """设置上次使用的路径"""
        self.config['last_path'] = str(path)
        self.save_config()
    
    def add_recent_album(self, album_path):
        """添加到最近浏览"""
        album_path = str(album_path)
        recent_albums = self.config.get('recent_albums', [])
        
        # 如果已存在，先移除
        if album_path in recent_albums:
            recent_albums.remove(album_path)
        
        # 添加到开头
        recent_albums.insert(0, album_path)
        
        # 限制数量
        max_recent = self.config.get('max_recent', 10)
        if len(recent_albums) > max_recent:
            recent_albums = recent_albums[:max_recent]
        
        self.config['recent_albums'] = recent_albums
        self.save_config()
        log_info(f"添加到最近浏览: {os.path.basename(album_path)}", 'core.config')
    
    def get_recent_albums(self):
        """获取最近浏览的漫画"""
        recent_albums = self.config.get('recent_albums', [])
        # 过滤不存在的路径
        valid_albums = []
        for album_path in recent_albums:
            if Path(album_path).exists():
                valid_albums.append(album_path)
        
        # 如果有变化，更新配置
        if len(valid_albums) != len(recent_albums):
            self.config['recent_albums'] = valid_albums
            self.save_config()
        
        return valid_albums
    
    def add_favorite(self, album_path):
        """添加到收藏"""
        album_path = str(album_path)
        favorites = self.config.get('favorites', [])
        
        if album_path not in favorites:
            favorites.append(album_path)
            self.config['favorites'] = favorites
            self.save_config()
            log_info(f"添加到收藏: {os.path.basename(album_path)}", 'core.config')
    
    def remove_favorite(self, album_path):
        """从收藏中移除"""
        album_path = str(album_path)
        favorites = self.config.get('favorites', [])
        
        if album_path in favorites:
            favorites.remove(album_path)
            self.config['favorites'] = favorites
            self.save_config()
            log_info(f"移除收藏: {os.path.basename(album_path)}", 'core.config')
    
    def is_favorite(self, album_path):
        """检查是否已收藏"""
        album_path = str(album_path)
        return album_path in self.config.get('favorites', [])
    
    def get_favorites(self):
        """获取收藏的漫画"""
        favorites = self.config.get('favorites', [])
        # 过滤不存在的路径
        valid_favorites = []
        for album_path in favorites:
            if Path(album_path).exists():
                valid_favorites.append(album_path)
        
        # 如果有变化，更新配置
        if len(valid_favorites) != len(favorites):
            self.config['favorites'] = valid_favorites
            self.save_config()
        
        return valid_favorites
    
    def get_auto_switch_album(self):
        """获取是否启用自动切换相册"""
        return self.config.get('auto_switch_album', True)
    
    def set_auto_switch_album(self, enabled):
        """设置是否启用自动切换相册"""
        self.config['auto_switch_album'] = enabled
        self.save_config()
    
    def get_show_switch_notification(self):
        """获取是否显示切换提示"""
        return self.config.get('show_switch_notification', True)
    
    def set_show_switch_notification(self, enabled):
        """设置是否显示切换提示"""
        self.config['show_switch_notification'] = enabled
        self.save_config()

    # 主题设置
    def get_theme(self):
        """获取主题设置"""
        return self.config.get('theme', 'light')

    def set_theme(self, theme):
        """设置主题"""
        self.config['theme'] = theme
        self.save_config()

    # 窗口设置
    def get_window_geometry(self):
        """获取窗口几何信息"""
        return self.config.get('window_geometry')

    def set_window_geometry(self, geometry):
        """设置窗口几何信息"""
        self.config['window_geometry'] = geometry
        self.save_config()

    def get_window_maximized(self):
        """获取窗口是否最大化"""
        return self.config.get('window_maximized', False)

    def set_window_maximized(self, maximized):
        """设置窗口是否最大化"""
        self.config['window_maximized'] = maximized
        self.save_config()

    def get_sidebar_width(self):
        """获取侧边栏宽度"""
        return self.config.get('sidebar_width', 240)

    def set_sidebar_width(self, width):
        """设置侧边栏宽度"""
        self.config['sidebar_width'] = width
        self.save_config()

    # 图片查看器设置
    def get_image_zoom_mode(self):
        """获取图片缩放模式"""
        return self.config.get('image_zoom_mode', 'fit_window')

    def set_image_zoom_mode(self, mode):
        """设置图片缩放模式"""
        self.config['image_zoom_mode'] = mode
        self.save_config()

    def get_image_smooth(self):
        """获取图片平滑缩放设置"""
        return self.config.get('image_smooth', True)

    def set_image_smooth(self, enabled):
        """设置图片平滑缩放"""
        self.config['image_smooth'] = enabled
        self.save_config()

    def get_image_preload(self):
        """获取图片预加载设置"""
        return self.config.get('image_preload', True)

    def set_image_preload(self, enabled):
        """设置图片预加载"""
        self.config['image_preload'] = enabled
        self.save_config()

    # 快捷键设置
    def get_shortcuts(self):
        """获取所有快捷键设置"""
        return self.config.get('shortcuts', self.default_config['shortcuts'])

    def get_shortcut(self, key):
        """获取单个快捷键"""
        shortcuts = self.get_shortcuts()
        return shortcuts.get(key, self.default_config['shortcuts'].get(key, ''))

    def set_shortcut(self, key, value):
        """设置单个快捷键"""
        if 'shortcuts' not in self.config:
            self.config['shortcuts'] = self.default_config['shortcuts'].copy()
        self.config['shortcuts'][key] = value
        self.save_config()

    def reset_shortcuts(self):
        """重置快捷键为默认"""
        self.config['shortcuts'] = self.default_config['shortcuts'].copy()
        self.save_config()

    # 高级设置
    def get_image_cache_size(self):
        """获取图片缓存大小(MB)"""
        return self.config.get('image_cache_size', 100)

    def set_image_cache_size(self, size):
        """设置图片缓存大小(MB)"""
        self.config['image_cache_size'] = size
        self.save_config()

    def get_image_thumbnail_size(self):
        """获取缩略图大小(px)"""
        return self.config.get('image_thumbnail_size', 200)

    def set_image_thumbnail_size(self, size):
        """设置缩略图大小(px)"""
        self.config['image_thumbnail_size'] = size
        self.save_config()

    def get_auto_save_window_state(self):
        """获取是否自动保存窗口状态"""
        return self.config.get('auto_save_window_state', True)

    def set_auto_save_window_state(self, enabled):
        """设置是否自动保存窗口状态"""
        self.config['auto_save_window_state'] = enabled
        self.save_config()

    def get_show_thumbnails(self):
        """获取是否显示缩略图"""
        return self.config.get('show_thumbnails', True)

    def set_show_thumbnails(self, enabled):
        """设置是否显示缩略图"""
        self.config['show_thumbnails'] = enabled
        self.save_config()

    def get_slideshow_interval(self):
        """获取幻灯片间隔(秒)"""
        return self.config.get('slideshow_interval', 3)

    def set_slideshow_interval(self, interval):
        """设置幻灯片间隔(秒)"""
        self.config['slideshow_interval'] = interval
        self.save_config()

    # 扫描设置
    def get_scan_recursive(self):
        """获取是否递归扫描"""
        return self.config.get('scan_recursive', True)

    def set_scan_recursive(self, enabled):
        """设置是否递归扫描"""
        self.config['scan_recursive'] = enabled
        self.save_config()

    def get_scan_hidden_folders(self):
        """获取是否扫描隐藏文件夹"""
        return self.config.get('scan_hidden_folders', False)

    def set_scan_hidden_folders(self, enabled):
        """设置是否扫描隐藏文件夹"""
        self.config['scan_hidden_folders'] = enabled
        self.save_config()

    def get_image_formats(self):
        """获取支持图片格式"""
        return self.config.get('image_formats', self.default_config['image_formats'])

    def set_image_formats(self, formats):
        """设置支持图片格式"""
        self.config['image_formats'] = formats
        self.save_config()

    # 配置导入导出
    def export_config(self, file_path):
        """导出配置到文件"""
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(self.config, f, indent=2, ensure_ascii=False)
            log_info(f"配置已导出到: {file_path}", 'core.config')
            return True
        except Exception as e:
            log_exception(f"导出配置失败: {e}", 'core.config')
            return False

    def import_config(self, file_path):
        """从文件导入配置"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                imported_config = json.load(f)
                # 合并配置
                for key, value in imported_config.items():
                    self.config[key] = value
                self.save_config()
            log_info(f"配置已从 {file_path} 导入", 'core.config')
            return True
        except Exception as e:
            log_exception(f"导入配置失败: {e}", 'core.config')
            return False

    def reset_to_default(self):
        """重置为默认配置"""
        self.config = self.default_config.copy()
        self.save_config()
        log_info("配置已重置为默认值", 'core.config')
