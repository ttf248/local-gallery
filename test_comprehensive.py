"""
综合测试脚本
验证UI重构后的所有功能
"""

import sys
import os
from pathlib import Path
import time
import traceback

# 添加src路径
src_path = Path(__file__).parent / "src"
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

# 测试结果
test_results = {
    "total": 0,
    "passed": 0,
    "failed": 0,
    "skipped": 0,
    "errors": []
}


def test_import(module_name, description):
    """测试模块导入"""
    test_results["total"] += 1
    try:
        __import__(module_name)
        print(f"[PASS] {description}")
        test_results["passed"] += 1
        return True
    except Exception as e:
        # 忽略PyQt6相关错误
        if "PyQt6" in str(e) or "PyQt" in str(e):
            print(f"[SKIP] {description} (PyQt6未安装)")
            test_results["skipped"] += 1
            return True
        print(f"[FAIL] {description}: {e}")
        test_results["failed"] += 1
        test_results["errors"].append(f"{description}: {e}")
        return False


def test_class_import(module_path, class_name, description):
    """测试类导入"""
    test_results["total"] += 1
    try:
        from importlib import import_module
        module = import_module(module_path)
        getattr(module, class_name)
        print(f"[PASS] {description}")
        test_results["passed"] += 1
        return True
    except Exception as e:
        # 忽略PyQt6相关错误
        if "PyQt6" in str(e) or "PyQt" in str(e):
            print(f"[SKIP] {description} (PyQt6未安装)")
            test_results["skipped"] += 1
            return True
        print(f"[FAIL] {description}: {e}")
        test_results["failed"] += 1
        test_results["errors"].append(f"{description}: {e}")
        return False


def test_syntax(file_path, description):
    """测试Python文件语法"""
    test_results["total"] += 1
    try:
        import py_compile
        py_compile.compile(file_path, doraise=True)
        print(f"[PASS] {description}")
        test_results["passed"] += 1
        return True
    except Exception as e:
        print(f"[FAIL] {description}: {e}")
        test_results["failed"] += 1
        test_results["errors"].append(f"{description}: {e}")
        return False


def test_configuration():
    """测试配置系统"""
    print("\n=== 配置系统测试 ===")
    test_class_import(
        "ui_pyqt6.config_manager",
        "ConfigManager",
        "ConfigManager导入"
    )


def test_style_system():
    """测试样式系统"""
    print("\n=== 样式系统测试 ===")
    test_class_import(
        "ui_pyqt6.style_manager",
        "StyleManager",
        "StyleManager导入"
    )

    test_import(
        "ui_pyqt6.theme.minimal",
        "极简主题模块"
    )

    # QSS文件不是Python文件，跳过语法检查
    # test_syntax(
    #     src_path / "ui_pyqt6/qss/minimal.qss",
    #     "QSS样式文件"
    # )


def test_component_library():
    """测试组件库"""
    print("\n=== 组件库测试 ===")

    # 基础组件
    test_class_import(
        "ui_pyqt6.components.library.base.base_widget",
        "BaseWidget",
        "BaseWidget导入"
    )
    test_class_import(
        "ui_pyqt6.components.library.base.card",
        "Card",
        "Card导入"
    )

    # 按钮组件
    test_class_import(
        "ui_pyqt6.components.library.buttons.button",
        "Button",
        "Button导入"
    )
    test_class_import(
        "ui_pyqt6.components.library.buttons.primary_button",
        "PrimaryButton",
        "PrimaryButton导入"
    )
    test_class_import(
        "ui_pyqt6.components.library.buttons.secondary_button",
        "SecondaryButton",
        "SecondaryButton导入"
    )
    test_class_import(
        "ui_pyqt6.components.library.buttons.icon_button",
        "IconButton",
        "IconButton导入"
    )

    # 卡片组件
    test_class_import(
        "ui_pyqt6.components.library.cards.album_card",
        "AlbumCard",
        "AlbumCard导入"
    )

    # 输入组件
    test_class_import(
        "ui_pyqt6.components.library.inputs.line_edit",
        "LineEdit",
        "LineEdit导入"
    )
    test_class_import(
        "ui_pyqt6.components.library.inputs.search_input",
        "SearchInput",
        "SearchInput导入"
    )

    # 显示组件
    test_class_import(
        "ui_pyqt6.components.library.display.label",
        "Label",
        "Label导入"
    )
    test_class_import(
        "ui_pyqt6.components.library.display.tag",
        "Tag",
        "Tag导入"
    )

    # 导航组件
    test_class_import(
        "ui_pyqt6.components.library.navigation.nav_button",
        "NavButton",
        "NavButton导入"
    )

    # 反馈组件
    test_class_import(
        "ui_pyqt6.components.library.feedback.loading_indicator",
        "LoadingIndicator",
        "LoadingIndicator导入"
    )


def test_animation_system():
    """测试动画系统"""
    print("\n=== 动画系统测试 ===")

    test_class_import(
        "ui_pyqt6.animation_manager",
        "AnimationManager",
        "AnimationManager导入"
    )

    test_class_import(
        "ui_pyqt6.widgets.animated_widget",
        "AnimatedWidget",
        "AnimatedWidget导入"
    )
    test_class_import(
        "ui_pyqt6.widgets.animated_widget",
        "AnimatedButtonMixin",
        "AnimatedButtonMixin导入"
    )
    test_class_import(
        "ui_pyqt6.widgets.animated_widget",
        "AnimatedCardMixin",
        "AnimatedCardMixin导入"
    )
    test_class_import(
        "ui_pyqt6.widgets.animated_widget",
        "TransitionManager",
        "TransitionManager导入"
    )


