"""Download the pinned AI model files and verify their SHA256 digests."""

from __future__ import annotations

import hashlib
import os
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

from model_cache import resolve_model_dir


MODELS = (
    ("相册封面审美模型 V2.5",
     "https://huggingface.co/fsw/aesthetic-predictor-v2-5_onnx/resolve/e9a8e5e4ff7c566a14cae9d18377fccd0bad0079/aesthetic_predictor_v2_5.onnx",
     "aesthetic/cover.onnx", "7dd2f7424eb799f60fd63289b2b0c437fe2f06121695325e80e298718818a826"),
    (
        "RapidOCR PP-OCRv6 检测",
        "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/det/PP-OCRv6_det_small.onnx",
        "ocr/PP-OCRv6_det_small.onnx",
        "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f",
    ),
    (
        "RapidOCR 方向分类",
        "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv4/cls/ch_ppocr_mobile_v2.0_cls_mobile.onnx",
        "ocr/ch_ppocr_mobile_v2.0_cls_mobile.onnx",
        "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c",
    ),
    (
        "RapidOCR PP-OCRv6 识别",
        "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/rec/PP-OCRv6_rec_small.onnx",
        "ocr/PP-OCRv6_rec_small.onnx",
        "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884",
    ),
    (
        "Chinese-CLIP",
        "https://huggingface.co/OFA-Sys/chinese-clip-vit-base-patch16/resolve/957be8390cef5bab9ddd2dd36ca81a8622f966e7/clip_cn_vit-b-16.pt?download=true",
        "clip_cn_vit-b-16.pt",
        "5997ef32c50de18f3ac06eb5d746c324a639053c3bed8f2986f97ebb22b2ecde",
    ),
    (
        "YuNet 人脸检测",
        "https://huggingface.co/opencv/opencv_zoo/resolve/d4938dfc9d4ec5d098bfa33e98b3f3345a236586/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "face/face_detection_yunet_2023mar.onnx",
        "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    ),
    (
        "SFace 人脸特征",
        "https://huggingface.co/opencv/opencv_zoo/resolve/d4938dfc9d4ec5d098bfa33e98b3f3345a236586/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "face/face_recognition_sface_2021dec.onnx",
        "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    ),
)

BUFFALO_M_ARCHIVE_URL = "https://github.com/deepinsight/insightface/releases/download/model-zoo/buffalo_m.zip"
BUFFALO_M_ARCHIVE_SHA256 = "d98264bd8f2dc75cbc2ddce2a14e636e02bb857b3051c234b737bf3b614edca9"
BUFFALO_M_FILES = (
    ("det_2.5g.onnx", 3_292_009, "041f73f47371333d1d17a6fee6c8ab4e6aecabefe398ff32cca4e2d5eaee0af9"),
    ("w600k_r50.onnx", 174_383_860, "4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43"),
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(name: str, url: str, destination: Path, expected: str) -> None:
    if destination.is_file() and sha256(destination) == expected:
        print(f"[已就绪] {name}")
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name + ".download")
    request = urllib.request.Request(url, headers={"User-Agent": "local-gallery-setup"})
    print(f"[下载] {name}（代理：{os.environ.get('https_proxy', '系统设置')}）")
    for attempt in range(1, 5):
        try:
            with urllib.request.urlopen(request, timeout=90) as response, partial.open("wb") as target:
                while chunk := response.read(1024 * 1024):
                    target.write(chunk)
            if sha256(partial) != expected:
                raise ValueError(f"{name} SHA256 校验失败")
            partial.replace(destination)
            break
        except Exception:
            partial.unlink(missing_ok=True)
            if attempt == 4:
                raise
            time.sleep(attempt * 2)
    print(f"[完成] {name}")


def install_buffalo_m(model_dir: Path) -> None:
    face_dir = model_dir / "face" / "buffalo_m"
    face_dir.mkdir(parents=True, exist_ok=True)
    if all((face_dir / name).is_file() and sha256(face_dir / name) == digest for name, _, digest in BUFFALO_M_FILES):
        print("[已就绪] Buffalo_m SCRFD 与人脸特征模型")
        return

    archive_path = model_dir / "face" / "buffalo_m.zip"
    download("Buffalo_m 模型包", BUFFALO_M_ARCHIVE_URL, archive_path, BUFFALO_M_ARCHIVE_SHA256)
    try:
        with zipfile.ZipFile(archive_path) as archive:
            for name, expected_size, expected_digest in BUFFALO_M_FILES:
                member = f"buffalo_m/{name}"
                try:
                    info = archive.getinfo(member)
                except KeyError as error:
                    raise ValueError(f"Buffalo_m 模型包缺少 {name}") from error
                if info.file_size != expected_size:
                    raise ValueError(f"Buffalo_m {name} 文件大小不匹配")

                destination = face_dir / name
                partial = destination.with_name(destination.name + ".download")
                digest = hashlib.sha256()
                try:
                    with archive.open(info) as source, partial.open("wb") as target:
                        while chunk := source.read(1024 * 1024):
                            target.write(chunk)
                            digest.update(chunk)
                    if digest.hexdigest() != expected_digest:
                        raise ValueError(f"Buffalo_m {name} SHA256 校验失败")
                    partial.replace(destination)
                except Exception:
                    partial.unlink(missing_ok=True)
                    raise
    finally:
        archive_path.unlink(missing_ok=True)
    print("[完成] Buffalo_m SCRFD 与人脸特征模型")


def main() -> int:
    model_dir = resolve_model_dir()
    for name, url, relative_path, digest in MODELS:
        download(name, url, model_dir / relative_path, digest)
    install_buffalo_m(model_dir)
    print(f"模型目录：{model_dir}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"[错误] {error}", file=sys.stderr)
        raise SystemExit(1)
