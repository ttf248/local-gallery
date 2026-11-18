"""Run a local, labelled face and identity evaluation for both face profiles."""

from __future__ import annotations

import argparse
import ctypes
import json
import math
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path


def read_dataset(path: Path, limit: int | None) -> tuple[list[dict], int]:
    try:
        dataset = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"无法读取标注集: {error}") from None
    if not isinstance(dataset, dict) or dataset.get("schemaVersion") != 1:
        raise ValueError("标注集 schemaVersion 必须为 1")
    photos = dataset.get("photos")
    if not isinstance(photos, list) or not photos:
        raise ValueError("标注集 photos 必须是非空数组")

    normalized = []
    resource_ids = set()
    for index, photo in enumerate(photos):
        if not isinstance(photo, dict):
            raise ValueError(f"photos[{index}] 必须是对象")
        resource_id = photo.get("resourceId")
        image_path = photo.get("path")
        faces = photo.get("faces")
        tags = photo.get("tags", [])
        if not isinstance(resource_id, str) or not resource_id or resource_id in resource_ids:
            raise ValueError(f"photos[{index}].resourceId 必须唯一且非空")
        if not isinstance(image_path, str) or not image_path:
            raise ValueError(f"photos[{index}].path 必须是本地图片路径")
        if not isinstance(faces, list):
            raise ValueError(f"photos[{index}].faces 必须是数组")
        if (
            not isinstance(tags, list)
            or any(not isinstance(tag, str) or not tag.strip() for tag in tags)
        ):
            raise ValueError(f"photos[{index}].tags 必须是非空字符串组成且无重复的数组")
        tags = [tag.strip() for tag in tags]
        if len(tags) != len(set(tags)):
            raise ValueError(f"photos[{index}].tags 必须是非空字符串组成且无重复的数组")
        resolved_path = Path(image_path).expanduser()
        if not resolved_path.is_absolute():
            resolved_path = path.parent / resolved_path
        if not resolved_path.is_file():
            raise ValueError(f"资源 {resource_id} 的图片文件不存在")
        normalized_faces = []
        for face_index, face in enumerate(faces):
            if not isinstance(face, dict):
                raise ValueError(f"资源 {resource_id} 的 faces[{face_index}] 必须是对象")
            box = face.get("box")
            identity = face.get("identity")
            small_face = face.get("smallFace")
            if (
                not isinstance(box, list)
                or len(box) != 4
                or not all(
                    isinstance(value, (int, float))
                    and not isinstance(value, bool)
                    and math.isfinite(value)
                    for value in box
                )
                or box[2] <= 0
                or box[3] <= 0
                or not isinstance(identity, str)
                or not identity
                or (small_face is not None and not isinstance(small_face, bool))
            ):
                raise ValueError(f"资源 {resource_id} 的 faces[{face_index}] 标注无效")
            normalized_faces.append({
                "box": [float(value) for value in box],
                "identity": identity,
                **({"smallFace": small_face} if small_face is not None else {}),
            })
        resource_ids.add(resource_id)
        normalized.append({
            "resourceId": resource_id,
            "path": str(resolved_path.resolve()),
            "tags": tags,
            "faces": normalized_faces,
        })
    if limit is not None:
        if limit < 1:
            raise ValueError("--limit-photos 必须大于 0")
        normalized = normalized[:limit]
    return normalized, sum(len(photo["faces"]) for photo in normalized)


def load_worker(model_directory: Path):
    worker_path = Path(__file__).with_name("worker.py").resolve()
    sys.path.insert(0, str(worker_path.parent))
    original_argv = sys.argv
    sys.argv = [str(worker_path), str(model_directory.resolve())]
    try:
        import worker
    finally:
        sys.argv = original_argv
    return worker


