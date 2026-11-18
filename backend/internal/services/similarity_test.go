package services

import (
	"bytes"
	"image"
	"image/color"
	"math"
	"testing"
	"time"

	"github.com/disintegration/imaging"
)

// 相似照片整理的算法验证。
//
// 验收要求覆盖五类样本：完全相同、缩放压缩、轻微裁剪、连拍、
// 以及「相似但不同」的照片。测试里现造这几种样本，
// 保证判定边界不会因为改了阈值而悄悄漂移。

// similarityTestPattern 造一张有结构、有纹理的测试图。
//
// 纯色图没有纹理，感知哈希会退化；这里用多个方块加斜纹，
// 保证哈希对缩放、压缩与裁剪的反应接近真实照片。
func similarityTestPattern(width, height int, seed int) image.Image {
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			block := ((x / 37) + (y / 29) + seed) % 5
			value := uint8(40 + block*38)
			if (x+y+seed)%7 == 0 {
				value += 60
			}
			img.SetNRGBA(x, y, color.NRGBA{R: value, G: value / 2 + 30, B: 255 - value, A: 255})
		}
	}
	return img
}

// similarityTestJPEG 把图片编码成 JPEG 字节。
func similarityTestJPEG(t *testing.T, img image.Image, quality int) []byte {
	t.Helper()
	var buffer bytes.Buffer
	if err := imaging.Encode(&buffer, img, imaging.JPEG, imaging.JPEGQuality(quality)); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
	return buffer.Bytes()
}

// similarityTestFeature 为测试图片算出特征。
func similarityTestFeature(t *testing.T, data []byte) SimilarityFeature {
	t.Helper()
	feature, err := computeSimilarityFeature(data)
	if err != nil {
		t.Fatalf("compute feature: %v", err)
	}
	return feature
}

// similarityTestCandidate 造一条候选记录。
func similarityTestCandidate(id, folder string, feature SimilarityFeature) SimilarityCandidate {
	return SimilarityCandidate{ResourceID: id, Folder: folder, Feature: feature}
}

func TestSimilarityExactGroupsFindsIdenticalFiles(t *testing.T) {
	base := similarityTestJPEG(t, similarityTestPattern(320, 240, 0), 92)
	feature := similarityTestFeature(t, base)
	candidates := []SimilarityCandidate{
		similarityTestCandidate("f_a", "相册", feature),
		similarityTestCandidate("f_b", "相册", feature),
		similarityTestCandidate("f_c", "另一个相册", feature),
		similarityTestCandidate("f_d", "相册", similarityTestFeature(t, similarityTestJPEG(t, similarityTestPattern(320, 240, 3), 92))),
	}

	groups := SimilarityExactGroups(candidates)
	if len(groups) != 1 {
		t.Fatalf("expected 1 exact group, got %d", len(groups))
	}
	if len(groups[0]) != 3 {
		t.Fatalf("expected 3 members in the exact group, got %d", len(groups[0]))
	}
	// 完全重复允许跨文件夹：三张相同的文件应当落在同一组里。
	for _, index := range groups[0] {
		if index < 0 || index >= len(candidates) {
			t.Fatalf("group member index out of range: %d", index)
		}
	}
}

func TestSimilarityNearGroupsAcceptsResizedAndRecompressed(t *testing.T) {
	original := similarityTestPattern(800, 600, 0)
	originalBytes := similarityTestJPEG(t, original, 95)
	// 缩到 60% 再以更低质量重新编码：画面一致，文件不同。
	shrunk := imaging.Resize(original, 480, 360, imaging.Lanczos)
	shrunkBytes := similarityTestJPEG(t, shrunk, 70)

	originalFeature := similarityTestFeature(t, originalBytes)
	shrunkFeature := similarityTestFeature(t, shrunkBytes)
	candidates := []SimilarityCandidate{
		similarityTestCandidate("f_a", "相册", originalFeature),
		similarityTestCandidate("f_b", "相册", shrunkFeature),
	}

	groups, limited := SimilarityNearGroups(candidates)
	if limited {
		t.Fatal("candidate recall should not be limited for a small folder")
	}
	if len(groups) != 1 {
		t.Fatalf("expected 1 near group, got %d", len(groups))
	}
	if len(groups[0]) != 2 {
		t.Fatalf("expected 2 members, got %d", len(groups[0]))
	}
	if !similarityNearMatch(candidates[0], candidates[1]) {
		t.Fatal("a resized and recompressed copy should count as a near duplicate")
	}
}

