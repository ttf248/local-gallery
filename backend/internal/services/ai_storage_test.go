package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeAIStorageFile 造一个带内容的文件，返回内容长度。
func writeAIStorageFile(t *testing.T, path string, content string) int64 {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return int64(len(content))
}

func TestAIStorageUsageReportsRelativePathsAndSizes(t *testing.T) {
	root := t.TempDir()
	cacheRoot := filepath.Join(root, "cache")
	workerDir := filepath.Join(root, "backend", "aiworker")
	ocrModels := filepath.Join(cacheRoot, "derived", "ai", "models", "ocr")
	legacyOCRModels := filepath.Join(workerDir, ".venv", "Lib", "site-packages", "rapidocr", "models")

	clipBytes := writeAIStorageFile(t, filepath.Join(cacheRoot, "derived", "ai", "models", ChineseCLIPModelFile), "clip-model")
	yunetBytes := writeAIStorageFile(t, filepath.Join(cacheRoot, "derived", "ai", "models", "face", "face_detection_yunet_2023mar.onnx"), "yunet")
	sfaceBytes := writeAIStorageFile(t, filepath.Join(cacheRoot, "derived", "ai", "models", "face", "face_recognition_sface_2021dec.onnx"), "sface-model")
	buffaloDetectorBytes := writeAIStorageFile(t, filepath.Join(cacheRoot, "derived", "ai", "models", "face", FaceModelBuffaloM, "det_2.5g.onnx"), "buffalo-detector")
	buffaloRecognizerBytes := writeAIStorageFile(t, filepath.Join(cacheRoot, "derived", "ai", "models", "face", FaceModelBuffaloM, "w600k_r50.onnx"), "buffalo-recognizer")
	ocrBytes := int64(0)
	for _, model := range []struct{ name, content string }{
		{name: "PP-OCRv6_det_small.onnx", content: "ocr-detector"},
		{name: "PP-OCRv6_rec_small.onnx", content: "ocr-recognizer"},
		{name: "ch_ppocr_mobile_v2.0_cls_mobile.onnx", content: "ocr-classifier"},
	} {
		ocrBytes += writeAIStorageFile(t, filepath.Join(ocrModels, model.name), model.content)
	}
	_ = writeAIStorageFile(t, filepath.Join(ocrModels, "readme.txt"), "ignored")
	_ = writeAIStorageFile(t, filepath.Join(legacyOCRModels, "legacy-detector.onnx"), "ignored")

	metadataBytes := int64(0)
	for _, module := range []string{AIJobTypeMetadata, AIJobTypeEmbedding, AIJobTypeOCR} {
		metadataBytes += writeAIStorageFile(t, filepath.Join(cacheRoot, "derived", "metadata", module, "batches", "job", "00000001.json"), "batch")
	}
	metadataBytes += writeAIStorageFile(t, filepath.Join(cacheRoot, "derived", "metadata", AIJobTypeFace, FaceModelQualityV2, "batches", "job-quality", "00000001.json"), "quality-batch")
	metadataBytes += writeAIStorageFile(t, filepath.Join(cacheRoot, "derived", "metadata", AIJobTypeFace, FaceModelBuffaloM, "batches", "job-buffalo", "00000001.json"), "buffalo-batch")
	vectorBytes := writeAIStorageFile(t, filepath.Join(cacheRoot, "derived", "ai", "vectors", "shards", "00000001.bin"), "vector")
	ocrIndexBytes := writeAIStorageFile(t, filepath.Join(cacheRoot, "derived", "ai", "ocr-search-index.json"), "ocr-index")
	qualityIndexBytes := writeAIStorageFile(t, filepath.Join(cacheRoot, "derived", "ai", "people-index-quality-v2.json"), "quality-index")
	buffaloIndexBytes := writeAIStorageFile(t, filepath.Join(cacheRoot, "derived", "ai", "people-index-buffalo_m.json"), "buffalo-index")
	qualityCorrectionsBytes := writeAIStorageFile(t, filepath.Join(cacheRoot, "state", "people-quality-v2.json"), "quality-corrections")
	buffaloCorrectionsBytes := writeAIStorageFile(t, filepath.Join(cacheRoot, "state", "people-buffalo_m.json"), "buffalo-corrections")

	service := NewAIStorageService(0)
	usage, _, err := service.Usage(cacheRoot)
	if err != nil {
		t.Fatal(err)
	}
	if !usage.Available {
		t.Fatal("storage usage should be available")
	}
	if len(usage.Modules) != 6 {
		t.Fatalf("module count = %d, want 6", len(usage.Modules))
	}
	wantTypes := []string{AIJobTypeMetadata, AIJobTypeEmbedding, AIJobTypeOCR, AIJobTypeFace, AIJobTypeSimilarity, AIJobTypeAlbumCover}
	wantNames := []string{"照片元数据", "向量索引", "文字识别", "人脸识别", "相似照片特征", "相册封面精选"}
	for index, module := range usage.Modules {
		if module.Type != wantTypes[index] || module.Name != wantNames[index] {
			t.Fatalf("module %d = %s/%s", index, module.Type, module.Name)
		}
	}

	metadataModule := usage.Modules[0]
	if metadataModule.ModelLocation != AIStorageModelNone || len(metadataModule.ModelFiles) != 0 || metadataModule.ModelBytes != 0 {
		t.Fatalf("metadata module = %+v", metadataModule)
	}

	embedding := usage.Modules[1]
	if embedding.ModelLocation != AIStorageModelCache {
		t.Fatalf("embedding model location = %q", embedding.ModelLocation)
	}
	if len(embedding.ModelFiles) != 1 || embedding.ModelFiles[0].Path != "derived/ai/models/"+ChineseCLIPModelFile {
		t.Fatalf("embedding model files = %+v", embedding.ModelFiles)
	}
	if embedding.ModelBytes != clipBytes {
		t.Fatalf("embedding model bytes = %d, want %d", embedding.ModelBytes, clipBytes)
	}

	ocr := usage.Modules[2]
	if ocr.ModelLocation != AIStorageModelCache {
		t.Fatalf("ocr model location = %q", ocr.ModelLocation)
	}
	if ocr.ModelDirectory != "derived/ai/models/ocr" || len(ocr.ModelFiles) != 3 {
		t.Fatalf("ocr model files = %+v", ocr.ModelFiles)
	}
	for _, file := range ocr.ModelFiles {
		if file.Location != AIStorageModelCache || !strings.HasPrefix(file.Path, "derived/ai/models/ocr/") {
			t.Fatalf("ocr model file is outside the derived cache: %+v", file)
		}
		if file.Name == "legacy-detector.onnx" {
			t.Fatalf("legacy Python package model was reported: %+v", file)
		}
	}
	if ocr.ModelBytes != ocrBytes {
		t.Fatalf("ocr model bytes = %d, want %d", ocr.ModelBytes, ocrBytes)
	}

	face := usage.Modules[3]
	if face.ModelBytes != yunetBytes+sfaceBytes+buffaloDetectorBytes+buffaloRecognizerBytes || len(face.Profiles) != 2 {
		t.Fatalf("face model bytes = %d", face.ModelBytes)
	}
	if face.Profiles[0].Model != FaceModelQualityV2 || face.Profiles[0].ModelBytes != yunetBytes+sfaceBytes || face.Profiles[1].Model != FaceModelBuffaloM || face.Profiles[1].ModelBytes != buffaloDetectorBytes+buffaloRecognizerBytes {
		t.Fatalf("face profiles = %+v", face.Profiles)
	}
	if face.ModelDirectory != "derived/ai/models/face" || face.Profiles[0].ModelDirectory != "derived/ai/models/face" || face.Profiles[1].ModelDirectory != "derived/ai/models/face/buffalo_m" {
		t.Fatalf("face model directories = module:%q profiles:%+v", face.ModelDirectory, face.Profiles)
	}
	if face.Profiles[0].Outputs[0].Path != "derived/metadata/face/quality-v2/batches" || face.Profiles[1].Outputs[0].Path != "derived/metadata/face/buffalo_m/batches" {
		t.Fatalf("face profile outputs = %+v", face.Profiles)
	}

	if usage.Summary.ModelBytes != clipBytes+yunetBytes+sfaceBytes+buffaloDetectorBytes+buffaloRecognizerBytes+ocrBytes {
		t.Fatalf("summary model bytes = %d", usage.Summary.ModelBytes)
	}
	if usage.Summary.OutputBytes != metadataBytes+vectorBytes+ocrIndexBytes+qualityIndexBytes+buffaloIndexBytes+qualityCorrectionsBytes+buffaloCorrectionsBytes {
		t.Fatalf("summary output bytes = %d", usage.Summary.OutputBytes)
	}
	if usage.Summary.OutputFileCount != 11 {
		t.Fatalf("summary output file count = %d, want 11", usage.Summary.OutputFileCount)
	}

	if usage.Paths.JobsFile != "state/ai_jobs.json" {
		t.Fatalf("jobs file = %q", usage.Paths.JobsFile)
	}
	if usage.Paths.MetadataDirectory != "derived/metadata" || usage.Paths.VectorDirectory != "derived/ai/vectors" {
		t.Fatalf("relative paths = %+v", usage.Paths)
	}

	// 绝对路径不能从对外的占用快照里漏出去。
	encoded, err := json.Marshal(usage)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), cacheRoot) || strings.Contains(string(encoded), workerDir) {
		t.Fatalf("usage payload leaked an absolute path: %s", encoded)
	}
}