def process_peak_working_set_bytes() -> int | None:
    if os.name == "nt":
        class ProcessMemoryCounters(ctypes.Structure):
            _fields_ = [
                ("cb", ctypes.c_ulong),
                ("PageFaultCount", ctypes.c_ulong),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        counters = ProcessMemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel32.GetCurrentProcess.restype = ctypes.c_void_p
        psapi.GetProcessMemoryInfo.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(ProcessMemoryCounters),
            ctypes.c_ulong,
        ]
        psapi.GetProcessMemoryInfo.restype = ctypes.c_int
        process = kernel32.GetCurrentProcess()
        if psapi.GetProcessMemoryInfo(
            process, ctypes.byref(counters), counters.cb
        ):
            return int(counters.PeakWorkingSetSize)
        return None

    if sys.platform.startswith("linux"):
        try:
            status = Path("/proc/self/status").read_text(encoding="utf-8")
        except OSError:
            return None
        for line in status.splitlines():
            if line.startswith("VmHWM:"):
                return int(line.split()[1]) * 1024
        return None

    try:
        import resource
    except ImportError:
        return None
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(peak if sys.platform == "darwin" else peak * 1024)


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = fraction * (len(ordered) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def infer_profile(
    worker,
    photos: list[dict],
    model: str,
    device: str,
    detection_mode: str | None = None,
) -> dict:
    """跑一次推理，返回可直接交给评分工具的检测记录与性能数据。"""
    profile_status = worker.face_model_status().get(model, {})
    if not profile_status.get("ready"):
        raise RuntimeError(profile_status.get("error", "face_model_unavailable"))

    model_load_start = time.perf_counter()
    worker.load_face_models(device, model)
    model_load_seconds = time.perf_counter() - model_load_start
    records = []
    inference_seconds = []
    for photo in photos:
        stat = os.stat(photo["path"])
        inference_start = time.perf_counter()
        if model == worker.FACE_MODEL_BUFFALO_M:
            result = worker.analyze_face_image(
                photo["path"],
                device,
                model,
                buffalo_m_tiling=detection_mode == "adaptive",
            )
        else:
            result = worker.analyze_face_image(photo["path"], device, model)
        inference_seconds.append(time.perf_counter() - inference_start)
        if result.get("error") or result.get("data") is None:
            raise RuntimeError(f"{photo['resourceId']}: {result.get('error', 'face_inference_failed')}")
        records.append({
            "type": "face",
            "resourceId": photo["resourceId"],
            "size": stat.st_size,
            "mtimeNs": stat.st_mtime_ns,
            "moduleVersion": profile_status["version"],
            "status": "faces_found",
            "data": result["data"],
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "fields": ["faces"],
        })

    return {
        "version": profile_status["version"],
        "records": records,
        "performance": {
            "modelLoadSeconds": round(model_load_seconds, 3),
            "inferenceSeconds": round(sum(inference_seconds), 3),
            "imagesPerSecond": round(
                len(photos) / sum(inference_seconds) if sum(inference_seconds) else 0,
                3,
            ),
            "latencyP50Seconds": round(percentile(inference_seconds, 0.50), 4),
            "latencyP95Seconds": round(percentile(inference_seconds, 0.95), 4),
        },
    }


def score_profile(
    photos: list[dict],
    inference: dict,
    model: str,
    device: str,
    backend: Path,
    small_face_max_side: float,
    detection_mode: str | None = None,
    match_policy: str = "current",
) -> dict:
    """用生产分组器给检测结果打分。同一份检测结果可以换复核口径再评一次。"""
    start = time.perf_counter()
    records = inference["records"]
    with tempfile.TemporaryDirectory(prefix="local-gallery-people-eval-") as directory:
        input_path = Path(directory) / "records.json"
        input_path.write_text(json.dumps({
            "model": model,
            "photos": [
                {
                    "resourceId": photo["resourceId"],
                    "path": photo["path"],
                    "tags": photo["tags"],
                    "faces": photo["faces"],
                }
                for photo in photos
            ],
            "records": records,
        }, ensure_ascii=False), encoding="utf-8")
        completed = subprocess.run(
            [
                "go", "run", "./cmd/people-eval",
                "--input", str(input_path),
                "--small-face-max-side", str(small_face_max_side),
                "--match-policy", match_policy,
            ],
            cwd=backend,
            capture_output=True,
            check=False,
            text=True,
            encoding="utf-8",
        )
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr.strip() or "people-eval_failed")
        metrics = json.loads(completed.stdout)

    return {
        "model": model,
        "version": inference["version"],
        "device": device,
        **({"detectionMode": detection_mode} if detection_mode else {}),
        "matchPolicy": match_policy,
        "durationSeconds": round(time.perf_counter() - start, 3),
        "performance": inference["performance"],
        "metrics": metrics,
    }


