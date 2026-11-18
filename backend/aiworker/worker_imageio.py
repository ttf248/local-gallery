"""Shared bounded image decoding for the local AI worker.

人脸与 OCR 的输入都要「按上限解码」：先只读文件头拿到尺寸与朝向，
再让 OpenCV 做一次有上限的解码。两边的上限口径不同 —— 人脸看长边，
OCR 看像素总数 —— 但实现原本各写一遍，改一处容易漏掉另一处。

这个模块不持有任何状态：OpenCV 与 NumPy 由调用方传入，
这样测试可以替换它们，Worker 的入口模块也仍然是唯一的状态持有者。
"""

from __future__ import annotations

import math
import threading

# Pillow 在读文件头时会检查解压上限；这一步只读尺寸，
# 限制要临时放开，真正的解码由 OpenCV 按上限完成。
image_header_lock = threading.Lock()

_REDUCED_FLAG_NAMES = {
    2: "IMREAD_REDUCED_COLOR_2",
    4: "IMREAD_REDUCED_COLOR_4",
    8: "IMREAD_REDUCED_COLOR_8",
}


def read_image_header(path):
    """Read the display size, format and EXIF orientation without decoding pixels.

    Returns (width, height, format); the size already accounts for a rotated
    EXIF orientation, because everything downstream works on the upright image.
    """
    from PIL import Image as PILImage

    with image_header_lock:
        max_image_pixels = PILImage.MAX_IMAGE_PIXELS
        try:
            PILImage.MAX_IMAGE_PIXELS = None
            with PILImage.open(path) as source:
                width, height = source.size
                image_format = source.format
                orientation = source.getexif().get(274, 1)
        finally:
            PILImage.MAX_IMAGE_PIXELS = max_image_pixels
    if orientation in (5, 6, 7, 8):
        width, height = height, width
    return width, height, image_format


def _reduced_flag(cv2, factor):
    name = _REDUCED_FLAG_NAMES.get(factor)
    return getattr(cv2, name, None) if name else None


def _reduction_fits(factor, longest_side, pixels, max_dimension, max_pixels):
    """判断按这个压缩比解码之后是否仍然满足上限。"""
    if max_dimension is not None:
        return math.ceil(longest_side / factor) >= max_dimension
    if max_pixels is not None:
        return pixels // (factor * factor) <= max_pixels
    return False


def decode_bounded(path, cv2, np, max_dimension=None, max_pixels=None, prefer="smallest"):
    """Decode an image at a bounded size.

    Returns (image, scale_x, scale_y). The scales map the decoded pixels back
    to the source image, so boxes detected on the decoded image can be put back
    onto the original.

    prefer="smallest" 取仍然满足上限的最大压缩比：人脸检测只需要够长的边，
    解得越小越快。prefer="largest" 取仍然满足上限的最小压缩比：OCR 文本
    越清楚越好，能不降就不降。
    """
    try:
        original_width, original_height, image_format = read_image_header(path)
        encoded = np.fromfile(path, dtype=np.uint8)
        decode_flag = cv2.IMREAD_COLOR
        longest_side = max(original_width, original_height)
        pixels = original_width * original_height
        if image_format == "JPEG":
            if prefer == "largest":
                if not _reduction_fits(1, longest_side, pixels, max_dimension, max_pixels):
                    for factor in (2, 4, 8):
                        flag = _reduced_flag(cv2, factor)
                        if flag is None:
                            continue
                        decode_flag = flag
                        if _reduction_fits(factor, longest_side, pixels, max_dimension, max_pixels):
                            break
            else:
                for factor in (8, 4, 2):
                    flag = _reduced_flag(cv2, factor)
                    if flag is None:
                        continue
                    if _reduction_fits(factor, longest_side, pixels, max_dimension, max_pixels):
                        decode_flag = flag
                        break
        image = cv2.imdecode(encoded, decode_flag)
        if image is None and decode_flag != cv2.IMREAD_COLOR:
            image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    except Exception:
        # 文件头读不出来时退回完整解码：尺寸从解出来的图上取。
        try:
            encoded = np.fromfile(path, dtype=np.uint8)
            image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
        except Exception:
            image = None
        if image is None:
            return None, 1.0, 1.0
        original_height, original_width = image.shape[:2]

    if image is None:
        return None, 1.0, 1.0

    height, width = image.shape[:2]
    if max_dimension is not None and max(height, width) > max_dimension:
        scale = max_dimension / float(max(height, width))
        image = cv2.resize(
            image,
            (max(1, int(round(width * scale))), max(1, int(round(height * scale)))),
            interpolation=cv2.INTER_AREA,
        )
        height, width = image.shape[:2]
    elif max_pixels is not None and height * width > max_pixels:
        scale = (max_pixels / float(height * width)) ** 0.5
        image = cv2.resize(
            image,
            (max(1, int(width * scale)), max(1, int(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
        height, width = image.shape[:2]
    return image, original_width / width, original_height / height
