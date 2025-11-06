"""
极简主义工具栏组件
基于HTML原型图设计：搜索框、筛选、网格/列表切换
"""

from PyQt6.QtWidgets import (
    QWidget, QHBoxLayout, QPushButton, QLineEdit, QComboBox,
    QLabel, QSpacerItem, QSizePolicy, QFrame
)
from PyQt6.QtCore import Qt, pyqtSignal, QPropertyAnimation, QEasingCurve
from PyQt6.QtGui import QFont, QIcon


class MinimalToolbar(QWidget):
    """极简主义工具栏组件"""

    # 定义信号
    browseClicked = pyqtSignal()
    scanClicked = pyqtSignal()
    filterChanged = pyqtSignal(str)
    themeClicked = pyqtSignal()
    settingsClicked = pyqtSignal()
    searchTextChanged = pyqtSignal(str)
    viewModeChanged = pyqtSignal(str)  # 'grid' or 'list'

    def __init__(self, parent=None):
        super().__init__(parent)
        self.current_view = 'grid'  # 默认网格视图
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("minimal-toolbar")
        self.setFixedHeight(72)

        # 主布局
        layout = QHBoxLayout(self)
        layout.setContentsMargins(24, 12, 24, 12)
        layout.setSpacing(16)

        # 左侧操作区
        self.create_left_panel(layout)

        # 中间搜索区
        self.create_search_panel(layout)

        # 右侧功能区
        self.create_right_panel(layout)

    def create_left_panel(self, parent_layout):
        """创建左侧操作面板"""
        # 导入按钮
        self.import_btn = QPushButton("导入")
        self.import_btn.setObjectName("toolbar-button")
        self.import_btn.clicked.connect(self.browseClicked)
        parent_layout.addWidget(self.import_btn)

        # 扫描按钮
        self.scan_btn = QPushButton("扫描")
        self.scan_btn.setObjectName("toolbar-button-primary")
        self.scan_btn.clicked.connect(self.scanClicked)
        parent_layout.addWidget(self.scan_btn)

        # 分隔线
        separator = QFrame()
        separator.setObjectName("toolbar-separator")
        separator.setFrameShape(QFrame.Shape.VLine)
        separator.setFrameShadow(QFrame.Shadow.Sunken)
        parent_layout.addWidget(separator)

    def create_search_panel(self, parent_layout):
        """创建搜索面板"""
        # 搜索输入框
        self.search_input = QLineEdit()
        self.search_input.setObjectName("search-input")
        self.search_input.setPlaceholderText("搜索漫画标题、作者...")
        self.search_input.setMinimumWidth(400)
        self.search_input.textChanged.connect(self.searchTextChanged.emit)
        parent_layout.addWidget(self.search_input, 1)

    def create_right_panel(self, parent_layout):
        """创建右侧功能面板"""
        # 筛选按钮
        self.filter_btn = QPushButton("筛选")
        self.filter_btn.setObjectName("toolbar-button")
        self.filter_btn.setCheckable(True)
        self.filter_btn.clicked.connect(self.on_filter_clicked)
        parent_layout.addWidget(self.filter_btn)

        # 网格视图按钮
        self.grid_btn = QPushButton()
        self.grid_btn.setObjectName("view-button")
        self.grid_btn.setToolTip("网格视图")
        self.grid_btn.setCheckable(True)
        self.grid_btn.setChecked(True)
        self.grid_btn.clicked.connect(lambda: self.set_view_mode('grid'))
        parent_layout.addWidget(self.grid_btn)

        # 列表视图按钮
        self.list_btn = QPushButton()
        self.list_btn.setObjectName("view-button")
        self.list_btn.setToolTip("列表视图")
        self.list_btn.setCheckable(True)
        self.list_btn.clicked.connect(lambda: self.set_view_mode('list'))
        parent_layout.addWidget(self.list_btn)

        # 分隔线
        separator2 = QFrame()
        separator2.setObjectName("toolbar-separator")
        separator2.setFrameShape(QFrame.Shape.VLine)
        separator2.setFrameShadow(QFrame.Shadow.Sunken)
        parent_layout.addWidget(separator2)

        # 主题切换按钮
        self.theme_btn = QPushButton("主题")
        self.theme_btn.setObjectName("toolbar-button")
        self.theme_btn.setCheckable(True)
        self.theme_btn.clicked.connect(self.themeClicked)
        parent_layout.addWidget(self.theme_btn)

        # 设置按钮
        self.settings_btn = QPushButton("设置")
        self.settings_btn.setObjectName("toolbar-button")
        self.settings_btn.clicked.connect(self.settingsClicked)
        parent_layout.addWidget(self.settings_btn)

    def set_view_mode(self, mode):
        """设置视图模式"""
        if self.current_view == mode:
            return

        self.current_view = mode

        # 更新按钮状态
        if mode == 'grid':
            self.grid_btn.setChecked(True)
            self.list_btn.setChecked(False)
        else:
            self.grid_btn.setChecked(False)
            self.list_btn.setChecked(True)

        # 发送信号
        self.viewModeChanged.emit(mode)

        # 添加点击动画
        sender = self.sender()
        if sender:
            self.animate_click(sender)

    def on_filter_clicked(self):
        """筛选按钮点击处理"""
        if self.filter_btn.isChecked():
            # 筛选器展开（这里可以添加下拉菜单）
            pass
        else:
            # 筛选器收起
            pass

    def animate_click(self, button):
        """点击动画效果"""
        animation = QPropertyAnimation(button, b"geometry")
        animation.setDuration(150)
        animation.setEasingCurve(QEasingCurve.Type.OutCubic)

        # 获取按钮当前几何
        geo = button.geometry()
        # 轻微缩放效果
        animation.setStartValue(geo)
        animation.setEndValue(geo)
        animation.start()

    def set_search_text(self, text):
        """设置搜索文本"""
        self.search_input.setText(text)

    def get_search_text(self):
        """获取搜索文本"""
        return self.search_input.text()

    def set_scan_enabled(self, enabled):
        """设置扫描按钮启用状态"""
        self.scan_btn.setEnabled(enabled)

    def update_filter_count(self, count):
        """更新筛选器计数（如果需要）"""
        if count > 0:
            self.filter_btn.setText(f"筛选({count})")
        else:
            self.filter_btn.setText("筛选")
