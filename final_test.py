#!/usr/bin/env python3
"""
最终验证测试 - 检查所有修复是否成功
"""
import sys
from pathlib import Path

# Setup paths
src_path = Path(__file__).parent / 'src'
sys.path.insert(0, str(src_path))

print('='*60)
print('FINAL VERIFICATION TEST')
print('='*60)

# Test 1: Import utils modules
print('\n[Test 1] Importing utils modules...')
try:
    from utils.image_utils import ImageProcessor
    print('  [OK] utils.image_utils.ImageProcessor')
except Exception as e:
    print(f'  [ERROR] utils.image_utils: {e}')
    sys.exit(1)

try:
    from utils.image_cache import get_image_cache
    print('  [OK] utils.image_cache.get_image_cache')
except Exception as e:
    print(f'  [ERROR] utils.image_cache: {e}')
    sys.exit(1)

try:
    from utils.logger import get_logger
    print('  [OK] utils.logger.get_logger')
except Exception as e:
    print(f'  [ERROR] utils.logger: {e}')
    sys.exit(1)

# Test 2: Import core modules
print('\n[Test 2] Importing core modules...')
try:
    from core.album_scanner import AlbumScannerService
    print('  [OK] core.album_scanner.AlbumScannerService')
except Exception as e:
    print(f'  [ERROR] core.album_scanner: {e}')
    sys.exit(1)

try:
    from core.config import Config
    print('  [OK] core.config.Config')
except Exception as e:
    print(f'  [ERROR] core.config: {e}')
    sys.exit(1)

# Test 3: Import UI components
print('\n[Test 3] Importing UI components...')
try:
    from ui import StyleManager, StatusBar, AlbumGrid
    print('  [OK] ui module (StyleManager, StatusBar, AlbumGrid)')
except Exception as e:
    print(f'  [ERROR] ui module: {e}')
    sys.exit(1)

try:
    from ui.components.style_manager import get_safe_font
    print('  [OK] ui.components.style_manager.get_safe_font')
except Exception as e:
    print(f'  [ERROR] ui.components.style_manager: {e}')
    sys.exit(1)

try:
    from ui.components.status_bar import StatusBar
    print('  [OK] ui.components.status_bar.StatusBar')
except Exception as e:
    print(f'  [ERROR] ui.components.status_bar: {e}')
    sys.exit(1)

try:
    from ui.components.album_grid import AlbumGrid
    print('  [OK] ui.components.album_grid.AlbumGrid')
except Exception as e:
    print(f'  [ERROR] ui.components.album_grid: {e}')
    sys.exit(1)

try:
    from ui.components.image_viewer import ImageViewer
    print('  [OK] ui.components.image_viewer.ImageViewer')
except Exception as e:
    print(f'  [ERROR] ui.components.image_viewer: {e}')
    sys.exit(1)

try:
    from ui.components.toolbar import Toolbar
    print('  [OK] ui.components.toolbar.Toolbar')
except Exception as e:
    print(f'  [ERROR] ui.components.toolbar: {e}')
    sys.exit(1)

try:
    from ui.components.sidebar import Sidebar
    print('  [OK] ui.components.sidebar.Sidebar')
except Exception as e:
    print(f'  [ERROR] ui.components.sidebar: {e}')
    sys.exit(1)

# Test 4: Test basic functionality
print('\n[Test 4] Testing basic functionality...')
try:
    # Test ImageProcessor
    processor = ImageProcessor()
    size = processor.format_size(1024)
    assert size == '1.0KB', f"Expected '1.0KB', got '{size}'"
    print('  [OK] ImageProcessor.format_size works')
except Exception as e:
    print(f'  [ERROR] ImageProcessor test: {e}')
    sys.exit(1)

print('\n' + '='*60)
print('ALL TESTS PASSED!')
print('='*60)
print('\nSummary:')
print('  - All modules import successfully')
print('  - No relative import errors')
print('  - VS Code should be able to discover and run tests')
print('\nNext steps:')
print('  1. Reload VS Code window (Ctrl+Shift+P → Reload Window)')
print('  2. Run tests: cd tests && python test_suite.py')
print('='*60)

