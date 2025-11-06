"""
简化版ImageProcessor测试 - 对比原始版本和简化版本的性能
"""
import sys
import time
import tempfile
import shutil
from pathlib import Path

# Add src to path
src_path = Path(__file__).parent.parent / 'src'
sys.path.insert(0, str(src_path))

# 导入原始版本和简化版本
from utils.image_utils import ImageProcessor as OriginalImageProcessor
from utils.image_utils_simple import ImageProcessor as SimplifiedImageProcessor


def create_test_data(test_dir, album_count=20, images_per_album=10):
    """创建测试数据"""
    albums = []
    for i in range(album_count):
        album_dir = test_dir / f'test_album_{i:03d}'
        album_dir.mkdir(exist_ok=True)

        # 创建图片文件
        for j in range(images_per_album):
            img_file = album_dir / f'image_{j:03d}.jpg'
            img_file.write_text(f'dummy image {j}')

        albums.append(album_dir)

    return albums


def test_original_version():
    """测试原始版本"""
    print("\n" + "="*70)
    print("测试原始版本 ImageProcessor")
    print("="*70)

    test_dir = Path(tempfile.mkdtemp(prefix='test_original_'))

    try:
        # 创建测试数据
        albums = create_test_data(test_dir, album_count=20, images_per_album=5)

        # 执行扫描测试
        progress_updates = []

        def progress_callback(progress, status):
            progress_updates.append((progress, status))

        start_time = time.time()
        result = OriginalImageProcessor.scan_albums(str(test_dir), progress_callback)
        elapsed_time = time.time() - start_time

        print(f"扫描结果:")
        print(f"  - 用时: {elapsed_time:.3f}秒")
        print(f"  - 找到: {len(result)}个项目")
        print(f"  - 进度更新: {len(progress_updates)}次")
        print(f"  - 扫描速度: {len(result)/elapsed_time:.1f}项目/秒")

        return {
            'time': elapsed_time,
            'count': len(result),
            'progress_updates': len(progress_updates)
        }

    finally:
        shutil.rmtree(test_dir)


def test_simplified_version():
    """测试简化版本"""
    print("\n" + "="*70)
    print("测试简化版本 SimplifiedImageProcessor")
    print("="*70)

    test_dir = Path(tempfile.mkdtemp(prefix='test_simplified_'))

    try:
        # 创建测试数据
        albums = create_test_data(test_dir, album_count=20, images_per_album=5)

        # 执行扫描测试
        progress_updates = []

        def progress_callback(progress, status):
            progress_updates.append((progress, status))

        start_time = time.time()
        result = SimplifiedImageProcessor.scan_albums(str(test_dir), progress_callback)
        elapsed_time = time.time() - start_time

        print(f"扫描结果:")
        print(f"  - 用时: {elapsed_time:.3f}秒")
        print(f"  - 找到: {len(result)}个项目")
        print(f"  - 进度更新: {len(progress_updates)}次")
        print(f"  - 扫描速度: {len(result)/elapsed_time:.1f}项目/秒")

        return {
            'time': elapsed_time,
            'count': len(result),
            'progress_updates': len(progress_updates)
        }

    finally:
        shutil.rmtree(test_dir)


def test_real_world_performance():
    """真实世界性能对比"""
    print("\n" + "="*70)
    print("真实世界性能对比 - E:\\漫画 目录")
    print("="*70)

    manga_path = Path("E:/漫画")
    if not manga_path.exists():
        print("E:\\漫画 目录不存在，跳过真实世界测试")
        return None, None

    # 测试原始版本
    print("\n[原始版本]")
    start_time = time.time()
    result1 = OriginalImageProcessor.scan_albums(str(manga_path))
    time1 = time.time() - start_time

    # 测试简化版本
    print("\n[简化版本]")
    start_time = time.time()
    result2 = SimplifiedImageProcessor.scan_albums(str(manga_path))
    time2 = time.time() - start_time

    print(f"\n对比结果:")
    print(f"  原始版本: {time1:.3f}秒，找到 {len(result1)}个项目")
    print(f"  简化版本: {time2:.3f}秒，找到 {len(result2)}个项目")

    if time2 < time1:
        improvement = ((time1 - time2) / time1) * 100
        print(f"  [+] 简化版本性能提升: {improvement:.1f}%")
    else:
        decline = ((time2 - time1) / time1) * 100
        print(f"  [-] 简化版本性能下降: {decline:.1f}%")

    return time1, time2


def main():
    """运行所有测试"""
    print("█"*70)
    print("█" + " "*68 + "█")
    print("█" + "   ImageProcessor 简化版性能对比测试".center(68) + "█")
    print("█" + " "*68 + "█")
    print("█"*70)

    results = {
        'original': None,
        'simplified': None,
        'real_world': (None, None)
    }

    # 测试原始版本
    try:
        results['original'] = test_original_version()
    except Exception as e:
        print(f"[ERROR] 原始版本测试失败: {e}")

    # 测试简化版本
    try:
        results['simplified'] = test_simplified_version()
    except Exception as e:
        print(f"[ERROR] 简化版本测试失败: {e}")

    # 对比结果
    if results['original'] and results['simplified']:
        print("\n" + "="*70)
        print("对比结果")
        print("="*70)

        time1 = results['original']['time']
        time2 = results['simplified']['time']

        print(f"时间对比:")
        print(f"  原始版本: {time1:.3f}秒")
        print(f"  简化版本: {time2:.3f}秒")

        if time2 < time1:
            improvement = ((time1 - time2) / time1) * 100
            print(f"  [+] 性能提升: {improvement:.1f}%")
        else:
            decline = ((time2 - time1) / time1) * 100
            print(f"  [-] 性能下降: {decline:.1f}%")

    # 真实世界测试
    try:
        results['real_world'] = test_real_world_performance()
    except Exception as e:
        print(f"[ERROR] 真实世界测试失败: {e}")

    print("\n" + "█"*70)
    print("█" + " "*68 + "█")
    print("█" + "   测试完成".center(68) + "█")
    print("█" + " "*68 + "█")
    print("█"*70)


if __name__ == '__main__':
    main()
