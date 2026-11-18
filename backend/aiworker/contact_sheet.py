"""把若干个候选分组的拼图合并成一张联系表。

用途：一次看多个候选分组，判断每个分组是不是真的同一个人。
脚本只做拼图，不产生任何标签。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

import annotate_ground_truth as ag


def build_sheet(
    clusters: list[dict],
    paths: dict[str, str],
    output: Path,
    cell: int = 84,
    label_height: int = 16,
) -> None:
    rows = []
    for cluster in clusters:
        tiles = []
        for member in cluster["faces"]:
            path = paths.get(member["resourceId"])
            if not path:
                continue
            cropped = ag.crop_face(path, member["box"], cell)
            if cropped is None:
                continue
            tiles.append((cropped, member["resourceId"][-6:]))
        if not tiles:
            continue
        rows.append((cluster["name"], tiles))

    columns = max(len(tiles) for _, tiles in rows)
    width = columns * cell
    height = len(rows) * (cell + label_height + 16)
    sheet = Image.new("RGB", (width, height), (16, 16, 16))
    draw = ImageDraw.Draw(sheet)
    y = 0
    for name, tiles in rows:
        draw.text((4, y + 2), name, fill=(120, 200, 255))
        y += 16
        for index, (tile, label) in enumerate(tiles):
            x = index * cell
            sheet.paste(tile, (x, y))
            draw.text((x + 3, y + cell + 2), label, fill=(225, 225, 225))
        y += cell + label_height
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output)


def main() -> int:
    parser = argparse.ArgumentParser(description="合并候选分组的拼图")
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--clusters", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--minimum", type=int, default=2)
    parser.add_argument("--maximum", type=int, default=8)
    parser.add_argument("--per-sheet", type=int, default=6)
    args = parser.parse_args()

    paths = ag.resolve_paths(args.root)
    clusters = json.loads(args.clusters.read_text(encoding="utf-8"))
    selected = [
        cluster for cluster in clusters
        if args.minimum <= cluster["count"] <= args.maximum
    ]
    for start in range(0, len(selected), args.per_sheet):
        chunk = selected[start:start + args.per_sheet]
        build_sheet(chunk, paths, args.output / f"sheet-{start // args.per_sheet:02d}.png")
    print(f"{len(selected)} 个候选分组，输出到 {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
