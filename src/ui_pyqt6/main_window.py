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
from .components.minimal_sidebar import MinimalSidebar
from .components.minimal_toolbar import MinimalToolbar
from .minimal_album_grid import MinimalAlbumGrid
from .components.status_bar import StatusBar
from utils.logger import get_logger, log_info, log_warning, log_error, log_exception, log_debug, file_logger

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
        self.logger = get_logger('ui.main_window')
        self.style_manager = StyleManager()
        self.folder_path = config_manager.get_last_path()  # 从配置加载上次路径
        self.albums = []
        self.current_view_state = "home"

        # 创建快捷键管理器
        self.shortcut_manager = None

        # 设置日志系统配置管理器
        file_logger.set_config_manager(self.config_manager)

        log_info("MainWindow 初始化开始", 'ui.main_window')
        log_info(f"加载上次路径: {self.folder_path}", 'ui.main_window')

        # 初始化UI
        self.init_ui()
        log_info("MainWindow 初始化完成", 'ui.main_window')

    def init_ui(self):
        """初始化用户界面"""
        self.setWindowTitle("漫画阅读器 - 现代化图片管理")
        self.setMinimumSize(1200, 800)

        # 应用窗口状态 - 优先于UI创建
        self.restore_window_state()

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
        """创建极简侧边栏"""
        self.sidebar = MinimalSidebar()
        self.sidebar.homeClicked.connect(self.show_home)
        self.sidebar.browseClicked.connect(self.browse_folder)
        self.sidebar.scanClicked.connect(self.scan_albums)
        self.sidebar.recentClicked.connect(self.show_recent)
        self.sidebar.favoritesClicked.connect(self.show_favorites)
        self.sidebar.settingsClicked.connect(self.show_settings)

        # 侧边栏固定宽度 240px（按HTML原型）
        self.sidebar.setFixedWidth(240)
        parent.addWidget(self.sidebar)

    def create_content_area(self, parent):
        """创建内容区"""
        # 垂直布局：工具栏 + 主内容
        content_widget = QWidget()
        content_layout = QVBoxLayout(content_widget)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(0)

        # 极简工具栏
        self.toolbar = MinimalToolbar()
        self.toolbar.browseClicked.connect(self.browse_folder)
        self.toolbar.scanClicked.connect(self.scan_albums)
        self.toolbar.filterChanged.connect(self.apply_filter)
        self.toolbar.searchTextChanged.connect(self.on_search)
        self.toolbar.themeClicked.connect(self.toggle_theme)
        self.toolbar.settingsClicked.connect(self.show_settings)
        self.toolbar.viewModeChanged.connect(self.on_view_mode_changed)

        # 极简漫画网格 - 6列布局（按HTML原型）
        self.album_grid = MinimalAlbumGrid(self.config_manager)
        self.album_grid.albumClicked.connect(self.open_album)
        self.album_grid.favoriteClicked.connect(self.toggle_favorite)

        content_layout.addWidget(self.toolbar)
        content_layout.addWidget(self.album_grid, 1)

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
        """创建快捷键 - 从配置中读取并注册"""
        from .components.shortcuts import ShortcutManager

        # 创建快捷键管理器
        self.shortcut_manager = ShortcutManager(self)
        shortcuts = self.config_manager.get_shortcuts()

        # 注册所有快捷键
        # 1. 打开文件夹 - Ctrl+O
        self.shortcut_manager.register(
            shortcuts.get('open_folder', 'Ctrl+O'),
            self.browse_folder,
            "打开文件夹"
        )

        # 2. 扫描漫画 - F5
        self.shortcut_manager.register(
            shortcuts.get('scan_albums', 'F5'),
            self.scan_albums,
            "扫描漫画"
        )

        # 3. 最近浏览 - Ctrl+R
        self.shortcut_manager.register(
            shortcuts.get('open_recent', 'Ctrl+R'),
            self.show_recent,
            "最近浏览"
        )

        # 4. 我的收藏 - Ctrl+F
        self.shortcut_manager.register(
            shortcuts.get('open_favorites', 'Ctrl+F'),
            self.show_favorites,
            "我的收藏"
        )

        # 5. 收藏/取消收藏 - Ctrl+D
        self.shortcut_manager.register(
            shortcuts.get('toggle_favorite', 'Ctrl+D'),
            lambda: self.toggle_favorite(self.folder_path) if self.folder_path else None,
            "收藏/取消收藏"
        )

        # 6. 全屏 - F11
        self.shortcut_manager.register(
            shortcuts.get('fullscreen', 'F11'),
            self.toggle_fullscreen,
            "全屏"
        )

        # 7. 设置 - Ctrl+,
        settings_action = QAction(self)
        settings_action.setShortcut(QKeySequence("Ctrl+,"))
        settings_action.triggered.connect(self.show_settings)
        self.addAction(settings_action)

    def restore_window_state(self):
        """恢复窗口状态"""
        # 应用窗口几何信息
        geometry = self.config_manager.get_window_geometry()
        if geometry and len(geometry) == 4:
            self.setGeometry(*geometry)

        # 应用窗口最大化状态
        if self.config_manager.get_window_maximized():
            self.showMaximized()

    def save_window_state(self):
        """保存窗口状态"""
        if not self.config_manager.get_auto_save_window_state():
            return

        # 保存窗口几何信息
        if self.windowState() == Qt.WindowState.WindowNoState:
            # 窗口未最大化时，保存几何信息
            self.config_manager.set_window_geometry([
                self.x(),
                self.y(),
                self.width(),
                self.height()
            ])
            self.config_manager.set_window_maximized(False)
        elif self.windowState() == Qt.WindowState.WindowMaximized:
            # 窗口最大化时，只保存最大化状态
            self.config_manager.set_window_maximized(True)

    def closeEvent(self, event):
        """窗口关闭事件 - 保存窗口状态"""
        self.save_window_state()
        super().closeEvent(event)

    def apply_theme_style(self):
        """应用极简主题样式"""
        colors = self.style_manager.get_colors()

        # 加载QSS样式表
        qss_path = Path(__file__).parent / 'qss' / 'minimal.qss'
        if qss_path.exists():
            with open(qss_path, 'r', encoding='utf-8') as f:
                qss = f.read()
                # 替换配色变量
                for key, value in colors.items():
                    qss = qss.replace(f'#{key}', f'#{value}')
                self.setStyleSheet(qss)
        else:
            # 回退到内联样式
            self.setStyleSheet(self.style_manager.get_stylesheet('main_window'))

        # 应用各组件样式（已通过QSS处理，这里无需重复设置）

    def toggle_theme(self):
        """切换主题"""
        log_info("切换主题", 'ui.main_window')
        self.style_manager.toggle_theme()
        theme = "深色" if self.style_manager.is_dark else "浅色"
        self.status_bar.show_action_feedback(f"切换至{theme}主题", "成功")

    def show_initial_state(self):
        """显示初始状态"""
        self.album_grid.show_empty_state()
        self.status_bar.set_status("欢迎使用漫画阅读器 - 选择文件夹开始使用", "info")
        # 更新扫描按钮状态
        self.update_scan_button_state()

    def update_scan_button_state(self):
        """更新扫描按钮的启用/禁用状态"""
        if hasattr(self, 'toolbar') and hasattr(self.toolbar, 'scan_btn'):
            # 如果选择了文件夹，启用扫描按钮；否则禁用
            is_enabled = bool(self.folder_path and Path(self.folder_path).exists())
            self.toolbar.scan_btn.setEnabled(is_enabled)

            # 记录状态变更
            log_debug(f"扫描按钮状态: {'启用' if is_enabled else '禁用'}", 'ui.main_window')

    def browse_folder(self):
        """浏览并选择文件夹"""
        log_info("打开文件夹选择对话框", 'ui.main_window')
        # 从配置管理器获取上次路径，而不是使用self.folder_path
        last_path = self.config_manager.get_last_path()
        log_info(f"使用上次路径作为默认: {last_path}", 'ui.main_window')

        folder = QFileDialog.getExistingDirectory(
            self,
            "选择漫画文件夹",
            last_path or str(Path.home())
        )

        if folder:
            self.folder_path = folder
            self.config_manager.set_last_path(folder)
            folder_name = Path(folder).name
            if len(folder_name) > 30:
                display_name = folder_name[:27] + "..."
            else:
                display_name = folder_name

            log_info(f"选择文件夹: {folder}", 'ui.main_window')
            log_info(f"文件夹名称: {display_name}", 'ui.main_window')

            # 使用新的状态栏功能
            self.status_bar.show_file_selected(folder)

            # 更新扫描按钮状态
            self.update_scan_button_state()

            # 不再自动扫描
            log_info("选择文件夹完成，等待用户手动扫描", 'ui.main_window')
        else:
            log_info("取消文件夹选择", 'ui.main_window')
            self.status_bar.show_action_feedback("文件夹选择", "取消")
            # 更新扫描按钮状态
            self.update_scan_button_state()

    def scan_albums(self):
        """扫描漫画"""
        log_info("开始扫描漫画", 'ui.main_window')
        if not self.folder_path:
            log_warning("未选择文件夹，无法扫描", 'ui.main_window')
            self.status_bar.set_status("请先选择文件夹", "warning")
            return

        # 创建扫描器实例（如果不存在）
        if not hasattr(self, 'scanner'):
            log_info("创建AlbumScannerService实例", 'ui.main_window')
            from src.core.album_scanner import AlbumScannerService
            self.scanner = AlbumScannerService(self, self.config_manager)

        log_info(f"扫描路径: {self.folder_path}", 'ui.main_window')

        # 启动扫描
        self.status_bar.set_status("正在扫描...", "info")
        self.scanner.scan_albums()

    def show_recent(self):
        """显示最近浏览"""
        log_info("显示最近浏览", 'ui.main_window')
        from src.core.album_history import AlbumHistoryManager
        self.current_view_state = "recent"
        self.status_bar.show_action_feedback("打开最近浏览", "成功")
        history_manager = AlbumHistoryManager(self)
        history_manager.show_recent_albums()

    def show_favorites(self):
        """显示收藏"""
        log_info("显示收藏", 'ui.main_window')
        from src.core.album_favorites import AlbumFavoritesManager
        self.current_view_state = "favorites"
        self.status_bar.show_action_feedback("打开我的收藏", "成功")
        favorites_manager = AlbumFavoritesManager(self)
        favorites_manager.show_favorites()

    def show_home(self):
        """返回主页"""
        log_info("返回主页", 'ui.main_window')
        self.current_view_state = "home"
        self.status_bar.show_tip("返回主页")
        self.album_grid.show_empty_state()

    def show_settings(self):
        """显示设置"""
        log_info("打开设置对话框", 'ui.main_window')
        from .components.settings_dialog import SettingsDialog

        dialog = SettingsDialog(self.config_manager, self)
        result = dialog.exec()

        if result == QDialog.DialogCode.Accepted:
            log_info("设置已保存，应用新设置", 'ui.main_window')
            self.status_bar.show_action_feedback("设置保存", "成功")
            # 应用设置
            self.apply_settings()
        else:
            log_info("取消设置", 'ui.main_window')
            self.status_bar.show_action_feedback("设置", "取消")

    def apply_settings(self):
        """应用设置"""
        log_info("应用新设置", 'ui.main_window')
        theme = self.config_manager.get_theme()
        if theme == 'dark':
            self.style_manager.is_dark = True
        elif theme == 'light':
            self.style_manager.is_dark = False

        # 应用侧边栏宽度
        sidebar_width = self.config_manager.get_sidebar_width()
        if hasattr(self, 'sidebar'):
            self.sidebar.setFixedWidth(sidebar_width)

        # 更新日志级别
        file_logger._update_log_level()
        log_info(f"日志级别已更新为: {self.config_manager.get_log_level()}", 'ui.main_window')

    def apply_filter(self, filter_text):
        """应用筛选"""
        log_info(f"应用筛选: {filter_text}", 'ui.main_window')
        self.album_grid.apply_filter(filter_text)
        self.status_bar.show_action_feedback(f"筛选: {filter_text}", "成功")

    def on_search(self, text):
        """搜索处理"""
        log_info(f"搜索: {text}", 'ui.main_window')
        # TODO: 实现搜索
        self.status_bar.show_action_feedback(f"搜索: {text}", "成功")

    def open_album(self, album_path):
        """打开相册或合集"""
        # 查找对应的相册数据
        album_data = None
        for album in self.albums:
            if album.get('path') == album_path:
                album_data = album
                break

        if not album_data:
            log_warning(f"未找到相册数据: {album_path}", 'ui.main_window')
            return

        album_type = album_data.get('type', 'album')

        if album_type == 'collection' or album_type == 'smart_collection':
            # 打开合集查看器
            log_info(f"打开合集: {album_path}", 'ui.main_window')
            self.open_collection_viewer(album_data)
            self.status_bar.show_action_feedback(f"打开{album_type}", "成功")
        else:
            # 打开普通相册
            log_info(f"打开相册: {album_path}", 'ui.main_window')
            from src.core.album_viewer import AlbumViewerManager
            viewer = AlbumViewerManager(self)
            viewer.open_album(album_path)
            self.status_bar.show_action_feedback("打开相册", "成功")

    def open_collection_viewer(self, collection_data):
        """打开合集查看器"""
        try:
            log_info(f"创建合集查看器: {collection_data.get('name', '')}", 'ui.main_window')

            # 创建合集查看器窗口
            from .collection_viewer import CollectionViewer

            # 创建一个窗口来显示合集
            self.collection_window = QWidget()
            self.collection_window.setWindowTitle(f"合集: {collection_data.get('name', '')}")
            self.collection_window.setMinimumSize(900, 700)
            self.collection_window.setObjectName("collection_window")

            # 创建查看器
            self.collection_viewer = CollectionViewer(self, collection_data, self.collection_window)
            self.collection_viewer.albumClicked.connect(self.open_album)
            self.collection_viewer.backClicked.connect(self.collection_window.close)

            # 设置布局
            layout = QVBoxLayout(self.collection_window)
            layout.setContentsMargins(0, 0, 0, 0)
            layout.addWidget(self.collection_viewer)

            # 显示窗口
            self.collection_window.show()
            log_info("合集查看器窗口已创建", 'ui.main_window')

        except Exception as e:
            log_exception(f"打开合集查看器失败: {str(e)}", 'ui.main_window')
            self.status_bar.set_status("打开合集失败", "error")

    def toggle_favorite(self, album_path):
        """切换收藏状态"""
        if self.config_manager.is_favorite(album_path):
            self.config_manager.remove_favorite(album_path)
            self.status_bar.show_action_feedback("移除收藏", "成功")
        else:
            self.config_manager.add_favorite(album_path)
            self.status_bar.show_action_feedback("添加收藏", "成功")

        # 刷新当前显示
        if self.albums:
            self.album_grid.update_albums(self.albums)

            # 如果在收藏视图中，需要重新加载收藏列表
            if self.current_view_state == "favorites":
                self.show_favorites()

    def toggle_fullscreen(self):
        """切换全屏模式"""
        if self.windowState() == Qt.WindowState.WindowFullScreen:
            self.showNormal()
            self.status_bar.show_action_feedback("退出全屏", "成功")
        else:
            self.showFullScreen()
            self.status_bar.show_action_feedback("全屏模式", "成功")

    def on_view_mode_changed(self, mode):
        """视图模式切换"""
        self.album_grid.set_view_mode(mode)
        mode_name = "网格" if mode == 'grid' else "列表"
        self.status_bar.show_action_feedback(f"切换到{mode_name}视图", "成功")
