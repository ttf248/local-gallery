"""
搜索和筛选面板组件
提供高级搜索、筛选功能
使用组件库：SearchInput, Tag, Button, Card, Label等
"""

import sys
from pathlib import Path
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QScrollArea, QFrame,
    QSlider, QLabel as QtLabel, QComboBox, QCheckBox, QButtonGroup,
    QRadioButton, QLineEdit, QGroupBox
)
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QFont

# 添加src路径
src_path = Path(__file__).parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from ui_pyqt6.style_manager import StyleManager
from ui_pyqt6.components.library import (
    SearchInput, Tag, PrimaryButton, SecondaryButton, IconButton,
    Label, Card, EmptyState
)


class SearchPanel(QWidget):
    """搜索和筛选面板"""

    # 定义信号
    searchRequested = pyqtSignal(str)  # 搜索请求
    filterChanged = pyqtSignal(dict)   # 筛选条件变化
    clearFilters = pyqtSignal()        # 清空筛选

    def __init__(self, parent=None):
        super().__init__(parent)
        self.style_manager = StyleManager()
        self.current_filters = {}
        self.init_ui()

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("search-panel")
        self.setMinimumWidth(320)
        self.setMaximumWidth(400)

        # 主布局
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # 创建滚动区域
        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        scroll_area.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        scroll_area.setObjectName("search-scroll")
        scroll_area.setFrameShape(QFrame.Shape.NoFrame)

        # 滚动内容
        scroll_content = QWidget()
        scroll_content.setObjectName("search-content")
        scroll_layout = QVBoxLayout(scroll_content)
        scroll_layout.setContentsMargins(16, 16, 16, 16)
        scroll_layout.setSpacing(16)

        # 搜索框
        self.create_search_section(scroll_layout)

        # 快速筛选标签
        self.create_quick_tags_section(scroll_layout)

        # 分类筛选
        self.create_category_section(scroll_layout)

        # 排序选项
        self.create_sort_section(scroll_layout)

        # 高级筛选
        self.create_advanced_section(scroll_layout)

        # 筛选结果统计
        self.create_result_stats_section(scroll_layout)

        scroll_layout.addStretch()

        scroll_area.setWidget(scroll_content)
        layout.addWidget(scroll_area, 1)

    def create_search_section(self, parent_layout):
        """创建搜索框区域"""
        search_card = Card(self, self.style_manager)
        search_layout = QVBoxLayout(search_card)
        search_layout.setContentsMargins(12, 12, 12, 12)
        search_layout.setSpacing(8)

        # 搜索框标题
        title = Label("搜索漫画", self, self.style_manager)
        title.set_font_size('base')
        title.set_bold(True)
        search_layout.addWidget(title)

        # 搜索输入框
        self.search_input = SearchInput(
            placeholder="输入标题、作者、标签...",
            parent=self,
            style_manager=self.style_manager
        )
        self.search_input.textChanged.connect(self.on_search_text_changed)
        search_layout.addWidget(self.search_input)

        # 搜索按钮
        search_btn_layout = QHBoxLayout()
        search_btn_layout.addStretch()

        self.search_btn = PrimaryButton("搜索", self, self.style_manager)
        self.search_btn.clicked.connect(self.on_search_clicked)
        search_btn_layout.addWidget(self.search_btn)

        search_layout.addLayout(search_btn_layout)
        parent_layout.addWidget(search_card)

    def create_quick_tags_section(self, parent_layout):
        """创建快速筛选标签区域"""
        tags_card = Card(self, self.style_manager)
        tags_layout = QVBoxLayout(tags_card)
        tags_layout.setContentsMargins(12, 12, 12, 12)
        tags_layout.setSpacing(8)

        # 标题
        title = Label("快速筛选", self, self.style_manager)
        title.set_font_size('base')
        title.set_bold(True)
        tags_layout.addWidget(title)

        # 标签网格
        self.tags_group = QButtonGroup()
        self.tags_layout = QHBoxLayout()
        self.tags_layout.setSpacing(8)

        # 预定义标签
        quick_tags = [
            ("全部", None),
            ("未读", "#E3F2FD"),
            ("已收藏", "#FFEBEE"),
            ("最近更新", "#FFF3E0"),
            ("高评分", "#E8F5E9"),
        ]

        for tag_text, bg_color in quick_tags:
            if tag_text == "全部":
                tag_btn = SecondaryButton(tag_text, self, self.style_manager)
                tag_btn.setCheckable(True)
                tag_btn.setChecked(True)
                tag_btn.clicked.connect(lambda checked, t=tag_text: self.on_tag_selected(t))
                self.tags_group.addButton(tag_btn)
                self.tags_layout.addWidget(tag_btn)
            else:
                tag = Tag(
                    text=tag_text,
                    bg_color=bg_color or "#F8F9FA",
                    text_color="#2C3E50",
                    parent=self,
                    style_manager=self.style_manager
                )
                tag.setCursor(Qt.CursorShape.PointingHandCursor)
                tag.mousePressEvent = lambda e, t=tag_text: self.on_tag_selected(t)
                self.tags_layout.addWidget(tag)

        tags_layout.addLayout(self.tags_layout)
        parent_layout.addWidget(tags_card)

    def create_category_section(self, parent_layout):
        """创建分类筛选区域"""
        category_group = QGroupBox("分类")
        category_group.setFont(self.style_manager.get_font('sm'))
        category_group.setStyleSheet(f"""
            QGroupBox {{
                color: {self.style_manager.get_colors()['text-primary']};
                font-size: {self.style_manager.font_sizes['sm']}px;
                font-weight: 500;
                border: 1px solid {self.style_manager.get_colors()['border-light']};
                border-radius: 6px;
                margin-top: 12px;
                padding-top: 8px;
            }}
            QGroupBox::title {{
                subcontrol-origin: margin;
                left: 8px;
                padding: 0 4px;
            }}
        """)

        layout = QVBoxLayout(category_group)
        layout.setContentsMargins(12, 8, 12, 12)
        layout.setSpacing(6)

        # 分类选项
        self.category_group = QButtonGroup()
        categories = ["全部", "冒险", "爱情", "奇幻", "科幻", "日常", "校园", "职场"]
        for category in categories:
            radio = QRadioButton(category)
            radio.setFont(self.style_manager.get_font('sm'))
            radio.toggled.connect(self.on_filter_changed)
            layout.addWidget(radio)
            self.category_group.addButton(radio)

        # 默认选中"全部"
        layout.itemAt(1).widget().setChecked(True)

        parent_layout.addWidget(category_group)

    def create_sort_section(self, parent_layout):
        """创建排序选项区域"""
        sort_group = QGroupBox("排序")
        sort_group.setFont(self.style_manager.get_font('sm'))
        sort_group.setStyleSheet(f"""
            QGroupBox {{
                color: {self.style_manager.get_colors()['text-primary']};
                font-size: {self.style_manager.font_sizes['sm']}px;
                font-weight: 500;
                border: 1px solid {self.style_manager.get_colors()['border-light']};
                border-radius: 6px;
                margin-top: 12px;
                padding-top: 8px;
            }}
            QGroupBox::title {{
                subcontrol-origin: margin;
                left: 8px;
                padding: 0 4px;
            }}
        """)

        layout = QVBoxLayout(sort_group)
        layout.setContentsMargins(12, 8, 12, 12)
        layout.setSpacing(6)

        # 排序选项
        self.sort_combo = QComboBox()
        self.sort_combo.addItems([
            "默认排序",
            "标题 A-Z",
            "标题 Z-A",
            "作者 A-Z",
            "评分 高-低",
            "评分 低-高",
            "页数 多-少",
            "页数 少-多",
            "最近更新"
        ])
        self.sort_combo.setFont(self.style_manager.get_font('sm'))
        self.sort_combo.currentTextChanged.connect(self.on_filter_changed)
        layout.addWidget(self.sort_combo)

        parent_layout.addWidget(sort_group)

    def create_advanced_section(self, parent_layout):
        """创建高级筛选区域"""
        advanced_group = QGroupBox("高级筛选")
        advanced_group.setFont(self.style_manager.get_font('sm'))
        advanced_group.setStyleSheet(f"""
            QGroupBox {{
                color: {self.style_manager.get_colors()['text-primary']};
                font-size: {self.style_manager.font_sizes['sm']}px;
                font-weight: 500;
                border: 1px solid {self.style_manager.get_colors()['border-light']};
                border-radius: 6px;
                margin-top: 12px;
                padding-top: 8px;
            }}
            QGroupBox::title {{
                subcontrol-origin: margin;
                left: 8px;
                padding: 0 4px;
            }}
        """)

        layout = QVBoxLayout(advanced_group)
        layout.setContentsMargins(12, 8, 12, 12)
        layout.setSpacing(8)

        # 评分筛选
        rating_layout = QVBoxLayout()
        rating_label = Label("最低评分", self, self.style_manager)
        rating_label.set_font_size('sm')
        rating_layout.addWidget(rating_label)

        self.rating_slider = QSlider(Qt.Orientation.Horizontal)
        self.rating_slider.setRange(0, 10)
        self.rating_slider.setValue(0)
        self.rating_slider.setTickPosition(QSlider.TickPosition.TicksBelow)
        self.rating_slider.valueChanged.connect(self.on_filter_changed)
        rating_layout.addWidget(self.rating_slider)

        self.rating_value = Label("0.0", self, self.style_manager)
        self.rating_value.set_font_size('sm')
        rating_layout.addWidget(self.rating_value)

        layout.addLayout(rating_layout)

        # 页数筛选
        pages_layout = QVBoxLayout()
        pages_label = Label("页数范围", self, self.style_manager)
        pages_label.set_font_size('sm')
        pages_layout.addWidget(pages_label)

        pages_range_layout = QHBoxLayout()
        self.min_pages = QLineEdit()
        self.min_pages.setPlaceholderText("最小")
        self.min_pages.setFont(self.style_manager.get_font('sm'))
        self.min_pages.textChanged.connect(self.on_filter_changed)
        pages_range_layout.addWidget(self.min_pages)

        pages_range_layout.addWidget(QtLabel("-"))

        self.max_pages = QLineEdit()
        self.max_pages.setPlaceholderText("最大")
        self.max_pages.setFont(self.style_manager.get_font('sm'))
        self.max_pages.textChanged.connect(self.on_filter_changed)
        pages_range_layout.addWidget(self.max_pages)

        pages_layout.addLayout(pages_range_layout)
        layout.addLayout(pages_layout)

        # 状态筛选
        status_layout = QVBoxLayout()
        status_label = Label("阅读状态", self, self.style_manager)
        status_label.set_font_size('sm')
        status_layout.addWidget(status_label)

        self.status_combo = QComboBox()
        self.status_combo.addItems(["全部", "未读", "已读", "在读"])
        self.status_combo.setFont(self.style_manager.get_font('sm'))
        self.status_combo.currentTextChanged.connect(self.on_filter_changed)
        status_layout.addWidget(self.status_combo)

        layout.addLayout(status_layout)

        parent_layout.addWidget(advanced_group)

    def create_result_stats_section(self, parent_layout):
        """创建结果统计区域"""
        stats_card = Card(self, self.style_manager)
        stats_layout = QVBoxLayout(stats_card)
        stats_layout.setContentsMargins(12, 12, 12, 12)
        stats_layout.setSpacing(8)

        # 标题
        title = Label("筛选结果", self, self.style_manager)
        title.set_font_size('base')
        title.set_bold(True)
        stats_layout.addWidget(title)

        # 结果统计
        self.result_count = Label("共找到 0 部漫画", self, self.style_manager)
        self.result_count.set_font_size('sm')
        self.result_count.set_text_color(self.style_manager.get_colors()['text-secondary'])
        stats_layout.addWidget(self.result_count)

        # 清空筛选按钮
        clear_btn = SecondaryButton("清空所有筛选", self, self.style_manager)
        clear_btn.clicked.connect(self.clear_all_filters)
        stats_layout.addWidget(clear_btn)

        parent_layout.addWidget(stats_card)

    def on_search_text_changed(self, text):
        """搜索文本变化"""
        if len(text) >= 2 or len(text) == 0:
            self.searchRequested.emit(text)

    def on_search_clicked(self):
        """搜索按钮点击"""
        search_text = self.search_input.get_text()
        self.searchRequested.emit(search_text)

    def on_tag_selected(self, tag_text):
        """标签选择"""
        if tag_text == "全部":
            # 重置其他标签
            for i in range(1, self.tags_layout.count()):
                widget = self.tags_layout.itemAt(i).widget()
                if isinstance(widget, Tag):
                    widget.setStyleSheet(f"""
                        QLabel {{
                            background-color: {widget.bg_color};
                            color: {widget.text_color};
                        }}
                    """)
        else:
            # 取消"全部"选中，选中当前标签
            all_btn = self.tags_layout.itemAt(0).widget()
            if isinstance(all_btn, SecondaryButton):
                all_btn.setChecked(False)

            # 高亮当前标签
            for i in range(1, self.tags_layout.count()):
                widget = self.tags_layout.itemAt(i).widget()
                if isinstance(widget, Tag) and widget.get_text() == tag_text:
                    widget.setStyleSheet(f"""
                        QLabel {{
                            background-color: {self.style_manager.get_colors()['minimal-blue']};
                            color: white;
                        }}
                    """)
                else:
                    widget.setStyleSheet(f"""
                        QLabel {{
                            background-color: {widget.bg_color};
                            color: {widget.text_color};
                        }}
                    """)

        self.on_filter_changed()

    def on_filter_changed(self):
        """筛选条件变化"""
        filters = {}

        # 分类筛选
        if self.category_group.checkedButton():
            category = self.category_group.checkedButton().text()
            if category != "全部":
                filters['category'] = category

        # 排序
        sort_option = self.sort_combo.currentText()
        if sort_option != "默认排序":
            filters['sort'] = sort_option

        # 评分筛选
        min_rating = self.rating_slider.value()
        if min_rating > 0:
            filters['min_rating'] = min_rating
            self.rating_value.setText(f"{min_rating:.1f}")

        # 页数筛选
        min_pages_text = self.min_pages.text()
        max_pages_text = self.max_pages.text()
        if min_pages_text and min_pages_text.isdigit():
            filters['min_pages'] = int(min_pages_text)
        if max_pages_text and max_pages_text.isdigit():
            filters['max_pages'] = int(max_pages_text)

        # 状态筛选
        status = self.status_combo.currentText()
        if status != "全部":
            filters['status'] = status

        # 搜索文本
        search_text = self.search_input.get_text()
        if search_text:
            filters['search'] = search_text

        self.current_filters = filters
        self.filterChanged.emit(filters)

    def clear_all_filters(self):
        """清空所有筛选条件"""
        # 重置搜索框
        self.search_input.clear()

        # 重置快速标签
        all_btn = self.tags_layout.itemAt(0).widget()
        if isinstance(all_btn, SecondaryButton):
            all_btn.setChecked(True)

        # 重置分类
        if self.category_group.checkedButton():
            self.category_group.checkedButton().setChecked(False)
        self.category_group.buttons()[0].setChecked(True)

        # 重置排序
        self.sort_combo.setCurrentIndex(0)

        # 重置高级筛选
        self.rating_slider.setValue(0)
        self.rating_value.setText("0.0")
        self.min_pages.clear()
        self.max_pages.clear()
        self.status_combo.setCurrentIndex(0)

        # 重置标签样式
        for i in range(1, self.tags_layout.count()):
            widget = self.tags_layout.itemAt(i).widget()
            if isinstance(widget, Tag):
                widget.setStyleSheet(f"""
                    QLabel {{
                        background-color: {widget.bg_color};
                        color: {widget.text_color};
                    }}
                """)

        # 清空筛选条件
        self.current_filters = {}
        self.filterChanged.emit({})
        self.clearFilters.emit()

    def update_result_count(self, count):
        """更新结果数量"""
        self.result_count.setText(f"共找到 {count} 部漫画")

    def get_filters(self):
        """获取当前筛选条件"""
        return self.current_filters.copy()

    def set_filters(self, filters):
        """设置筛选条件"""
        # TODO: 实现从外部设置筛选条件
        pass
