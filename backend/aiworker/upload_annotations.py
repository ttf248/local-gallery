"""把人工核对过的标注写进本机标注工作台。

走的是浏览器同一条接口：先建匿名身份，再逐张保存标注。写完之后
标注工作台里就能看到同样的进度，也能直接导出评测集。
"""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from pathlib import Path


def request(url: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url, data=data, method="POST" if body is not None else "GET",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="把标注写进本机标注工作台")
    parser.add_argument("--base", required=True, help="服务地址，例如 http://127.0.0.1:18941")
    parser.add_argument("--annotations", required=True, type=Path)
    parser.add_argument("--tags", default="reviewed", help="场景标签，逗号分隔")
    args = parser.parse_args()

    dataset = json.loads(args.annotations.read_text(encoding="utf-8"))
    base = args.base.rstrip("/")
    tags = [tag.strip() for tag in args.tags.split(",") if tag.strip()]

    identities: dict[str, str] = {}
    for photo in dataset["photos"]:
        for face in photo["faces"]:
            identity = face["identity"]
            if identity in identities:
                continue
            created = request(f"{base}/api/admin/people/annotations/identities", {"label": ""})
            identities[identity] = created["identity"]["id"]

    for photo in dataset["photos"]:
        body = {
            "resourceId": photo["resourceId"],
            "tags": tags,
            "faces": [
                {
                    "identity": identities[face["identity"]],
                    "box": face["box"],
                    "source": "detected",
                }
                for face in photo["faces"]
            ],
            "reviewed": True,
        }
        request(f"{base}/api/admin/people/annotations/photo", body)

    progress = request(f"{base}/api/admin/people/annotations/progress")
    print(json.dumps({
        "identities": len(identities),
        "photos": len(dataset["photos"]),
        "progress": progress.get("progress"),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
