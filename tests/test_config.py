"""
配置系统单元测试
测试所有23个配置项的功能
"""

import unittest
import tempfile
import json
import os
from pathlib import Path
import sys

# 添加项目根目录到路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from src.core.config import ConfigManager


class TestConfigManager(unittest.TestCase):
    """配置管理器测试"""

    def setUp(self):
        """测试前准备"""
        # 使用临时目录
        self.test_dir = tempfile.mkdtemp()
        self.original_home = os.environ.get('HOME') or os.environ.get('USERPROFILE')
        os.environ['HOME'] = self.test_dir

        # 创建配置管理器
        self.config = ConfigManager()

    def tearDown(self):
        """测试后清理"""
        # 恢复原始HOME
        if self.original_home:
            os.environ['HOME'] = self.original_home
        else:
            del os.environ['HOME']

    def test_config_initialization(self):
        """测试配置初始化"""
        self.assertIsNotNone(self.config.config)
        self.assertGreater(len(self.config.config), 0)
        print(f"✓ 配置初始化成功，共{len(self.config.config)}个配置项")

    def test_default_config_items(self):
        """测试默认配置项完整性"""
        required_items = [
            'last_path', 'window_size', 'recent_albums', 'favorites',
            'max_recent', 'auto_switch_album', 'show_switch_notification',
            'theme', 'window_geometry', 'sidebar_width', 'window_maximized',
            'image_zoom_mode', 'image_smooth', 'image_preload', 'shortcuts',
            'image_cache_size', 'image_thumbnail_size', 'auto_save_window_state',
            'show_thumbnails', 'slideshow_interval', 'scan_recursive',
            'scan_hidden_folders', 'image_formats'
        ]

        for item in required_items:
            self.assertIn(item, self.config.config,
                         f"缺少配置项: {item}")
        print(f"✓ 所有{len(required_items)}个默认配置项存在")

    # ========== 主题与界面测试 ==========

    def test_theme_settings(self):
        """测试主题设置"""
        # 测试获取默认值
        self.assertEqual(self.config.get_theme(), 'light')

        # 测试设置主题
        self.config.set_theme('dark')
        self.assertEqual(self.config.get_theme(), 'dark')

        self.config.set_theme('system')
        self.assertEqual(self.config.get_theme(), 'system')
        print("✓ 主题设置测试通过")

    def test_window_settings(self):
        """测试窗口设置"""
        # 测试窗口最大化
        self.assertFalse(self.config.get_window_maximized())
        self.config.set_window_maximized(True)
        self.assertTrue(self.config.get_window_maximized())

        # 测试侧边栏宽度
        self.assertEqual(self.config.get_sidebar_width(), 240)
        self.config.set_sidebar_width(300)
        self.assertEqual(self.config.get_sidebar_width(), 300)

        print("✓ 窗口设置测试通过")

    def test_window_geometry(self):
        """测试窗口几何信息"""
        geometry = [100, 100, 1200, 800]
        self.config.set_window_geometry(geometry)
        self.assertEqual(self.config.get_window_geometry(), geometry)
        print("✓ 窗口几何信息测试通过")

    # ========== 图片查看器测试 ==========

    def test_image_viewer_settings(self):
        """测试图片查看器设置"""
        # 缩放模式
        self.assertEqual(self.config.get_image_zoom_mode(), 'fit_window')
        self.config.set_image_zoom_mode('original_size')
        self.assertEqual(self.config.get_image_zoom_mode(), 'original_size')

        # 图片平滑
        self.assertTrue(self.config.get_image_smooth())
        self.config.set_image_smooth(False)
        self.assertFalse(self.config.get_image_smooth())

        # 图片预加载
        self.assertTrue(self.config.get_image_preload())
        self.config.set_image_preload(False)
        self.assertFalse(self.config.get_image_preload())

        print("✓ 图片查看器设置测试通过")

    # ========== 快捷键测试 ==========

    def test_shortcuts(self):
        """测试快捷键设置"""
        shortcuts = self.config.get_shortcuts()
        self.assertIsInstance(shortcuts, dict)
        self.assertIn('open_folder', shortcuts)
        self.assertIn('fullscreen', shortcuts)

        # 测试修改快捷键
        self.config.set_shortcut('open_folder', 'Ctrl+Shift+O')
        self.assertEqual(self.config.get_shortcut('open_folder'), 'Ctrl+Shift+O')

        # 测试重置快捷键
        original_count = len(shortcuts)
        self.config.reset_shortcuts()
        new_shortcuts = self.config.get_shortcuts()
        self.assertEqual(len(new_shortcuts), original_count)

        print("✓ 快捷键设置测试通过")

    # ========== 高级设置测试 ==========

    def test_advanced_settings(self):
        """测试高级设置"""
        # 缓存大小
        self.assertEqual(self.config.get_image_cache_size(), 100)
        self.config.set_image_cache_size(200)
        self.assertEqual(self.config.get_image_cache_size(), 200)

        # 缩略图大小
        self.assertEqual(self.config.get_image_thumbnail_size(), 200)
        self.config.set_image_thumbnail_size(300)
        self.assertEqual(self.config.get_image_thumbnail_size(), 300)

        # 幻灯片间隔
        self.assertEqual(self.config.get_slideshow_interval(), 3)
        self.config.set_slideshow_interval(5)
        self.assertEqual(self.config.get_slideshow_interval(), 5)

        # 自动保存窗口状态
        self.assertTrue(self.config.get_auto_save_window_state())
        self.config.set_auto_save_window_state(False)
        self.assertFalse(self.config.get_auto_save_window_state())

        # 显示缩略图
        self.assertTrue(self.config.get_show_thumbnails())
        self.config.set_show_thumbnails(False)
        self.assertFalse(self.config.get_show_thumbnails())

        print("✓ 高级设置测试通过")

    # ========== 扫描设置测试 ==========

    def test_scan_settings(self):
        """测试扫描设置"""
        # 递归扫描
        self.assertTrue(self.config.get_scan_recursive())
        self.config.set_scan_recursive(False)
        self.assertFalse(self.config.get_scan_recursive())

        # 扫描隐藏文件夹
        self.assertFalse(self.config.get_scan_hidden_folders())
        self.config.set_scan_hidden_folders(True)
        self.assertTrue(self.config.get_scan_hidden_folders())

        # 图片格式
        formats = self.config.get_image_formats()
        self.assertIsInstance(formats, list)
        self.assertIn('jpg', formats)
        self.assertIn('png', formats)

        new_formats = ['jpg', 'png', 'webp']
        self.config.set_image_formats(new_formats)
        self.assertEqual(self.config.get_image_formats(), new_formats)

        print("✓ 扫描设置测试通过")

    # ========== 数据管理测试 ==========

    def test_recent_albums(self):
        """测试最近浏览"""
        # 添加测试路径
        test_path1 = "/test/comic1"
        test_path2 = "/test/comic2"

        self.config.add_recent_album(test_path1)
        self.config.add_recent_album(test_path2)

        recent = self.config.get_recent_albums()
        self.assertIn(test_path2, recent)
        self.assertLessEqual(len(recent), self.config.config['max_recent'])

        print("✓ 最近浏览测试通过")

    def test_favorites(self):
        """测试收藏功能"""
        test_path = "/test/favorite"

        # 添加收藏
        self.config.add_favorite(test_path)
        self.assertTrue(self.config.is_favorite(test_path))
        self.assertIn(test_path, self.config.get_favorites())

        # 移除收藏
        self.config.remove_favorite(test_path)
        self.assertFalse(self.config.is_favorite(test_path))

        print("✓ 收藏功能测试通过")

    def test_album_switching(self):
        """测试相册切换设置"""
        self.assertTrue(self.config.get_auto_switch_album())
        self.config.set_auto_switch_album(False)
        self.assertFalse(self.config.get_auto_switch_album())

        self.assertTrue(self.config.get_show_switch_notification())
        self.config.set_show_switch_notification(False)
        self.assertFalse(self.config.get_show_switch_notification())

        print("✓ 相册切换设置测试通过")

    # ========== 导入导出测试 ==========

    def test_export_import_config(self):
        """测试配置导入导出"""
        # 设置一些测试值
        self.config.set_theme('dark')
        self.config.set_image_cache_size(500)
        self.config.set_shortcut('open_folder', 'Ctrl+E')

        # 导出配置
        export_file = Path(self.test_dir) / 'test_export.json'
        result = self.config.export_config(str(export_file))
        self.assertTrue(result)
        self.assertTrue(export_file.exists())

        # 验证导出内容
        with open(export_file, 'r') as f:
            exported_data = json.load(f)
            self.assertEqual(exported_data['theme'], 'dark')
            self.assertEqual(exported_data['image_cache_size'], 500)

        # 修改配置
        self.config.set_theme('light')
        self.assertEqual(self.config.get_theme(), 'light')

        # 导入配置
        result = self.config.import_config(str(export_file))
        self.assertTrue(result)
        self.assertEqual(self.config.get_theme(), 'dark')
        self.assertEqual(self.config.get_image_cache_size(), 500)

        print("✓ 导入导出测试通过")

    def test_reset_to_default(self):
        """测试重置为默认"""
        # 修改一些配置
        self.config.set_theme('dark')
        self.config.set_image_cache_size(1000)
        self.config.set_shortcut('open_folder', 'Ctrl+X')

        # 重置
        self.config.reset_to_default()

        # 验证
        self.assertEqual(self.config.get_theme(), 'light')
        self.assertEqual(self.config.get_image_cache_size(), 100)
        self.assertEqual(self.config.get_shortcut('open_folder'), 'Ctrl+O')

        print("✓ 重置为默认测试通过")

    # ========== 路径管理测试 ==========

    def test_path_management(self):
        """测试路径管理"""
        test_path = "/test/last/path"

        # 设置最后路径
        self.config.set_last_path(test_path)
        self.assertEqual(self.config.get_last_path(), test_path)

        print("✓ 路径管理测试通过")


