import concurrent.futures
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
original_argv = sys.argv
sys.argv = [str(Path(__file__).with_name("worker.py")), tempfile.gettempdir()]
import worker
sys.argv = original_argv


class FakeOutOfMemoryError(RuntimeError):
    pass


class FakeCuda:
    OutOfMemoryError = FakeOutOfMemoryError

    @staticmethod
    def empty_cache():
        return None

    @staticmethod
    def is_available():
        return False


class FakeTorch:
    cuda = FakeCuda()
    version = None
    __version__ = "2.7.1"


class FakeModel:
    def __init__(self):
        self.device = "cuda"
        self.is_float = False

    def to(self, device):
        self.device = device
        return self

    def float(self):
        self.is_float = True
        return self

    def eval(self):
        return self


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.originals = {
            "device": worker.device,
            "model": worker.model,
            "model_device": worker.model_device,
            "model_cache": worker.model_cache,
            "preprocess": worker.preprocess,
            "model_dir": worker.model_dir,
            "model_validation": worker.model_validation,
            "runtime_error": worker.runtime_error,
            "ocr_runtime_error": worker.ocr_runtime_error,
            "torch": worker.torch,
            "rapid_ocr": worker.rapid_ocr,
            "ocr_gpu_runtime_failed": worker.ocr_gpu_runtime_failed,
            "model_file_validation": worker.model_file_validation,
            "face_models": worker.face_models,
        }
        worker.device = "cuda"
        worker.model = FakeModel()
        worker.model_cache = {}
        worker.model_validation = None
        worker.runtime_error = ""
        worker.ocr_runtime_error = ""
        worker.torch = FakeTorch()
        worker.ocr_gpu_runtime_failed = False
        worker.model_file_validation = {}

    def tearDown(self):
        for name, value in self.originals.items():
            setattr(worker, name, value)

    def test_corrupted_model_checksum_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory) / worker.MODEL_FILE
            model_path.write_bytes(b"not a model")
            worker.model_dir = Path(directory)
            worker.model_validation = None

            state = worker.model_state()

        self.assertTrue(state["modelAvailable"])
        self.assertFalse(state["modelValid"])
        self.assertNotEqual(state["modelSha256"], worker.MODEL_SHA256)

    def test_unavailable_gpu_reports_cpu_fallback(self):
        worker.device = "cpu"
        worker.model = None
        worker.model_dir = Path(tempfile.gettempdir()) / "local-gallery-missing-model"
        worker.model_validation = None

        with patch.object(worker, "cuda_provider_available", return_value=False):
            state = worker.status()

        self.assertTrue(state["runtimeReady"])
        self.assertFalse(state["cudaAvailable"])
        self.assertEqual("cpu", state["device"])

    def test_cached_model_is_reused_without_loading_weights_again(self):
        cached = FakeModel()
        worker.model = None
        worker.model_device = None
        worker.model_cache = {"cpu": (cached, "cached-preprocess")}
        worker.model_dir = Path(tempfile.gettempdir()) / "local-gallery-missing-model"

        with patch.object(worker, "model_state", return_value={"modelValid": True}), patch(
            "cn_clip.clip.load_from_name"
        ) as load_from_name:
            worker.load_model("cpu")

        self.assertIs(worker.model, cached)
        self.assertEqual("cached-preprocess", worker.preprocess)
        load_from_name.assert_not_called()

    def test_onnx_cuda_provider_is_available_without_torch_cuda(self):
        with patch.object(worker, "cuda_provider_available", return_value=True):
            state = worker.status()
            available = worker.gpu_available(require_onnx=True)

        self.assertTrue(available)
        self.assertTrue(state["cudaAvailable"])
        self.assertTrue(state["cudaExecutionProviderAvailable"])

    def test_dll_search_path_is_prepended_once(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"PATH": "existing"}):
            worker.prepend_dll_search_path(directory)
            worker.prepend_dll_search_path(directory)

            entries = os.environ["PATH"].split(os.pathsep)

        self.assertEqual(os.path.abspath(directory), entries[0])
        self.assertEqual(["existing"], entries[1:])

    def test_ocr_gpu_mode_sets_tested_microbatch_sizes(self):
        engine = object()
        rapid_ocr = SimpleNamespace(RapidOCR=lambda **kwargs: engine)
        with patch.object(worker, "rapid_ocr", {}), patch.object(
            worker, "ocr_module_status", return_value={"ready": True}
        ), patch.object(worker, "gpu_available", return_value=True), patch.dict(
            sys.modules, {"rapidocr": rapid_ocr}
        ), patch.object(rapid_ocr, "RapidOCR", wraps=rapid_ocr.RapidOCR) as create_engine:
            loaded = worker.load_ocr_engine("gpu")

        self.assertIs(engine, loaded)
        params = create_engine.call_args.kwargs["params"]
        self.assertEqual(str(worker.model_dir / worker.OCR_MODEL_DIRECTORY), params["Global.model_root_dir"])
        self.assertTrue(params["EngineConfig.onnxruntime.use_cuda"])
        self.assertEqual(16, params["Cls.cls_batch_num"])
        self.assertEqual(6, params["Rec.rec_batch_num"])

    def test_ocr_cpu_mode_keeps_default_microbatch_sizes(self):
        engine = object()
        rapid_ocr = SimpleNamespace(RapidOCR=lambda **kwargs: engine)
        with patch.object(worker, "rapid_ocr", {}), patch.object(
            worker, "ocr_module_status", return_value={"ready": True}
        ), patch.dict(sys.modules, {"rapidocr": rapid_ocr}), patch.object(
            rapid_ocr, "RapidOCR", wraps=rapid_ocr.RapidOCR
        ) as create_engine:
            loaded = worker.load_ocr_engine("cpu")

        self.assertIs(engine, loaded)
        params = create_engine.call_args.kwargs["params"]
        self.assertEqual(str(worker.model_dir / worker.OCR_MODEL_DIRECTORY), params["Global.model_root_dir"])
        self.assertFalse(params["EngineConfig.onnxruntime.use_cuda"])
        self.assertEqual(6, params["Cls.cls_batch_num"])
        self.assertEqual(6, params["Rec.rec_batch_num"])

    def test_ocr_input_pixel_cap_resizes_and_maps_boxes_to_source(self):
        pixels = np.full((100, 100, 3), 255, dtype=np.uint8)
        with tempfile.TemporaryDirectory() as directory:
            for extension in ("jpg", "png"):
                ok, encoded = cv2.imencode(f".{extension}", pixels)
                self.assertTrue(ok)
                path = Path(directory) / f"page.{extension}"
                path.write_bytes(encoded.tobytes())

                image, scale_x, scale_y = worker.read_ocr_image(str(path), max_pixels=2500)
                self.assertEqual((50, 50), image.shape[:2])
                self.assertAlmostEqual(2.0, scale_x)
                self.assertAlmostEqual(2.0, scale_y)
                self.assertEqual(
                    [[2, 4], [10, 4], [10, 16], [2, 16]],
                    worker.scale_ocr_box([[1, 2], [5, 2], [5, 8], [1, 8]], scale_x, scale_y),
                )

                original, original_scale_x, original_scale_y = worker.read_ocr_image(
                    str(path), max_pixels=10000
                )
                self.assertEqual((100, 100), original.shape[:2])
                self.assertEqual((1.0, 1.0), (original_scale_x, original_scale_y))

    def test_large_jpeg_header_uses_reduced_decode_above_pillow_limit(self):
        from PIL import Image as PILImage

        class Header:
            size = (50_000, 20_000)
            format = "JPEG"

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            @staticmethod
            def getexif():
                return {}

        decoded = SimpleNamespace(shape=(2_500, 6_250, 3))
        decode_flags = []

        def decode(_encoded, flag):
            decode_flags.append(flag)
            return decoded if flag == 8 else None

        fake_cv2 = SimpleNamespace(
            IMREAD_COLOR=1,
            IMREAD_REDUCED_COLOR_2=2,
            IMREAD_REDUCED_COLOR_4=4,
            IMREAD_REDUCED_COLOR_8=8,
            imdecode=decode,
        )
        fake_np = SimpleNamespace(uint8=object(), fromfile=lambda *_args, **_kwargs: b"encoded")
        previous_limit = PILImage.MAX_IMAGE_PIXELS

        def open_header(path):
            self.assertIsNone(PILImage.MAX_IMAGE_PIXELS)
            self.assertEqual("large.jpg", path)
            return Header()

        with patch.object(PILImage, "open", side_effect=open_header) as open_image, patch.object(
            worker, "cv2", fake_cv2
        ), patch.object(worker, "np", fake_np):
            image, scale_x, scale_y = worker.read_ocr_image("large.jpg")

        self.assertIs(decoded, image)
        self.assertEqual([8], decode_flags)
        self.assertEqual((8.0, 8.0), (scale_x, scale_y))
        self.assertEqual(previous_limit, PILImage.MAX_IMAGE_PIXELS)
        open_image.assert_called_once_with("large.jpg")

    def test_face_large_jpeg_uses_reduced_decode_and_source_scales(self):
        from PIL import Image as PILImage

        class Header:
            size = (1024, 512)
            format = "JPEG"

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            @staticmethod
            def getexif():
                return {}

        decoded = np.zeros((64, 128, 3), dtype=np.uint8)
        decode_flags = []
        fake_cv2 = SimpleNamespace(
            IMREAD_COLOR=1,
            IMREAD_REDUCED_COLOR_2=2,
            IMREAD_REDUCED_COLOR_4=4,
            IMREAD_REDUCED_COLOR_8=8,
            imdecode=lambda _encoded, flag: decode_flags.append(flag) or decoded,
        )
        fake_np = SimpleNamespace(uint8=object(), fromfile=lambda *_args, **_kwargs: b"encoded")
        previous_limit = PILImage.MAX_IMAGE_PIXELS

        def open_header(path):
            self.assertIsNone(PILImage.MAX_IMAGE_PIXELS)
            self.assertEqual("large.jpg", path)
            return Header()

        with patch.object(PILImage, "open", side_effect=open_header), patch.object(
            worker, "cv2", fake_cv2
        ), patch.object(worker, "np", fake_np):
            image, scale_x, scale_y = worker.read_face_image("large.jpg", max_dimension=128)

        self.assertIs(decoded, image)
        self.assertEqual([8], decode_flags)
        self.assertEqual((8.0, 8.0), (scale_x, scale_y))
        self.assertEqual(previous_limit, PILImage.MAX_IMAGE_PIXELS)

    def test_face_reduced_decode_keeps_exif_orientation_and_source_scale(self):
        from PIL import Image as PILImage

        exif = PILImage.Exif()
        exif[274] = 6
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "turned.jpg"
            PILImage.new("RGB", (800, 400), (120, 160, 200)).save(path, exif=exif)
            with patch.object(worker, "cv2", cv2), patch.object(worker, "np", np):
                image, scale_x, scale_y = worker.read_face_image(str(path), max_dimension=200)

        self.assertEqual((200, 100), image.shape[:2])
        self.assertEqual((4.0, 4.0), (scale_x, scale_y))

    def test_face_boxes_map_from_reduced_input_to_source_dimensions(self):
        class Detector:
            @staticmethod
            def setInputSize(_size):
                return None

            @staticmethod
            def detect(_image):
                detection = np.asarray(
                    [[10, 20, 30, 40, 15, 25, 35, 25, 25, 30, 18, 40, 32, 40, 0.9]],
                    dtype=np.float32,
                )
                return None, detection

        class Recognizer:
            @staticmethod
            def alignCrop(_image, _detection):
                return np.zeros((112, 112, 3), dtype=np.uint8)

            @staticmethod
            def feature(_aligned):
                return np.ones((128,), dtype=np.float32)

        image = np.zeros((256, 512, 3), dtype=np.uint8)
        runtime = {"device": "cpu", "detector": Detector(), "recognizer": Recognizer()}
        with patch.object(worker, "read_face_image", return_value=(image, 4.0, 2.0)), patch.object(
            worker, "load_face_models", return_value=runtime
        ), patch.object(worker, "np", np):
            result = worker.analyze_face_image("face.jpg")

        self.assertEqual([40.0, 40.0, 120.0, 80.0], result["data"]["faces"][0]["box"])

    def test_ocr_status_verifies_models_in_the_derived_cache(self):
        def version(package):
            return "3.10.0" if package == "rapidocr" else "1.20.2"

        with tempfile.TemporaryDirectory() as directory, patch.object(
            worker, "model_dir", Path(directory)
        ), patch.object(worker.importlib.util, "find_spec", return_value=object()), patch.object(
            worker.importlib.metadata, "version", side_effect=version
        ), patch.object(worker, "file_state", return_value=True) as verify_file:
            result = worker.ocr_module_status()

        self.assertTrue(result["ready"])
        self.assertEqual(
            [
                Path(directory) / worker.OCR_MODEL_DIRECTORY / worker.OCR_DETECTOR_FILE,
                Path(directory) / worker.OCR_MODEL_DIRECTORY / worker.OCR_CLASSIFIER_FILE,
                Path(directory) / worker.OCR_MODEL_DIRECTORY / worker.OCR_RECOGNIZER_FILE,
            ],
            [call.args[0] for call in verify_file.call_args_list],
        )

    def test_ocr_status_rejects_a_missing_cached_model(self):
        def version(package):
            return "3.10.0" if package == "rapidocr" else "1.20.2"

        with tempfile.TemporaryDirectory() as directory, patch.object(
            worker, "model_dir", Path(directory)
        ), patch.object(worker.importlib.util, "find_spec", return_value=object()), patch.object(
            worker.importlib.metadata, "version", side_effect=version
        ), patch.object(worker, "file_state", side_effect=[True, False]):
            result = worker.ocr_module_status()

        self.assertFalse(result["ready"])
        self.assertEqual("ocr_model_missing_or_checksum_invalid", result["error"])

    def test_ocr_gpu_verification_checks_loaded_sessions(self):
        def model(providers):
            session = SimpleNamespace(get_providers=lambda: providers)
            return SimpleNamespace(session=SimpleNamespace(session=session))

        engine = SimpleNamespace(
            text_det=model(["CUDAExecutionProvider", "CPUExecutionProvider"]),
            text_cls=None,
            text_rec=None,
        )

        self.assertTrue(worker.ocr_engine_uses_cuda(engine))

        engine.text_rec = model(["CPUExecutionProvider"])
        self.assertFalse(worker.ocr_engine_uses_cuda(engine))

    def test_ocr_gpu_inference_reports_provider_fallback(self):
        session = SimpleNamespace(get_providers=lambda: ["CPUExecutionProvider"])
        model = SimpleNamespace(session=SimpleNamespace(session=session))

        class Engine:
            text_det = model
            text_cls = None
            text_rec = None

            def __call__(self, _image):
                return SimpleNamespace(txts=[], scores=[], boxes=[])

        engine = Engine()

        engine_cache = {"gpu": engine}
        with patch.object(worker, "rapid_ocr", engine_cache), patch.object(
            worker, "read_ocr_image", return_value=(object(), 1.0, 1.0)
        ), patch.object(worker, "load_ocr_engine", return_value=engine):
            result = worker.analyze_ocr_image("image.jpg", "gpu")

        self.assertEqual("gpu_inference_failed", result["error"])
        self.assertTrue(worker.ocr_gpu_runtime_failed)
        self.assertNotIn("gpu", engine_cache)

    def test_failed_ocr_gpu_session_is_not_loaded_again(self):
        with patch.object(worker, "ocr_gpu_runtime_failed", True), patch.object(
            worker, "ocr_module_status"
        ) as module_status:
            with self.assertRaisesRegex(RuntimeError, "gpu_inference_failed"):
                worker.load_ocr_engine("gpu")

        module_status.assert_not_called()

    def test_cuda_oom_reduces_image_batch_size(self):
        batch_sizes = []

        def encode(items):
            batch_sizes.append(len(items))
            if len(items) > 2:
                raise FakeOutOfMemoryError("CUDA out of memory")
            return [[1.0] + [0.0] * (worker.DIMENSION - 1) for _ in items]

        results = worker.run_with_fallback(["a", "b", "c", "d"], encode, lambda item: item)

        self.assertEqual([4, 2, 2], batch_sizes)
        self.assertTrue(all(not item["error"] and len(item["vector"]) == worker.DIMENSION for item in results))
        self.assertEqual("cuda", worker.device)

    def test_gpu_embedding_batch_starts_larger_than_cpu_batch(self):
        images = [str(index) for index in range(33)]
        batch_sizes = []

        def encode(items):
            batch_sizes.append(len(items))
            return [[1.0] + [0.0] * (worker.DIMENSION - 1) for _ in items]

        gpu_results = worker.run_with_fallback(images, encode, lambda item: item)
        self.assertEqual([32, 1], batch_sizes)
        self.assertTrue(all(not item["error"] for item in gpu_results))

        batch_sizes.clear()
        with patch.object(worker, "device", "cpu"):
            cpu_results = worker.run_with_fallback(images, encode, lambda item: item)

        self.assertEqual([8, 8, 8, 8, 1], batch_sizes)
        self.assertTrue(all(not item["error"] for item in cpu_results))

    def test_single_item_cuda_oom_retries_on_cpu(self):
        def encode(items):
            if worker.device == "cuda":
                raise FakeOutOfMemoryError("CUDA out of memory")
            return [[1.0] + [0.0] * (worker.DIMENSION - 1) for _ in items]

        results = worker.run_with_fallback(["a"], encode, lambda item: item)

        self.assertFalse(results[0]["error"])
        self.assertEqual(worker.DIMENSION, len(results[0]["vector"]))
        self.assertEqual("cpu", worker.device)
        self.assertEqual("cpu", worker.model.device)
        self.assertTrue(worker.model.is_float)

    def test_forced_gpu_oom_never_retries_on_cpu(self):
        model = worker.model

        def encode(_items):
            raise FakeOutOfMemoryError("CUDA out of memory")

        results = worker.run_with_fallback(["image"], encode, lambda item: item, "gpu")

        self.assertEqual("gpu_out_of_memory", results[0]["error"])
        self.assertEqual("cuda", model.device)

    def test_unreadable_image_does_not_abort_other_items(self):
        results = worker.run_with_fallback(
            ["bad", "good"],
            lambda items: [[1.0] + [0.0] * (worker.DIMENSION - 1) for _ in items],
            lambda item: (_ for _ in ()).throw(ValueError()) if item == "bad" else item,
        )

        self.assertEqual("image_unreadable", results[0]["error"])
        self.assertEqual(worker.DIMENSION, len(results[1]["vector"]))

    def test_parallel_image_preparation_preserves_input_order(self):
        def encode(items):
            return [[float(ord(item))] + [0.0] * (worker.DIMENSION - 1) for item in items]

        results = worker.run_with_fallback(
            ["c", "bad", "a", "b"],
            encode,
            lambda item: (_ for _ in ()).throw(ValueError()) if item == "bad" else item,
            prepare_workers=3,
        )

        self.assertEqual(
            [float(ord("c")), None, float(ord("a")), float(ord("b"))],
            [item["vector"][0] if item["vector"] else None for item in results],
        )
        self.assertEqual("image_unreadable", results[1]["error"])

    def test_clip_preparation_uses_reduced_jpeg_decode(self):
        from PIL import Image as PILImage

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "large.jpg"
            PILImage.new("RGB", (1600, 800), (40, 120, 200)).save(path)
            with patch.object(worker, "Image", PILImage), patch.object(
                worker, "preprocess", side_effect=lambda image: image.size
            ):
                prepared_size = worker.prepare_image(str(path))

        self.assertLess(prepared_size[0], 1600)
        self.assertLess(prepared_size[1], 800)
        self.assertGreaterEqual(min(prepared_size), worker.CLIP_IMAGE_SIZE)

    def test_image_analysis_preserves_success_and_failure_per_item(self):
        results = worker.run_image_analysis(
            ["one.jpg", "two.jpg"],
            lambda path: {"data": {"path": path}, "error": "image_unreadable"}
            if path == "two.jpg"
            else {"data": {"text": "入口"}},
        )

        self.assertEqual("入口", results["items"][0]["data"]["text"])
        self.assertEqual("image_unreadable", results["items"][1]["error"])
        self.assertIn("modules", results["status"])

    def test_parallel_image_analysis_preserves_input_order(self):
        barrier = threading.Barrier(2)
        result = worker.run_image_analysis(
            ["first", "second"],
            lambda path: (barrier.wait(timeout=2), {"data": {"path": path}})[1],
            max_workers=2,
        )

        self.assertEqual(["first", "second"], [item["data"]["path"] for item in result["items"]])

    def test_gpu_ocr_warms_engine_before_parallelizing_remaining_images(self):
        barrier = threading.Barrier(2)
        main_thread = threading.current_thread().name
        call_threads = {}

        def analyze(path, _device_mode):
            call_threads[path] = threading.current_thread().name
            if path == "broken.jpg":
                return {"data": None, "error": "image_unreadable"}
            if path == "warm.jpg":
                return {"data": {"path": path}}
            barrier.wait(timeout=2)
            return {"data": {"path": path}}

        with patch.object(worker, "analyze_ocr_image", side_effect=analyze), patch.object(
            worker, "status", return_value={"modules": {}}
        ):
            result = worker.run_ocr_image_analysis(
                ["broken.jpg", "warm.jpg", "one.jpg", "two.jpg"], "gpu"
            )

        self.assertEqual(
            ["image_unreadable", None, None, None],
            [item.get("error") for item in result["items"]],
        )
        self.assertEqual(
            ["warm.jpg", "one.jpg", "two.jpg"],
            [item["data"]["path"] for item in result["items"][1:]],
        )
        self.assertEqual(main_thread, call_threads["broken.jpg"])
        self.assertEqual(main_thread, call_threads["warm.jpg"])
        self.assertTrue(call_threads["one.jpg"].startswith("ThreadPoolExecutor"))
        self.assertTrue(call_threads["two.jpg"].startswith("ThreadPoolExecutor"))

    def test_parallel_gpu_ocr_inference_does_not_redirect_worker_stdout(self):
        result = SimpleNamespace(
            txts=["recognized"],
            scores=[0.9],
            boxes=[[[0, 0], [10, 0], [10, 5], [0, 5]]],
        )
        engine = lambda _image: result

        with patch.object(worker, "read_ocr_image", side_effect=lambda path: (path, 1.0, 1.0)), patch.object(
            worker, "load_ocr_engine", return_value=engine
        ), patch.object(worker, "ocr_engine_uses_cuda", return_value=True), patch.object(
            worker, "status", return_value={"modules": {}}
        ), patch.object(
            worker.contextlib,
            "redirect_stdout",
            side_effect=AssertionError("parallel inference must not replace process stdout"),
        ) as redirect_stdout:
            response = worker.run_ocr_image_analysis(["warm.jpg", "one.jpg", "two.jpg"], "gpu")

        self.assertTrue(all(item["data"]["text"] == "recognized" for item in response["items"]))
        redirect_stdout.assert_not_called()

    def test_gpu_ocr_keeps_processing_serial_after_runtime_failure(self):
        call_threads = []

        def analyze(path, _device_mode):
            call_threads.append((path, threading.current_thread().name))
            return {"data": None, "error": "gpu_inference_failed"}

        with patch.object(worker, "analyze_ocr_image", side_effect=analyze), patch.object(
            worker, "status", return_value={"modules": {}}
        ):
            result = worker.run_ocr_image_analysis(["one.jpg", "two.jpg", "three.jpg"], "gpu")

        self.assertEqual(["one.jpg", "two.jpg", "three.jpg"], [item[0] for item in call_threads])
        self.assertEqual(1, len({thread_name for _, thread_name in call_threads}))
        self.assertTrue(all(item["error"] == "gpu_inference_failed" for item in result["items"]))

    def test_gpu_ocr_action_uses_ocr_concurrency_coordinator(self):
        response = {"items": []}
        with patch.object(worker, "ocr_module_status", return_value={"ready": True}), patch.object(
            worker, "gpu_available", return_value=True
        ), patch.object(worker, "run_ocr_image_analysis", return_value=response) as run_analysis:
            result = worker.process(
                {"action": "ocr_images", "device": "gpu", "paths": ["one.jpg", "two.jpg"]}
            )

        self.assertIs(response, result)
        run_analysis.assert_called_once_with(["one.jpg", "two.jpg"], "gpu")

    def test_gpu_face_action_requests_bounded_parallel_workers(self):
        response = {"items": []}
        with patch.object(worker, "face_module_status", return_value={"ready": True}), patch.object(
            worker, "gpu_available", return_value=True
        ), patch.object(worker, "run_image_analysis", return_value=response) as run_analysis:
            result = worker.process({"action": "face_images", "device": "gpu", "paths": ["one", "two"]})

        self.assertIs(response, result)
        self.assertEqual(worker.FACE_GPU_WORKERS, run_analysis.call_args.kwargs["max_workers"])

    def test_face_model_initialization_is_shared_by_parallel_workers(self):
        sessions = []

        class Session:
            @staticmethod
            def get_providers():
                return ["CUDAExecutionProvider", "CPUExecutionProvider"]

        class FakeOnnxRuntime:
            @staticmethod
            def InferenceSession(_path, providers):
                time.sleep(0.02)
                sessions.append(tuple(providers))
                return Session()

        with patch.object(worker, "face_models", {}), patch.object(
            worker, "face_module_status", return_value={"ready": True}
        ), patch.object(worker, "gpu_available", return_value=True), patch.dict(
            sys.modules, {"onnxruntime": FakeOnnxRuntime}
        ):
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
                models = list(executor.map(lambda _: worker.load_face_models("gpu"), range(4)))

        self.assertEqual(2, len(sessions))
        self.assertTrue(all(model is models[0] for model in models))

    def test_image_analysis_rejects_invalid_batches(self):
        self.assertEqual("invalid_image_batch", worker.run_image_analysis([], lambda _: {})["error"])
        self.assertEqual("invalid_image_batch", worker.run_image_analysis([object()], lambda _: {})["error"])

    def test_worker_stdio_is_utf8(self):
        class Stream:
            encoding = "cp1252"

            def reconfigure(self, *, encoding):
                self.encoding = encoding

        stdin = Stream()
        stdout = Stream()
        with patch.object(worker.sys, "stdin", stdin), patch.object(worker.sys, "stdout", stdout):
            worker.configure_worker_stdio()

        self.assertEqual("utf-8", stdin.encoding)
        self.assertEqual("utf-8", stdout.encoding)


if __name__ == "__main__":
    unittest.main()
