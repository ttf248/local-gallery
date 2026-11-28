"""Build the Windows runtime and copy the models admitted to the release ZIP."""

import os
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile


WINDOWS_FILES = Path(__file__).resolve().parent
PYTHON_URL = "https://github.com/astral-sh/python-build-standalone/releases/download/20261124/cpython-3.11.18%2B20261124-x86_64-pc-windows-msvc-install_only.tar.gz"
PYTHON_SHA256 = "3e4a35e3c238e5090d36bf95c041d9052bc82d6e298cb912ba7f70f6c66cf81a"
FFMPEG_URL = "https://github.com/GyanD/codexffmpeg/releases/download/8.1.1/ffmpeg-8.1.1-essentials_build.zip"
FFMPEG_SHA256 = "6f58ce889f59c311410f7d2b18895b33c03456463486f3b1ebc93d97a0f54541"
MSVC_URL = "https://download.visualstudio.microsoft.com/download/pr/45d3b8dd-bced-4b37-9974-142f748d710c/4aaf54db0bfc9435f7c3660e1a00237a4b556042bfeea64bde44c2e0194e6ee5/Microsoft.VC.14.44.17.14.CRT.Redist.X64.base.vsix"
MSVC_SHA256 = "4aaf54db0bfc9435f7c3660e1a00237a4b556042bfeea64bde44c2e0194e6ee5"
RAW = "https://raw.githubusercontent.com"
OPENCV_LICENSE_ROOT = f"{RAW}/opencv/opencv_zoo/48b10fa505aeb51fbd127fc60a5c660040e823b7/models"
MODEL_LICENSES = (
    ("Chinese-CLIP-LICENSE.txt", f"{RAW}/OFA-Sys/Chinese-CLIP/31863c707501bf1605d36842f43deb78793dbc5d/MIT-LICENSE.txt",
     "aaaac89467b2ed90ff9dedb180c43a9007b96cab2396ae5991568fc1940a49b6"),
    ("YuNet-LICENSE.txt", f"{OPENCV_LICENSE_ROOT}/face_detection_yunet/LICENSE",
     "c83b8120c50ccbd4c4f96edf53141bdd566ebb8f8e9227e415326aa1b1aba958"),
    ("SFace-LICENSE.txt", f"{OPENCV_LICENSE_ROOT}/face_recognition_sface/LICENSE",
     "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"),
    ("RapidOCR-LICENSE.txt", f"{RAW}/RapidAI/RapidOCR/v3.10.0/python/LICENSE",
     "3e0af25fdd06aa9586ae97adb00ea927ebe5a3805ac77d2d3a81ce5f55693333"),
    ("RapidOCR-模型声明.md", f"{RAW}/RapidAI/RapidOCR/v3.10.0/python/MODEL_LICENSES.md",
     "c5fd0e8603d3df743355b546121e6fe0f4ef8ff455c5a85c1681fd3ae520e153"),
)


def bundle_runtime(bundle: Path) -> None:
    worker = bundle / "aiworker"
    sys.path.insert(0, str(worker))
    from download_models import download, install_models

    with TemporaryDirectory(prefix="dependencies-", dir=bundle.parent) as temp:
        staging = Path(temp)
        archive = staging / "python.tar.gz"
        download("Python 3.11", PYTHON_URL, archive, PYTHON_SHA256)
        with tarfile.open(archive, "r:gz") as source:
            source.extractall(staging, filter="data")
        runtime = worker / "runtime"
        (staging / "python").rename(runtime)
        python = runtime / "python.exe"
        pip = [python, "-I", "-m", "pip", "--isolated", "install", "--index-url", "https://pypi.org/simple",
               "--disable-pip-version-check", "--no-compile", "--no-warn-script-location", "--only-binary=:all:"]
        subprocess.run([*pip, "-r", WINDOWS_FILES / "requirements.txt"], check=True)
        # cn_clip 的 lmdb 依赖只用于训练，便携包只提供推理。
        subprocess.run([*pip, "--no-deps", "cn_clip==1.6.0"], check=True)
        for pattern in ("*.pdb", "*.pyc", "*.lib"):
            for path in runtime.rglob(pattern):
                path.unlink()

        archive = staging / "msvc.vsix"
        download("Visual C++ 运行库", MSVC_URL, archive, MSVC_SHA256)
        with ZipFile(archive) as source:
            for name in source.namelist():
                if "/x64/Microsoft.VC143.CRT/" in name and name.endswith(".dll"):
                    target = runtime / Path(name).name
                    if not target.exists():
                        target.write_bytes(source.read(name))
        if not (runtime / "msvcp140.dll").is_file():
            raise RuntimeError("发布包缺少 MSVC 运行库。")

        archive = staging / "ffmpeg.zip"
        download("FFmpeg 8.1.1", FFMPEG_URL, archive, FFMPEG_SHA256)
        ffmpeg = bundle / "ffmpeg"
        ffmpeg.mkdir()
        with ZipFile(archive) as source:
            for name in ("bin/ffmpeg.exe", "bin/ffprobe.exe", "LICENSE", "README.txt"):
                member = f"ffmpeg-8.1.1-essentials_build/{name}"
                with source.open(member) as src, (ffmpeg / Path(name).name).open("wb") as dst:
                    shutil.copyfileobj(src, dst)
        for name, url, digest in MODEL_LICENSES:
            download(name, url, bundle / name, digest)

    for name in ("config.yaml", "第三方组件.md"):
        shutil.copyfile(WINDOWS_FILES / name, bundle / name)
    for name in ("start.bat", "download-extra-models.bat"):
        text = (WINDOWS_FILES / name).read_text(encoding="ascii")
        (bundle / name).write_text(text, encoding="ascii", newline="\r\n")
    cache = os.environ.get("LG_RELEASE_MODEL_CACHE")
    install_models(bundle / ".local-gallery/derived/ai/models", "portable", Path(cache) if cache else None)


if __name__ == "__main__":
    bundle = Path(sys.argv[1])
    bundle_runtime(bundle)
    with ZipFile(sys.argv[2], "w", compression=ZIP_DEFLATED, compresslevel=5) as archive:
        for path in sorted(bundle.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(bundle.parent).as_posix())