class TestConfigDataIntegrity(unittest.TestCase):
    """配置数据完整性测试"""

    def setUp(self):
        src_path = Path(__file__).parent.parent / 'src'
        sys.path.insert(0, str(src_path))
        self.test_dir = tempfile.mkdtemp()
        self.original_home = os.environ.get('HOME') or os.environ.get('USERPROFILE')
        os.environ['HOME'] = self.test_dir
        self.config = ConfigManager()

    def tearDown(self):
        if self.original_home:
            os.environ['HOME'] = self.original_home
        else:
            del os.environ['HOME']

    def test_config_survival_after_restart(self):
        """测试配置在重启后保持"""
        # 设置一些值
        self.config.set_theme('dark')
        self.config.set_image_cache_size(300)

        # 模拟重启 - 创建新的ConfigManager实例
        config2 = ConfigManager()

        # 验证值保持
        self.assertEqual(config2.get_theme(), 'dark')
        self.assertEqual(config2.get_image_cache_size(), 300)

        print("✓ 配置持久化测试通过")

    def test_invalid_config_fallback(self):
        """测试无效配置回退到默认"""
        config_file = Path.home() / '.comic_reader' / 'settings.json'

        # 写入无效JSON
        with open(config_file, 'w') as f:
            f.write("{ invalid json }")

        # 重新加载配置 - 应该回退到默认
        config2 = ConfigManager()
        self.assertEqual(config2.get_theme(), 'light')
        self.assertEqual(config2.get_image_cache_size(), 100)

        print("✓ 无效配置回退测试通过")


if __name__ == '__main__':
    print("="*60)
    print("配置系统单元测试")
    print("="*60)

    # 创建测试套件
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()

    # 添加测试
    suite.addTests(loader.loadTestsFromTestCase(TestConfigManager))
    suite.addTests(loader.loadTestsFromTestCase(TestConfigDataIntegrity))

    # 运行测试
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    # 总结
    print("\n" + "="*60)
    if result.wasSuccessful():
        print("✓ 所有测试通过！")
        print(f"  运行: {result.testsRun} 个测试")
        print(f"  失败: {len(result.failures)} 个")
        print(f"  错误: {len(result.errors)} 个")
    else:
        print("✗ 部分测试失败")
        if result.failures:
            print("\n失败详情:")
            for test, trace in result.failures:
                print(f"  - {test}: {trace.split(chr(10))[-2]}")
        if result.errors:
            print("\n错误详情:")
            for test, trace in result.errors:
                print(f"  - {test}: {trace.split(chr(10))[-2]}")
    print("="*60)

    sys.exit(0 if result.wasSuccessful() else 1)
