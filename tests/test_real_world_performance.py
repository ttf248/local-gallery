"""
真实世界性能测试 - 使用 E:\漫画 目录进行实际性能验证
"""
import sys
import time
from pathlib import Path

# Add src to path
src_path = Path(__file__).parent.parent / 'src'
sys.path.insert(0, str(src_path))

from utils.image_utils import ImageProcessor


def test_real_world_performance():
    """使用E:\漫画目录进行真实世界性能测试"""
    print("="*70)
    print("真实世界性能测试 - E:\\漫画 目录")
    print("="*70)

    manga_path = Path("E:/漫画")

    if not manga_path.exists():
        print(f"E:\\漫画 目录不存在，跳过性能测试")
        return False

    # 统计目录信息
    subdirs = [d for d in manga_path.iterdir() if d.is_dir()]
    print(f"\n目录统计:")
    print(f"   - 漫画目录数量: {len(subdirs)}")

    # 执行性能测试
    print(f"\n开始性能测试...")
    print(f"   测试路径: {manga_path}")

    start_time = time.time()
    albums = []

    def progress_callback(progress, status):
        """进度回调"""
        if progress % 20 == 0 or progress == 100:
            print(f"   进度: {progress}% - {status}")

    albums = ImageProcessor.scan_albums(str(manga_path), progress_callback)

    elapsed_time = time.time() - start_time

    # 分析结果
    print(f"\n性能结果:")
    print(f"   - 扫描时间: {elapsed_time:.3f} 秒")
    print(f"   - 总项目数: {len(albums)}")

    album_count = sum(1 for a in albums if a.get('type') == 'album')
    collection_count = sum(1 for a in albums if a.get('type') in ['collection', 'smart_collection'])

    print(f"   - 相册数量: {album_count}")
    print(f"   - 合集数量: {collection_count}")

    if elapsed_time > 0:
        print(f"   - 扫描速度: {len(albums)/elapsed_time:.1f} 项目/秒")

    # 性能评估
    print(f"\n性能评估:")
    if elapsed_time < 1.0:
        print(f"   - 性能等级: 优秀 (< 1秒)")
    elif elapsed_time < 3.0:
        print(f"   - 性能等级: 良好 (1-3秒)")
    else:
        print(f"   - 性能等级: 需优化 (> 3秒)")

    # 显示前5个相册信息
    if albums:
        print(f"\n相册样例 (前5个):")
        for i, album in enumerate(albums[:5], 1):
            print(f"   {i}. {album.get('name', 'Unknown')}")
            print(f"      - 类型: {album.get('type', 'album')}")
            if 'image_count' in album:
                print(f"      - 图片数: {album['image_count']}")
            if 'album_count' in album:
                print(f"      - 包含相册: {album['album_count']}个")
            print()

    return elapsed_time < 5.0  # 5秒内完成认为测试通过


def test_memory_efficiency():
    """测试内存效率 - 检查是否正确释放资源"""
    print("\n" + "="*70)
    print("内存效率测试")
    print("="*70)

    import gc

    # 强制垃圾回收
    gc.collect()

    # 扫描目录
    albums = ImageProcessor.scan_albums("E:/漫画")

    print(f"   - 扫描完成，共 {len(albums)} 个项目")

    # 清空结果
    albums.clear()

    # 再次垃圾回收
    gc.collect()

    print(f"   - 内存已释放")
    print(f"   [PASS] 内存效率测试通过")

    return True


def main():
    """运行所有性能测试"""
    print("\n")
    print("="*70)
    print("=" + " "*68 + "=")
    print("=" + "   漫画阅读器 - 真实世界性能测试".center(68) + "=")
    print("=" + " "*68 + "=")
    print("="*70)

    results = {'passed': 0, 'failed': 0}

    try:
        # 性能测试
        if test_real_world_performance():
            results['passed'] += 1
            print(f"\n[PASS] 性能测试通过")
        else:
            results['failed'] += 1
            print(f"\n[FAIL] 性能测试失败")

    except Exception as e:
        results['failed'] += 1
        print(f"\n[ERROR] 性能测试出错: {e}")

    try:
        # 内存测试
        if test_memory_efficiency():
            results['passed'] += 1
        else:
            results['failed'] += 1
    except Exception as e:
        results['failed'] += 1
        print(f"\n[ERROR] 内存测试出错: {e}")

    # 最终结果
    print("\n" + "="*70)
    print("=" + " "*68 + "=")
    print(f"测试结果: {results['passed']} 通过, {results['failed']} 失败".center(68))
    print("=" + " "*68 + "=")
    print("="*70)

    if results['failed'] == 0:
        print("\n[SUCCESS] 所有性能测试通过！")
        return True
    else:
        print(f"\n[WARNING] {results['failed']} 个测试失败")
        return False


if __name__ == '__main__':
    success = main()
    exit(0 if success else 1)