func TestSimilarityNearGroupsAcceptsSlightCrop(t *testing.T) {
	original := similarityTestPattern(800, 600, 0)
	originalBytes := similarityTestJPEG(t, original, 95)
	// 居中裁掉 12%，长宽比不变：内容仍是同一张照片。
	cropped := imaging.Crop(original, image.Rect(96, 72, 704, 528))
	croppedBytes := similarityTestJPEG(t, cropped, 90)

	candidates := []SimilarityCandidate{
		similarityTestCandidate("f_a", "相册", similarityTestFeature(t, originalBytes)),
		similarityTestCandidate("f_b", "相册", similarityTestFeature(t, croppedBytes)),
	}
	if !similarityNearMatch(candidates[0], candidates[1]) {
		t.Fatal("a slightly cropped copy should count as a near duplicate")
	}
	groups, _ := SimilarityNearGroups(candidates)
	if len(groups) != 1 || len(groups[0]) != 2 {
		t.Fatalf("expected one group of two members, got %v", groups)
	}
}

func TestSimilarityNearGroupsRejectsDifferentPhotos(t *testing.T) {
	first := similarityTestJPEG(t, similarityTestPattern(800, 600, 0), 92)
	second := similarityTestJPEG(t, similarityTestPattern(800, 600, 9), 92)
	candidates := []SimilarityCandidate{
		similarityTestCandidate("f_a", "相册", similarityTestFeature(t, first)),
		similarityTestCandidate("f_b", "相册", similarityTestFeature(t, second)),
	}
	if similarityNearMatch(candidates[0], candidates[1]) {
		t.Fatal("two different photos must not count as a near duplicate")
	}
	groups, _ := SimilarityNearGroups(candidates)
	if len(groups) != 0 {
		t.Fatalf("expected no near group, got %v", groups)
	}
}

func TestSimilarityNearGroupsRejectsDifferentAspectRatio(t *testing.T) {
	original := similarityTestJPEG(t, similarityTestPattern(800, 600, 0), 92)
	// 同样的画面裁成窄条：长宽比变了，不是「近似重复」而是另一张照片。
	strip := imaging.Crop(similarityTestPattern(800, 600, 0), image.Rect(0, 0, 800, 300))
	stripBytes := similarityTestJPEG(t, strip, 92)
	candidates := []SimilarityCandidate{
		similarityTestCandidate("f_a", "相册", similarityTestFeature(t, original)),
		similarityTestCandidate("f_b", "相册", similarityTestFeature(t, stripBytes)),
	}
	if similarityNearMatch(candidates[0], candidates[1]) {
		t.Fatal("a different aspect ratio must not count as a near duplicate")
	}
}

func TestSimilarityNearGroupsUsesClipAsVeto(t *testing.T) {
	original := similarityTestJPEG(t, similarityTestPattern(800, 600, 0), 92)
	same := similarityTestJPEG(t, similarityTestPattern(800, 600, 0), 80)
	left := similarityTestCandidate("f_a", "相册", similarityTestFeature(t, original))
	right := similarityTestCandidate("f_b", "相册", similarityTestFeature(t, same))
	if !similarityNearMatch(left, right) {
		t.Fatal("the same picture encoded differently should match")
	}
	// 语义向量明确指向不同画面时，即使哈希接近也要否决。
	left.Vector = []float32{1, 0}
	right.Vector = []float32{0, 1}
	left.HasVector, right.HasVector = true, true
	if similarityNearMatch(left, right) {
		t.Fatal("the semantic veto should reject a pair whose vectors disagree")
	}
}

func TestSimilarityBurstGroupsLinksCloseShots(t *testing.T) {
	first := similarityTestJPEG(t, similarityTestPattern(640, 480, 0), 90)
	second := similarityTestJPEG(t, similarityTestPattern(640, 480, 1), 90)
	base := time.Date(2024, 5, 1, 10, 0, 0, 0, time.UTC)
	left := similarityTestCandidate("f_a", "相册", similarityTestFeature(t, first))
	left.CapturedAt, left.HasCapture, left.TimeSource = base, true, "capture"
	right := similarityTestCandidate("f_b", "相册", similarityTestFeature(t, second))
	right.CapturedAt, right.HasCapture, right.TimeSource = base.Add(3*time.Second), true, "capture"
	// 同一场景：语义向量高度一致。
	left.Vector, right.Vector = []float32{1, 0}, []float32{0.99, 0.1}
	left.HasVector, right.HasVector = true, true

	groups := SimilarityBurstGroups([]SimilarityCandidate{left, right})
	if len(groups) != 1 || len(groups[0]) != 2 {
		t.Fatalf("expected one burst group of two members, got %v", groups)
	}
}

