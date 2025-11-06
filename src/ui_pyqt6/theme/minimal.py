"""
极简主义主题配置
严格遵循HTML原型图的视觉规范
"""

# 极简配色方案 - 浅色主题
MINIMAL_LIGHT = {
    # 主色调 - 来自HTML原型
    'minimal-gray': '#F8F9FA',         # 背景 - 干净浅灰
    'minimal-border': '#E9ECEF',       # 边框 - 精细分割线
    'minimal-text': '#2C3E50',         # 主文字 - 深蓝灰
    'minimal-muted': '#6C757D',        # 辅助文字 - 中灰
    'minimal-blue': '#4A90E2',         # 强调色 - 极简蓝
    'minimal-green': '#50C878',        # 成功色 - 翠绿
    'minimal-red': '#E74C3C',          # 错误色 - 珊瑚红
    'minimal-yellow': '#F39C12',       # 警告色 - 琥珀黄

    # 功能色
    'primary': '#4A90E2',
    'primary-hover': '#3A7BD5',
    'primary-pressed': '#2A6BC5',

    # 背景色系
    'bg-primary': '#FFFFFF',           # 主背景
    'bg-secondary': '#F8F9FA',         # 次要背景
    'bg-tertiary': '#F2F2F2',          # 三级背景
    'bg-accent': '#E3F2FD',            # 强调背景

    # 文字色系
    'text-primary': '#2C3E50',         # 主要文字
    'text-secondary': '#6C757D',       # 次要文字
    'text-tertiary': '#ADB5BD',        # 三级文字
    'text-muted': '#868E96',           # 静音文字
    'text-white': '#FFFFFF',           # 白色文字

    # 边框色系
    'border-light': '#E9ECEF',         # 浅边框
    'border-medium': '#DEE2E6',        # 中等边框
    'border-dark': '#CED4DA',          # 深边框
    'border-focus': '#4A90E2',         # 聚焦边框

    # 卡片样式
    'card-bg': '#FFFFFF',              # 卡片背景
    'card-border': '#E9ECEF',          # 卡片边框
    'card-hover': '#4A90E2',           # 卡片悬停边框
    'card-shadow': 'rgba(0, 0, 0, 0.08)',  # 卡片阴影

    # 状态色
    'success': '#50C878',
    'success-bg': '#E8F5E9',
    'warning': '#F39C12',
    'warning-bg': '#FFF3E0',
    'error': '#E74C3C',
    'error-bg': '#FFEBEE',
    'info': '#4A90E2',
    'info-bg': '#E3F2FD',

    # 滚动条
    'scrollbar': '#CBD5E0',
    'scrollbar-hover': '#A0AEC0',
    'scrollbar-track': '#F8F9FA',
}

# 极简配色方案 - 深色主题
MINIMAL_DARK = {
    # 主色调
    'minimal-gray': '#1A1D23',         # 深色背景
    'minimal-border': '#2D3748',       # 深色边框
    'minimal-text': '#E2E8F0',         # 深色文字
    'minimal-muted': '#A0AEC0',        # 深色辅助文字
    'minimal-blue': '#4A90E2',         # 保持蓝色强调
    'minimal-green': '#50C878',
    'minimal-red': '#E74C3C',
    'minimal-yellow': '#F39C12',

    # 功能色
    'primary': '#4A90E2',
    'primary-hover': '#5CA0F2',
    'primary-pressed': '#3A7BD5',

    # 背景色系
    'bg-primary': '#1A1D23',
    'bg-secondary': '#1E2229',
    'bg-tertiary': '#252A32',
    'bg-accent': '#1E3A5F',

    # 文字色系
    'text-primary': '#E2E8F0',
    'text-secondary': '#A0AEC0',
    'text-tertiary': '#718096',
    'text-muted': '#4A5568',
    'text-white': '#FFFFFF',

    # 边框色系
    'border-light': '#2D3748',
    'border-medium': '#374151',
    'border-dark': '#4A5568',
    'border-focus': '#4A90E2',

    # 卡片样式
    'card-bg': '#1E2229',
    'card-border': '#2D3748',
    'card-hover': '#4A90E2',
    'card-shadow': 'rgba(0, 0, 0, 0.3)',

    # 状态色
    'success': '#50C878',
    'success-bg': '#1B3A2F',
    'warning': '#F39C12',
    'warning-bg': '#3D2A0F',
    'error': '#E74C3C',
    'error-bg': '#3D1214',
    'info': '#4A90E2',
    'info-bg': '#1E3A5F',

    # 滚动条
    'scrollbar': '#4A5568',
    'scrollbar-hover': '#718096',
    'scrollbar-track': '#1E2229',
}

