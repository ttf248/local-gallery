"""Run a local, labelled face and identity evaluation for both face profiles."""

from __future__ import annotations

import argparse
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
        if not isinstance(resource_id, str) or not resource_id or resource_id in resource_ids:
            raise ValueError(f"photos[{index}].resourceId 必须唯一且非空")
        if not isinstance(image_path, str) or not image_path:
            raise ValueError(f"photos[{index}].path 必须是本地图片路径")
        if not isinstance(faces, list):
            raise ValueError(f"photos[{index}].faces 必须是数组")
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


def evaluate_profile(worker, photos: list[dict], model: str, device: str, backend: Path, small_face_max_side: float) -> dict:
    profile_status = worker.face_model_status().get(model, {})
    if not profile_status.get("ready"):
        raise RuntimeError(profile_status.get("error", "face_model_unavailable"))

    start = time.perf_counter()
    worker.load_face_models(device, model)
    records = []
    for photo in photos:
        stat = os.stat(photo["path"])
        result = worker.analyze_face_image(photo["path"], device, model)
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

    with tempfile.TemporaryDirectory(prefix="local-gallery-people-eval-") as directory:
        input_path = Path(directory) / "records.json"
        input_path.write_text(json.dumps({
            "model": model,
            "photos": [
                {"resourceId": photo["resourceId"], "faces": photo["faces"]}
                for photo in photos
            ],
            "records": records,
        }, ensure_ascii=False), encoding="utf-8")
        completed = subprocess.run(
            [
                "go", "run", "./cmd/people-eval",
                "--input", str(input_path),
                "--small-face-max-side", str(small_face_max_side),
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
        "version": profile_status["version"],
        "device": device,
        "durationSeconds": round(time.perf_counter() - start, 3),
        "metrics": metrics,
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
        for model in worker.FACE_MODELS:
            try:
                profiles.append(evaluate_profile(
                    worker, photos, model, args.device, backend, args.small_face_max_side
                ))
            except Exception as error:
                failures.append({"model": model, "error": str(error)})
        report = {
            "photoCount": len(photos),
            "annotatedFaceCount": annotated_faces,
            "smallFaceMaxSide": args.small_face_max_side,
            "device": args.device,
            "profiles": profiles,
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