def evaluate_profile(
    worker,
    photos: list[dict],
    model: str,
    device: str,
    backend: Path,
    small_face_max_side: float,
    detection_mode: str | None = None,
) -> dict:
    inference = infer_profile(worker, photos, model, device, detection_mode)
    return score_profile(
        photos, inference, model, device, backend, small_face_max_side, detection_mode,
    )


def match_policy_comparison(current: dict, legacy: dict) -> dict:
    """对照两种复核口径：当前口径与扩大召回之前的旧口径。"""

    def read(metrics: dict, key: str):
        value = metrics.get("matchSuggestions", {}).get(key)
        return value if isinstance(value, (int, float)) else None

    def section(metrics: dict) -> dict:
        suggestions = metrics.get("matchSuggestions", {})
        return {
            "sourceCount": suggestions.get("sourceCount", 0),
            "suggestionCount": suggestions.get("suggestionCount", 0),
            "trueDuplicatePairs": suggestions.get("trueDuplicatePairs", 0),
            "surfacedDuplicatePairs": suggestions.get("surfacedDuplicatePairs", 0),
            "missedDuplicatePairs": suggestions.get("missedDuplicatePairs", 0),
            "falseSuggestionCount": suggestions.get("falseSuggestionCount", 0),
            "duplicateRecall": suggestions.get("duplicateRecall", 0),
            "suggestionPrecision": suggestions.get("suggestionPrecision", 0),
        }

    current_metrics = current.get("metrics", {})
    legacy_metrics = legacy.get("metrics", {})
    delta = {}
    for key in ("surfacedDuplicatePairs", "missedDuplicatePairs", "falseSuggestionCount", "suggestionCount"):
        current_value = read(current_metrics, key)
        legacy_value = read(legacy_metrics, key)
        if current_value is None or legacy_value is None:
            continue
        delta[key] = round(current_value - legacy_value, 6)
    for key in ("duplicateRecall", "suggestionPrecision"):
        current_value = read(current_metrics, key)
        legacy_value = read(legacy_metrics, key)
        if current_value is None or legacy_value is None:
            continue
        delta[key] = round(current_value - legacy_value, 6)

    suggestions = current_metrics.get("matchSuggestions", {})
    return {
        "current": section(current_metrics),
        "legacy": section(legacy_metrics),
        "delta": delta,
        "missedDuplicates": suggestions.get("missedDuplicates", []),
        "falseSuggestions": suggestions.get("falseSuggestions", []),
    }


