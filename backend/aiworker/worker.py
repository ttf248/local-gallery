"""Local JSONL worker for Chinese-CLIP. It never downloads model files."""

from __future__ import annotations

import concurrent.futures
import contextlib
import gc
import hashlib
import importlib.metadata
import importlib.util
import json
import math
import os
import sys
import threading
import time
from pathlib import Path


MODEL_FILE = "clip_cn_vit-b-16.pt"
MODEL_SHA256 = "5997ef32c50de18f3ac06eb5d746c324a639053c3bed8f2986f97ebb22b2ecde"
MODEL_VERSION = "chinese-clip-vit-b-16@957be8390cef5bab9ddd2dd36ca81a8622f966e7+exif-orientation-v1"
DIMENSION = 512
CLIP_IMAGE_SIZE = 224
INITIAL_BATCH_SIZE = 8
GPU_INITIAL_BATCH_SIZE = 32
IMAGE_PREPROCESS_WORKERS = 8
IMAGE_PREPROCESS_LARGE_IMAGE_WORKERS = 4
IMAGE_PREPROCESS_EIGHT_WORKER_PIXEL_LIMIT = 4_000_000
OCR_CLASSIFIER_BATCH_SIZE = 16
OCR_DEFAULT_BATCH_SIZE = 6
OCR_RECOGNIZER_BATCH_SIZE = 6
OCR_CPU_ONNX_THREADS = 2
OCR_CPU_MAX_IMAGE_WORKERS = 4
OCR_GPU_IMAGE_WORKERS = 16
OCR_GPU_LARGE_IMAGE_WORKERS = 8
OCR_GPU_LARGE_IMAGE_PIXEL_LIMIT = 4_000_000
OCR_MAX_INPUT_PIXELS = 16_000_000
FACE_MAX_INPUT_DIMENSION = 2048
MODEL_IDLE_RELEASE_SECONDS = 300
image_header_lock = threading.Lock()
OCR_MODEL_DIRECTORY = "ocr"
OCR_DETECTOR_FILE = "PP-OCRv6_det_small.onnx"
OCR_DETECTOR_SHA256 = "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f"
OCR_CLASSIFIER_FILE = "ch_ppocr_mobile_v2.0_cls_mobile.onnx"
OCR_CLASSIFIER_SHA256 = "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c"
OCR_RECOGNIZER_FILE = "PP-OCRv6_rec_small.onnx"
OCR_RECOGNIZER_SHA256 = "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884"
# YuNet and SFace accept one image each; overlap calls across photos instead.
FACE_GPU_WORKERS = 12
FACE_GPU_LARGE_IMAGE_WORKERS = 4
FACE_GPU_TWELVE_WORKER_PIXEL_LIMIT = 4_000_000
BUFFALO_M_GPU_WORKERS = 4
BUFFALO_M_GPU_TILED_WORKERS = 2
BUFFALO_M_GPU_LARGE_IMAGE_WORKERS = 1
BUFFALO_M_TILED_IMAGE_PIXEL_LIMIT = 2_000_000
BUFFALO_M_LARGE_IMAGE_PIXEL_LIMIT = 3_500_000
BUFFALO_M_GROUP_TILE_SIZE = 1280
BUFFALO_M_GROUP_TILE_LIMIT = 64
BUFFALO_M_GROUP_FACE_LIMIT = 256
BUFFALO_M_FACE_LIMIT = 64
YUNET_FILE = "face_detection_yunet_2023mar.onnx"
YUNET_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
SFACE_FILE = "face_recognition_sface_2021dec.onnx"
SFACE_SHA256 = "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"
FACE_VERSION = "yunet-2023mar-multiscale+sface-2021dec+quality-v2"
FACE_MODEL_QUALITY_V2 = "quality-v2"
FACE_MODEL_BUFFALO_M = "buffalo_m"
FACE_MODEL_DEFAULT = FACE_MODEL_QUALITY_V2
FACE_MODELS = (FACE_MODEL_QUALITY_V2, FACE_MODEL_BUFFALO_M)
BUFFALO_M_VERSION = "buffalo-m-scrfd-2.5g-w600k-r50-v1"
BUFFALO_M_DETECTOR_FILE = "det_2.5g.onnx"
BUFFALO_M_DETECTOR_SHA256 = "041f73f47371333d1d17a6fee6c8ab4e6aecabefe398ff32cca4e2d5eaee0af9"
BUFFALO_M_RECOGNIZER_FILE = "w600k_r50.onnx"
BUFFALO_M_RECOGNIZER_SHA256 = "4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43"
BUFFALO_M_DETECTION_THRESHOLD = 0.5
BUFFALO_M_DETECTION_STRIDES = (8, 16, 32)
BUFFALO_M_ANCHORS_PER_LOCATION = 2
BUFFALO_M_DETECTION_SIZE = 640
BUFFALO_M_RECOGNITION_SIZE = 112
BUFFALO_M_EMBEDDING_DIMENSION = 512
YUNET_INPUT_SIZE = 640
YUNET_SCORE_THRESHOLD = 0.75
YUNET_MIN_FACE_SIDE = 32

model_dir = Path(sys.argv[1]).resolve()
model = None
model_device = None
preprocess = None
model_cache = {}
clip = None
torch = None
Image = None
device = "cpu"
runtime_error = ""
model_validation = None
rapid_ocr = {}
face_models = {}
face_models_lock = threading.Lock()
cuda_dll_handles = []
cv2 = None
np = None
ocr_runtime_error = ""
ocr_gpu_runtime_failed = False
face_runtime_error = ""
face_profile_runtime_errors = {}
model_file_validation = {}
last_model_activity = None


def has_loaded_models() -> bool:
    return model is not None or bool(model_cache) or bool(rapid_ocr) or bool(face_models)


def release_idle_models(now=None) -> bool:
    global model, model_device, preprocess, device, last_model_activity
    if now is None:
        now = time.monotonic()
    if last_model_activity is None or now - last_model_activity < MODEL_IDLE_RELEASE_SECONDS:
        return False
    if not has_loaded_models():
        last_model_activity = None
        return False

    cuda_models_loaded = (
        model_device == "cuda"
        or "cuda" in model_cache
        or "gpu" in rapid_ocr
        or any(key.endswith(":gpu") or key == "gpu" for key in face_models)
    )
    model = None
    model_device = None
    preprocess = None
    model_cache.clear()
    rapid_ocr.clear()
    face_models.clear()
    device = "cpu"
    last_model_activity = None
    gc.collect()
    if cuda_models_loaded and torch is not None:
        try:
            torch.cuda.empty_cache()
        except Exception:
            pass
    return True


def mark_model_activity() -> None:
    global last_model_activity
    last_model_activity = time.monotonic()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def model_state() -> dict:
    global model_validation
    path = model_dir / MODEL_FILE
    if not path.is_file():
        model_validation = {"modelAvailable": False, "modelValid": False, "modelVersion": MODEL_VERSION}
        return model_validation
    try:
        info = path.stat()
    except OSError:
        model_validation = {"modelAvailable": True, "modelValid": False, "modelVersion": MODEL_VERSION}
        return model_validation
    signature = (info.st_size, info.st_mtime_ns)
    if model_validation and model_validation.get("signature") == signature:
        return {key: value for key, value in model_validation.items() if key != "signature"}
    digest = file_sha256(path)
    model_validation = {
        "modelAvailable": True,
        "modelValid": digest == MODEL_SHA256,
        "modelVersion": MODEL_VERSION,
        "modelSha256": digest,
        "signature": signature,
    }
    return {key: value for key, value in model_validation.items() if key != "signature"}


def status() -> dict:
    state = model_state()
    has_cuda_provider = cuda_provider_available()
    result = {
        "pythonAvailable": True,
        "pythonVersion": sys.version.split()[0],
        "device": device,
        "cudaAvailable": bool(torch is not None and torch.cuda.is_available()) or has_cuda_provider,
        "cudaExecutionProviderAvailable": has_cuda_provider,
        "cudaVersion": getattr(getattr(torch, "version", None), "cuda", None),
        "runtimeReady": not runtime_error,
        "modelLoaded": model is not None,
        "runtimeError": runtime_error,
        "modules": {
            "ocr": ocr_module_status(),
            "face": face_module_status(),
        },
        "faceModels": face_model_status(),
    }
    if torch is not None:
        result["torchVersion"] = torch.__version__
        if torch.cuda.is_available():
            try:
                result["gpuName"] = torch.cuda.get_device_name(0)
                result["gpuMemoryBytes"] = int(torch.cuda.get_device_properties(0).total_memory)
            except Exception:
                pass
    result.update(state)
    return result


