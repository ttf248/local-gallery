"""
PyQt6主窗口
现代化iPhone风格界面
"""

from PyQt6.QtWidgets import (
    QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QPushButton, QStatusBar, QToolBar
)
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QAction, QIcon

class MainWindow(QMainWindow):
    """主窗口"""

    # 定义信号
    folderSelected = pyqtSignal(str)  # 文件夹选择信号
    scanRequested = pyqtSignal()     # 扫描请求信号

    def __init__(self):
        super().__init__()

        # 初始化UI
        self.init_ui()

    def init_ui(self):
        """初始化用户界面"""
        self.setWindowTitle("漫画阅读器 - 现代化图片管理")
        self.setMinimumSize(1200, 800)

        # 设置中央部件
        central_widget = QWidget()
        self.setCentralWidget(central_widget)

        # 创建主布局
        main_layout = QVBoxLayout(central_widget)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # TODO: 创建侧边栏、工具栏、相册网格等组件
        # 占位标签
        placeholder = QLabel("PyQt6 UI - 开发中...")
        placeholder.setAlignment(Qt.AlignmentFlag.AlignCenter)
        placeholder.setStyleSheet("""
            QLabel {
                font-size: 24px;
                color: #666;
                background-color: #f5f5f5;
            }
        """)
        main_layout.addWidget(placeholder)

        # 创建状态栏
        self.status_bar = QStatusBar()
        self.setStatusBar(self.status_bar)
        self.status_bar.showMessage("准备就绪")

        # 创建工具栏
        self.create_toolbar()

    def create_toolbar(self):
        """创建工具栏"""
        toolbar = QToolBar("主工具栏")
        self.addToolBar(toolbar)

        # TODO: 添加工具栏按钮
        # 占位按钮
        action = QAction("选择文件夹", self)
        action.triggered.connect(self.on_select_folder)
        toolbar.addAction(action)

        toolbar.addSeparator()

        scan_action = QAction("扫描漫画", self)
        scan_action.triggered.connect(self.on_scan)
        toolbar.addAction(scan_action)

    def on_select_folder(self):
        """选择文件夹"""
        # TODO: 实现文件夹选择
        print("选择文件夹")

    def on_scan(self):
        """扫描漫画"""
        # TODO: 实现扫描
        print("扫描漫画")
