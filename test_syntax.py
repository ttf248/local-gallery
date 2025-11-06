"""
语法检查测试
检查所有组件文件的语法是否正确
"""

import sys
import py_compile
from pathlib import Path

def check_file_syntax(file_path):
    """检查文件语法"""
    try:
        py_compile.compile(file_path, doraise=True)
        return True
    except py_compile.PyCompileError as e:
        print(f"[ERROR] 语法错误 in {file_path}: {e}")
        return False
    except Exception as e:
        print(f"[ERROR] 未知错误 in {file_path}: {e}")
        return False

def main():
    """主测试函数"""
    print("=" * 50)
    print("组件库语法检查")
    print("=" * 50)

    # 获取所有组件文件
    component_dir = Path(__file__).parent / "src" / "ui_pyqt6" / "components" / "library"
    python_files = list(component_dir.rglob("*.py"))

    if not python_files:
        print("[ERROR] 未找到组件文件")
        return 1

    print(f"找到 {len(python_files)} 个Python文件\n")

    all_passed = True
    for file_path in python_files:
        if file_path.name == "__init__.py":
            print(f"[SKIP] {file_path.relative_to(Path(__file__).parent)} (跳过__init__.py)")
            continue

        print(f"[CHECK] {file_path.relative_to(Path(__file__).parent)}")
        if not check_file_syntax(file_path):
            all_passed = False

    print("\n" + "=" * 50)
    print("检查结果")
    print("=" * 50)

    if all_passed:
        print("[SUCCESS] 所有文件语法检查通过！")
        print(f"共检查 {len(python_files)} 个文件")
        return 0
    else:
        print("[FAIL] 部分文件存在语法错误")
        return 1

if __name__ == "__main__":
    sys.exit(main())
