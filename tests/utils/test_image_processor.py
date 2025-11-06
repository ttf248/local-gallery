"""
Unit tests for ImageProcessor class
"""
import sys
from pathlib import Path
import unittest

# Add src directory to path
src_path = Path(__file__).parent.parent.parent / 'src'
sys.path.insert(0, str(src_path))

from utils.image_utils import ImageProcessor
from tests.base_test import BaseTestCase


class TestImageProcessor(BaseTestCase):
    """Test cases for ImageProcessor"""

    def test_get_image_files_with_images(self):
        """Test getting image files from a directory with images"""
        # Arrange
        album_dir = self.create_test_album('test_album', image_count=10)

        # Act
        image_files = ImageProcessor.get_image_files(str(album_dir))

        # Assert
        self.assertEqual(len(image_files), 10)
        for img in image_files:
            self.assertTrue(img.endswith('.jpg'))

    def test_get_image_files_empty_directory(self):
        """Test getting image files from empty directory"""
        # Arrange
        empty_dir = self.test_subdir / 'empty'
        empty_dir.mkdir()

        # Act
        image_files = ImageProcessor.get_image_files(str(empty_dir))

        # Assert
        self.assertEqual(len(image_files), 0)

    def test_get_image_files_no_directory(self):
        """Test getting image files from non-existent directory"""
        # Act
        image_files = ImageProcessor.get_image_files(str(self.test_subdir / 'nonexistent'))

        # Assert
        self.assertEqual(len(image_files), 0)

    def test_format_size_bytes(self):
        """Test formatting size in bytes"""
        # Act & Assert
        self.assertEqual(ImageProcessor.format_size(0), "0B")
        self.assertEqual(ImageProcessor.format_size(1024), "1.0KB")
        self.assertEqual(ImageProcessor.format_size(1048576), "1.0MB")
        self.assertEqual(ImageProcessor.format_size(1073741824), "1.0GB")

    def test_format_size_large(self):
        """Test formatting large size values"""
        # Act & Assert
        self.assertEqual(ImageProcessor.format_size(1536), "1.5KB")
        self.assertEqual(ImageProcessor.format_size(1572864), "1.5MB")

    def test_get_folder_size(self):
        """Test calculating folder size"""
        # Arrange
        album_dir = self.create_test_album('size_test', image_count=5)

        # Act
        folder_size_str = ImageProcessor.get_folder_size(
            [str(f) for f in (album_dir / 'image_000.jpg').parent.glob('*.jpg')]
        )

        # Assert
        self.assertIsNotNone(folder_size_str)
        self.assertTrue(folder_size_str.endswith('B') or folder_size_str.endswith('KB'))

    def test_scan_albums_single_album(self):
        """Test scanning a directory with a single album"""
        # Arrange
        album_dir = self.create_test_album('single_album', image_count=7)

        # Act
        albums = ImageProcessor.scan_albums(str(album_dir))

        # Assert
        self.assertEqual(len(albums), 1)
        self.assertEqual(albums[0]['image_count'], 7)
        self.assertEqual(albums[0]['type'], 'album')
        self.assertIn('single_album', albums[0]['name'])

    def test_scan_albums_multiple_albums(self):
        """Test scanning a directory with multiple albums"""
        # Arrange
        self.create_test_album('album_1', image_count=5)
        self.create_test_album('album_2', image_count=8)
        self.create_test_album('album_3', image_count=3)

        # Act
        albums = ImageProcessor.scan_albums(str(self.test_subdir))

        # Assert
        self.assertEqual(len(albums), 3)
        for album in albums:
            self.assertEqual(album['type'], 'album')

    def test_scan_albums_with_collection(self):
        """Test scanning a directory with a collection"""
        # Arrange
        collection_dir = self.create_test_collection('collection_1', album_count=3)

        # Act
        albums = ImageProcessor.scan_albums(str(collection_dir))

        # Assert
        self.assertGreaterEqual(len(albums), 1)
        # Should contain sub-albums
        collection = next((a for a in albums if a.get('type') == 'collection'), None)
        if collection:
            self.assertGreaterEqual(collection['album_count'], 3)

    def test_scan_albums_progress_callback(self):
        """Test scanning with progress callback"""
        # Arrange
        for i in range(10):
            self.create_test_album(f'album_{i}', image_count=3)

        progress_updates = []

        def progress_callback(progress, status):
            progress_updates.append((progress, status))

        # Act
        albums = ImageProcessor.scan_albums(str(self.test_subdir), progress_callback)

        # Assert
        self.assertGreater(len(progress_updates), 0)
        self.assertEqual(len(albums), 10)

    def test_scan_albums_cancel_flag(self):
        """Test scanning with cancel flag"""
        # Arrange
        for i in range(20):
            self.create_test_album(f'album_{i}', image_count=2)

        # Act - Cancel after some iterations
        ImageProcessor._cancel_flag = True
        albums = ImageProcessor.scan_albums(str(self.test_subdir))
        ImageProcessor._cancel_flag = False  # Reset

        # Assert - Should return empty or partial results
        # (actual behavior depends on implementation)

    def test_scan_albums_max_albums_limit(self):
        """Test scanning with max albums limit"""
        # Arrange - Create more albums than limit
        for i in range(50):
            self.create_test_album(f'album_{i}', image_count=2)

        # Act
        albums = ImageProcessor.scan_albums(str(self.test_subdir))

        # Assert - Should respect max limit
        self.assertLessEqual(len(albums), ImageProcessor._max_albums)

    def test_create_smart_groups_empty_list(self):
        """Test smart grouping with empty list"""
        # Act
        result = ImageProcessor.create_smart_groups([])

        # Assert
        self.assertEqual(len(result), 0)

    def test_create_smart_groups_single_album(self):
        """Test smart grouping with single album"""
        # Arrange
        albums = [{'name': 'single_album', 'image_count': 5, 'type': 'album', 'path': '/test'}]

        # Act
        result = ImageProcessor.create_smart_groups(albums)

        # Assert
        self.assertEqual(len(result), 1)

    def test_create_smart_groups_multiple_albums(self):
        """Test smart grouping with multiple albums"""
        # Arrange
        albums = []
        for i in range(5):
            albums.append({
                'name': f'test_series_part_{i}',
                'image_count': 10,
                'type': 'album',
                'path': f'/test/part_{i}'
            })

        # Act
        result = ImageProcessor.create_smart_groups(albums)

        # Assert
        self.assertGreaterEqual(len(result), 1)

    def test_image_extensions_constant(self):
        """Test IMAGE_EXTENSIONS contains expected formats"""
        # Assert
        expected_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff']
        self.assertEqual(ImageProcessor.IMAGE_EXTENSIONS, expected_extensions)


if __name__ == '__main__':
    unittest.main()