def module_error(module: str) -> str:
    if module == "ocr" and ocr_runtime_error:
        return ocr_runtime_error
    if module == "face" and face_runtime_error:
        return face_runtime_error
    return ""


def ocr_module_status() -> dict:
    error = module_error("ocr")
    if error:
        return {"ready": False, "version": "rapidocr-3.10.0-onnxruntime-1.20.2", "error": error}
    try:
        if (
            importlib.util.find_spec("rapidocr") is None
            or importlib.util.find_spec("onnxruntime") is None
            or importlib.util.find_spec("cv2") is None
        ):
            error = "ocr_dependencies_missing"
        else:
            version = importlib.metadata.version("rapidocr")
            try:
                runtime_version = importlib.metadata.version("onnxruntime-gpu")
            except importlib.metadata.PackageNotFoundError:
                runtime_version = importlib.metadata.version("onnxruntime")
            if version != "3.10.0" or runtime_version != "1.20.2":
                error = "ocr_dependency_version_mismatch"
            else:
                ocr_model_dir = model_dir / OCR_MODEL_DIRECTORY
                ocr_models = (
                    (ocr_model_dir / OCR_DETECTOR_FILE, OCR_DETECTOR_SHA256),
                    (ocr_model_dir / OCR_CLASSIFIER_FILE, OCR_CLASSIFIER_SHA256),
                    (ocr_model_dir / OCR_RECOGNIZER_FILE, OCR_RECOGNIZER_SHA256),
                )
                if not all(file_state(path, digest) for path, digest in ocr_models):
                    error = "ocr_model_missing_or_checksum_invalid"
    except Exception:
        error = "ocr_dependencies_missing"
    return {
        "ready": not error,
        "version": "rapidocr-3.10.0-onnxruntime-1.20.2",
        **({"error": error} if error else {}),
    }


def file_state(path: Path, expected_sha256: str) -> bool:
    key = str(path)
    try:
        info = path.stat()
        if not path.is_file():
            return False
        signature = (info.st_size, info.st_mtime_ns)
        cached = model_file_validation.get(key)
        if cached and cached[0] == signature:
            return cached[1]
        valid = file_sha256(path) == expected_sha256
        model_file_validation[key] = (signature, valid)
        return valid
    except OSError:
        return False


def face_module_status() -> dict:
    error = module_error("face")
    detector_path = model_dir / "face" / YUNET_FILE
    recognizer_path = model_dir / "face" / SFACE_FILE
    if not error:
        try:
            if importlib.util.find_spec("cv2") is None:
                error = "face_dependencies_missing"
            else:
                import cv2 as cv2_module
                if not hasattr(cv2_module, "FaceDetectorYN_create") or not hasattr(cv2_module, "FaceRecognizerSF_create"):
                    error = "face_dependencies_missing"
                elif not file_state(detector_path, YUNET_SHA256) or not file_state(recognizer_path, SFACE_SHA256):
                    error = "face_model_missing_or_checksum_invalid"
        except Exception:
            error = "face_dependencies_missing"
    return {
        "ready": not error,
        "version": FACE_VERSION,
        **({"error": error} if error else {}),
    }


def face_model_status() -> dict:
    quality = face_module_status()
    buffalo_error = face_profile_runtime_errors.get(FACE_MODEL_BUFFALO_M, "")
    buffalo_detector = model_dir / "face" / FACE_MODEL_BUFFALO_M / BUFFALO_M_DETECTOR_FILE
    buffalo_recognizer = model_dir / "face" / FACE_MODEL_BUFFALO_M / BUFFALO_M_RECOGNIZER_FILE
    if not buffalo_error:
        try:
            if importlib.util.find_spec("cv2") is None or importlib.util.find_spec("onnxruntime") is None:
                buffalo_error = "face_dependencies_missing"
            elif not file_state(buffalo_detector, BUFFALO_M_DETECTOR_SHA256) or not file_state(
                buffalo_recognizer, BUFFALO_M_RECOGNIZER_SHA256
            ):
                buffalo_error = "face_model_missing_or_checksum_invalid"
        except Exception:
            buffalo_error = "face_dependencies_missing"
    return {
        FACE_MODEL_QUALITY_V2: quality,
        FACE_MODEL_BUFFALO_M: {
            "ready": not buffalo_error,
            "version": BUFFALO_M_VERSION,
            **({"error": buffalo_error} if buffalo_error else {}),
        },
    }


def cuda_provider_available() -> bool:
    try:
        configure_cuda_dlls()
        import onnxruntime
        return "CUDAExecutionProvider" in onnxruntime.get_available_providers()
    except Exception:
        return False


def configure_cuda_dlls() -> None:
    if os.name != "nt" or cuda_dll_handles:
        return
    site_packages = Path(sys.prefix) / "Lib" / "site-packages"
    candidates = [site_packages / "torch" / "lib"]
    candidates.extend((site_packages / "nvidia").glob("*"))
    for candidate in candidates:
        if candidate.name != "lib" and candidate.is_dir():
            candidates.extend(candidate.glob("bin"))
    for directory in candidates:
        if directory.is_dir():
            try:
                prepend_dll_search_path(directory)
                cuda_dll_handles.append(os.add_dll_directory(str(directory)))
            except OSError:
                continue


def prepend_dll_search_path(directory) -> None:
    resolved = os.path.abspath(os.fspath(directory))
    normalized = os.path.normcase(resolved)
    existing = os.environ.get("PATH", "").split(os.pathsep)
    for entry in existing:
        if entry and os.path.normcase(os.path.abspath(entry.strip('"'))) == normalized:
            return
    os.environ["PATH"] = os.pathsep.join([resolved, *existing])


def gpu_available(require_onnx: bool = False) -> bool:
    if require_onnx:
        return cuda_provider_available()
    return bool(torch is not None and torch.cuda.is_available())


def load_model(device_mode: str = "auto") -> None:
    global clip, model, model_device, preprocess, torch, Image, device, runtime_error
    state = model_state()
    if not state.get("modelValid"):
        raise RuntimeError("model_missing_or_checksum_invalid")
    try:
        import torch as torch_module
        from PIL import Image as image_module
        import cn_clip.clip as clip_module
        from cn_clip.clip import load_from_name
    except Exception:
        runtime_error = "python_dependencies_missing"
        raise RuntimeError(runtime_error) from None
    torch, Image, clip = torch_module, image_module, clip_module
    if device_mode == "gpu" and not torch.cuda.is_available():
        raise RuntimeError("gpu_unavailable")
    target_device = "cuda" if device_mode == "gpu" or (device_mode == "auto" and torch.cuda.is_available()) else "cpu"
    if model is not None and model_device == target_device:
        device = target_device
        return
    cached = model_cache.get(target_device)
    if cached is not None:
        model, preprocess = cached
        model_device = target_device
        device = target_device
        runtime_error = ""
        return

    try:
        with contextlib.redirect_stdout(sys.stderr):
            loaded_model, loaded_preprocess = load_from_name(
                "ViT-B-16", device=target_device, download_root=str(model_dir)
            )
    except Exception as error:
        if device_mode == "auto" and target_device == "cuda" and "out of memory" in str(error).lower():
            torch.cuda.empty_cache()
            target_device = "cpu"
            cached = model_cache.get(target_device)
            if cached is not None:
                loaded_model, loaded_preprocess = cached
            else:
                try:
                    with contextlib.redirect_stdout(sys.stderr):
                        loaded_model, loaded_preprocess = load_from_name(
                            "ViT-B-16", device=target_device, download_root=str(model_dir)
                        )
                except Exception:
                    runtime_error = "model_load_failed"
                    raise RuntimeError(runtime_error) from None
        elif device_mode == "gpu":
            torch.cuda.empty_cache()
            raise RuntimeError("gpu_inference_failed") from None
        else:
            runtime_error = "model_load_failed"
            raise RuntimeError(runtime_error) from None

    loaded_model.eval()
    model_cache[target_device] = (loaded_model, loaded_preprocess)
    model, preprocess = loaded_model, loaded_preprocess
    model_device = target_device
    device = target_device
    runtime_error = ""


def normalize_rows(features):
    norms = features.norm(p=2, dim=-1, keepdim=True).clamp_min(1e-12)
    return features / norms


