"""把人工核对过的候选分组整理成一份评测标注集。

输入是 annotate_ground_truth.py 产出的候选分组。脚本按两条规则确定身份：

1. 候选分组来自高相似度阈值，视为「可能是同一个人」；
2. 同一张照片里的两张脸一定不是同一个人。这条硬约束会把第一步里
   混进去的不同的人拆开 —— 长得像的几个人被错误合并时一定会同框。

之后按外观归组把拆分出来的部分重新合并成人眼认定的身份，并输出一份
待核对的拼图清单。脚本不推断身份：外观判断来自人工，脚本只做约束求解
与落盘。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def split_cluster_by_photo(members: list[dict]) -> list[list[dict]]:
    """把一个候选分组按「同框即不同人」拆开。"""
    buckets: list[list[dict]] = []
    for member in sorted(members, key=lambda item: (item["resourceId"], item["faceIndex"])):
        placed = False
        for bucket in buckets:
            if any(item["resourceId"] == member["resourceId"] for item in bucket):
                continue
            bucket.append(member)
            placed = True
            break
        if not placed:
            buckets.append([member])
    return buckets


def main() -> int:
    parser = argparse.ArgumentParser(description="由候选分组生成评测标注集")
    parser.add_argument("--clusters", required=True, type=Path)
    parser.add_argument("--paths", required=True, type=Path, help="资源 ID 到路径的 JSON")
    parser.add_argument("--all-faces", required=True, type=Path, help="全部检出人脸的 JSON")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--minimum-cluster", type=int, default=2)
    parser.add_argument("--maximum-cluster", type=int, default=12)
    parser.add_argument(
        "--exclude-identity", action="append", default=[],
        help="人工目视核对后剔除的身份 ID，可重复给出",
    )
    args = parser.parse_args()

    clusters = json.loads(args.clusters.read_text(encoding="utf-8"))
    paths = json.loads(args.paths.read_text(encoding="utf-8"))
    all_faces = json.loads(args.all_faces.read_text(encoding="utf-8"))

    excluded = set(args.exclude_identity)
    # 第一步：高相似度分组 → 候选身份；同框冲突把它们拆开。
    candidates: list[list[dict]] = []
    for cluster in clusters:
        if not (args.minimum_cluster <= cluster["count"] <= args.maximum_cluster):
            continue
        candidates.extend(split_cluster_by_photo(cluster["faces"]))

    face_identity: dict[tuple[str, int], str] = {}
    face_box: dict[tuple[str, int], list[float]] = {}
    for index, candidate in enumerate(candidates):
        identity = f"id-{index:04d}"
        if identity in excluded:
            continue
        for member in candidate:
            key = (member["resourceId"], member["faceIndex"])
            face_identity[key] = identity
            face_box[key] = member["box"]

    photo_faces: dict[str, list[tuple[str, int]]] = {}
    for record in all_faces:
        photo_faces.setdefault(record["resourceId"], []).append(
            (record["resourceId"], record["faceIndex"])
        )
    photos = []
    skipped_partial = 0
    for resource_id, keys in sorted(photo_faces.items()):
        if any(key not in face_identity for key in keys):
            skipped_partial += 1
            continue
        identities = {face_identity[key] for key in keys}
        if len(identities) != len(keys):
            skipped_partial += 1
            continue
        path = paths.get(resource_id, "")
        if not path:
            skipped_partial += 1
            continue
        photos.append({
            "resourceId": resource_id,
            "path": path,
            "tags": ["reviewed"],
            "faces": [
                {"box": face_box[key], "identity": face_identity[key]}
                for key in sorted(keys)
            ],
        })

    result = {"schemaVersion": 1, "photos": photos}
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    identity_faces: dict[str, int] = {}
    for identity in face_identity.values():
        identity_faces[identity] = identity_faces.get(identity, 0) + 1
    report = {
        "candidateCount": len(candidates),
        "identityCount": len(identity_faces),
        "photoCount": len(photos),
        "faceCount": sum(len(photo["faces"]) for photo in photos),
        "skippedPhotos": skipped_partial,
        "identitiesBySize": {
            str(size): sum(1 for count in identity_faces.values() if count == size)
            for size in sorted(set(identity_faces.values()))
        },
    }
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
