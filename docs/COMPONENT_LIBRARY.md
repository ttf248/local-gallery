# 极简主义组件库文档

基于HTML原型图设计的PyQt6可复用组件库，遵循极简设计原则。

## 目录结构

```
src/ui_pyqt6/components/library/
├── __init__.py           # 组件导出
├── base/                 # 基础组件
├── buttons/              # 按钮组件
├── cards/                # 卡片组件
├── display/              # 显示组件
├── feedback/             # 反馈组件
├── inputs/               # 输入组件
└── navigation/           # 导航组件
```

## 基础组件

### BaseWidget
所有组件的基类，提供统一的功能。

**特性：**
- 样式管理集成
- 主题支持
- 通用方法封装

### Card
通用卡片容器，用于包装内容。

**用法：**
```python
from src.ui_pyqt6.components.library import Card, StyleManager

card = Card(parent=widget, style_manager=style_manager)
```

### Container
布局容器组件。

**用法：**
```python
from src.ui_pyqt6.components.library import Container, StyleManager

container = Container(parent=widget, style_manager=style_manager)
```

## 按钮组件

### PrimaryButton
主要操作按钮，蓝色主题。

**特性：**
- 悬停效果
- 点击动画
- 图标支持

**用法：**
```python
from src.ui_pyqt6.components.library import PrimaryButton, StyleManager

button = PrimaryButton(
    text="确认",
    icon="✓",
    parent=widget,
    style_manager=style_manager
)
button.clicked.connect(on_click)
```

### SecondaryButton
次要操作按钮，灰色主题。

**用法：**
```python
from src.ui_pyqt6.components.library import SecondaryButton, StyleManager

button = SecondaryButton(
    text="取消",
    parent=widget,
    style_manager=style_manager
)
```

### IconButton
图标按钮。

**用法：**
```python
from src.ui_pyqt6.components.library import IconButton, StyleManager

button = IconButton(
    icon="♥",
    parent=widget,
    style_manager=style_manager
)
button.setCheckable(True)  # 可切换状态
```

## 卡片组件

### AlbumCard
漫画专辑卡片。

**特性：**
- 封面显示
- 标题和作者信息
- 收藏和播放按钮
- 评分显示
- 悬停效果

**用法：**
```python
from src.ui_pyqt6.components.library import AlbumCard

album_data = {
    'name': '漫画名称',
    'author': '作者名',
    'path': '/path/to/album',
    'page_count': 120,
    'rating': 9.2
}

card = AlbumCard(
    album_data=album_data,
    parent=widget,
    style_manager=style_manager
)
card.clicked.connect(on_album_clicked)
card.favoriteClicked.connect(on_favorite_clicked)
```

## 输入组件

### LineEdit
文本输入框。

**用法：**
```python
from src.ui_pyqt6.components.library import LineEdit

line_edit = LineEdit(
    text="",
    placeholder="请输入...",
    parent=widget,
    style_manager=style_manager
)
text = line_edit.get_text()
line_edit.set_text("新文本")
```

### SearchInput
搜索输入框，带搜索图标。

**特性：**
- 搜索图标
- 占位符支持
- 信号支持

**用法：**
```python
from src.ui_pyqt6.components.library import SearchInput

search = SearchInput(
    placeholder="搜索漫画...",
    parent=widget,
    style_manager=style_manager
)
search.textChanged.connect(on_text_changed)
search.returnPressed.connect(on_search)

# 获取搜索内容
query = search.get_text()
```

## 显示组件

### Label
文本标签。

**用法：**
```python
from src.ui_pyqt6.components.library import Label

label = Label(
    text="显示文本",
    parent=widget,
    style_manager=style_manager
)
label.set_text_color("#4A90E2")
label.set_font_size('lg')
label.set_bold(True)
label.set_alignment(Qt.AlignmentFlag.AlignCenter)
```

### Tag
标签组件。

**特性：**
- 小巧的标签样式
- 自定义颜色
- 点击信号

**用法：**
```python
from src.ui_pyqt6.components.library import Tag

tag = Tag(
    text="新标签",
    bg_color="#E3F2FD",
    text_color="#4A90E2",
    parent=widget,
    style_manager=style_manager
)
tag.clicked.connect(on_tag_clicked)
```

## 导航组件

### NavButton
导航按钮，用于侧边栏菜单。