# 字体系统
FONT_SYSTEM = {
    # 字体族 - 按优先级
    'families': [
        'Inter',               # 现代无衬线字体
        'PingFang SC',         # 苹果苹方
        'Microsoft YaHei',     # 微软雅黑
        'SF Pro Display',      # SF Pro（如果可用）
        'Segoe UI',            # Windows UI
        'Roboto',              # Android 字体
        'system-ui',           # 系统默认
        'sans-serif',          # 通用无衬线
    ],

    # 字体大小 - 8px基础网格
    'sizes': {
        'xs': 11,    # 极小文字 - 标签、小注释
        'sm': 12,    # 小文字 - 按钮、菜单
        'base': 14,  # 基础文字 - 正文
        'lg': 16,    # 大文字 - 小标题
        'xl': 18,    # 特大文字 - 中标题
        '2xl': 20,   # 标题 - Section标题
        '3xl': 24,   # 大标题 - 页面标题
        '4xl': 30,   # 特大标题 - 主标题
    },

    # 字重
    'weights': {
        'light': 300,
        'normal': 400,
        'medium': 500,
        'semibold': 600,
        'bold': 700,
    },
}

# 间距系统 - 4px基础网格
SPACING = {
    'xs': 4,      # 极小间距 - 图标内边距
    'sm': 8,      # 小间距 - 元素间距
    'md': 12,     # 中等间距 - 组件内边距
    'lg': 16,     # 大间距 - 组件外边距
    'xl': 24,     # 特大间距 - 区块间距
    '2xl': 32,    # 页面边距 - 容器边距
    '3xl': 48,    # 区域间距 - 大区块
    '4xl': 64,    # 页面间距 - 页面级别
}

# 圆角系统
BORDER_RADIUS = {
    'none': 0,
    'sm': 4,      # 小圆角 - 按钮、小元素
    'md': 8,      # 中等圆角 - 卡片、输入框
    'lg': 12,     # 大圆角 - 对话框
    'xl': 16,     # 特大圆角 - 大卡片
    'full': 9999, # 完全圆形 - 头像
}

# 阴影系统
SHADOWS = {
    'sm': {
        'x': 0, 'y': 1, 'blur': 2,
        'spread': 0, 'color': 'rgba(0, 0, 0, 0.05)'
    },
    'md': {
        'x': 0, 'y': 4, 'blur': 6,
        'spread': -1, 'color': 'rgba(0, 0, 0, 0.1)'
    },
    'lg': {
        'x': 0, 'y': 10, 'blur': 15,
        'spread': -3, 'color': 'rgba(0, 0, 0, 0.1)'
    },
    'xl': {
        'x': 0, 'y': 20, 'blur': 25,
        'spread': -5, 'color': 'rgba(0, 0, 0, 0.15)'
    },
    'inner': {
        'x': 0, 'y': 2, 'blur': 4,
        'spread': 0, 'color': 'rgba(0, 0, 0, 0.06)', 'inset': True
    },
}

# 动画时长
ANIMATION = {
    'fast': 150,      # 快速 - 点击反馈
    'normal': 200,    # 正常 - 悬停效果
    'slow': 300,      # 慢 - 页面切换
}

# 响应式断点（为未来扩展准备）
BREAKPOINTS = {
    'xs': 0,      # 极小屏幕
    'sm': 600,    # 小屏幕
    'md': 900,    # 中等屏幕
    'lg': 1200,   # 大屏幕
    'xl': 1536,   # 特大屏幕
}
