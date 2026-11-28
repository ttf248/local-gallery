"""Exercise the shipped launcher and inference from a freshly extracted archive."""

import argparse
import json
import math
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile


def fetch(base, path):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(base + path, timeout=25) as response:
        return response.read()


def verify(bundle: Path, work: Path, version: str) -> None:
    ffmpeg = bundle / "ffmpeg" / "ffmpeg.exe"
    ffprobe = bundle / "ffmpeg" / "ffprobe.exe"
    env = os.environ.copy()
    windows = Path(os.environ["SystemRoot"])
    env.update(PATH=f"{windows / 'System32'};{windows}", PYTHONHOME="invalid", PYTHONPATH="invalid",
               HTTP_PROXY="http://127.0.0.1:1", HTTPS_PROXY="http://127.0.0.1:1", NO_PROXY="127.0.0.1")
    media = work / "媒体 样本"
    media.mkdir()
    clip = media / "样本.mp4"
    subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=red:s=96x64:d=0.25",
                    "-c:v", "libx264", clip], env=env, check=True)
    probe = subprocess.check_output([ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries",
                                    "stream=codec_name", "-of", "csv=p=0", clip], env=env, text=True)
    assert probe.strip() == "h264", probe

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    config = bundle / "config.yaml"
    text = config.read_text(encoding="utf-8")
    assert "mediaRoots: []" in text and "port: 8080" in text
    config.write_text(text.replace("port: 8080", f"port: {port}").replace(
        "mediaRoots: []", f'mediaRoots:\n  - path: "{media.as_posix()}"\n    kind: photo'), encoding="utf-8")

    launcher = bundle / "start.bat"
    base = f"http://127.0.0.1:{port}"
    with (work / "server.log").open("w+b") as log:
        process = subprocess.Popen(f'cmd.exe /d /s /c ""{launcher}""', cwd=work, env=env,
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=log)
        try:
            for _ in range(120):
                if process.poll() is not None:
                    raise RuntimeError(f"启动器提前退出：{process.returncode}")
                try:
                    health = json.loads(fetch(base, "/api/health"))
                    if health["mediaRoots"]:
                        break
                except urllib.error.URLError:
                    pass
                time.sleep(1)
            else:
                raise RuntimeError("发布包启动或样本扫描超时。")
            assert health["status"] == "ok" and health["version"] == version, health
            html = fetch(base, "/").decode()
            for path in re.findall(r'(?:src|href)="(/assets/[^\"]+\.m?js)"', html):
                assert fetch(base, path), path
            assert "/assets/" in html
            marker = re.compile(r"Web 版 · v.{0,24}" + re.escape(version))
            assert any(marker.search(path.read_text(encoding="utf-8"))
                       for path in (bundle / "dist" / "assets").glob("Settings-*.js")), "前端发布版本未注入"
            status = json.loads(fetch(base, "/api/ai/semantic/status"))["status"]
            assert status["portable"] and status["runtimeReady"] and status["modelValid"], status
            for module in ("ocr", "face"):
                assert status["modules"][module]["ready"], status["modules"][module]
            print(f"发布包服务已就绪，版本 {version}，设备 {status['device']}。", flush=True)
        except Exception:
            log.seek(0)
            print(log.read().decode("utf-8", errors="replace"))
            raise
        finally:
            if process.poll() is None:
                subprocess.run(["taskkill.exe", "/PID", str(process.pid), "/T", "/F"], env=env, check=False)
            process.wait(timeout=20)

    worker = bundle / "aiworker"
    python = worker / "runtime" / "python.exe"
    image = media / "推理 样本.png"
    subprocess.run([python, "-I", "-c", "import cv2,numpy as np,sys; a=np.full((240,960,3),255,np.uint8);"
                    "cv2.putText(a,'LOCAL GALLERY 2026',(36,150),cv2.FONT_HERSHEY_SIMPLEX,2,(0,0,0),4,cv2.LINE_AA);"
                    "cv2.imencode('.png',a)[1].tofile(sys.argv[1])", image], env=env, check=True)
    commands = []
    for device in ("cpu", "gpu"):
        commands.extend([
            {"action": "embed_texts", "texts": ["照片"], "device": device},
            {"action": "embed_images", "paths": [str(image)], "device": device},
            {"action": "ocr_images", "paths": [str(image)], "device": device},
            {"action": "face_images", "paths": [str(image)], "device": device},
        ])
    result = subprocess.run([python, "-E", "-s", worker / "worker.py", bundle / ".local-gallery/derived/ai/models",
                             "--portable"], cwd=work, env=env, check=True, timeout=420,
                            input="".join(json.dumps(command) + "\n" for command in commands),
                            stdout=subprocess.PIPE, encoding="utf-8")
    replies = [json.loads(line) for line in result.stdout.splitlines()]
    for command, reply in zip(commands, replies, strict=True):
        assert not reply.get("error"), (command, reply.get("error"))
        item, = reply["items"]
        assert not item.get("error"), (command, item.get("error"))
        if command["action"].startswith("embed_"):
            vector = item["vector"]
            assert len(vector) == 512 and all(map(math.isfinite, vector)), command
            expected_device = "directml" if command["device"] == "gpu" and status.get("directMLAvailable") else "cpu"
            assert reply["status"]["device"] == expected_device, reply["status"]
        elif command["action"] == "ocr_images":
            assert "LOCAL" in json.dumps(item["data"]).upper(), item
    print("已验证 FFmpeg、文本和图片向量、OCR、人脸检测及 GPU 优先 / CPU 回退。")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("version")
    args = parser.parse_args()
    with TemporaryDirectory(prefix="local-gallery-smoke-", ignore_cleanup_errors=True) as temp:
        work = Path(temp) / "绿色版 验收"
        work.mkdir()
        with ZipFile(args.archive) as archive:
            archive.extractall(work)
        verify(work / f"local-gallery-v{args.version}-windows-amd64-portable", work, args.version)