func TestAIStorageUsageCachesUntilInvalidated(t *testing.T) {
	root := t.TempDir()
	cacheRoot := filepath.Join(root, "cache")
	batch := filepath.Join(cacheRoot, "derived", "metadata", AIJobTypeOCR, "batches", "job", "00000001.json")
	writeAIStorageFile(t, batch, "batch")

	service := NewAIStorageService(0)
	usage, _, err := service.Usage(cacheRoot)
	if err != nil {
		t.Fatal(err)
	}
	if usage.Summary.OutputBytes != int64(len("batch")) {
		t.Fatalf("output bytes = %d", usage.Summary.OutputBytes)
	}

	// TTL 内的第二次读取走缓存：文件变大也不立刻反映。
	writeAIStorageFile(t, batch, "batch-and-more")
	cached, _, err := service.Usage(cacheRoot)
	if err != nil {
		t.Fatal(err)
	}
	if cached.Summary.OutputBytes != usage.Summary.OutputBytes {
		t.Fatalf("cached output bytes = %d, want %d", cached.Summary.OutputBytes, usage.Summary.OutputBytes)
	}

	service.Invalidate()
	fresh, _, err := service.Usage(cacheRoot)
	if err != nil {
		t.Fatal(err)
	}
	if fresh.Summary.OutputBytes != int64(len("batch-and-more")) {
		t.Fatalf("fresh output bytes = %d", fresh.Summary.OutputBytes)
	}
}

