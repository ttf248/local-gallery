"""从本机人脸分析结果里整理标注素材。

用途：给人工标注做辅助。它只做两件事 ——
1. 按特征相似度给出「可能同一个人」的候选分组，供人工核对；
2. 把每组的脸裁成一张拼图，方便一眼判断这一组是不是真的同一个人。

脚本不产生任何标签：标注由人在浏览器里确认。
"""

from __future__ import annotations

import argparse
import base64
import glob
import hashlib
import json
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def load_records(metadata_dir: Path, model: str) -> list[dict]:
    pattern = str(metadata_dir / "face" / model / "batches" / "*" / "*.json")
    records: list[dict] = []
    for path in sorted(glob.glob(pattern)):
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        records.extend(payload.get("records", []))
    return records


def resolve_paths(root: Path) -> dict[str, str]:
    """按服务端同一套规则算出资源 ID 与本地路径的对照。

    资源 ID 是「根 ID + 种类 + 相对路径」的哈希；这里复刻同一套算法，
    免得为了做标注额外给服务端加一个只在本机用的导出接口。
    """
    key = os.path.normpath(str(root)).lower().replace("/", os.sep)
    root_id = "r_" + hashlib.sha256(key.encode()).hexdigest()[:12]
    mapping: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(root).as_posix().lower()
        digest = hashlib.sha256(
            (root_id + chr(0) + "file" + chr(0) + relative).encode()
        ).digest()[:16]
        resource = "f_" + base64.urlsafe_b64encode(digest).decode().rstrip("=")
        mapping[resource] = str(path)
    return mapping


def cluster_faces(faces: list[dict], threshold: float) -> list[list[int]]:
    vectors = [face["embedding"] for face in faces]
    matrix = np.asarray(vectors, dtype=np.float32)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    matrix = matrix / np.maximum(norms, 1e-8)
    similarity = matrix @ matrix.T
    clusters: list[list[int]] = []
    assigned = [False] * len(faces)
    for index in range(len(faces)):
        if assigned[index]:
            continue
        cluster = [index]
        assigned[index] = True
        for other in range(index + 1, len(faces)):
            if assigned[other]:
                continue
            if similarity[index, other] >= threshold:
                cluster.append(other)
                assigned[other] = True
        clusters.append(cluster)
    return clusters


def crop_face(path: str, box: list[float], size: int = 96) -> Image.Image | None:
    try:
        with Image.open(path) as image:
            image = image.convert("RGB")
            x, y, width, height = box
            left = max(0, int(x))
            top = max(0, int(y))
            right = min(image.width, int(x + width))
            bottom = min(image.height, int(y + height))
            if right <= left or bottom <= top:
                return None
            return image.crop((left, top, right, bottom)).resize((size, size))
    except (OSError, ValueError):
        return None


def write_montage(
    cluster: list[dict],
    paths: dict[str, str],
    output: Path,
    columns: int = 6,
    cell: int = 96,
) -> bool:
    tiles: list[Image.Image] = []
    for face in cluster:
        path = paths.get(face["resourceId"])
        if not path:
            continue
        cropped = crop_face(path, face["box"], cell)
        if cropped is None:
            continue
        tiles.append(cropped)
    if not tiles:
        return False
    rows = (len(tiles) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * cell, rows * (cell + 18)), (18, 18, 18))
    draw = ImageDraw.Draw(sheet)
    for index, tile in enumerate(tiles):
        column = index % columns
        row = index // columns
        x = column * cell
        y = row * (cell + 18)
        sheet.paste(tile, (x, y))
        label = cluster[index]["resourceId"][-6:]
        draw.text((x + 3, y + cell + 3), label, fill=(230, 230, 230))
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="整理本机人脸标注素材")
    parser.add_argument("--metadata-dir", required=True, type=Path)
    parser.add_argument("--root", required=True, type=Path, help="媒体根目录")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model", default="buffalo_m")
    parser.add_argument("--threshold", type=float, default=0.55)
    args = parser.parse_args()

    records = load_records(args.metadata_dir, args.model)
    paths = resolve_paths(args.root)
    faces: list[dict] = []
    for record in records:
        if record.get("status") != "faces_found":
            continue
        data = record.get("data")
        if isinstance(data, str):
            data = json.loads(data)
        for index, face in enumerate(data.get("faces", [])):
            faces.append({
                "resourceId": record["resourceId"],
                "faceIndex": index,
                "box": face["box"],
                "score": face.get("score", 0),
                "embedding": face["embedding"],
            })
    if not faces:
        print("没有可用的人脸记录")
        return 1
    clusters = cluster_faces(faces, args.threshold)
    clusters.sort(key=len, reverse=True)
    index: list[dict] = []
    for number, cluster in enumerate(clusters):
        members = [faces[position] for position in cluster]
        name = f"cluster-{number:03d}"
        written = write_montage(members, paths, args.output / f"{name}.png")
        index.append({
            "name": name,
            "count": len(members),
            "montage": str(args.output / f"{name}.png") if written else "",
            "faces": [
                {
                    "resourceId": face["resourceId"],
                    "faceIndex": face["faceIndex"],
                    "box": face["box"],
                }
                for face in members
            ],
        })
    (args.output / "clusters.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    print(f"{len(faces)} 张脸分成 {len(clusters)} 组，输出到 {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
