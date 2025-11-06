"""
极简主义组件库
基于HTML原型图设计的可复用PyQt6组件
"""

# 基础组件
from .base.base_widget import BaseWidget
from .base.card import Card
from .base.container import Container

# 按钮组件
from .buttons.button import Button
from .buttons.primary_button import PrimaryButton
from .buttons.secondary_button import SecondaryButton
from .buttons.icon_button import IconButton

# 卡片组件
from .cards.album_card import AlbumCard

# 输入组件
from .inputs.line_edit import LineEdit
from .inputs.search_input import SearchInput

# 显示组件
from .display.tag import Tag
from .display.label import Label

# 导航组件
from .navigation.nav_button import NavButton
from .navigation.breadcrumbs import Breadcrumbs
from .navigation.pagination import Pagination

# 反馈组件
from .feedback.empty_state import EmptyState
from .feedback.loading_indicator import LoadingIndicator, LoadingSpinner
from .feedback.progress_bar import ProgressBar

__all__ = [
    # 基础
    'BaseWidget',
    'Card',
    'Container',

    # 按钮
    'Button',
    'PrimaryButton',
    'SecondaryButton',
    'IconButton',

    # 卡片
    'AlbumCard',

    # 输入
    'LineEdit',
    'SearchInput',

    # 显示
    'Tag',
    'Label',

    # 导航
    'NavButton',
    'Breadcrumbs',
    'Pagination',

    # 反馈
    'EmptyState',
    'LoadingIndicator',
    'LoadingSpinner',
    'ProgressBar',
]
