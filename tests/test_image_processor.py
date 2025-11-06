"""
Simplified unit tests for ImageProcessor
"""
import sys
import tempfile
import shutil
from pathlib import Path

# Add src to path
src_path = Path(__file__).parent.parent / 'src'
sys.path.insert(0, str(src_path))

from utils.image_utils import ImageProcessor


class TestImageProcessor:
    """Test cases for ImageProcessor"""

    @classmethod
    def setup_class(cls):
        """Set up test environment"""
        cls.test_dir = Path(tempfile.mkdtemp(prefix='test_'))
        print(f"\nTest dir: {cls.test_dir}")

    @classmethod
    def teardown_class(cls):
        """Clean up test environment"""
        if cls.test_dir.exists():
            shutil.rmtree(cls.test_dir)
        print(f"\nCleaned up: {cls.test_dir}")

    def setup_method(self):
        """Set up each test"""
        self.test_subdir = self.test_dir / f'test_{self.id()}'
        self.test_subdir.mkdir(exist_ok=True)

    def teardown_method(self):
        """Clean up after each test"""
        if self.test_subdir.exists():
            for item in self.test_subdir.iterdir():
                if item.is_file():
                    item.unlink()
                elif item.is_dir():
                    shutil.rmtree(item)

    def test_get_image_files_with_images(self):
        """Test getting image files"""
        album_dir = self.test_subdir / 'album1'
        album_dir.mkdir()

        # Create dummy files
        for i in range(5):
            (album_dir / f'img{i}.jpg').write_text('dummy')

        image_files = ImageProcessor.get_image_files(str(album_dir))

        assert len(image_files) == 5, f"Expected 5 images, got {len(image_files)}"
        print(f"✓ Found {len(image_files)} images")

    def test_format_size(self):
        """Test size formatting"""
        assert ImageProcessor.format_size(0) == "0B"
        assert ImageProcessor.format_size(1024) == "1.0KB"
        assert ImageProcessor.format_size(1048576) == "1.0MB"
        print("✓ Size formatting works")

    def test_scan_albums_single(self):
        """Test scanning single album"""
        album_dir = self.test_subdir / 'album1'
        album_dir.mkdir()

        for i in range(3):
            (album_dir / f'img{i}.jpg').write_text('dummy')

        albums = ImageProcessor.scan_albums(str(album_dir))

        assert len(albums) == 1
        assert albums[0]['image_count'] == 3
        print(f"✓ Scanned single album with {albums[0]['image_count']} images")

    def test_scan_albums_multiple(self):
        """Test scanning multiple albums"""
        for i in range(3):
            album_dir = self.test_subdir / f'album{i}'
            album_dir.mkdir()
            for j in range(2):
                (album_dir / f'img{j}.jpg').write_text('dummy')

        albums = ImageProcessor.scan_albums(str(self.test_subdir))

        assert len(albums) == 3
        print(f"✓ Scanned {len(albums)} albums")

    def run_all_tests(self):
        """Run all tests"""
        print("\n" + "="*50)
        print("Running ImageProcessor Tests")
        print("="*50)

        tests = [
            self.test_get_image_files_with_images,
            self.test_format_size,
            self.test_scan_albums_single,
            self.test_scan_albums_multiple
        ]

        passed = 0
        failed = 0

        for test in tests:
            try:
                test()
                passed += 1
            except Exception as e:
                print(f"✗ {test.__name__}: {e}")
                failed += 1

        print("\n" + "="*50)
        print(f"Results: {passed} passed, {failed} failed")
        print("="*50)

        return failed == 0


if __name__ == '__main__':
    suite = TestImageProcessor()
    suite.setup_class()

    try:
        success = suite.run_all_tests()
        exit(0 if success else 1)
    finally:
        suite.teardown_class()
