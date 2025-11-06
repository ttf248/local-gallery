"""
极简主义工具栏组件
基于HTML原型图设计：搜索框、筛选、网格/列表切换
使用组件库：SearchInput, PrimaryButton, SecondaryButton, IconButton
"""

from PyQt6.QtWidgets import (
    QWidget, QHBoxLayout, QFrame
)
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QFont

import sys
from pathlib import Path

# 添加src路径
src_path = Path(__file__).parent.parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from ui_pyqt6.style_manager import StyleManager
from ui_pyqt6.components.library import SearchInput, PrimaryButton, SecondaryButton, IconButton


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
        self.style_manager = StyleManager()
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
        # 导入按钮 - 使用组件库的SecondaryButton
        self.import_btn = SecondaryButton(
            text="导入",
            parent=self,
            style_manager=self.style_manager
        )
        self.import_btn.clicked.connect(self.browseClicked)
        parent_layout.addWidget(self.import_btn)

        # 扫描按钮 - 使用组件库的PrimaryButton
        self.scan_btn = PrimaryButton(
            text="扫描",
            parent=self,
            style_manager=self.style_manager
        )
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
        # 搜索输入框 - 使用组件库的SearchInput
        self.search_input = SearchInput(
            placeholder="搜索漫画标题、作者...",
            parent=self,
            style_manager=self.style_manager
        )
        self.search_input.setMinimumWidth(400)
        self.search_input.textChanged.connect(self.searchTextChanged.emit)
        self.search_input.returnPressed.connect(lambda: self.searchTextChanged.emit(self.search_input.get_text()))
        parent_layout.addWidget(self.search_input, 1)

    def create_right_panel(self, parent_layout):
        """创建右侧功能面板"""
        # 筛选按钮 - 使用组件库的SecondaryButton
        self.filter_btn = SecondaryButton(
            text="筛选",
            parent=self,
            style_manager=self.style_manager
        )
        self.filter_btn.setCheckable(True)
        self.filter_btn.clicked.connect(self.on_filter_clicked)
        parent_layout.addWidget(self.filter_btn)

        # 网格视图按钮 - 使用组件库的IconButton
        self.grid_btn = IconButton(
            icon="⊞",
            parent=self,
            style_manager=self.style_manager
        )
        self.grid_btn.setToolTip("网格视图")
        self.grid_btn.setCheckable(True)
        self.grid_btn.setChecked(True)
        self.grid_btn.clicked.connect(lambda: self.set_view_mode('grid'))
        parent_layout.addWidget(self.grid_btn)

        # 列表视图按钮 - 使用组件库的IconButton
        self.list_btn = IconButton(
            icon="☰",
            parent=self,
            style_manager=self.style_manager
        )
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

        # 主题切换按钮 - 使用组件库的SecondaryButton
        self.theme_btn = SecondaryButton(
            text="主题",
            parent=self,
            style_manager=self.style_manager
        )
        self.theme_btn.setCheckable(True)
        self.theme_btn.clicked.connect(self.themeClicked)
        parent_layout.addWidget(self.theme_btn)

        # 设置按钮 - 使用组件库的SecondaryButton
        self.settings_btn = SecondaryButton(
            text="设置",
            parent=self,
            style_manager=self.style_manager
        )
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

    def on_filter_clicked(self):
        """筛选按钮点击处理"""
        if self.filter_btn.isChecked():
            # 筛选器展开（这里可以添加下拉菜单）
            pass
        else:
            # 筛选器收起
            pass

    def set_search_text(self, text):
        """设置搜索文本"""
        self.search_input.set_text(text)

    def get_search_text(self):
        """获取搜索文本"""
        return self.search_input.get_text()

    def set_scan_enabled(self, enabled):
        """设置扫描按钮启用状态"""
        self.scan_btn.setEnabled(enabled)

    def update_filter_count(self, count):
        """更新筛选器计数（如果需要）"""
        if count > 0:
            self.filter_btn.setText(f"筛选({count})")
        else:
            self.filter_btn.setText("筛选")
