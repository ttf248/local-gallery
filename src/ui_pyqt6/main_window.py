"""
PyQt6主窗口
现代化iPhone风格界面
整合所有UI组件
"""

import sys
from pathlib import Path
from PyQt6.QtWidgets import (
    QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QFileDialog,
    QSplitter, QDialog
)
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QAction, QKeySequence

# 添加src路径
src_path = Path(__file__).parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from .style_manager import StyleManager
from .components.sidebar import Sidebar
from .components.toolbar import Toolbar
from .components.album_grid import AlbumGrid
from .components.status_bar import StatusBar

class MainWindow(QMainWindow):
    """主窗口"""

    # 定义信号
    folderSelected = pyqtSignal(str)  # 文件夹选择信号
    scanRequested = pyqtSignal()     # 扫描请求信号
    recentRequested = pyqtSignal()   # 最近浏览信号
    favoritesRequested = pyqtSignal() # 收藏信号

    def __init__(self, config_manager):
        super().__init__()
        self.config_manager = config_manager
        self.style_manager = StyleManager()
        self.folder_path = ""
        self.albums = []
        self.current_view_state = "home"

        # 初始化UI
        self.init_ui()

    def init_ui(self):
        """初始化用户界面"""
        self.setWindowTitle("漫画阅读器 - 现代化图片管理")
        self.setMinimumSize(1200, 800)
        self.resize(1400, 900)

        # 应用样式
        self.style_manager.themeChanged.connect(self.apply_theme_style)
        self.apply_theme_style()

        # 创建中央分割器
        self.create_central_splitter()

        # 创建状态栏
        self.create_status_bar()

        # 创建菜单栏
        self.create_menu_bar()

        # 创建快捷键
        self.create_shortcuts()

        # 初始状态
        self.show_initial_state()

    def create_central_splitter(self):
        """创建中央分割器 (侧边栏 + 内容区)"""
        # 创建分割器
        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.setChildrenCollapsible(False)

        # 创建侧边栏
        self.create_sidebar(splitter)

        # 创建内容区
        self.create_content_area(splitter)

        # 设置分割器初始比例
        splitter.setSizes([240, 1160])  # 侧边栏240px，内容区自适应
        self.setCentralWidget(splitter)

    def create_sidebar(self, parent):
        """创建侧边栏"""
        self.sidebar = Sidebar()
        self.sidebar.homeClicked.connect(self.show_home)
        self.sidebar.browseClicked.connect(self.browse_folder)
        self.sidebar.scanClicked.connect(self.scan_albums)
        self.sidebar.recentClicked.connect(self.show_recent)
        self.sidebar.favoritesClicked.connect(self.show_favorites)
        self.sidebar.settingsClicked.connect(self.show_settings)

        # 侧边栏固定宽度
        self.sidebar.setFixedWidth(240)
        parent.addWidget(self.sidebar)

    def create_content_area(self, parent):
        """创建内容区"""
        # 垂直布局：工具栏 + 主内容
        content_widget = QWidget()
        content_layout = QVBoxLayout(content_widget)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(0)

        # 工具栏
        self.toolbar = Toolbar()
        self.toolbar.browseClicked.connect(self.browse_folder)
        self.toolbar.scanClicked.connect(self.scan_albums)
        self.toolbar.filterChanged.connect(self.apply_filter)
        self.toolbar.searchTextChanged.connect(self.on_search)
        self.toolbar.themeClicked.connect(self.toggle_theme)
        self.toolbar.settingsClicked.connect(self.show_settings)

        # 相册网格
        self.album_grid = AlbumGrid()
        self.album_grid.albumClicked.connect(self.open_album)
        self.album_grid.favoriteClicked.connect(self.toggle_favorite)

        content_layout.addWidget(self.toolbar)
        content_layout.addWidget(self.album_grid)

        parent.addWidget(content_widget)

    def create_status_bar(self):
        """创建状态栏"""
        self.status_bar = StatusBar()
        self.setStatusBar(self.status_bar)

    def create_menu_bar(self):
        """创建菜单栏"""
        menubar = self.menuBar()

        # 文件菜单
        file_menu = menubar.addMenu('文件')
        browse_action = QAction('选择文件夹', self)
        browse_action.setShortcut(QKeySequence("Ctrl+O"))
        browse_action.triggered.connect(self.browse_folder)
        file_menu.addAction(browse_action)

        scan_action = QAction('扫描漫画', self)
        scan_action.setShortcut(QKeySequence("Ctrl+S"))
        scan_action.triggered.connect(self.scan_albums)
        file_menu.addAction(scan_action)

        file_menu.addSeparator()
        exit_action = QAction('退出', self)
        exit_action.setShortcut(QKeySequence("Ctrl+Q"))
        exit_action.triggered.connect(self.close)
        file_menu.addAction(exit_action)

        # 视图菜单
        view_menu = menubar.addMenu('视图')
        recent_action = QAction('最近浏览', self)
        recent_action.setShortcut(QKeySequence("Ctrl+R"))
        recent_action.triggered.connect(self.show_recent)
        view_menu.addAction(recent_action)

        favorites_action = QAction('我的收藏', self)
        favorites_action.setShortcut(QKeySequence("Ctrl+F"))
        favorites_action.triggered.connect(self.show_favorites)
        view_menu.addAction(favorites_action)

        theme_action = QAction('切换主题', self)
        theme_action.triggered.connect(self.toggle_theme)
        view_menu.addAction(theme_action)

        # 帮助菜单
        help_menu = menubar.addMenu('帮助')
        settings_action = QAction('设置', self)
        settings_action.setShortcut(QKeySequence("Ctrl+,"))
        settings_action.triggered.connect(self.show_settings)
        help_menu.addAction(settings_action)

    def create_shortcuts(self):
        """创建快捷键"""
        # F5刷新扫描
        refresh_action = QAction(self)
        refresh_action.setShortcut(QKeySequence("F5"))
        refresh_action.triggered.connect(self.scan_albums)
        self.addAction(refresh_action)

    def apply_theme_style(self):
        """应用主题样式"""
        # 应用主窗口样式
        self.setStyleSheet(self.style_manager.get_stylesheet('main_window'))

        # 应用各组件样式
        if hasattr(self, 'sidebar'):
            self.sidebar.setStyleSheet(self.style_manager.get_stylesheet('sidebar'))

        if hasattr(self, 'toolbar'):
            self.toolbar.setStyleSheet(self.style_manager.get_stylesheet('toolbar'))

        if hasattr(self, 'album_grid'):
            self.album_grid.setStyleSheet(self.style_manager.get_stylesheet('album_card'))

        if hasattr(self, 'status_bar'):
            self.status_bar.setStyleSheet(self.style_manager.get_stylesheet('status_bar'))

    def toggle_theme(self):
        """切换主题"""
        self.style_manager.toggle_theme()

    def show_initial_state(self):
        """显示初始状态"""
        self.album_grid.show_empty_state()
        self.status_bar.set_status("欢迎使用漫画阅读器 - 选择文件夹开始使用", "info")

    def browse_folder(self):
        """浏览并选择文件夹"""
        folder = QFileDialog.getExistingDirectory(
            self,
            "选择漫画文件夹",
            self.folder_path or str(Path.home())
        )

        if folder:
            self.folder_path = folder
            self.config_manager.set_last_path(folder)
            folder_name = Path(folder).name
            if len(folder_name) > 30:
                display_name = folder_name[:27] + "..."
            else:
                display_name = folder_name
            self.status_bar.set_status(f"已选择: {display_name}", "success")

            # 自动开始扫描
            self.scan_albums()

    def scan_albums(self):
        """扫描漫画"""
        if not self.folder_path:
            self.status_bar.set_status("请先选择文件夹", "warning")
            return

        # 创建扫描器实例（如果不存在）
        if not hasattr(self, 'scanner'):
            from src.core.album_scanner import AlbumScannerService
            self.scanner = AlbumScannerService(self)

        # 启动扫描
        self.status_bar.set_status("正在扫描...", "info")
        self.scanner.scan_albums()

    def show_recent(self):
        """显示最近浏览"""
        from src.core.album_history import AlbumHistoryManager
        self.current_view_state = "recent"
        history_manager = AlbumHistoryManager(self)
        history_manager.show_recent_albums()

    def show_favorites(self):
        """显示收藏"""
        from src.core.album_favorites import AlbumFavoritesManager
        self.current_view_state = "favorites"
        favorites_manager = AlbumFavoritesManager(self)
        favorites_manager.show_favorites()

    def show_home(self):
        """返回主页"""
        self.current_view_state = "home"
        self.status_bar.set_status("返回主页", "info")
        self.album_grid.show_empty_state()

    def show_settings(self):
        """显示设置"""
        from .components.settings_dialog import SettingsDialog

        dialog = SettingsDialog(self.config_manager, self)
        result = dialog.exec()

        if result == QDialog.DialogCode.Accepted:
            # 应用设置
            self.apply_settings()
            self.status_bar.set_status("设置已保存", "success")

    def apply_settings(self):
        """应用设置"""
        # 应用主题
        theme = self.config_manager.get_theme()
        if theme == 'dark':
            self.style_manager.is_dark = True
        elif theme == 'light':
            self.style_manager.is_dark = False

        # 应用侧边栏宽度
        sidebar_width = self.config_manager.get_sidebar_width()
        if hasattr(self, 'sidebar'):
            self.sidebar.setFixedWidth(sidebar_width)

    def apply_filter(self, filter_text):
        """应用筛选"""
        self.album_grid.apply_filter(filter_text)
        self.status_bar.set_status(f"筛选: {filter_text}", "info")

    def on_search(self, text):
        """搜索处理"""
        # TODO: 实现搜索
        self.status_bar.set_status(f"搜索: {text}", "info")

    def open_album(self, album_path):
        """打开相册"""
        from src.core.album_viewer import AlbumViewerManager
        viewer = AlbumViewerManager(self)
        viewer.open_album(album_path)

    def toggle_favorite(self, album_path):
        """切换收藏状态"""
        if self.config_manager.is_favorite(album_path):
            self.config_manager.remove_favorite(album_path)
            self.status_bar.set_status(f"已从收藏中移除: {Path(album_path).name}", "warning")
        else:
            self.config_manager.add_favorite(album_path)
            self.status_bar.set_status(f"已添加到收藏: {Path(album_path).name}", "success")

        # 刷新当前显示
        if self.albums:
            self.album_grid.update_albums(self.albums)

            # 如果在收藏视图中，需要重新加载收藏列表
            if self.current_view_state == "favorites":
                self.show_favorites()