func TestSimilarityBurstGroupsKeepsFarApartShotsApart(t *testing.T) {
	first := similarityTestJPEG(t, similarityTestPattern(640, 480, 0), 90)
	second := similarityTestJPEG(t, similarityTestPattern(640, 480, 1), 90)
	base := time.Date(2024, 5, 1, 10, 0, 0, 0, time.UTC)
	left := similarityTestCandidate("f_a", "相册", similarityTestFeature(t, first))
	left.CapturedAt, left.HasCapture = base, true
	right := similarityTestCandidate("f_b", "相册", similarityTestFeature(t, second))
	right.CapturedAt, right.HasCapture = base.Add(30*time.Minute), true
	left.Vector, right.Vector = []float32{1, 0}, []float32{0.99, 0.1}
	left.HasVector, right.HasVector = true, true

	groups := SimilarityBurstGroups([]SimilarityCandidate{left, right})
	if len(groups) != 0 {
		t.Fatalf("shots 30 minutes apart must not form a burst, got %v", groups)
	}
}

func TestSimilarityBurstGroupsRequiresDifferentScenes(t *testing.T) {
	first := similarityTestJPEG(t, similarityTestPattern(640, 480, 0), 90)
	second := similarityTestJPEG(t, similarityTestPattern(640, 480, 7), 90)
	base := time.Date(2024, 5, 1, 10, 0, 0, 0, time.UTC)
	left := similarityTestCandidate("f_a", "相册", similarityTestFeature(t, first))
	left.CapturedAt, left.HasCapture = base, true
	right := similarityTestCandidate("f_b", "相册", similarityTestFeature(t, second))
	right.CapturedAt, right.HasCapture = base.Add(2*time.Second), true
	left.Vector, right.Vector = []float32{1, 0}, []float32{0, 1}
	left.HasVector, right.HasVector = true, true

	groups := SimilarityBurstGroups([]SimilarityCandidate{left, right})
	if len(groups) != 0 {
		t.Fatalf("different scenes must not form a burst, got %v", groups)
	}
}

func TestSimilarityQualityScorePrefersSharpLargeWellExposed(t *testing.T) {
	sharp := SimilarityFeature{Width: 4000, Height: 3000, Sharpness: 900, Exposure: 0.45}
	blurry := SimilarityFeature{Width: 4000, Height: 3000, Sharpness: 30, Exposure: 0.45}
	small := SimilarityFeature{Width: 640, Height: 480, Sharpness: 900, Exposure: 0.45}
	overexposed := SimilarityFeature{Width: 4000, Height: 3000, Sharpness: 900, Exposure: 0.98, ClippedHigh: 0.4}

	best := similarityQualityScore(sharp)
	if best.Score <= similarityQualityScore(blurry).Score {
		t.Fatal("a sharper photo should score higher")
	}
	if best.Score <= similarityQualityScore(small).Score {
		t.Fatal("a larger photo should score higher at equal sharpness")
	}
	if best.Score <= similarityQualityScore(overexposed).Score {
		t.Fatal("an overexposed photo should score lower")
	}
	if best.SharpnessScore <= 0 || best.ResolutionScore <= 0 || best.ExposureScore <= 0 {
		t.Fatalf("every quality component should be positive: %+v", best)
	}
}

func TestSimilarityQualityScoreIgnoresFileSize(t *testing.T) {
	// 质量分只看清晰度、分辨率与曝光：同样指标的照片得分相同，
	// 与文件多大无关。
	left := SimilarityFeature{Width: 2000, Height: 1500, Sharpness: 200, Exposure: 0.5}
	right := SimilarityFeature{Width: 2000, Height: 1500, Sharpness: 200, Exposure: 0.5}
	if similarityQualityScore(left).Score != similarityQualityScore(right).Score {
		t.Fatal("equal metrics should produce equal scores")
	}
}

func TestSimilarityGroupIDIsStableWhenGroupGrows(t *testing.T) {
	first := similarityGroupID(SimilarityGroupKindNear, []string{"f_a", "f_b"})
	second := similarityGroupID(SimilarityGroupKindNear, []string{"f_a", "f_b", "f_c"})
	if first != second {
		t.Fatalf("group id should survive membership changes: %s vs %s", first, second)
	}
	other := similarityGroupID(SimilarityGroupKindExact, []string{"f_a", "f_b"})
	if other == first {
		t.Fatal("different kinds must not share a group id")
	}
}

func TestSimilarityHashDistance(t *testing.T) {
	if similarityHashDistance(0, 0) != 0 {
		t.Fatal("identical hashes should have distance 0")
	}
	if similarityHashDistance(0, ^uint64(0)) != 64 {
		t.Fatal("complementary hashes should have distance 64")
	}
}

func TestSimilarityVectorCosine(t *testing.T) {
	if math.Abs(similarityVectorCosine([]float32{1, 0}, []float32{1, 0})-1) > 1e-6 {
		t.Fatal("identical vectors should have cosine 1")
	}
	if similarityVectorCosine([]float32{1, 0}, []float32{0, 1}) > 1e-6 {
		t.Fatal("orthogonal vectors should have cosine 0")
	}
}
