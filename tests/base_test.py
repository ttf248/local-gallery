"""
Base test class for Comic Reader test suite
"""
import unittest
import tempfile
import shutil
from pathlib import Path


class BaseTestCase(unittest.TestCase):
    """Base test case with common setup and utilities"""

    @classmethod
    def setUpClass(cls):
        """Set up test environment once for all tests"""
        cls.test_dir = Path(tempfile.mkdtemp(prefix='comic_reader_test_'))
        print(f"\n[TEST] Created test directory: {cls.test_dir}")

    @classmethod
    def tearDownClass(cls):
        """Clean up test environment after all tests"""
        if cls.test_dir.exists():
            shutil.rmtree(cls.test_dir)
            print(f"[TEST] Cleaned up test directory: {cls.test_dir}")

    def setUp(self):
        """Set up each test"""
        self.test_subdir = self.test_dir / self._testMethodName
        self.test_subdir.mkdir(exist_ok=True)

    def tearDown(self):
        """Clean up after each test"""
        # Clean up test subdirectory
        if self.test_subdir.exists():
            for item in self.test_subdir.iterdir():
                if item.is_file():
                    item.unlink()
                elif item.is_dir():
                    shutil.rmtree(item)

    def create_test_album(self, name, image_count=5):
        """Create a test album with dummy images"""
        album_dir = self.test_subdir / name
        album_dir.mkdir(exist_ok=True)

        # Create dummy image files
        for i in range(image_count):
            (album_dir / f'image_{i:03d}.jpg').write_text(f'dummy image {i}')

        return album_dir

    def create_test_collection(self, name, album_count=3):
        """Create a test collection (parent directory with sub-albums)"""
        collection_dir = self.test_subdir / name
        collection_dir.mkdir(exist_ok=True)

        # Create sub-albums
        for i in range(album_count):
            album_dir = collection_dir / f'album_{i}'
            album_dir.mkdir(exist_ok=True)
            for j in range(5):
                (album_dir / f'page_{j:03d}.png').write_text(f'dummy page {j}')

        return collection_dir
