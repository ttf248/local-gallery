"""
漫画阅读器 - 主入口
基于PyQt6的现代化图片管理应用
"""

import sys
import traceback
from pathlib import Path

# 添加src路径
src_path = Path(__file__).parent / 'src'
sys.path.insert(0, str(src_path))

def main():
    """主函数"""
    try:
        # 初始化日志系统
        from utils.logger import get_logger, log_info, log_error, log_exception
        logger = get_logger('main')
        log_info("=== 漫画阅读器启动 (PyQt6) ===", 'main')

        # 导入配置管理器
        from core.config import ConfigManager
        config_manager = ConfigManager()

        # 创建PyQt6应用程序
        from ui_pyqt6.app import ComicReaderApp
        from ui_pyqt6.main_window import MainWindow

        log_info("创建PyQt6应用程序", 'main')
        app = ComicReaderApp(sys.argv)

        log_info("创建主窗口", 'main')
        window = MainWindow(config_manager)
        window.show()

        log_info("应用程序启动成功，进入主循环", 'main')
        # 运行主循环
        exit_code = app.run()

        log_info(f"=== 应用程序正常退出，退出码: {exit_code} ===", 'main')
        sys.exit(exit_code)

    except Exception as e:
        error_msg = f"启动应用程序时发生错误：{e}"
        print(error_msg)
        traceback.print_exc()

        # 尝试使用日志系统记录错误
        try:
            from utils.logger import log_exception
            log_exception(error_msg, 'main')
        except:
            pass

        # 显示错误对话框
        try:
            from PyQt6.QtWidgets import QApplication, QMessageBox
            if not QApplication.instance():
                error_app = QApplication(sys.argv)
            msg = QMessageBox()
            msg.setIcon(QMessageBox.Icon.Critical)
            msg.setWindowTitle("启动错误")
            msg.setText(f"应用程序启动失败")
            msg.setDetailedText(str(e))
            msg.exec()
        except:
            pass

        sys.exit(1)

if __name__ == "__main__":
    main()