"""
测试组件初始化修复
"""

import sys
from pathlib import Path

# 添加src路径
src_path = Path(__file__).parent / "src"
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from ui_pyqt6.style_manager import StyleManager

style_manager = StyleManager()

print("测试组件初始化...")

# 测试NavButton
try:
    from ui_pyqt6.components.library.navigation.nav_button import NavButton
    nav_btn = NavButton("测试", icon="🏠", parent=None, style_manager=style_manager)
    print("✓ NavButton初始化成功")
except Exception as e:
    print(f"✗ NavButton初始化失败: {e}")

# 测试Label
try:
    from ui_pyqt6.components.library.display.label import Label
    label = Label("测试文字", parent=None, style_manager=style_manager)
    print("✓ Label初始化成功")
except Exception as e:
    print(f"✗ Label初始化失败: {e}")

# 测试LineEdit
try:
    from ui_pyqt6.components.library.inputs.line_edit import LineEdit
    line_edit = LineEdit("测试", placeholder="输入...", parent=None, style_manager=style_manager)
    print("✓ LineEdit初始化成功")
except Exception as e:
    print(f"✗ LineEdit初始化失败: {e}")

print("\n所有组件初始化测试完成！")
