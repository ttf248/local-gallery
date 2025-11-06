"""
PyQt6状态栏组件
显示状态信息，支持多种联动
"""

import time
from datetime import datetime
from PyQt6.QtWidgets import QStatusBar, QLabel, QFrame
from PyQt6.QtCore import Qt, QTimer, pyqtSignal
from PyQt6.QtGui import QFont, QFontMetrics

class StatusBar(QStatusBar):
    """状态栏组件，支持丰富联动"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.init_ui()
        self.start_time = None
        self.current_operation = ""
        self.operation_count = 0

    def init_ui(self):
        """初始化UI"""
        self.setObjectName("status_bar")

        # 主状态标签
        self.status_label = QLabel("准备就绪")
        self.status_label.setObjectName("status_label")
        self.status_label.setMinimumWidth(300)
        self.addWidget(self.status_label)

        # 分隔符1
        self.separator1 = QLabel(" | ")
        self.separator1.setObjectName("separator")
        self.addPermanentWidget(self.separator1)

        # 操作信息标签
        self.operation_label = QLabel("")
        self.operation_label.setObjectName("operation_label")
        self.operation_label.setMinimumWidth(200)
        self.addPermanentWidget(self.operation_label)

        # 分隔符2
        self.separator2 = QLabel(" | ")
        self.separator2.setObjectName("separator")
        self.addPermanentWidget(self.separator2)

        # 时间标签
        self.time_label = QLabel("")
        self.time_label.setObjectName("time_label")
        self.addPermanentWidget(self.time_label)

        # 启动时间更新定时器
        self.time_timer = QTimer()
        self.time_timer.timeout.connect(self.update_time)
        self.time_timer.start(1000)  # 每秒更新

        # 初始化显示
        self.update_time()

    def update_time(self):
        """更新时间显示"""
        current_time = datetime.now().strftime("%H:%M:%S")
        self.time_label.setText(current_time)

    def set_status(self, text, msg_type="info"):
        """设置状态信息"""
        # 记录操作开始时间
        if "开始" in text or "正在" in text or "扫描" in text:
            self.start_time = time.time()
            self.current_operation = text

        self.status_label.setText(text)

        # 根据消息类型设置颜色
        colors = {
            "info": "#86868B",
            "success": "#34C759",
            "warning": "#FF9500",
            "error": "#FF3B30",
        }
        color = colors.get(msg_type, "#86868B")
        self.status_label.setStyleSheet(f"color: {color};")

        # 如果是完成操作，显示耗时
        if "完成" in text and self.start_time:
            elapsed = time.time() - self.start_time
            if elapsed > 1:  # 只显示超过1秒的操作
                self.set_operation(f"耗时 {elapsed:.1f}s", "info")

    def set_info(self, text):
        """设置附加信息"""
        self.info_label.setText(text)

    def set_operation(self, text, msg_type="info"):
        """设置操作信息"""
        self.operation_label.setText(text)

        # 根据消息类型设置颜色
        colors = {
            "info": "#86868B",
            "success": "#34C759",
            "warning": "#FF9500",
            "error": "#FF3B30",
        }
        color = colors.get(msg_type, "#86868B")
        self.operation_label.setStyleSheet(f"color: {color};")

    def show_scan_progress(self, progress, status):
        """显示扫描进度"""
        self.set_status(f"扫描中: {status}", "info")
        self.set_operation(f"进度: {progress}%", "info")

    def show_scan_complete(self, count, total_images):
        """显示扫描完成"""
        self.set_status(f"扫描完成 - 找到 {count} 个项目", "success")
        self.set_operation(f"共 {total_images} 张图片", "success")
        self.current_operation = ""
        self.start_time = None

    def show_error(self, error_msg):
        """显示错误信息"""
        self.set_status(f"错误: {error_msg}", "error")
        self.set_operation("", "info")

    def show_file_selected(self, path, count=None):
        """显示文件选择"""
        from pathlib import Path
        name = Path(path).name
        if len(name) > 30:
            name = name[:27] + "..."

        self.set_status(f"已选择: {name}", "success")

        if count is not None:
            self.set_operation(f"共 {count} 个项目", "info")
        else:
            self.set_operation("", "info")

    def show_operation_count(self, operation, count):
        """显示操作计数"""
        self.set_status(f"{operation} ({count})", "info")
        self.operation_count = count

    def show_tip(self, tip_text):
        """显示提示信息"""
        self.set_status(tip_text, "info")
        # 3秒后清除提示
        QTimer.singleShot(3000, lambda: self.set_status("准备就绪", "info"))

    def show_keyboard_shortcut(self, key, description):
        """显示快捷键提示"""
        self.set_status(f"{key}: {description}", "info")

    def show_action_feedback(self, action, result="成功"):
        """显示操作反馈"""
        if result == "成功":
            self.set_status(f"{action} 成功", "success")
        elif result == "取消":
            self.set_status(f"{action} 已取消", "warning")
        else:
            self.set_status(f"{action} 失败", "error")

    def show_performance_info(self, info):
        """显示性能信息"""
        self.set_operation(info, "info")
