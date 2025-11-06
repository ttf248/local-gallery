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
            'window_size': '1200x800',
            'recent_albums': [],
            'favorites': [],
            'max_recent': 10,
            'auto_switch_album': True,  # 是否启用自动切换相册
            'show_switch_notification': True  # 是否显示切换提示
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
