import logging
import os
import sys
from datetime import datetime
from pathlib import Path
from logging.handlers import TimedRotatingFileHandler

class FileLogger:
    """文件日志管理器 - 统一管理应用程序日志输出到文件"""

    _instance = None
    _initialized = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(FileLogger, cls).__new__(cls)
        return cls._instance

    def __init__(self):
        if not self._initialized:
            self.config_manager = None
            self.setup_logging()
            FileLogger._initialized = True

    def set_config_manager(self, config_manager):
        """设置配置管理器，用于读取日志级别"""
        self.config_manager = config_manager
        self._update_log_level()

    def _get_log_level(self):
        """从配置获取日志级别"""
        if self.config_manager:
            level_name = self.config_manager.get_log_level()
            level_map = {
                'DEBUG': logging.DEBUG,
                'INFO': logging.INFO,
                'WARNING': logging.WARNING,
                'ERROR': logging.ERROR,
                'CRITICAL': logging.CRITICAL
            }
            return level_map.get(level_name, logging.DEBUG)
        return logging.DEBUG  # 默认级别

    def _update_log_level(self):
        """更新日志器级别"""
        if hasattr(self, 'logger') and self.logger:
            self.logger.setLevel(self._get_log_level())
            # 同时更新所有handler的级别
            for handler in self.logger.handlers:
                handler.setLevel(self._get_log_level())

    def setup_logging(self):
        """设置日志配置"""
        # 创建日志目录
        log_dir = Path.home() / '.comic_reader' / 'logs'
        log_dir.mkdir(parents=True, exist_ok=True)

        # 日志文件路径
        log_file = log_dir / 'comic_reader.log'

        # 创建根日志器
        self.logger = logging.getLogger('comic_reader')
        self.logger.setLevel(self._get_log_level())

        # 避免重复添加处理器
        if not self.logger.handlers:
            # 创建文件处理器 - 按天轮转，保留30天
            file_handler = TimedRotatingFileHandler(
                log_file,
                when='midnight',
                interval=1,
                backupCount=30,
                encoding='utf-8'
            )
            file_handler.setLevel(self._get_log_level())

            # 设置日志格式
            formatter = logging.Formatter(
                fmt='%(asctime)s [%(levelname)8s] %(name)s: %(message)s',
                datefmt='%Y-%m-%d %H:%M:%S'
            )
            file_handler.setFormatter(formatter)

            # 添加处理器到日志器
            self.logger.addHandler(file_handler)

            # 防止日志向上传播到根日志器
            self.logger.propagate = False

            # 记录日志系统初始化
            self.logger.info(f"日志系统初始化完成，日志文件: {log_file}")

    def get_logger(self, name=None):
        """获取指定名称的日志器"""
        if name:
            return logging.getLogger(f'comic_reader.{name}')
        return self.logger

    def debug(self, message, module_name=None):
        """调试信息"""
        logger = self.get_logger(module_name)
        logger.debug(message)

    def info(self, message, module_name=None):
        """普通信息"""
        logger = self.get_logger(module_name)
        logger.info(message)

    def warning(self, message, module_name=None):
        """警告信息"""
        logger = self.get_logger(module_name)
        logger.warning(message)

    def error(self, message, module_name=None):
        """错误信息"""
        logger = self.get_logger(module_name)
        logger.error(message)

    def critical(self, message, module_name=None):
        """严重错误"""
        logger = self.get_logger(module_name)
        logger.critical(message)

    def exception(self, message, module_name=None):
        """记录异常信息（包含堆栈跟踪）"""
        logger = self.get_logger(module_name)
        logger.exception(message)

# 创建全局日志实例
file_logger = FileLogger()

def get_logger(module_name=None):
    """获取日志器的便捷函数"""
    return file_logger.get_logger(module_name)

def log_info(message, module_name=None):
    """记录信息日志的便捷函数"""
    file_logger.info(message, module_name)

def log_warning(message, module_name=None):
    """记录警告日志的便捷函数"""
    file_logger.warning(message, module_name)

def log_error(message, module_name=None):
    """记录错误日志的便捷函数"""
    file_logger.error(message, module_name)

def log_debug(message, module_name=None):
    """记录调试日志的便捷函数"""
    file_logger.debug(message, module_name)

def log_exception(message, module_name=None):
    """记录异常日志的便捷函数"""
    file_logger.exception(message, module_name)
