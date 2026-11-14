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
            "torch": worker.torch,
            "rapid_ocr": worker.rapid_ocr,
            "ocr_gpu_runtime_failed": worker.ocr_gpu_runtime_failed,
            "face_models": worker.face_models,
        }
        worker.device = "cuda"
        worker.model = FakeModel()
        worker.model_cache = {}
        worker.model_validation = None
        worker.runtime_error = ""
        worker.torch = FakeTorch()
        worker.ocr_gpu_runtime_failed = False

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
        self.assertFalse(params["EngineConfig.onnxruntime.use_cuda"])
        self.assertEqual(6, params["Cls.cls_batch_num"])
        self.assertEqual(6, params["Rec.rec_batch_num"])

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
            worker, "read_cv_image", return_value=object()
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
