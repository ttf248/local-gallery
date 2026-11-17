import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from evaluate_people import buffalo_m_comparison, evaluate_profile, read_dataset


class EvaluatePeopleDatasetTests(unittest.TestCase):
    def test_resolves_relative_paths_and_counts_annotated_faces(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = root / "photo.jpg"
            image.write_bytes(b"temporary image")
            annotations = root / "annotations.json"
            annotations.write_text(
                json.dumps({
                    "schemaVersion": 1,
                    "photos": [{
                        "resourceId": "sample-1",
                        "path": "photo.jpg",
                        "tags": ["year:2024", "side-profile"],
                        "faces": [{
                            "box": [12, 24, 48, 60],
                            "identity": "person-a",
                            "smallFace": True,
                        }],
                    }],
                }),
                encoding="utf-8",
            )

            photos, face_count = read_dataset(annotations, None)

            self.assertEqual(face_count, 1)
            self.assertEqual(photos[0]["resourceId"], "sample-1")
            self.assertEqual(photos[0]["path"], str(image.resolve()))
            self.assertEqual(photos[0]["tags"], ["year:2024", "side-profile"])
            self.assertEqual(photos[0]["faces"][0]["identity"], "person-a")

    def test_rejects_duplicate_or_empty_scenario_tags(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = root / "photo.jpg"
            image.write_bytes(b"temporary image")
            annotations = root / "annotations.json"
            annotations.write_text(
                json.dumps({
                    "schemaVersion": 1,
                    "photos": [{
                        "resourceId": "sample-1",
                        "path": "photo.jpg",
                        "tags": ["group-photo", "group-photo"],
                        "faces": [],
                    }],
                }),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "tags"):
                read_dataset(annotations, None)

    def test_buffalo_m_profiles_select_overview_and_adaptive_detection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = root / "photo.jpg"
            image.write_bytes(b"temporary image")

            class Worker:
                FACE_MODEL_BUFFALO_M = "buffalo_m"

                def __init__(self):
                    self.tiling_modes = []

                @staticmethod
                def face_model_status():
                    return {"buffalo_m": {"ready": True, "version": "test-version"}}

                @staticmethod
                def load_face_models(_device, _model):
                    return None

                def analyze_face_image(self, _path, _device, _model, buffalo_m_tiling):
                    self.tiling_modes.append(buffalo_m_tiling)
                    return {"data": {"faces": []}}

            worker = Worker()
            photos = [{
                "resourceId": "sample-1",
                "path": str(image),
                "tags": [],
                "faces": [],
            }]
            completed = subprocess.CompletedProcess([], 0, stdout="{}", stderr="")
            with patch("evaluate_people.subprocess.run", return_value=completed):
                overview = evaluate_profile(
                    worker, photos, "buffalo_m", "cpu", root, 96, "overview"
                )
                adaptive = evaluate_profile(
                    worker, photos, "buffalo_m", "cpu", root, 96, "adaptive"
                )

            self.assertEqual(worker.tiling_modes, [False, True])
            self.assertEqual(overview["detectionMode"], "overview")
            self.assertEqual(adaptive["detectionMode"], "adaptive")
            self.assertIn("latencyP95Seconds", overview["performance"])
            self.assertGreaterEqual(overview["performance"]["inferenceSeconds"], 0)

    def test_buffalo_m_comparison_reports_adaptive_minus_overview(self):
        def profile(mode, seconds, small_recall):
            return {
                "detectionMode": mode,
                "performance": {"inferenceSeconds": seconds},
                "metrics": {
                    "detection": {"recall": 0.8},
                    "smallFaceDetection": {"recall": small_recall},
                    "identityPairwise": {"precision": 0.9, "recall": 0.7},
                    "splitIdentityRate": 0.2,
                    "mergedGroupRate": 0.1,
                    "singletonGroupShare": 0.4,
                },
            }

        comparison = buffalo_m_comparison([
            profile("overview", 2.0, 0.5),
            profile("adaptive", 3.0, 0.75),
        ])

        self.assertEqual(comparison["additionalInferenceSeconds"], 1.0)
        self.assertEqual(comparison["inferenceTimeRatio"], 1.5)
        self.assertEqual(
            comparison["adaptiveMinusOverview"]["smallFaceRecall"], 0.25
        )
        self.assertEqual(
            comparison["adaptiveMinusOverview"]["identityPairwisePrecision"], 0
        )

    def test_rejects_non_finite_boxes_before_model_inference(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = root / "photo.jpg"
            image.write_bytes(b"temporary image")
            annotations = root / "annotations.json"
            annotations.write_text(
                '{"schemaVersion":1,"photos":[{"resourceId":"sample-1",'
                '"path":"photo.jpg","faces":[{"box":[0,0,NaN,20],'
                '"identity":"person-a"}]}]}',
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "标注无效"):
                read_dataset(annotations, None)

    def test_rejects_boolean_box_coordinates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = root / "photo.jpg"
            image.write_bytes(b"temporary image")
            annotations = root / "annotations.json"
            annotations.write_text(
                json.dumps({
                    "schemaVersion": 1,
                    "photos": [{
                        "resourceId": "sample-1",
                        "path": "photo.jpg",
                        "faces": [{"box": [True, 0, 48, 60], "identity": "person-a"}],
                    }],
                }),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "标注无效"):
                read_dataset(annotations, None)


if __name__ == "__main__":
    unittest.main()