def buffalo_m_comparison(profiles: list[dict]) -> dict | None:
    overview = next(
        (profile for profile in profiles if profile.get("detectionMode") == "overview"),
        None,
    )
    adaptive = next(
        (profile for profile in profiles if profile.get("detectionMode") == "adaptive"),
        None,
    )
    if overview is None or adaptive is None:
        return None

    def read_metric(profile: dict, section: str | None, key: str) -> float | None:
        try:
            value = (
                profile["metrics"][section][key]
                if section
                else profile["metrics"][key]
            )
        except (KeyError, TypeError):
            return None
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            return None
        return float(value)

    def delta(section: str | None, key: str) -> float | None:
        overview_value = read_metric(overview, section, key)
        adaptive_value = read_metric(adaptive, section, key)
        if overview_value is None or adaptive_value is None:
            return None
        return round(adaptive_value - overview_value, 6)

    overview_seconds = overview["performance"]["inferenceSeconds"]
    adaptive_seconds = adaptive["performance"]["inferenceSeconds"]
    return {
        "overviewInferenceSeconds": overview_seconds,
        "adaptiveInferenceSeconds": adaptive_seconds,
        "additionalInferenceSeconds": round(adaptive_seconds - overview_seconds, 3),
        "inferenceTimeRatio": round(adaptive_seconds / overview_seconds, 3)
        if overview_seconds > 0
        else None,
        "adaptiveMinusOverview": {
            "detectionRecall": delta("detection", "recall"),
            "smallFaceRecall": delta("smallFaceDetection", "recall"),
            "identityPairwisePrecision": delta("identityPairwise", "precision"),
            "identityPairwiseRecall": delta("identityPairwise", "recall"),
            "splitIdentityRate": delta(None, "splitIdentityRate"),
            "mergedGroupRate": delta(None, "mergedGroupRate"),
            "singletonGroupShare": delta(None, "singletonGroupShare"),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="使用本机标注集比较 quality-v2 与 Buffalo_m 人物分组效果")
    parser.add_argument("--annotations", required=True, type=Path, help="schemaVersion=1 的本地标注 JSON")
    parser.add_argument("--models", required=True, type=Path, help="现有 derived/ai/models 目录")
    parser.add_argument("--device", choices=("cpu", "gpu"), default="cpu", help="本地推理设备")
    parser.add_argument("--limit-photos", type=int, help="只评测清单开头的 N 张照片")
    parser.add_argument("--small-face-max-side", type=float, default=96, help="小脸默认定义的短边上限像素")
    parser.add_argument("--output", type=Path, help="可选的评测结果 JSON 路径")
    args = parser.parse_args()

    try:
        if not math.isfinite(args.small_face_max_side) or args.small_face_max_side <= 0:
            raise ValueError("--small-face-max-side 必须是大于 0 的有限数值")
        photos, annotated_faces = read_dataset(args.annotations.resolve(), args.limit_photos)
        model_directory = args.models.expanduser().resolve()
        if not model_directory.is_dir():
            raise ValueError("--models 必须指向现有模型目录")
        worker = load_worker(model_directory)
        backend = Path(__file__).resolve().parents[1]
        profiles = []
        failures = []
        profile_runs = [
            (worker.FACE_MODEL_QUALITY_V2, None),
            (worker.FACE_MODEL_BUFFALO_M, "overview"),
            (worker.FACE_MODEL_BUFFALO_M, "adaptive"),
        ]
        policy_comparison = None
        for model, detection_mode in profile_runs:
            try:
                inference = infer_profile(worker, photos, model, args.device, detection_mode)
                profile = score_profile(
                    photos, inference, model, args.device, backend,
                    args.small_face_max_side, detection_mode,
                )
                profiles.append(profile)
                if model == worker.FACE_MODEL_BUFFALO_M and detection_mode == "adaptive":
                    # 同一份检测结果再按旧口径评一次，得到复核召回的前后对照。
                    legacy = score_profile(
                        photos, inference, model, args.device, backend,
                        args.small_face_max_side, detection_mode, match_policy="legacy",
                    )
                    policy_comparison = match_policy_comparison(profile, legacy)
            except Exception as error:
                failures.append({
                    "model": model,
                    **({"detectionMode": detection_mode} if detection_mode else {}),
                    "error": str(error),
                })
        report = {
            "photoCount": len(photos),
            "annotatedFaceCount": annotated_faces,
            "smallFaceMaxSide": args.small_face_max_side,
            "device": args.device,
            "profiles": profiles,
            "buffaloMComparison": buffalo_m_comparison(profiles),
            "matchPolicyComparison": policy_comparison,
            "memory": {
                "processPeakWorkingSetBytes": process_peak_working_set_bytes(),
                "gpuPeakBytes": None,
            },
            "failures": failures,
        }
        encoded = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            output_path = args.output.expanduser().resolve()
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(encoded, encoding="utf-8")
        else:
            print(encoded, end="")
        return 1 if failures else 0
    except (OSError, ValueError, RuntimeError) as error:
        print(f"评测失败：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