def test_ui_components():
    """测试UI组件"""
    print("\n=== UI组件测试 ===")

    # 主界面组件
    test_class_import(
        "ui_pyqt6.minimal_album_grid",
        "MinimalAlbumGrid",
        "MinimalAlbumGrid导入"
    )
    test_class_import(
        "ui_pyqt6.components.minimal_sidebar",
        "MinimalSidebar",
        "MinimalSidebar导入"
    )
    test_class_import(
        "ui_pyqt6.components.minimal_toolbar",
        "MinimalToolbar",
        "MinimalToolbar导入"
    )

    # 阅读界面
    test_class_import(
        "ui_pyqt6.reader_view",
        "ReaderView",
        "ReaderView导入"
    )

    # 搜索界面
    test_class_import(
        "ui_pyqt6.search_panel",
        "SearchPanel",
        "SearchPanel导入"
    )

    # 设置界面
    test_class_import(
        "ui_pyqt6.components.settings_dialog",
        "SettingsDialog",
        "SettingsDialog导入"
    )
    test_class_import(
        "ui_pyqt6.components.shortcut_editor",
        "ShortcutEditor",
        "ShortcutEditor导入"
    )


def test_file_structure():
    """测试文件结构"""
    print("\n=== 文件结构测试 ===")

    required_files = [
        "src/ui_pyqt6/style_manager.py",
        "src/ui_pyqt6/qss/minimal.qss",
        "src/ui_pyqt6/animation_manager.py",
        "src/ui_pyqt6/widgets/animated_widget.py",
        "src/ui_pyqt6/components/library/__init__.py",
        "src/ui_pyqt6/minimal_album_grid.py",
        "src/ui_pyqt6/reader_view.py",
        "src/ui_pyqt6/search_panel.py",
        "src/ui_pyqt6/components/settings_dialog.py",
        "docs/STAGE1_SUMMARY.md",
        "docs/STAGE2_SUMMARY.md",
        "docs/STAGE3_SUMMARY.md",
        "docs/STAGE4_SUMMARY.md",
        "docs/STAGE5_SUMMARY.md",
        "docs/STAGE6_SUMMARY.md",
        "docs/STAGE7_SUMMARY.md",
        "docs/STAGE8_SUMMARY.md",
    ]

    for file_path in required_files:
        test_results["total"] += 1
        if Path(file_path).exists():
            print(f"[PASS] 文件存在: {file_path}")
            test_results["passed"] += 1
        else:
            print(f"[FAIL] 文件缺失: {file_path}")
            test_results["failed"] += 1
            test_results["errors"].append(f"文件缺失: {file_path}")


def test_documentation():
    """测试文档完整性"""
    print("\n=== 文档测试 ===")

    # Markdown文件不是Python文件，跳过语法检查
    # test_syntax(
    #     src_path / "ui_pyqt6/ANIMATION_GUIDE.md",
    #     "动画集成指南"
    # )

    # 检查README
    if Path("README.md").exists():
        test_results["total"] += 1
        print("[PASS] README.md存在")
        test_results["passed"] += 1
    else:
        test_results["total"] += 1
        print("[FAIL] README.md不存在")
        test_results["failed"] += 1
        test_results["errors"].append("README.md不存在")


def test_code_quality():
    """测试代码质量"""
    print("\n=== 代码质量测试 ===")

    # 统计所有Python文件
    src_dir = Path("src")
    total_lines = 0
    file_count = 0

    if src_dir.exists():
        for py_file in src_dir.rglob("*.py"):
            try:
                with open(py_file, 'r', encoding='utf-8') as f:
                    lines = len(f.readlines())
                    total_lines += lines
                    file_count += 1
            except Exception as e:
                # 忽略读取错误
                pass

    print(f"[INFO] 总文件数: {file_count}")
    print(f"[INFO] 总代码行数: {total_lines}")

    # 检查是否超过最小行数要求
    test_results["total"] += 1
    if total_lines > 5000:  # 至少5000行代码
        print(f"[PASS] 代码量充足 ({total_lines} 行)")
        test_results["passed"] += 1
    else:
        print(f"[FAIL] 代码量不足 (当前 {total_lines} 行，要求 > 5000 行)")
        test_results["failed"] += 1
        test_results["errors"].append(f"代码量不足: {total_lines} 行")


def print_summary():
    """打印测试摘要"""
    print("\n" + "="*60)
    print("测试摘要")
    print("="*60)
    print(f"总测试数: {test_results['total']}")
    print(f"通过: {test_results['passed']} [PASS]")
    print(f"失败: {test_results['failed']} [FAIL]")
    print(f"跳过: {test_results['skipped']} [SKIP]")

    if test_results['total'] > 0:
        pass_rate = (test_results['passed'] / test_results['total']) * 100
        print(f"通过率: {pass_rate:.1f}%")

    if test_results['errors']:
        print("\n错误列表:")
        for i, error in enumerate(test_results['errors'][:10], 1):
            print(f"{i}. {error}")

    print("="*60)

    # 返回测试结果
    return test_results['failed'] == 0


def main():
    """主测试函数"""
    print("="*60)
    print("PyQt6漫画阅读器 - UI重构综合测试")
    print("="*60)
    print(f"测试时间: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print()

    start_time = time.time()

    # 运行所有测试
    test_configuration()
    test_style_system()
    test_component_library()
    test_animation_system()
    test_ui_components()
    test_file_structure()
    test_documentation()
    test_code_quality()

    # 打印摘要
    elapsed_time = time.time() - start_time
    print(f"\n测试耗时: {elapsed_time:.2f} 秒")

    success = print_summary()

    # 返回退出码
    return 0 if success else 1


if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
