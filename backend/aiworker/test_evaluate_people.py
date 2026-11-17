import json
import tempfile
import unittest
from pathlib import Path

from evaluate_people import read_dataset


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
            self.assertEqual(photos[0]["faces"][0]["identity"], "person-a")

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