**特性：**
- 激活状态支持
- 图标支持
- 悬停效果

**用法：**
```python
from src.ui_pyqt6.components.library import NavButton

nav_btn = NavButton(
    text="首页",
    icon="🏠",
    is_active=True,
    parent=widget,
    style_manager=style_manager
)
nav_btn.clicked.connect(on_nav_clicked)
nav_btn.set_active(False)  # 设置激活状态
```

### Breadcrumbs
面包屑导航。

**用法：**
```python
from src.ui_pyqt6.components.library import Breadcrumbs

breadcrumbs = Breadcrumbs(
    items=["首页", "漫画", "详情"],
    parent=widget,
    style_manager=style_manager
)
breadcrumbs.itemClicked.connect(on_item_clicked)
breadcrumbs.set_items(["新", "路", "径"])
```

### Pagination
分页组件。

**用法：**
```python
from src.ui_pyqt6.components.library import Pagination

pagination = Pagination(
    current_page=1,
    total_pages=10,
    parent=widget,
    style_manager=style_manager
)
pagination.pageChanged.connect(on_page_changed)
pagination.set_page(3)  # 跳转到第3页
```

## 反馈组件

### EmptyState
空状态提示。

**特性：**
- 图标显示
- 标题和描述
- 操作按钮

**用法：**
```python
from src.ui_pyqt6.components.library import EmptyState

empty = EmptyState(
    title="暂无数据",
    description="请先添加一些内容",
    action_text="去添加",
    icon="📭",
    parent=widget,
    style_manager=style_manager
)
empty.actionClicked.connect(on_action_clicked)
```

### LoadingIndicator
加载指示器（旋转动画）。

**特性：**
- 旋转动画
- 可调节大小
- 颜色主题

**用法：**
```python
from src.ui_pyqt6.components.library import LoadingIndicator

loading = LoadingIndicator(
    size="large",
    text="加载中...",
    parent=widget,
    style_manager=style_manager
)
loading.start()  # 开始动画
loading.stop()   # 停止动画
```

### ProgressBar
进度条。

**特性：**
- 自定义范围
- 百分比显示
- 颜色主题

**用法：**
```python
from src.ui_pyqt6.components.library import ProgressBar

progress = ProgressBar(
    minimum=0,
    maximum=100,
    value=50,
    show_text=True,
    parent=widget,
    style_manager=style_manager
)
progress.valueChanged.connect(on_value_changed)
progress.set_value(75)  # 设置进度值
```

## StyleManager 使用

每个组件都需要一个 `StyleManager` 实例来管理样式和主题。

```python
from src.ui_pyqt6.style_manager import StyleManager

# 创建样式管理器
style_manager = StyleManager()

# 获取颜色
colors = style_manager.get_colors()
bg_color = colors['minimal-blue']

# 获取字体
font = style_manager.get_font('sm')

# 获取圆角
radius = style_manager.border_radius['md']
```

## 事件处理

所有组件都使用PyQt6的信号-槽机制处理事件：

```python
# 按钮点击
button.clicked.connect(callback_function)

# 输入框文本变化
line_edit.textChanged.connect(callback_function)

# 自定义信号
custom_component.customSignal.connect(callback_function)
```

## 主题切换

组件支持主题切换，通过StyleManager管理：

```python
# 切换到深色主题
style_manager.set_theme('dark')

# 切换到浅色主题
style_manager.set_theme('light')
```

## 注意事项

1. **初始化顺序**：所有组件都应先创建，再设置属性
2. **样式管理**：每个组件都需要一个 `style_manager` 实例
3. **信号连接**：使用 `connect()` 方法连接信号
4. **内存管理**：PyQt6会自动管理组件内存
5. **线程安全**：UI操作必须在主线程中执行

## 最佳实践

1. **复用组件**：优先使用现有组件，避免重复开发
2. **保持一致**：遵循设计规范和颜色规范
3. **合理分层**：使用布局管理组件位置
4. **信号设计**：合理设计组件间的通信
5. **性能优化**：避免频繁的样式更新

## 扩展开发

如需开发新组件：

1. 继承 `BaseWidget`
2. 实现 `init_ui()` 方法
3. 使用 `StyleManager` 进行样式管理
4. 定义适当的信号
5. 遵循命名规范
6. 添加文档注释