def encode_image_batch(images):
    tensor = torch.stack(images).to(device)
    with torch.inference_mode():
        features = normalize_rows(model.encode_image(tensor)).float().cpu()
    return features.tolist()


def encode_text_batch(texts):
    tokens = clip.tokenize(texts).to(device)
    with torch.inference_mode():
        features = normalize_rows(model.encode_text(tokens)).float().cpu()
    return features.tolist()


def is_cuda_oom(error: Exception) -> bool:
    return bool(torch is not None and isinstance(error, torch.cuda.OutOfMemoryError)) or "out of memory" in str(error).lower()


def run_with_fallback(items, encode, prepare, device_mode="auto", prepare_workers=1):
    global device, model, model_device
    batch_size = GPU_INITIAL_BATCH_SIZE if device == "cuda" else INITIAL_BATCH_SIZE
    results = [None] * len(items)
    errors = [""] * len(items)
    prepared = {}

    def prepare_one(item):
        try:
            return prepare(item), ""
        except Exception:
            return None, "image_unreadable"

    worker_count = min(max(1, prepare_workers), len(items))
    if worker_count > 1:
        with concurrent.futures.ThreadPoolExecutor(max_workers=worker_count) as executor:
            prepared_items = executor.map(prepare_one, items)
            for index, (value, error) in enumerate(prepared_items):
                if error:
                    errors[index] = error
                else:
                    prepared[index] = value
    else:
        for index, item in enumerate(items):
            value, error = prepare_one(item)
            if error:
                errors[index] = error
            else:
                prepared[index] = value

    pending = list(prepared)
    while pending:
        size = min(batch_size, len(pending))
        chunk = pending[:size]
        try:
            vectors = encode([prepared[index] for index in chunk])
            for index, vector in zip(chunk, vectors, strict=True):
                if len(vector) != DIMENSION:
                    errors[index] = "invalid_vector_dimension"
                else:
                    results[index] = vector
            pending = pending[size:]
        except Exception as error:
            if not is_cuda_oom(error) or device != "cuda":
                for index in chunk:
                    errors[index] = "gpu_inference_failed" if device_mode == "gpu" else "inference_failed"
                pending = pending[size:]
                continue
            torch.cuda.empty_cache()
            if size > 1:
                batch_size = max(1, size // 2)
                continue
            if device_mode == "gpu":
                errors[chunk[0]] = "gpu_out_of_memory"
                pending = pending[size:]
                continue
            device = "cpu"
            model = model.to("cpu").float()
            model_device = "cpu"
            model_cache.pop("cuda", None)
            model_cache["cpu"] = (model, preprocess)
            batch_size = 1
    return [{"vector": results[index], "error": errors[index]} for index in range(len(items))]


def prepare_image(path: str):
    from PIL import ImageOps

    with Image.open(path) as source:
        if source.format == "JPEG":
            source.draft("RGB", (CLIP_IMAGE_SIZE, CLIP_IMAGE_SIZE))
        source.load()
        orientation = source.getexif().get(274, 1)
        image = ImageOps.exif_transpose(source) if orientation in range(2, 9) else source
        return preprocess(image.convert("RGB"))


def image_preprocess_worker_count(paths):
    for path in paths:
        try:
            with open(path, "rb") as image_file:
                is_jpeg = image_file.read(2) == b"\xff\xd8"
            if is_jpeg:
                continue
            with Image.open(path) as source:
                if source.format != "JPEG" and (
                    source.width * source.height > IMAGE_PREPROCESS_EIGHT_WORKER_PIXEL_LIMIT
                ):
                    return IMAGE_PREPROCESS_LARGE_IMAGE_WORKERS
        except Exception:
            return IMAGE_PREPROCESS_LARGE_IMAGE_WORKERS
    return IMAGE_PREPROCESS_WORKERS


def read_cv_image(path: str):
    global cv2, np
    if cv2 is None or np is None:
        import cv2 as cv2_module
        import numpy as numpy_module
        cv2, np = cv2_module, numpy_module
    try:
        encoded = np.fromfile(path, dtype=np.uint8)
        return cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    except Exception:
        return None


def read_face_image(path: str, max_dimension=FACE_MAX_INPUT_DIMENSION):
    """Decode large JPEG faces near the detector input size and return source scales."""
    global cv2, np
    if cv2 is None or np is None:
        import cv2 as cv2_module
        import numpy as numpy_module
        cv2, np = cv2_module, numpy_module

    max_dimension = max(1, int(max_dimension))
    try:
        from PIL import Image as PILImage

        # Read dimensions without decoding the image. OpenCV performs the reduced JPEG decode.
        with image_header_lock:
            max_image_pixels = PILImage.MAX_IMAGE_PIXELS
            try:
                PILImage.MAX_IMAGE_PIXELS = None
                with PILImage.open(path) as source:
                    original_width, original_height = source.size
                    image_format = source.format
                    orientation = source.getexif().get(274, 1)
            finally:
                PILImage.MAX_IMAGE_PIXELS = max_image_pixels
        if orientation in (5, 6, 7, 8):
            original_width, original_height = original_height, original_width

        encoded = np.fromfile(path, dtype=np.uint8)
        decode_flag = cv2.IMREAD_COLOR
        longest_side = max(original_width, original_height)
        if image_format == "JPEG" and longest_side > max_dimension:
            # Keep enough long-edge pixels for the final detector-sized resize.
            for factor, flag in (
                (8, cv2.IMREAD_REDUCED_COLOR_8),
                (4, cv2.IMREAD_REDUCED_COLOR_4),
                (2, cv2.IMREAD_REDUCED_COLOR_2),
            ):
                if math.ceil(longest_side / factor) >= max_dimension:
                    decode_flag = flag
                    break
        image = cv2.imdecode(encoded, decode_flag)
        if image is None and decode_flag != cv2.IMREAD_COLOR:
            image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    except Exception:
        image = read_cv_image(path)
        if image is None:
            return None, 1.0, 1.0
        original_height, original_width = image.shape[:2]

    if image is None:
        return None, 1.0, 1.0

    height, width = image.shape[:2]
    if max(height, width) > max_dimension:
        scale = max_dimension / float(max(height, width))
        image = cv2.resize(
            image,
            (max(1, int(round(width * scale))), max(1, int(round(height * scale)))),
            interpolation=cv2.INTER_AREA,
        )
        height, width = image.shape[:2]
    return image, original_width / width, original_height / height


def face_gpu_worker_count(paths):
    from PIL import Image as PILImage

    for path in paths:
        try:
            with open(path, "rb") as image_file:
                is_jpeg = image_file.read(2) == b"\xff\xd8"
            if is_jpeg:
                continue
            with PILImage.open(path) as source:
                if source.format != "JPEG" and (
                    source.width * source.height > FACE_GPU_TWELVE_WORKER_PIXEL_LIMIT
                ):
                    return FACE_GPU_LARGE_IMAGE_WORKERS
        except Exception:
            return FACE_GPU_LARGE_IMAGE_WORKERS
    return FACE_GPU_WORKERS


def buffalo_m_gpu_worker_count(paths):
    from PIL import Image as PILImage

    has_tiled_image = False
    for path in paths:
        try:
            with PILImage.open(path) as source:
                pixels = source.width * source.height
                if pixels >= BUFFALO_M_LARGE_IMAGE_PIXEL_LIMIT:
                    return BUFFALO_M_GPU_LARGE_IMAGE_WORKERS
                has_tiled_image = has_tiled_image or pixels >= BUFFALO_M_TILED_IMAGE_PIXEL_LIMIT
        except Exception:
            return BUFFALO_M_GPU_LARGE_IMAGE_WORKERS
    return BUFFALO_M_GPU_TILED_WORKERS if has_tiled_image else BUFFALO_M_GPU_WORKERS


def read_ocr_image(path: str, max_pixels=OCR_MAX_INPUT_PIXELS):
    """Decode OCR input at a bounded size and return source-to-input scale."""
    global cv2, np
    if cv2 is None or np is None:
        import cv2 as cv2_module
        import numpy as numpy_module
        cv2, np = cv2_module, numpy_module

    try:
        from PIL import Image as PILImage

        # Pillow checks decompression limits while reading headers. Disable that check
        # only during this metadata-only probe; OpenCV performs the bounded pixel decode.
        with image_header_lock:
            max_image_pixels = PILImage.MAX_IMAGE_PIXELS
            try:
                PILImage.MAX_IMAGE_PIXELS = None
                with PILImage.open(path) as source:
                    original_width, original_height = source.size
                    image_format = source.format
                    orientation = source.getexif().get(274, 1)
            finally:
                PILImage.MAX_IMAGE_PIXELS = max_image_pixels
        if orientation in (5, 6, 7, 8):
            original_width, original_height = original_height, original_width

        encoded = np.fromfile(path, dtype=np.uint8)
        decode_flag = cv2.IMREAD_COLOR
        if original_width * original_height > max_pixels and image_format == "JPEG":
            for factor, flag in (
                (2, cv2.IMREAD_REDUCED_COLOR_2),
                (4, cv2.IMREAD_REDUCED_COLOR_4),
                (8, cv2.IMREAD_REDUCED_COLOR_8),
            ):
                decode_flag = flag
                if original_width * original_height // (factor * factor) <= max_pixels:
                    break
        image = cv2.imdecode(encoded, decode_flag)
        if image is None and decode_flag != cv2.IMREAD_COLOR:
            image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    except Exception:
        image = read_cv_image(path)
        if image is None:
            return None, 1.0, 1.0
        original_height, original_width = image.shape[:2]

    if image is None:
        return None, 1.0, 1.0

    height, width = image.shape[:2]
    if height * width > max_pixels:
        scale = (max_pixels / float(height * width)) ** 0.5
        image = cv2.resize(
            image,
            (max(1, int(width * scale)), max(1, int(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
        height, width = image.shape[:2]
    return image, original_width / width, original_height / height


def scale_ocr_box(box, scale_x, scale_y):
    """Map OCR polygon coordinates back to the decoded source image."""
    if scale_x == 1.0 and scale_y == 1.0:
        return box
    return [
        [int(round(float(point[0]) * scale_x)), int(round(float(point[1]) * scale_y))]
        for point in box
    ]


def load_ocr_engine(device_mode="cpu"):
    global rapid_ocr, ocr_runtime_error
    mode = "gpu" if device_mode == "gpu" else "cpu"
    if mode == "gpu" and ocr_gpu_runtime_failed:
        raise RuntimeError("gpu_inference_failed")
    state = ocr_module_status()
    if not state["ready"]:
        ocr_runtime_error = state.get("error", "ocr_dependencies_missing")
        raise RuntimeError(ocr_runtime_error)
    if mode == "gpu" and not gpu_available(require_onnx=True):
        raise RuntimeError("gpu_unavailable")
    if mode not in rapid_ocr:
        try:
            from rapidocr import RapidOCR
            params = {
                "Global.model_root_dir": str(model_dir / OCR_MODEL_DIRECTORY),
                "EngineConfig.onnxruntime.use_cuda": mode == "gpu",
                "Cls.cls_batch_num": (
                    OCR_CLASSIFIER_BATCH_SIZE if mode == "gpu" else OCR_DEFAULT_BATCH_SIZE
                ),
                "Rec.rec_batch_num": OCR_RECOGNIZER_BATCH_SIZE,
            }
            if mode == "cpu":
                params["EngineConfig.onnxruntime.intra_op_num_threads"] = OCR_CPU_ONNX_THREADS
            with contextlib.redirect_stdout(sys.stderr):
                rapid_ocr[mode] = RapidOCR(params=params)
        except Exception:
            if mode == "gpu":
                raise RuntimeError("gpu_inference_failed") from None
            ocr_runtime_error = "ocr_model_load_failed"
            raise RuntimeError(ocr_runtime_error) from None
    return rapid_ocr[mode]


def ocr_engine_uses_cuda(engine) -> bool:
    loaded_sessions = 0
    for model_name in ("text_det", "text_cls", "text_rec"):
        model = getattr(engine, model_name, None)
        if model is None:
            continue
        inference = getattr(model, "session", None)
        session = getattr(inference, "session", None)
        if session is None:
            return False
        try:
            providers = session.get_providers()
        except Exception:
            return False
        if not providers or providers[0] != "CUDAExecutionProvider":
            return False
        loaded_sessions += 1
    return loaded_sessions > 0


def invalidate_gpu_ocr_engine() -> None:
    global ocr_gpu_runtime_failed
    ocr_gpu_runtime_failed = True
    rapid_ocr.pop("gpu", None)


def load_face_models(device_mode="cpu", face_model=FACE_MODEL_DEFAULT):
    global face_models, cv2, np, face_runtime_error
    if face_model not in FACE_MODELS:
        raise RuntimeError("face_model_unknown")
    state = face_module_status() if face_model == FACE_MODEL_QUALITY_V2 else face_model_status().get(face_model, {})
    if not state["ready"]:
        face_runtime_error = state.get("error", "face_dependencies_missing")
        raise RuntimeError(face_runtime_error)
    mode = "gpu" if device_mode == "gpu" else "cpu"
    if mode == "gpu" and not gpu_available(require_onnx=True):
        raise RuntimeError("gpu_unavailable")
    cache_key = f"{face_model}:{mode}"
    if cache_key in face_models:
        return face_models[cache_key]
    with face_models_lock:
        if cache_key in face_models:
            return face_models[cache_key]
        try:
            import cv2 as cv2_module
            import numpy as numpy_module
            cv2, np = cv2_module, numpy_module
            if face_model == FACE_MODEL_BUFFALO_M:
                import onnxruntime
                detector_path = str(model_dir / "face" / FACE_MODEL_BUFFALO_M / BUFFALO_M_DETECTOR_FILE)
                recognizer_path = str(model_dir / "face" / FACE_MODEL_BUFFALO_M / BUFFALO_M_RECOGNIZER_FILE)
                providers = ["CUDAExecutionProvider"] if mode == "gpu" else ["CPUExecutionProvider"]
                detector = onnxruntime.InferenceSession(detector_path, providers=providers)
                recognizer = onnxruntime.InferenceSession(recognizer_path, providers=providers)
                if any(
                    not session.get_providers()
                    or session.get_providers()[0] != providers[0]
                    for session in (detector, recognizer)
                ):
                    raise RuntimeError("gpu_unavailable" if mode == "gpu" else "face_inference_failed")
                outputs = detector.get_outputs()
                if len(outputs) != 9:
                    raise RuntimeError("face_model_load_failed")
                face_models[cache_key] = {
                    "device": mode,
                    "profile": face_model,
                    "detector": detector,
                    "recognizer": recognizer,
                    "detector_input": detector.get_inputs()[0].name,
                    "recognizer_input": recognizer.get_inputs()[0].name,
                    "detector_outputs": [output.name for output in outputs],
                }
                return face_models[cache_key]

            detector_path = str(model_dir / "face" / YUNET_FILE)
            recognizer_path = str(model_dir / "face" / SFACE_FILE)
            if mode == "gpu":
                import onnxruntime
                detector = onnxruntime.InferenceSession(
                    detector_path, providers=["CUDAExecutionProvider"]
                )
                recognizer = onnxruntime.InferenceSession(
                    recognizer_path, providers=["CUDAExecutionProvider"]
                )
                if any(
                    not session.get_providers()
                    or session.get_providers()[0] != "CUDAExecutionProvider"
                    for session in (detector, recognizer)
                ):
                    raise RuntimeError("gpu_unavailable")
                face_models[cache_key] = {
                    "device": mode, "profile": face_model,
                    "detector": detector, "recognizer": recognizer,
                }
            else:
                face_models[cache_key] = {
                    "device": mode,
                    "profile": face_model,
                    "detector": cv2.FaceDetectorYN_create(
                        detector_path, "", (320, 320), YUNET_SCORE_THRESHOLD, 0.3, 5000
                    ),
                    "recognizer": cv2.FaceRecognizerSF_create(recognizer_path, ""),
                }
        except RuntimeError:
            raise
        except Exception:
            if mode == "gpu":
                raise RuntimeError("gpu_inference_failed") from None
            if face_model == FACE_MODEL_QUALITY_V2:
                face_runtime_error = "face_model_load_failed"
                raise RuntimeError(face_runtime_error) from None
            face_profile_runtime_errors[face_model] = "face_model_load_failed"
            raise RuntimeError(face_profile_runtime_errors[face_model]) from None
        return face_models[cache_key]


def analyze_ocr_image(path: str, device_mode="cpu") -> dict:
    image, scale_x, scale_y = read_ocr_image(path)
    if image is None:
        return {"data": None, "error": "image_unreadable"}
    try:
        engine = load_ocr_engine(device_mode)
        result = engine(image)
        if device_mode == "gpu" and not ocr_engine_uses_cuda(engine):
            invalidate_gpu_ocr_engine()
            return {"data": None, "error": "gpu_inference_failed"}
        texts = list(result.txts) if result.txts is not None else []
        scores = list(result.scores) if result.scores is not None else []
        boxes = list(result.boxes) if result.boxes is not None else []
        lines = []
        for index, text in enumerate(texts):
            normalized = str(text).strip()
            if not normalized:
                continue
            box = boxes[index].tolist() if index < len(boxes) and hasattr(boxes[index], "tolist") else boxes[index] if index < len(boxes) else []
            if box and (scale_x != 1.0 or scale_y != 1.0):
                box = scale_ocr_box(box, scale_x, scale_y)
            try:
                confidence = float(scores[index]) if index < len(scores) else 0.0
            except (TypeError, ValueError):
                confidence = 0.0
            lines.append({"text": normalized, "confidence": confidence, "box": box})
        lines = lines[:512]
        return {"data": {"text": "\n".join(line["text"] for line in lines), "lines": lines}}
    except RuntimeError as error:
        code = str(error)
        if code in ("gpu_unavailable", "gpu_inference_failed"):
            if code == "gpu_inference_failed":
                invalidate_gpu_ocr_engine()
            return {"data": None, "error": code}
        return {"data": None, "error": "ocr_inference_failed"}
    except Exception:
        if device_mode == "gpu":
            invalidate_gpu_ocr_engine()
        return {"data": None, "error": "gpu_inference_failed" if device_mode == "gpu" else "ocr_inference_failed"}


def ocr_cpu_image_worker_count() -> int:
    logical_processors = os.cpu_count()
    if logical_processors is None:
        return 2
    return min(
        OCR_CPU_MAX_IMAGE_WORKERS,
        max(1, logical_processors // (OCR_CPU_ONNX_THREADS * 2)),
    )


def ocr_gpu_image_worker_count(paths) -> int:
    from PIL import Image as PILImage

    if (
        not isinstance(paths, list)
        or not paths
        or not all(isinstance(path, str) for path in paths)
    ):
        return OCR_GPU_IMAGE_WORKERS
    for path in paths:
        try:
            with PILImage.open(path) as source:
                if source.width * source.height > OCR_GPU_LARGE_IMAGE_PIXEL_LIMIT:
                    return OCR_GPU_LARGE_IMAGE_WORKERS
        except Exception:
            return OCR_GPU_LARGE_IMAGE_WORKERS
    return OCR_GPU_IMAGE_WORKERS


def tile_offsets(length, tile_size=YUNET_INPUT_SIZE, overlap=128):
    if length <= tile_size:
        return [0]
    stride = tile_size - max(0, min(overlap, tile_size - 1))
    offsets = list(range(0, length - tile_size + 1, stride))
    final = length - tile_size
    if offsets[-1] != final:
        offsets.append(final)
    return offsets


def yunet_nms(faces, threshold=0.3, limit=5000):
    if not faces:
        return []

    boxes = np.asarray([face[:4] for face in faces], dtype=np.float64)
    scores = np.asarray([face[14] for face in faces], dtype=np.float64)
    x1, y1 = boxes[:, 0], boxes[:, 1]
    x2, y2 = x1 + boxes[:, 2], y1 + boxes[:, 3]
    areas = np.maximum(0.0, boxes[:, 2]) * np.maximum(0.0, boxes[:, 3])
    order = np.argsort(-scores, kind="stable")
    kept = []
    max_kept = max(1, limit)
    while order.size and len(kept) < max_kept:
        selected = int(order[0])
        kept.append(selected)
        candidates = order[1:]
        if not candidates.size:
            break

        left = np.maximum(x1[selected], x1[candidates])
        top = np.maximum(y1[selected], y1[candidates])
        right = np.minimum(x2[selected], x2[candidates])
        bottom = np.minimum(y2[selected], y2[candidates])
        intersection = np.maximum(0.0, right - left) * np.maximum(0.0, bottom - top)
        union = areas[selected] + areas[candidates] - intersection
        overlaps = np.divide(
            intersection,
            union,
            out=np.zeros_like(intersection),
            where=union > 0,
        )
        order = candidates[overlaps <= threshold]

    return [faces[index] for index in kept]


def yunet_overview(image):
    height, width = image.shape[:2]
    scale = YUNET_INPUT_SIZE / float(max(height, width))
    resized_width = max(1, int(round(width * scale)))
    resized_height = max(1, int(round(height * scale)))
    resized = cv2.resize(
        image,
        (resized_width, resized_height),
        interpolation=cv2.INTER_AREA,
    )
    if resized_height != YUNET_INPUT_SIZE or resized_width != YUNET_INPUT_SIZE:
        resized = cv2.copyMakeBorder(
            resized,
            0,
            YUNET_INPUT_SIZE - resized_height,
            0,
            YUNET_INPUT_SIZE - resized_width,
            cv2.BORDER_CONSTANT,
            value=(0, 0, 0),
        )
    return resized, width / resized_width, height / resized_height


def detect_yunet_gpu_input(image, session, offset_x=0, offset_y=0, scale_x=1.0, scale_y=1.0):
    input_meta = session.get_inputs()[0]
    outputs = {output.name: index for index, output in enumerate(session.get_outputs())}
    faces = []
    blob = cv2.dnn.blobFromImage(image)
    predictions = session.run(None, {input_meta.name: blob})
    for stride in (8, 16, 32):
        cls = predictions[outputs[f"cls_{stride}"]].reshape(-1)
        obj = predictions[outputs[f"obj_{stride}"]].reshape(-1)
        bbox = predictions[outputs[f"bbox_{stride}"]].reshape(-1, 4)
        keypoints = predictions[outputs[f"kps_{stride}"]].reshape(-1, 10)
        columns = YUNET_INPUT_SIZE // stride
        scores = np.sqrt(np.clip(cls, 0.0, 1.0) * np.clip(obj, 0.0, 1.0))
        selected = np.flatnonzero(scores >= YUNET_SCORE_THRESHOLD)
        if selected.size == 0:
            continue
        rows, grid_columns = np.divmod(selected, columns)
        selected_boxes = bbox[selected]
        center_x = (grid_columns + selected_boxes[:, 0]) * stride
        center_y = (rows + selected_boxes[:, 1]) * stride
        box_width = np.exp(selected_boxes[:, 2]) * stride
        box_height = np.exp(selected_boxes[:, 3]) * stride
        boxes = np.column_stack((
            (center_x - box_width / 2 + offset_x) * scale_x,
            (center_y - box_height / 2 + offset_y) * scale_y,
            box_width * scale_x,
            box_height * scale_y,
        ))
        landmarks = keypoints[selected].reshape(-1, 5, 2).copy()
        landmarks[:, :, 0] = (
            (landmarks[:, :, 0] + grid_columns[:, None]) * stride + offset_x
        ) * scale_x
        landmarks[:, :, 1] = ((landmarks[:, :, 1] + rows[:, None]) * stride + offset_y) * scale_y
        faces.extend(np.column_stack((
            boxes,
            landmarks.reshape(-1, 10),
            scores[selected],
        )).tolist())
    return faces


def detect_yunet_gpu(image, session):
    height, width = image.shape[:2]
    faces = []
    for top in tile_offsets(height):
        for left in tile_offsets(width):
            tile = image[top:min(top + YUNET_INPUT_SIZE, height), left:min(left + YUNET_INPUT_SIZE, width)]
            tile_height, tile_width = tile.shape[:2]
            if tile_height != YUNET_INPUT_SIZE or tile_width != YUNET_INPUT_SIZE:
                tile = cv2.copyMakeBorder(
                    tile, 0, YUNET_INPUT_SIZE - tile_height,
                    0, YUNET_INPUT_SIZE - tile_width,
                    cv2.BORDER_CONSTANT, value=(0, 0, 0),
                )
            faces.extend(detect_yunet_gpu_input(tile, session, left, top))

    if max(height, width) > YUNET_INPUT_SIZE:
        overview, scale_x, scale_y = yunet_overview(image)
        faces.extend(detect_yunet_gpu_input(overview, session, scale_x=scale_x, scale_y=scale_y))
    return yunet_nms(faces)


def detect_yunet_cpu(image, detector):
    height, width = image.shape[:2]
    faces = []

    def detect(view, scale_x=1.0, scale_y=1.0):
        view_height, view_width = view.shape[:2]
        detector.setInputSize((view_width, view_height))
        _, detections = detector.detect(view)
        if detections is None:
            return
        for detection in detections:
            face = detection.copy()
            face[[0, 2]] *= scale_x
            face[[1, 3]] *= scale_y
            face[4:14:2] *= scale_x
            face[5:14:2] *= scale_y
            faces.append(face.tolist())

    detect(image)
    if max(height, width) > YUNET_INPUT_SIZE:
        overview, scale_x, scale_y = yunet_overview(image)
        detect(overview, scale_x, scale_y)
    return yunet_nms(faces)


def buffalo_m_detection_input(image, detector, runtime, offset_x=0, offset_y=0):
    height, width = image.shape[:2]
    target_width = BUFFALO_M_DETECTION_SIZE
    target_height = BUFFALO_M_DETECTION_SIZE
    image_ratio = float(height) / width
    model_ratio = float(target_height) / target_width
    if image_ratio > model_ratio:
        resized_height = target_height
        resized_width = int(resized_height / image_ratio)
    else:
        resized_width = target_width
        resized_height = int(resized_width * image_ratio)
    if resized_width <= 0 or resized_height <= 0:
        return []
    scale_x = float(resized_width) / width
    scale_y = float(resized_height) / height
    resized = cv2.resize(image, (resized_width, resized_height))
    detector_image = np.zeros((target_height, target_width, 3), dtype=np.uint8)
    detector_image[:resized_height, :resized_width] = resized
    blob = cv2.dnn.blobFromImage(
        detector_image,
        1.0 / 128.0,
        (target_width, target_height),
        (127.5, 127.5, 127.5),
        swapRB=True,
    )
    predictions = detector.run(
        runtime["detector_outputs"],
        {runtime["detector_input"]: blob},
    )

    scores_all = []
    boxes_all = []
    landmarks_all = []
    for index, stride in enumerate(BUFFALO_M_DETECTION_STRIDES):
        scores = predictions[index].reshape(-1)
        boxes = predictions[index + 3].reshape(-1, 4) * stride
        landmarks = predictions[index + 6].reshape(-1, 5, 2) * stride
        feature_height = target_height // stride
        feature_width = target_width // stride
        grid_x, grid_y = np.meshgrid(
            np.arange(feature_width, dtype=np.float32),
            np.arange(feature_height, dtype=np.float32),
        )
        centers = np.column_stack((grid_x.reshape(-1), grid_y.reshape(-1))) * stride
        centers = np.repeat(centers, BUFFALO_M_ANCHORS_PER_LOCATION, axis=0)
        selected = np.flatnonzero(scores >= BUFFALO_M_DETECTION_THRESHOLD)
        if selected.size == 0:
            continue
        selected_boxes = boxes[selected]
        decoded_boxes = np.column_stack((
            centers[selected, 0] - selected_boxes[:, 0],
            centers[selected, 1] - selected_boxes[:, 1],
            centers[selected, 0] + selected_boxes[:, 2],
            centers[selected, 1] + selected_boxes[:, 3],
        ))
        decoded_boxes[:, (0, 2)] /= scale_x
        decoded_boxes[:, (1, 3)] /= scale_y
        decoded_boxes[:, (0, 2)] += offset_x
        decoded_boxes[:, (1, 3)] += offset_y
        scores_all.append(scores[selected])
        boxes_all.append(decoded_boxes)
        decoded_landmarks = landmarks[selected] + centers[selected, None, :]
        decoded_landmarks[:, :, 0] /= scale_x
        decoded_landmarks[:, :, 1] /= scale_y
        decoded_landmarks[:, :, 0] += offset_x
        decoded_landmarks[:, :, 1] += offset_y
        landmarks_all.append(decoded_landmarks)

    if not scores_all:
        return []
    scores = np.concatenate(scores_all).astype(np.float32, copy=False)
    boxes = np.concatenate(boxes_all).astype(np.float32, copy=False)
    landmarks = np.concatenate(landmarks_all).astype(np.float32, copy=False)
    order = np.argsort(-scores, kind="stable")
    scores, boxes, landmarks = scores[order], boxes[order], landmarks[order]

    x1, y1, x2, y2 = boxes.T
    areas = (x2 - x1 + 1) * (y2 - y1 + 1)
    order = np.argsort(-scores, kind="stable")
    kept = []
    while order.size and len(kept) < 5000:
        selected = int(order[0])
        kept.append(selected)
        remaining = order[1:]
        if not remaining.size:
            break
        left = np.maximum(x1[selected], x1[remaining])
        top = np.maximum(y1[selected], y1[remaining])
        right = np.minimum(x2[selected], x2[remaining])
        bottom = np.minimum(y2[selected], y2[remaining])
        intersection = np.maximum(0.0, right - left + 1) * np.maximum(0.0, bottom - top + 1)
        union = areas[selected] + areas[remaining] - intersection
        overlap = np.divide(intersection, union, out=np.zeros_like(intersection), where=union > 0)
        order = remaining[overlap <= 0.4]

    detections = []
    for index in kept:
        x, y, right, bottom = boxes[index]
        detections.append(np.concatenate((
            np.asarray([x, y, right - x, bottom - y], dtype=np.float32),
            landmarks[index].reshape(-1),
            np.asarray([scores[index]], dtype=np.float32),
        )))
    return detections


def buffalo_m_nms(faces, threshold=0.4, limit=512):
    if not faces:
        return []
    boxes = np.asarray([face[:4] for face in faces], dtype=np.float64)
    scores = np.asarray([face[14] for face in faces], dtype=np.float64)
    x1, y1 = boxes[:, 0], boxes[:, 1]
    x2, y2 = x1 + boxes[:, 2], y1 + boxes[:, 3]
    areas = np.maximum(0.0, boxes[:, 2]) * np.maximum(0.0, boxes[:, 3])
    order = np.argsort(-scores, kind="stable")
    kept = []
    while order.size and len(kept) < max(1, limit):
        selected = int(order[0])
        kept.append(selected)
        candidates = order[1:]
        if not candidates.size:
            break
        left = np.maximum(x1[selected], x1[candidates])
        top = np.maximum(y1[selected], y1[candidates])
        right = np.minimum(x2[selected], x2[candidates])
        bottom = np.minimum(y2[selected], y2[candidates])
        intersection = np.maximum(0.0, right - left) * np.maximum(0.0, bottom - top)
        union = areas[selected] + areas[candidates] - intersection
        overlaps = np.divide(intersection, union, out=np.zeros_like(intersection), where=union > 0)
        order = candidates[overlaps <= threshold]
    return [faces[index] for index in kept]


def buffalo_m_needs_group_tiles(image, detections):
    height, width = image.shape[:2]
    long_side = max(height, width)
    if len(detections) >= 8:
        return True
    if long_side >= 2048 and len(detections) >= 4:
        return True
    return any(
        len(face) >= 4 and max(float(face[2]), float(face[3])) / long_side <= 0.04
        for face in detections
    )


def buffalo_m_face_limit(image, detections):
    return BUFFALO_M_GROUP_FACE_LIMIT if buffalo_m_needs_group_tiles(image, detections) else BUFFALO_M_FACE_LIMIT


def detect_buffalo_m(image, runtime, use_group_tiles=True):
    detector = runtime["detector"]
    overview = buffalo_m_detection_input(image, detector, runtime)
    if not use_group_tiles or not buffalo_m_needs_group_tiles(image, overview):
        return overview

    height, width = image.shape[:2]
    tiled = list(overview)
    tile_count = 0
    for top in tile_offsets(height, BUFFALO_M_GROUP_TILE_SIZE):
        for left in tile_offsets(width, BUFFALO_M_GROUP_TILE_SIZE):
            if tile_count >= BUFFALO_M_GROUP_TILE_LIMIT:
                break
            tile = image[
                top:min(top + BUFFALO_M_GROUP_TILE_SIZE, height),
                left:min(left + BUFFALO_M_GROUP_TILE_SIZE, width),
            ]
            tiled.extend(buffalo_m_detection_input(tile, detector, runtime, left, top))
            tile_count += 1
        if tile_count >= BUFFALO_M_GROUP_TILE_LIMIT:
            break
    return buffalo_m_nms(tiled, limit=BUFFALO_M_GROUP_FACE_LIMIT * 2)


def align_sface_crop(image, detection):
    source = np.asarray(detection[4:14], dtype=np.float64).reshape(5, 2)
    destination = np.asarray([
        [38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
        [41.5493, 92.3655], [70.7299, 92.2041],
    ], dtype=np.float64)
    source_mean = source.mean(axis=0)
    destination_mean = np.asarray([56.0262, 71.9008], dtype=np.float64)
    source_centered = source - source_mean
    destination_centered = destination - destination_mean
    variance = float(np.square(source_centered).sum())
    scale_cos = float(np.sum(source_centered * destination_centered) / variance)
    scale_sin = float(
        np.sum(
            source_centered[:, 0] * destination_centered[:, 1]
            - source_centered[:, 1] * destination_centered[:, 0]
        )
        / variance
    )
    matrix = np.empty((2, 3), dtype=np.float64)
    matrix[0, 0], matrix[0, 1] = scale_cos, -scale_sin
    matrix[1, 0], matrix[1, 1] = scale_sin, scale_cos
    matrix[0, 2] = (
        destination_mean[0] - scale_cos * source_mean[0] + scale_sin * source_mean[1]
    )
    matrix[1, 2] = (
        destination_mean[1] - scale_sin * source_mean[0] - scale_cos * source_mean[1]
    )
    return cv2.warpAffine(image, matrix, (112, 112), flags=cv2.INTER_LINEAR)


def valid_yunet_detection(detection, image_shape, minimum_score=YUNET_SCORE_THRESHOLD):
    values = np.asarray(detection, dtype=np.float64).reshape(-1)
    if values.size < 15 or not np.isfinite(values[:15]).all():
        return False

    x, y, width, height = values[:4]
    score = values[14]
    if score < minimum_score or width < YUNET_MIN_FACE_SIDE or height < YUNET_MIN_FACE_SIDE:
        return False
    if height <= 0 or width / height < 0.5 or width / height > 2.0:
        return False

    frame_height, frame_width = image_shape[:2]
    if x + width <= 0 or y + height <= 0 or x >= frame_width or y >= frame_height:
        return False

    landmarks = values[4:14].reshape(5, 2)
    if (
        np.any(landmarks[:, 0] < x - width * 0.2)
        or np.any(landmarks[:, 0] > x + width * 1.2)
        or np.any(landmarks[:, 1] < y - height * 0.2)
        or np.any(landmarks[:, 1] > y + height * 1.2)
    ):
        return False

    eye_distance = float(np.linalg.norm(landmarks[0] - landmarks[1]))
    mouth_distance = float(np.linalg.norm(landmarks[3] - landmarks[4]))
    if eye_distance < max(2.0, width * 0.1) or mouth_distance < max(1.5, width * 0.06):
        return False

    eye_y = float(np.mean(landmarks[:2, 1]))
    nose_y = float(landmarks[2, 1])
    mouth_y = float(np.mean(landmarks[3:, 1]))
    return eye_y < mouth_y and eye_y - height * 0.1 <= nose_y <= mouth_y + height * 0.1


def analyze_face_image(
    path: str,
    device_mode="cpu",
    face_model=FACE_MODEL_DEFAULT,
    buffalo_m_tiling=True,
) -> dict:
    image, scale_x, scale_y = read_face_image(path)
    if image is None:
        return {"data": None, "error": "image_unreadable"}
    try:
        runtime = load_face_models(device_mode, face_model)
        if face_model == FACE_MODEL_BUFFALO_M:
            detections = detect_buffalo_m(image, runtime, use_group_tiles=buffalo_m_tiling)
        elif runtime["device"] == "gpu":
            detections = detect_yunet_gpu(image, runtime["detector"])
        else:
            detections = detect_yunet_cpu(image, runtime["detector"])
        faces = []
        minimum_score = (
            BUFFALO_M_DETECTION_THRESHOLD
            if face_model == FACE_MODEL_BUFFALO_M
            else YUNET_SCORE_THRESHOLD
        )
        if detections is not None:
            face_limit = (
                buffalo_m_face_limit(image, detections)
                if face_model == FACE_MODEL_BUFFALO_M
                else BUFFALO_M_FACE_LIMIT
            )
            for detection in detections:
                if not valid_yunet_detection(detection, image.shape, minimum_score):
                    continue
                if face_model == FACE_MODEL_BUFFALO_M:
                    aligned = align_sface_crop(image, detection)
                    blob = cv2.dnn.blobFromImage(
                        aligned,
                        1.0 / 127.5,
                        (BUFFALO_M_RECOGNITION_SIZE, BUFFALO_M_RECOGNITION_SIZE),
                        (127.5, 127.5, 127.5),
                        swapRB=True,
                    )
                    feature = runtime["recognizer"].run(
                        None,
                        {runtime["recognizer_input"]: blob},
                    )[0].reshape(-1).astype(np.float32)
                elif runtime["device"] == "gpu":
                    aligned = align_sface_crop(image, detection)
                    blob = cv2.dnn.blobFromImage(aligned, 1.0, (112, 112), (0, 0, 0), True, False)
                    feature = runtime["recognizer"].run(
                        None, {runtime["recognizer"].get_inputs()[0].name: blob}
                    )[0].reshape(-1).astype(np.float32)
                else:
                    aligned = runtime["recognizer"].alignCrop(image, detection)
                    feature = runtime["recognizer"].feature(aligned).reshape(-1).astype(np.float32)
                norm = float(np.linalg.norm(feature))
                if not norm or not np.isfinite(norm):
                    continue
                embedding = (feature / norm).tolist()
                x = float(detection[0]) * scale_x
                y = float(detection[1]) * scale_y
                box_width = float(detection[2]) * scale_x
                box_height = float(detection[3]) * scale_y
                faces.append({
                    "box": [x, y, box_width, box_height],
                    "score": float(detection[-1]),
                    "embedding": embedding,
                })
                if len(faces) == face_limit:
                    break
        return {"data": {"faces": faces}}
    except RuntimeError as error:
        code = str(error)
        if code in ("gpu_unavailable", "gpu_inference_failed"):
            return {"data": None, "error": code}
        return {"data": None, "error": "face_inference_failed"}
    except Exception:
        return {"data": None, "error": "gpu_inference_failed" if device_mode == "gpu" else "face_inference_failed"}


def run_image_analysis(paths, analyze, max_workers=1):
    if not isinstance(paths, list) or not paths or len(paths) > 32 or not all(isinstance(path, str) for path in paths):
        return {"error": "invalid_image_batch"}
    if max_workers > 1 and len(paths) > 1:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(max_workers, len(paths))) as executor:
            items = list(executor.map(analyze, paths))
    else:
        items = [analyze(path) for path in paths]
    return {"items": items, "status": status()}


def run_ocr_image_analysis(paths, device_mode):
    def analyze(path):
        return analyze_ocr_image(path, device_mode)

    max_workers = (
        ocr_gpu_image_worker_count(paths)
        if device_mode == "gpu"
        else ocr_cpu_image_worker_count()
    )
    return run_warmed_image_analysis(paths, analyze, max_workers)


def run_warmed_image_analysis(paths, analyze, max_workers):
    if not isinstance(paths, list) or not paths or len(paths) > 32 or not all(isinstance(path, str) for path in paths):
        return {"error": "invalid_image_batch"}
    if max_workers <= 1 or len(paths) < 2:
        return run_image_analysis(paths, analyze)

    items = [None] * len(paths)
    ready_index = None
    for index, path in enumerate(paths):
        items[index] = analyze(path)
        error = items[index].get("error")
        if not error:
            ready_index = index
            break
        if error != "image_unreadable":
            for later_index in range(index + 1, len(paths)):
                items[later_index] = analyze(paths[later_index])
            return {"items": items, "status": status()}

    if ready_index is not None and ready_index + 1 < len(paths):
        indices = range(ready_index + 1, len(paths))
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=min(max_workers, len(paths) - ready_index - 1)
        ) as executor:
            for index, result in zip(indices, executor.map(analyze, paths[ready_index + 1:]), strict=True):
                items[index] = result
    return {"items": items, "status": status()}


def verify_installation() -> None:
    global cv2, np
    modules = status()["modules"]
    face_models_status = status()["faceModels"]
    if (
        not modules["ocr"]["ready"]
        or not all(face_models_status[profile]["ready"] for profile in FACE_MODELS)
    ):
        raise RuntimeError("OCR or face dependencies/models are unavailable")
    import cv2 as cv2_module
    import numpy as numpy_module
    cv2, np = cv2_module, numpy_module

    probe = np.full((240, 960, 3), 255, dtype=np.uint8)
    cv2.putText(probe, "LOCAL GALLERY 2026", (36, 150), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (0, 0, 0), 4, cv2.LINE_AA)
    ocr_result = load_ocr_engine("cpu")(probe)
    if not ocr_result.txts:
        raise RuntimeError("OCR smoke image produced no text")

    face_runtime = load_face_models("cpu")
    face_runtime["detector"].setInputSize((320, 320))
    face_runtime["detector"].detect(np.full((320, 320, 3), 255, dtype=np.uint8))
    face_feature = face_runtime["recognizer"].feature(np.zeros((112, 112, 3), dtype=np.uint8)).reshape(-1)
    if face_feature.size != 128 or not np.isfinite(face_feature).all():
        raise RuntimeError("SFace inference returned an invalid feature")

    buffalo_runtime = load_face_models("cpu", FACE_MODEL_BUFFALO_M)
    buffalo_detections = detect_buffalo_m(np.full((640, 640, 3), 255, dtype=np.uint8), buffalo_runtime)
    if not isinstance(buffalo_detections, list):
        raise RuntimeError("Buffalo_m SCRFD inference returned unexpected detections")
    buffalo_feature_input = cv2.dnn.blobFromImage(
        np.zeros((112, 112, 3), dtype=np.uint8),
        1.0 / 127.5,
        (112, 112),
        (127.5, 127.5, 127.5),
        swapRB=True,
    )
    buffalo_feature = buffalo_runtime["recognizer"].run(
        None,
        {buffalo_runtime["recognizer_input"]: buffalo_feature_input},
    )[0].reshape(-1)
    if buffalo_feature.size != BUFFALO_M_EMBEDDING_DIMENSION or not np.isfinite(buffalo_feature).all():
        raise RuntimeError("Buffalo_m recognition returned an invalid feature")

    gpu_verified = False
    if gpu_available(require_onnx=True):
        gpu_ocr_result = load_ocr_engine("gpu")(probe)
        if not gpu_ocr_result.txts:
            raise RuntimeError("GPU OCR smoke image produced no text")

        gpu_face_runtime = load_face_models("gpu")
        detected_faces = detect_yunet_gpu(
            np.full((640, 640, 3), 255, dtype=np.uint8),
            gpu_face_runtime["detector"],
        )
        if not isinstance(detected_faces, list):
            raise RuntimeError("GPU YuNet inference returned unexpected detections")
        recognizer_input = cv2.dnn.blobFromImage(
            np.zeros((112, 112, 3), dtype=np.uint8), 1.0, (112, 112), (0, 0, 0), True, False
        )
        gpu_face_feature = gpu_face_runtime["recognizer"].run(
            None,
            {gpu_face_runtime["recognizer"].get_inputs()[0].name: recognizer_input},
        )[0].reshape(-1)
        if gpu_face_feature.size != 128 or not np.isfinite(gpu_face_feature).all():
            raise RuntimeError("GPU SFace inference returned an invalid feature")
        gpu_buffalo_runtime = load_face_models("gpu", FACE_MODEL_BUFFALO_M)
        gpu_buffalo_detections = detect_buffalo_m(
            np.full((640, 640, 3), 255, dtype=np.uint8),
            gpu_buffalo_runtime,
        )
        if not isinstance(gpu_buffalo_detections, list):
            raise RuntimeError("GPU Buffalo_m SCRFD inference returned unexpected detections")
        gpu_buffalo_feature = gpu_buffalo_runtime["recognizer"].run(
            None,
            {gpu_buffalo_runtime["recognizer_input"]: buffalo_feature_input},
        )[0].reshape(-1)
        if gpu_buffalo_feature.size != BUFFALO_M_EMBEDDING_DIMENSION or not np.isfinite(gpu_buffalo_feature).all():
            raise RuntimeError("GPU Buffalo_m recognition returned an invalid feature")
        gpu_verified = True

    print(json.dumps({
        "ok": True,
        "ocrText": " ".join(ocr_result.txts),
        "faceEmbeddingDimension": int(face_feature.size),
        "buffaloEmbeddingDimension": int(buffalo_feature.size),
        "gpuVerified": gpu_verified,
    }, ensure_ascii=False))


def _process_request(request: dict) -> dict:
    action = request.get("action")
    if action == "status":
        return {"status": status()}
    device_mode = request.get("device", "auto")
    if device_mode not in ("auto", "cpu", "gpu"):
        return {"error": "invalid_device_mode"}
    if action == "ocr_images":
        if not ocr_module_status()["ready"]:
            return {"error": ocr_module_status().get("error", "ocr_dependencies_missing")}
        if device_mode == "gpu" and not gpu_available(require_onnx=True):
            return {"error": "gpu_unavailable", "status": status()}
        return run_ocr_image_analysis(request.get("paths"), device_mode)
    if action == "face_images":
        face_model = request.get("model", FACE_MODEL_DEFAULT)
        if face_model not in FACE_MODELS:
            return {"error": "invalid_face_model"}
        profile_status = face_model_status()[face_model]
        if not profile_status["ready"]:
            return {"error": profile_status.get("error", "face_dependencies_missing")}
        if device_mode == "gpu" and not gpu_available(require_onnx=True):
            return {"error": "gpu_unavailable", "status": status()}
        paths = request.get("paths")
        max_workers = BUFFALO_M_GPU_WORKERS if face_model == FACE_MODEL_BUFFALO_M else FACE_GPU_WORKERS
        if face_model == FACE_MODEL_BUFFALO_M and device_mode == "gpu" and isinstance(paths, list) and 0 < len(paths) <= 32 and all(
            isinstance(path, str) for path in paths
        ):
            max_workers = buffalo_m_gpu_worker_count(paths)
        if face_model != FACE_MODEL_BUFFALO_M and device_mode == "gpu" and isinstance(paths, list) and 0 < len(paths) <= 32 and all(
            isinstance(path, str) for path in paths
        ):
            max_workers = face_gpu_worker_count(paths)
        return run_image_analysis(
            paths,
            lambda path: analyze_face_image(path, device_mode, face_model),
            max_workers=max_workers if device_mode == "gpu" else 1,
        )
    if action not in ("embed_images", "embed_texts"):
        return {"error": "unknown_action"}
    if runtime_error:
        return {"error": runtime_error}
    if device_mode == "gpu" and not gpu_available():
        return {"error": "gpu_unavailable", "status": status()}
    try:
        load_model(device_mode)
    except Exception as error:
        code = str(error)
        if code in ("gpu_unavailable", "gpu_inference_failed", "model_missing_or_checksum_invalid", "python_dependencies_missing", "model_load_failed"):
            return {"error": code, "status": status()}
        return {"error": "model_load_failed", "status": status()}
    if action == "embed_images":
        paths = request.get("paths")
        if not isinstance(paths, list) or len(paths) > 32 or not all(isinstance(path, str) for path in paths):
            return {"error": "invalid_image_batch"}
        prepare_workers = image_preprocess_worker_count(paths)
        return {
            "items": run_with_fallback(
                paths,
                encode_image_batch,
                prepare_image,
                device_mode,
                prepare_workers=prepare_workers,
            ),
            "status": status(),
        }
    texts = request.get("texts")
    if not isinstance(texts, list) or not texts or len(texts) > 64 or not all(isinstance(text, str) for text in texts):
        return {"error": "invalid_text_batch"}
    return {"items": run_with_fallback(texts, encode_text_batch, lambda text: text, device_mode), "status": status()}


def process(request: dict) -> dict:
    release_idle_models()
    action = request.get("action")
    try:
        return _process_request(request)
    finally:
        inference_actions = ("embed_images", "embed_texts", "ocr_images", "face_images")
        if action in inference_actions and has_loaded_models():
            mark_model_activity()


def configure_worker_stdio() -> None:
    for stream in (sys.stdin, sys.stdout):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8")


def main() -> None:
    global torch, runtime_error, device, clip, Image
    configure_worker_stdio()
    configure_cuda_dlls()
    try:
        import torch as torch_module
        from PIL import Image as image_module
        import cn_clip.clip as clip_module
        torch = torch_module
        Image = image_module
        clip = clip_module
        device = "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        runtime_error = "python_dependencies_missing"
    if len(sys.argv) > 2 and sys.argv[2] == "--verify-install":
        try:
            verify_installation()
        except Exception as error:
            sys.stderr.write(f"安装验证失败: {error}\n")
            raise SystemExit(1) from error
        return
    for line in sys.stdin:
        try:
            request = json.loads(line)
            request_id = request.get("id", "")
            response = process(request)
            response["id"] = request_id
        except Exception:
            response = {"id": "", "error": "worker_request_failed"}
        sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