func TestAIStorageAbsolutePathsExposeLocalLocations(t *testing.T) {
	root := t.TempDir()
	cacheRoot := filepath.Join(root, "cache")
	workerDir := filepath.Join(root, "backend", "aiworker")
	writeAIStorageFile(t, filepath.Join(cacheRoot, "derived", "ai", "models", ChineseCLIPModelFile), "clip-model")

	service := NewAIStorageService(0)
	paths := service.AbsolutePaths(AIStoragePathOptions{
		ConfigPath:       filepath.Join(root, "backend", "config.yaml"),
		WorkingDirectory: root,
		CacheRoot:        cacheRoot,
		WorkerDirectory:  workerDir,
		PythonPath:       filepath.Join(workerDir, ".venv", "Scripts", "python.exe"),
	})
	if paths.CacheRoot != cacheRoot {
		t.Fatalf("cache root = %q", paths.CacheRoot)
	}
	if paths.ConfigFile != filepath.Join(root, "backend", "config.yaml") {
		t.Fatalf("config file = %q", paths.ConfigFile)
	}
	if paths.JobsFile != filepath.Join(cacheRoot, "state", "ai_jobs.json") {
		t.Fatalf("jobs file = %q", paths.JobsFile)
	}
	if paths.PythonExecutable != filepath.Join(workerDir, ".venv", "Scripts", "python.exe") {
		t.Fatalf("python executable = %q", paths.PythonExecutable)
	}
	if len(paths.Modules) != 6 {
		t.Fatalf("module count = %d", len(paths.Modules))
	}
	var clip *AIStorageAbsoluteFile
	for index := range paths.Modules[1].ModelFiles {
		file := paths.Modules[1].ModelFiles[index]
		if file.Name == ChineseCLIPModelFile {
			clip = &file
		}
	}
	if clip == nil || !clip.Exists || clip.SizeBytes != int64(len("clip-model")) {
		t.Fatalf("clip model file = %+v", clip)
	}
}
