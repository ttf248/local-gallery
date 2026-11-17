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
            "last_model_activity": worker.last_model_activity,
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
        worker.last_model_activity = None

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

    def test_worker_releases_model_caches_after_idle_before_next_request(self):
        empty_cache_calls = []
        worker.device = "cuda"
        worker.model_device = "cuda"
        worker.model_cache = {
            "cuda": (worker.model, "cuda-preprocess"),
            "cpu": (FakeModel(), "cpu-preprocess"),
        }
        worker.rapid_ocr = {"gpu": object(), "cpu": object()}
        worker.face_models = {"gpu": object(), "cpu": object()}
        worker.torch = SimpleNamespace(
            cuda=SimpleNamespace(empty_cache=lambda: empty_cache_calls.append(True))
        )
        worker.last_model_activity = time.monotonic() - worker.MODEL_IDLE_RELEASE_SECONDS - 1

        with patch.object(
            worker,
            "_process_request",
            side_effect=lambda _request: {"released": worker.model is None},
        ):
            response = worker.process({"action": "status"})

        self.assertTrue(response["released"])
        self.assertIsNone(worker.model)
        self.assertIsNone(worker.model_device)
        self.assertIsNone(worker.preprocess)
        self.assertEqual("cpu", worker.device)
        self.assertEqual({}, worker.model_cache)
        self.assertEqual({}, worker.rapid_ocr)
        self.assertEqual({}, worker.face_models)
        self.assertIsNone(worker.last_model_activity)
        self.assertEqual([True], empty_cache_calls)

    def test_worker_keeps_models_during_idle_timeout(self):
        current_model = worker.model
        worker.model_cache = {"cuda": (current_model, "preprocess")}
        worker.last_model_activity = 100.0

        released = worker.release_idle_models(
            now=100.0 + worker.MODEL_IDLE_RELEASE_SECONDS - 1
        )

        self.assertFalse(released)
        self.assertIs(current_model, worker.model)
        self.assertIn("cuda", worker.model_cache)

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

    def test_ocr_cpu_mode_limits_intra_op_threads_and_keeps_microbatch_sizes(self):
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
        self.assertEqual(worker.OCR_CPU_ONNX_THREADS, params["EngineConfig.onnxruntime.intra_op_num_threads"])
        self.assertEqual(6, params["Cls.cls_batch_num"])
        self.assertEqual(6, params["Rec.rec_batch_num"])

    def test_ocr_cpu_image_worker_count_scales_with_logical_processors(self):
        cases = ((None, 2), (1, 1), (4, 1), (8, 2), (12, 3), (16, 4), (32, 4))
        for logical_processors, expected in cases:
            with self.subTest(logical_processors=logical_processors), patch.object(
                worker.os, "cpu_count", return_value=logical_processors
            ):
                self.assertEqual(expected, worker.ocr_cpu_image_worker_count())

    def test_ocr_cpu_analysis_uses_scaled_worker_count(self):
        result = {"items": []}
        with patch.object(worker, "ocr_cpu_image_worker_count", return_value=3), patch.object(
            worker, "run_warmed_image_analysis", return_value=result
        ) as run_batch:
            response = worker.run_ocr_image_analysis(["page.png"], "cpu")

        self.assertIs(result, response)
        self.assertEqual(3, run_batch.call_args.args[2])

    def test_ocr_gpu_worker_count_bounds_large_image_batches(self):
        from PIL import Image as PILImage

        with tempfile.TemporaryDirectory() as directory:
            small_png = Path(directory) / "small.png"
            large_png = Path(directory) / "large.png"
            large_jpeg = Path(directory) / "large.jpg"
            broken_image = Path(directory) / "broken.png"
            PILImage.new("RGB", (100, 100)).save(small_png)
            PILImage.new("RGB", (2200, 1900)).save(large_png)
            PILImage.new("RGB", (2200, 1900)).save(large_jpeg)
            broken_image.write_bytes(b"not an image")

            self.assertEqual(16, worker.ocr_gpu_image_worker_count([str(small_png)]))
            self.assertEqual(8, worker.ocr_gpu_image_worker_count([str(large_png)]))
            self.assertEqual(8, worker.ocr_gpu_image_worker_count([str(large_jpeg)]))
            self.assertEqual(
                8,
                worker.ocr_gpu_image_worker_count([str(small_png), str(large_png)]),
            )
            self.assertEqual(8, worker.ocr_gpu_image_worker_count([str(broken_image)]))

    def test_ocr_gpu_analysis_uses_adaptive_worker_count(self):
        paths = ["page.png", "large.png"]
        result = {"items": []}
        with patch.object(
            worker, "ocr_gpu_image_worker_count", return_value=8
        ) as choose_workers, patch.object(
            worker, "run_warmed_image_analysis", return_value=result
        ) as run_batch:
            response = worker.run_ocr_image_analysis(paths, "gpu")

        self.assertIs(result, response)
        self.assertEqual(16, worker.OCR_GPU_IMAGE_WORKERS)
        choose_workers.assert_called_once_with(paths)
        self.assertEqual(
            worker.OCR_GPU_LARGE_IMAGE_WORKERS,
            run_batch.call_args.args[2],
        )

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
            size = (14_000, 7_000)
            format = "JPEG"

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            @staticmethod
            def getexif():
                return {}

        decoded = SimpleNamespace(shape=(1_750, 3_500, 3))
        decode_flags = []

        def decode(_encoded, flag):
            decode_flags.append(flag)
            return decoded if flag == 4 else None

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
        self.assertEqual([4], decode_flags)
        self.assertEqual((4.0, 4.0), (scale_x, scale_y))
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

    def test_face_gpu_worker_count_bounds_large_non_jpeg_inputs(self):
        from PIL import Image as PILImage

        with tempfile.TemporaryDirectory() as directory:
            small_png = Path(directory) / "small.png"
            large_png = Path(directory) / "large.png"
            large_jpeg = Path(directory) / "large.jpg"
            PILImage.new("RGB", (100, 100)).save(small_png)
            PILImage.new("RGB", (2200, 1900)).save(large_png)
            PILImage.new("RGB", (2200, 1900)).save(large_jpeg)

            self.assertEqual(12, worker.face_gpu_worker_count([str(small_png)]))
            self.assertEqual(4, worker.face_gpu_worker_count([str(large_png)]))
            self.assertEqual(12, worker.face_gpu_worker_count([str(large_jpeg)]))
            self.assertEqual(
                4,
                worker.face_gpu_worker_count([str(small_png), str(large_png)]),
            )

    def test_face_boxes_map_from_reduced_input_to_source_dimensions(self):
        class Detector:
            @staticmethod
            def setInputSize(_size):
                return None

            @staticmethod
            def detect(_image):
                accepted = [10, 20, 40, 40, 18, 28, 42, 28, 30, 35, 20, 48, 40, 48, 0.75]
                rejected = accepted.copy()
                rejected[-1] = 0.74
                detection = np.asarray([rejected, accepted], dtype=np.float32)
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

        self.assertEqual(1, len(result["data"]["faces"]))
        self.assertEqual([40.0, 40.0, 160.0, 80.0], result["data"]["faces"][0]["box"])

    def test_yunet_detection_quality_gate_rejects_weak_or_invalid_faces(self):
        detection = np.asarray(
            [20, 20, 64, 64, 32, 38, 72, 38, 52, 51, 38, 70, 66, 70, 0.9],
            dtype=np.float32,
        )
        with patch.object(worker, "np", np):
            self.assertTrue(worker.valid_yunet_detection(detection, (120, 120, 3)))

            low_score = detection.copy()
            low_score[14] = 0.74
            self.assertFalse(worker.valid_yunet_detection(low_score, (120, 120, 3)))

            tiny_face = detection.copy()
            tiny_face[2] = 31
            self.assertFalse(worker.valid_yunet_detection(tiny_face, (120, 120, 3)))

            invalid_landmarks = detection.copy()
            invalid_landmarks[9] = 80
            self.assertFalse(worker.valid_yunet_detection(invalid_landmarks, (120, 120, 3)))

            non_finite = detection.copy()
            non_finite[4] = np.nan
            self.assertFalse(worker.valid_yunet_detection(non_finite, (120, 120, 3)))

            collapsed_landmarks = detection.copy()
            collapsed_landmarks[4:14] = [52, 48, 53, 49, 52, 50, 52, 51, 53, 51]
            self.assertFalse(worker.valid_yunet_detection(collapsed_landmarks, (120, 120, 3)))

    def test_buffalo_m_scrfd_decodes_boxes_and_five_landmarks(self):
        outputs = [
            np.zeros((12800, 1), dtype=np.float32),
            np.zeros((3200, 1), dtype=np.float32),
            np.zeros((800, 1), dtype=np.float32),
            np.zeros((12800, 4), dtype=np.float32),
            np.zeros((3200, 4), dtype=np.float32),
            np.zeros((800, 4), dtype=np.float32),
            np.zeros((12800, 10), dtype=np.float32),
            np.zeros((3200, 10), dtype=np.float32),
            np.zeros((800, 10), dtype=np.float32),
        ]
        position = (20 * 80 + 30) * worker.BUFFALO_M_ANCHORS_PER_LOCATION + 1
        outputs[0][position, 0] = 0.9
        outputs[3][position] = [4, 5, 6, 7]
        outputs[6][position] = [1, 2, 2, 2, 3, 3, 2, 4, 3, 4]

        class Detector:
            def run(self, _names, _feed):
                return outputs

        runtime = {
            "detector": Detector(),
            "detector_input": "input.1",
            "detector_outputs": [str(index) for index in range(9)],
        }
        with patch.object(worker, "cv2", cv2), patch.object(worker, "np", np):
            faces = worker.detect_buffalo_m(np.zeros((640, 640, 3), dtype=np.uint8), runtime)
            self.assertTrue(worker.valid_yunet_detection(faces[0], (640, 640, 3), 0.5))

        self.assertEqual(1, len(faces))
        np.testing.assert_allclose(faces[0][:4], [208, 120, 80, 96])
        np.testing.assert_allclose(faces[0][4:14], [248, 176, 256, 176, 264, 184, 256, 192, 264, 192])
        self.assertAlmostEqual(0.9, float(faces[0][14]))

    def test_sface_alignment_matches_svd_reference(self):
        rng = np.random.default_rng(20261115)
        destination = np.asarray([
            [38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
            [41.5493, 92.3655], [70.7299, 92.2041],
        ], dtype=np.float64)
        destination_mean = np.asarray([56.0262, 71.9008], dtype=np.float64)
        image = rng.integers(0, 256, (320, 480, 3), dtype=np.uint8)

        def svd_reference(detection):
            source = np.asarray(detection[4:14], dtype=np.float64).reshape(5, 2)
            source_mean = source.mean(axis=0)
            source_centered = source - source_mean
            destination_centered = destination - destination_mean
            covariance = destination_centered.T @ source_centered / 5
            u, singular_values, vt = np.linalg.svd(covariance)
            signs = np.asarray([1.0, -1.0 if np.linalg.det(covariance) < 0 else 1.0])
            rotation = u @ np.diag(signs) @ vt
            variance = float(np.square(source_centered).sum() / 5)
            scale = float((singular_values * signs).sum() / variance)
            matrix = np.empty((2, 3), dtype=np.float64)
            matrix[:, :2] = scale * rotation
            matrix[:, 2] = destination_mean - scale * rotation @ source_mean
            return cv2.warpAffine(image, matrix, (112, 112), flags=cv2.INTER_LINEAR)

        detections = []
        for index in range(32):
            angle = rng.uniform(-0.3, 0.3)
            scale = rng.uniform(0.8, 1.2)
            rotation = np.asarray([
                [np.cos(angle), -np.sin(angle)],
                [np.sin(angle), np.cos(angle)],
            ])
            if index % 2 == 0:
                rotation[0, 0] *= -1
            offset = np.asarray([rng.uniform(100, 400), rng.uniform(100, 300)])
            source = (destination - destination_mean) @ rotation / scale + offset
            source += rng.normal(0, 0.7, source.shape)
            detections.append([0.0, 0.0, 200.0, 250.0, *source.reshape(-1), 0.99])

        with patch.object(worker, "cv2", cv2), patch.object(worker, "np", np):
            for index, detection in enumerate(detections):
                with self.subTest(face=index):
                    expected = svd_reference(detection)
                    actual = worker.align_sface_crop(image, detection)
                    difference = np.abs(expected.astype(np.int16) - actual.astype(np.int16))
                    self.assertLessEqual(int(difference.max()), 1)

    def test_yunet_nms_matches_score_ordered_reference(self):
        rng = np.random.default_rng(42)
        faces = []
        for _ in range(300):
            x, y = rng.uniform(-20, 300, size=2)
            width, height = rng.uniform(0, 120, size=2)
            landmarks = rng.uniform(0, 320, size=10).tolist()
            score = float(rng.integers(65, 100)) / 100
            faces.append([float(x), float(y), float(width), float(height), *landmarks, score])

        def reference_nms(candidates, threshold, limit):
            ordered = sorted(candidates, key=lambda face: face[14], reverse=True)
            kept = []
            for face in ordered:
                x, y, box_width, box_height = face[:4]
                area = max(0.0, box_width) * max(0.0, box_height)
                for selected in kept:
                    sx, sy, selected_width, selected_height = selected[:4]
                    left, top = max(x, sx), max(y, sy)
                    right = min(x + box_width, sx + selected_width)
                    bottom = min(y + box_height, sy + selected_height)
                    intersection = max(0.0, right - left) * max(0.0, bottom - top)
                    selected_area = max(0.0, selected_width) * max(0.0, selected_height)
                    union = area + selected_area - intersection
                    if union > 0 and intersection / union > threshold:
                        break
                else:
                    kept.append(face)
                    if len(kept) >= max(1, limit):
                        break
            return kept

        with patch.object(worker, "np", np):
            for threshold, limit in ((0.3, 5000), (0.55, 40), (0.3, 0)):
                with self.subTest(threshold=threshold, limit=limit):
                    self.assertEqual(
                        reference_nms(faces, threshold, limit),
                        worker.yunet_nms(faces, threshold, limit),
                    )

    def test_yunet_gpu_adds_scaled_full_frame_pass_for_large_faces(self):
        output_names = [
            f"{kind}_{stride}"
            for stride in (8, 16, 32)
            for kind in ("cls", "obj", "bbox", "kps")
        ]

        class Session:
            def __init__(self):
                self.calls = 0

            @staticmethod
            def get_inputs():
                return [SimpleNamespace(name="input")]

            @staticmethod
            def get_outputs():
                return [SimpleNamespace(name=name) for name in output_names]

            def run(self, _outputs, _inputs):
                self.calls += 1
                predictions = []
                for stride in (8, 16, 32):
                    count = (worker.YUNET_INPUT_SIZE // stride) ** 2
                    predictions.extend((
                        np.zeros((1, count, 1), dtype=np.float32),
                        np.zeros((1, count, 1), dtype=np.float32),
                        np.zeros((1, count, 4), dtype=np.float32),
                        np.zeros((1, count, 10), dtype=np.float32),
                    ))
                if self.calls == 7:
                    index = 10 * (worker.YUNET_INPUT_SIZE // 8) + 10
                    predictions[0][0, index, 0] = 0.9
                    predictions[1][0, index, 0] = 0.9
                    predictions[2][0, index, 2:4] = np.log(10)
                    predictions[3][0, index] = [0, 0, 4, 0, 2, 4, 1, 7, 4, 7]
                return predictions

        session = Session()
        with patch.object(worker, "cv2", cv2), patch.object(worker, "np", np):
            faces = worker.detect_yunet_gpu(np.zeros((800, 1200, 3), dtype=np.uint8), session)

        self.assertEqual(7, session.calls)
        self.assertEqual(1, len(faces))
        self.assertAlmostEqual(75, faces[0][0], delta=1)
        self.assertAlmostEqual(75, faces[0][1], delta=1)
        self.assertAlmostEqual(150, faces[0][2], delta=2)
        self.assertAlmostEqual(150, faces[0][3], delta=2)
        landmarks = np.asarray(faces[0][4:14]).reshape((5, 2))
        self.assertAlmostEqual(60, landmarks[1, 0] - landmarks[0, 0], delta=1)
        self.assertAlmostEqual(45, landmarks[4, 0] - landmarks[3, 0], delta=1)

    def test_yunet_cpu_maps_scaled_overview_detections_to_source(self):
        detection = np.asarray([[
            40, 40, 80, 80,
            48, 52, 72, 52, 60, 65, 50, 76, 70, 76, 0.9,
        ]], dtype=np.float32)

        class Detector:
            def __init__(self):
                self.sizes = []

            def setInputSize(self, size):
                self.sizes.append(size)

            def detect(self, _image):
                return None, detection if self.sizes[-1] == (640, 640) else None

        detector = Detector()
        with patch.object(worker, "cv2", cv2), patch.object(worker, "np", np):
            faces = worker.detect_yunet_cpu(np.zeros((800, 1200, 3), dtype=np.uint8), detector)

        self.assertEqual([(1200, 800), (640, 640)], detector.sizes)
        self.assertEqual(1, len(faces))
        self.assertAlmostEqual(75, faces[0][0], delta=1)
        self.assertAlmostEqual(75, faces[0][1], delta=1)
        self.assertAlmostEqual(150, faces[0][2], delta=2)
        self.assertAlmostEqual(150, faces[0][3], delta=2)

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

    def test_clip_preparation_applies_exif_orientation(self):
        from PIL import Image as PILImage
        from PIL import ImageDraw

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "oriented.png"
            source = PILImage.new("RGB", (120, 80), "black")
            draw = ImageDraw.Draw(source)
            draw.rectangle((0, 0, 59, 79), fill=(240, 20, 20))
            draw.rectangle((60, 0, 119, 79), fill=(20, 20, 240))
            exif = PILImage.Exif()
            exif[274] = 6
            source.save(path, exif=exif)

            with patch.object(worker, "Image", PILImage), patch.object(
                worker,
                "preprocess",
                side_effect=lambda image: (
                    image.size,
                    image.getpixel((40, 20)),
                    image.getpixel((40, 100)),
                ),
            ):
                prepared = worker.prepare_image(str(path))

        self.assertEqual((80, 120), prepared[0])
        self.assertGreater(prepared[1][0], prepared[1][2])
        self.assertGreater(prepared[2][2], prepared[2][0])

    def test_image_preprocess_worker_count_bounds_large_non_jpeg_inputs(self):
        from PIL import Image as PILImage

        with tempfile.TemporaryDirectory() as directory:
            small_png = Path(directory) / "small.png"
            large_png = Path(directory) / "large.png"
            large_jpeg = Path(directory) / "large.jpg"
            PILImage.new("RGB", (100, 100)).save(small_png)
            PILImage.new("RGB", (2200, 1900)).save(large_png)
            PILImage.new("RGB", (2200, 1900)).save(large_jpeg)

            with patch.object(worker, "Image", PILImage):
                self.assertEqual(8, worker.image_preprocess_worker_count([str(small_png)]))
                self.assertEqual(4, worker.image_preprocess_worker_count([str(large_png)]))
                self.assertEqual(8, worker.image_preprocess_worker_count([str(large_jpeg)]))
                self.assertEqual(4, worker.image_preprocess_worker_count([str(small_png), str(large_png)]))

    def test_embed_image_action_uses_adaptive_preprocessing_workers(self):
        paths = ["one.png", "two.jpg"]
        items = [{"vector": [1.0], "error": ""}]
        with patch.object(worker, "runtime_error", ""), patch.object(
            worker, "gpu_available", return_value=True
        ), patch.object(worker, "load_model"), patch.object(
            worker, "image_preprocess_worker_count", return_value=8
        ) as choose_workers, patch.object(
            worker, "run_with_fallback", return_value=items
        ) as run_batch, patch.object(worker, "status", return_value={"device": "cuda"}):
            result = worker._process_request({"action": "embed_images", "device": "gpu", "paths": paths})

        self.assertIs(items, result["items"])
        choose_workers.assert_called_once_with(paths)
        self.assertEqual(8, run_batch.call_args.kwargs["prepare_workers"])

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

    def test_cpu_ocr_warms_engine_before_parallelizing_remaining_images(self):
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
                ["broken.jpg", "warm.jpg", "one.jpg", "two.jpg"], "cpu"
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

    def test_cpu_ocr_keeps_processing_serial_after_runtime_failure(self):
        call_threads = []

        def analyze(path, _device_mode):
            call_threads.append((path, threading.current_thread().name))
            return {"data": None, "error": "ocr_inference_failed"}

        with patch.object(worker, "analyze_ocr_image", side_effect=analyze), patch.object(
            worker, "status", return_value={"modules": {}}
        ):
            result = worker.run_ocr_image_analysis(["one.jpg", "two.jpg", "three.jpg"], "cpu")

        self.assertEqual(["one.jpg", "two.jpg", "three.jpg"], [item[0] for item in call_threads])
        self.assertEqual(1, len({thread_name for _, thread_name in call_threads}))
        self.assertTrue(all(item["error"] == "ocr_inference_failed" for item in result["items"]))

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
        ), patch.object(worker, "face_gpu_worker_count", return_value=12) as choose_workers, patch.object(
            worker, "run_image_analysis", return_value=response
        ) as run_analysis:
            result = worker.process({"action": "face_images", "device": "gpu", "paths": ["one", "two"]})

        self.assertIs(response, result)
        self.assertEqual(12, worker.FACE_GPU_WORKERS)
        choose_workers.assert_called_once_with(["one", "two"])
        self.assertEqual(worker.FACE_GPU_WORKERS, run_analysis.call_args.kwargs["max_workers"])

    def test_buffalo_m_gpu_action_uses_its_captured_profile_and_worker_limit(self):
        response = {"items": []}
        with patch.object(
            worker,
            "face_model_status",
            return_value={worker.FACE_MODEL_BUFFALO_M: {"ready": True}},
        ), patch.object(worker, "gpu_available", return_value=True), patch.object(
            worker, "run_image_analysis", return_value=response
        ) as run_analysis, patch.object(
            worker, "analyze_face_image", return_value={"data": {"faces": []}}
        ) as analyze:
            result = worker.process({
                "action": "face_images",
                "device": "gpu",
                "model": worker.FACE_MODEL_BUFFALO_M,
                "paths": ["one.jpg", "two.jpg"],
            })
            run_analysis.call_args.args[1]("one.jpg")

        self.assertIs(response, result)
        self.assertEqual(worker.BUFFALO_M_GPU_WORKERS, run_analysis.call_args.kwargs["max_workers"])
        analyze.assert_called_once_with("one.jpg", "gpu", worker.FACE_MODEL_BUFFALO_M)

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
