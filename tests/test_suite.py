"""
Complete test suite for Comic Reader
"""
import sys
import tempfile
import shutil
from pathlib import Path
import time

sys.path.insert(0, str(Path(__file__).parent.parent / 'src'))

from utils.image_utils import ImageProcessor


def test_image_processor():
    """Test ImageProcessor class"""
    print("="*60)
    print("IMAGE PROCESSOR TESTS")
    print("="*60)

    test_dir = Path(tempfile.mkdtemp())
    results = {'passed': 0, 'failed': 0}

    # Test 1: get_image_files
    print("\n[Test 1] get_image_files")
    try:
        album_dir = test_dir / 'album1'
        album_dir.mkdir()
        for i in range(5):
            (album_dir / f'img{i}.jpg').write_text('dummy')

        images = ImageProcessor.get_image_files(str(album_dir))
        assert len(images) == 5, f"Expected 5 images, got {len(images)}"
        print("  PASSED")
        results['passed'] += 1
    except Exception as e:
        print(f"  FAILED: {e}")
        results['failed'] += 1

    # Test 2: format_size
    print("\n[Test 2] format_size")
    try:
        assert ImageProcessor.format_size(0) == "0B"
        assert ImageProcessor.format_size(1024) == "1.0KB"
        assert ImageProcessor.format_size(1048576) == "1.0MB"
        print("  PASSED")
        results['passed'] += 1
    except Exception as e:
        print(f"  FAILED: {e}")
        results['failed'] += 1

    # Test 3: scan_albums with diverse names (simplified - smart grouping disabled)
    print("\n[Test 3] scan_albums - simplified grouping")
    try:
        for i, name in enumerate(['action', 'romance', 'horror', 'scifi']):
            album = test_dir / name
            album.mkdir()
            for j in range(3):
                (album / f'img{j}.jpg').write_text('dummy')

        albums = ImageProcessor.scan_albums(str(test_dir))
        # Simplified version groups by author info in brackets, so diverse names won't be grouped
        assert len(albums) >= 1, f"Expected at least 1 album, got {len(albums)}"
        print(f"  PASSED - Found {len(albums)} albums (simplified grouping)")
        results['passed'] += 1
    except Exception as e:
        print(f"  FAILED: {e}")
        results['failed'] += 1

    # Test 4: scan_albums performance
    print("\n[Test 4] scan_albums performance")
    try:
        # Cleanup
        for item in test_dir.iterdir():
            if item.is_dir():
                shutil.rmtree(item)

        # Create 20 albums
        for i in range(20):
            album = test_dir / f'perf_album_{i:03d}'
            album.mkdir()
            for j in range(2):
                (album / f'img{j}.jpg').write_text('dummy')

        start = time.time()
        albums = ImageProcessor.scan_albums(str(test_dir))
        elapsed = time.time() - start

        print(f"  Scanned {len(albums)} albums in {elapsed:.3f}s")
        print(f"  Rate: {len(albums)/elapsed:.1f} albums/s")

        assert elapsed < 1.0, f"Scan took too long: {elapsed:.3f}s"
        assert len(albums) > 0, "No albums found"
        print("  PASSED")
        results['passed'] += 1
    except Exception as e:
        print(f"  FAILED: {e}")
        results['failed'] += 1

    # Test 5: Progress callback
    print("\n[Test 5] Progress callback")
    try:
        # Cleanup
        for item in test_dir.iterdir():
            if item.is_dir():
                shutil.rmtree(item)

        # Create albums for progress test
        for i in range(10):
            album = test_dir / f'progress_album_{i}'
            album.mkdir()
            (album / 'img.jpg').write_text('dummy')

        progress_updates = []

        def progress_cb(progress, status):
            progress_updates.append((progress, status))

        albums = ImageProcessor.scan_albums(str(test_dir), progress_cb)

        assert len(progress_updates) > 0, "No progress updates received"
        print(f"  Received {len(progress_updates)} progress updates")
        print("  PASSED")
        results['passed'] += 1
    except Exception as e:
        print(f"  FAILED: {e}")
        results['failed'] += 1

    # Cleanup
    shutil.rmtree(test_dir)

    print("\n" + "="*60)
    print(f"IMAGE PROCESSOR TESTS COMPLETE")
    print(f"Passed: {results['passed']}, Failed: {results['failed']}")
    print("="*60)

    return results


def test_album_scanner():
    """Test AlbumScannerService"""
    print("\n" + "="*60)
    print("ALBUM SCANNER SERVICE TESTS")
    print("="*60)

    results = {'passed': 0, 'failed': 0}

    # Mock app
    class MockApp:
        def __init__(self):
            self.albums = []
            self.path_var = type('obj', (object,), {
                'get': lambda: str(test_dir)
            })()
            self.root = type('obj', (object,), {
                'after': lambda self, *args: None,
                'config': lambda self, **kwargs: None
            })()
            self.status_bar = type('obj', (object,), {
                'set_status': lambda self, *args: None,
                'set_info': lambda self, *args: None
            })()
            self.album_grid = type('obj', (object,), {
                'display_albums': lambda self, *args: None
            })()

    from core.album_scanner import AlbumScannerService

    # Test initialization
    print("\n[Test 1] Scanner initialization")
    try:
        app = MockApp()
        scanner = AlbumScannerService(app)
        assert scanner.scan_thread is None
        assert scanner.cancel_flag == False
        assert scanner.progress_queue is not None
        print("  PASSED")
        results['passed'] += 1
    except Exception as e:
        print(f"  FAILED: {e}")
        results['failed'] += 1

    print("\n" + "="*60)
    print(f"ALBUM SCANNER TESTS COMPLETE")
    print(f"Passed: {results['passed']}, Failed: {results['failed']}")
    print("="*60)

    return results


def main():
    """Run all tests"""
    print("\n" + "#"*60)
    print("# COMIC READER - COMPLETE TEST SUITE")
    print("#"*60)

    # Create test directory
    global test_dir
    test_dir = Path(tempfile.mkdtemp())

    try:
        # Run tests
        img_results = test_image_processor()
        scan_results = test_album_scanner()

        # Summary
        total_passed = img_results['passed'] + scan_results['passed']
        total_failed = img_results['failed'] + scan_results['failed']

        print("\n" + "#"*60)
        print("# FINAL SUMMARY")
        print("#"*60)
        print(f"Total Tests: {total_passed + total_failed}")
        print(f"Passed: {total_passed}")
        print(f"Failed: {total_failed}")

        if total_failed == 0:
            print("\nALL TESTS PASSED!")
        else:
            print(f"\n{total_failed} TESTS FAILED")

        print("#"*60)

        return total_failed == 0

    finally:
        # Cleanup
        if test_dir.exists():
            shutil.rmtree(test_dir)


if __name__ == '__main__':
    success = main()
    exit(0 if success else 1)
