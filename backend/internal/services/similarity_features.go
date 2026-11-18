package services

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	"io"
	"math"
	"math/bits"
	"os"
	"sort"
	"sync"

	"github.com/disintegration/imaging"
)

// 相似照片整理的本地特征提取。
//
// 这一层只做「把一张照片变成几个可比较的数」：内容指纹、感知哈希和
// 质量指标。它不读磁盘以外的任何东西，也不依赖本机 AI Worker，
// 因此可以在没有 Python 环境的机器上跑完整个整理流程。

const (
	// SimilarityAnalyzerVersion 是相似照片特征模块的版本。
	// 算法或阈值变化时递增，旧版本的结果会被判为过期并自动重算。
	SimilarityAnalyzerVersion = "phash-dhash-crop-v1"

	// AIFieldSimilarity 是相似照片模块在单条结果里报告的字段标识。
	AIFieldSimilarity = "similarity"

	// similarityAnalysisMaxBytes 是单张照片进入特征分析的字节上限。
	// 超过上限的文件按「无法分析」记失败，不占用解码内存。
	similarityAnalysisMaxBytes = 512 << 20

	// similarityHashSide 是感知哈希（DCT）使用的正方形边长。
	similarityHashSide = 32

	// similarityHashBlocks 是感知哈希保留的低频系数边长（8×8 = 64 位）。
	similarityHashBlocks = 8

	// similarityQualitySide 是清晰度与曝光评估使用的灰度副本长边。
	// 所有照片都折算到同一尺寸再比较，不同分辨率的照片因此可比。
	similarityQualitySide = 1024

	// similarityAnalysisWorkers 是特征提取的并发数。
	// 解码一张千万像素的照片要几十兆内存，这个上限是内存与速度的折中。
	similarityAnalysisWorkers = 2

	// similarityDifferenceHashWidth 是差分哈希的宽度（比高度多一列）。
	similarityDifferenceHashWidth = similarityHashBlocks + 1
)

// similarityCropScales 是中心裁切哈希的缩放档位。
//
// 裁切过的同源照片，其中心区域仍与原图的某个档位对应；把中心区域
// 各算一遍哈希，才能把「裁过一点」的照片召回到候选里。
var similarityCropScales = []float64{1.0, 0.8, 0.6}

// SimilarityFeature 是单张照片的可重建特征。
//
// 特征分三部分：
//   - 内容指纹（SHA-256）判定文件是否完全一致；
//   - 感知哈希（整幅与中心裁切档位）判定画面是否近似；
//   - 质量指标用于给代表照片排序，与文件大小无关。
type SimilarityFeature struct {
	// SHA256 是文件内容的摘要，完全相同的文件必然相同。
	SHA256 string `json:"sha256"`
	// PHash 是整幅画面的 64 位 DCT 感知哈希。
	PHash uint64 `json:"phash"`
	// DHash 是 64 位横向差分哈希，对亮度变化更敏感。
	DHash uint64 `json:"dhash"`
	// Crops 是中心裁切档位的感知哈希，顺序与 similarityCropScales 一致。
	Crops []uint64 `json:"crops"`
	// Width / Height 是原图像素尺寸。
	Width  int `json:"width"`
	Height int `json:"height"`
	// Sharpness 是拉普拉斯响应的方差，越大越锐。
	Sharpness float64 `json:"sharpness"`
	// Exposure 是灰度均值，0 为全黑、1 为全白。
	Exposure float64 `json:"exposure"`
	// ClippedHigh / ClippedLow 是接近全白与接近全黑的像素占比。
	ClippedHigh float64 `json:"clippedHigh"`
	ClippedLow  float64 `json:"clippedLow"`
}

// SimilarityAnalyzer 在本机提取相似照片比对需要的特征。
//
// 它实现 AIAnalyzerBatch：一批照片一起提交，转换后的临时文件路径
// 由任务系统给出（HEIC/HEIF 需要先转成 JPEG 才能解码）。
type SimilarityAnalyzer struct{}

// Type 返回分析模块类型。
func (SimilarityAnalyzer) Type() string { return AIJobTypeSimilarity }

// Version 返回模块版本，版本变化会让旧结果整体失效。
func (SimilarityAnalyzer) Version() string { return SimilarityAnalyzerVersion }

// MaxWorkers 限制并发解码的内存占用。
func (SimilarityAnalyzer) MaxWorkers() int { return similarityAnalysisWorkers }

// Analyze 计算单张照片的特征。
func (a SimilarityAnalyzer) Analyze(ctx context.Context, reader io.ReadSeeker) (AIAnalysisOutput, error) {
	data, err := readLimited(reader, similarityAnalysisMaxBytes)
	if err != nil {
		return AIAnalysisOutput{Status: "failed", ErrorCode: "source_unavailable", ErrorMessage: "无法读取图片内容"}, nil
	}
	return similarityOutputForBytes(ctx, data), nil
}

// AnalyzeBatch 批量计算特征。批内并发受 MaxWorkers 限制。
func (a SimilarityAnalyzer) AnalyzeBatch(ctx context.Context, inputs []AIAnalysisInput) ([]AIAnalysisOutput, error) {
	outputs := make([]AIAnalysisOutput, len(inputs))
	workers := min(similarityAnalysisWorkers, len(inputs))
	if workers <= 0 {
		return outputs, nil
	}
	queue := make(chan int)
	var wg sync.WaitGroup
	for worker := 0; worker < workers; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for index := range queue {
				outputs[index] = similarityOutputForInput(ctx, inputs[index])
			}
		}()
	}
	for index := range inputs {
		select {
		case <-ctx.Done():
			close(queue)
			wg.Wait()
			return outputs, ctx.Err()
		case queue <- index:
		}
	}
	close(queue)
	wg.Wait()
	return outputs, nil
}

// similarityOutputForInput 读取一张照片并算出它的特征。
func similarityOutputForInput(ctx context.Context, input AIAnalysisInput) AIAnalysisOutput {
	path := input.Path
	if input.AnalysisPath != "" {
		path = input.AnalysisPath
	}
	file, err := os.Open(path)
	if err != nil {
		return AIAnalysisOutput{Status: "failed", ErrorCode: "source_unavailable", ErrorMessage: "无法读取图片内容"}
	}
	defer file.Close()
	data, err := readLimited(file, similarityAnalysisMaxBytes)
	if err != nil {
		return AIAnalysisOutput{Status: "failed", ErrorCode: "source_unavailable", ErrorMessage: "无法读取图片内容"}
	}
	return similarityOutputForBytes(ctx, data)
}

// similarityOutputForBytes 解码图片并打包特征。
func similarityOutputForBytes(ctx context.Context, data []byte) AIAnalysisOutput {
	if ctx.Err() != nil {
		return AIAnalysisOutput{Status: "failed", ErrorCode: "analysis_cancelled", ErrorMessage: "任务已取消"}
	}
	feature, err := computeSimilarityFeature(data)
	if err != nil {
		return AIAnalysisOutput{Status: "failed", ErrorCode: "unsupported", ErrorMessage: "图片无法解码，已跳过"}
	}
	payload, err := json.Marshal(feature)
	if err != nil {
		return AIAnalysisOutput{Status: "failed", ErrorCode: "analysis_failed", ErrorMessage: "特征序列化失败"}
	}
	return AIAnalysisOutput{Status: "processed", Data: payload, Fields: []string{AIFieldSimilarity}}
}

// readLimited 读取一个文件，超过上限就停下。
func readLimited(reader io.Reader, limit int64) ([]byte, error) {
	buffer := make([]byte, 0, 64*1024)
	chunk := make([]byte, 64*1024)
	for {
		read, err := reader.Read(chunk)
		if read > 0 {
			if int64(len(buffer))+int64(read) > limit {
				return nil, errors.New("image exceeds the analysis size limit")
			}
			buffer = append(buffer, chunk[:read]...)
		}
		if err == io.EOF {
			return buffer, nil
		}
		if err != nil {
			return nil, err
		}
	}
}

// computeSimilarityFeature 从图片字节算出全部特征。
func computeSimilarityFeature(data []byte) (SimilarityFeature, error) {
	if len(data) == 0 {
		return SimilarityFeature{}, errors.New("empty image")
	}
	sum := sha256.Sum256(data)
	// 自动应用 EXIF 方向：同一张照片被不同软件存过，方向标记可能不同，
	// 不归一化的话感知哈希会完全不同。
	img, err := imaging.Decode(bytes.NewReader(data), imaging.AutoOrientation(true))
	if err != nil {
		return SimilarityFeature{}, err
	}
	bounds := img.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width <= 0 || height <= 0 {
		return SimilarityFeature{}, errors.New("image has no pixels")
	}
	feature := SimilarityFeature{
		SHA256: hex.EncodeToString(sum[:]),
		Width:  width,
		Height: height,
	}
	// 所有哈希与质量指标都基于长边折算到 similarityQualitySide 的灰度副本，
	// 这样不同分辨率、不同尺寸的照片之间仍然可比。
	work := imaging.Resize(img, similarityQualitySide, similarityQualitySide, imaging.Lanczos)
	gray := imaging.Grayscale(work)
	feature.PHash = perceptionHash(gray)
	feature.DHash = differenceHash(gray)
	feature.Crops = make([]uint64, 0, len(similarityCropScales))
	for _, scale := range similarityCropScales {
		feature.Crops = append(feature.Crops, perceptionHash(centerCropGray(gray, scale)))
	}
	feature.Sharpness, feature.Exposure, feature.ClippedHigh, feature.ClippedLow = qualityMetrics(gray)
	return feature, nil
}

// centerCropGray 取出居中的比例区域。
func centerCropGray(gray *image.NRGBA, scale float64) *image.NRGBA {
	if scale >= 1 {
		return gray
	}
	bounds := gray.Bounds()
	width := int(float64(bounds.Dx()) * scale)
	height := int(float64(bounds.Dy()) * scale)
	if width < similarityHashSide || height < similarityHashSide {
		return gray
	}
	offsetX := bounds.Min.X + (bounds.Dx()-width)/2
	offsetY := bounds.Min.Y + (bounds.Dy()-height)/2
	cropped := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			cropped.SetNRGBA(x, y, gray.NRGBAAt(offsetX+x, offsetY+y))
		}
	}
	return cropped
}

// dctCosines 是 DCT-II 用的余弦表。
var dctCosines = func() [similarityHashSide][similarityHashSide]float64 {
	var table [similarityHashSide][similarityHashSide]float64
	for u := 0; u < similarityHashSide; u++ {
		for x := 0; x < similarityHashSide; x++ {
			table[u][x] = math.Cos(float64(2*x+1) * float64(u) * math.Pi / (2 * similarityHashSide))
		}
	}
	return table
}()

// perceptionHash 计算 64 位 DCT 感知哈希。
//
// 做法是把画面缩到 32×32、做二维 DCT，取左上 8×8 的低频系数，
// 与这 64 个系数的中位数比较得到 64 位。低频部分描述的是画面的
// 明暗结构，对压缩、缩放与轻微调色都不敏感。
func perceptionHash(gray *image.NRGBA) uint64 {
	small := imaging.Resize(gray, similarityHashSide, similarityHashSide, imaging.Lanczos)
	coefficients := dctBlock(small, similarityHashBlocks)
	values := make([]float64, 0, len(coefficients))
	for _, value := range coefficients {
		values = append(values, value)
	}
	sort.Float64s(values)
	median := values[len(values)/2]
	var hash uint64
	for index, value := range coefficients {
		if value > median {
			hash |= 1 << uint(63-index)
		}
	}
	return hash
}

// dctBlock 对灰度图做二维 DCT-II，返回左上 blocks×blocks 的系数。
func dctBlock(gray *image.NRGBA, blocks int) []float64 {
	size := similarityHashSide
	rows := make([][]float64, size)
	for y := 0; y < size; y++ {
		row := make([]float64, size)
		for x := 0; x < size; x++ {
			row[x] = float64(gray.NRGBAAt(x, y).R)
		}
		rows[y] = row
	}
	// 先沿行做一维变换，再沿列做一次。
	temporary := make([][]float64, size)
	for y := range temporary {
		temporary[y] = make([]float64, size)
	}
	for y := 0; y < size; y++ {
		for u := 0; u < size; u++ {
			sum := 0.0
			for x := 0; x < size; x++ {
				sum += rows[y][x] * dctCosines[u][x]
			}
			temporary[y][u] = sum * dctScale(u, size)
		}
	}
	result := make([]float64, 0, blocks*blocks)
	for v := 0; v < blocks; v++ {
		for u := 0; u < blocks; u++ {
			sum := 0.0
			for y := 0; y < size; y++ {
				sum += temporary[y][u] * dctCosines[v][y]
			}
			result = append(result, sum*dctScale(v, size))
		}
	}
	return result
}

// dctScale 是 DCT-II 的归一化系数。
func dctScale(index, size int) float64 {
	if index == 0 {
		return math.Sqrt(1 / float64(size))
	}
	return math.Sqrt(2 / float64(size))
}

// differenceHash 计算 64 位横向差分哈希。
//
// 相邻像素谁更亮构成一位，因此它对整体亮度变化敏感、对压缩稳定，
// 与感知哈希互补。
func differenceHash(gray *image.NRGBA) uint64 {
	scaled := imaging.Resize(gray, similarityDifferenceHashWidth, similarityHashBlocks, imaging.Lanczos)
	var hash uint64
	bit := 0
	for y := 0; y < similarityHashBlocks; y++ {
		for x := 0; x < similarityHashBlocks; x++ {
			left := scaled.NRGBAAt(x, y).R
			right := scaled.NRGBAAt(x+1, y).R
			if left > right {
				hash |= 1 << uint(63-bit)
			}
			bit++
		}
	}
	return hash
}

// qualityMetrics 在折算尺寸的灰度副本上计算清晰度与曝光。
//
// 清晰度取 3×3 拉普拉斯响应的方差：越锐，响应越大。
// 曝光取灰度均值，并统计接近全白与接近全黑的像素占比。
func qualityMetrics(gray *image.NRGBA) (sharpness, exposure, clippedHigh, clippedLow float64) {
	bounds := gray.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width < 3 || height < 3 {
		return 0, 0, 0, 0
	}
	sum := 0.0
	high, low := 0, 0
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			value := float64(gray.NRGBAAt(x, y).R)
			sum += value
			if value >= 250 {
				high++
			}
			if value <= 5 {
				low++
			}
		}
	}
	total := float64(width * height)
	exposure = sum / total / 255
	clippedHigh = float64(high) / total
	clippedLow = float64(low) / total
	sharpness = laplacianVariance(gray)
	return sharpness, exposure, clippedHigh, clippedLow
}

// laplacianVariance 计算 3×3 拉普拉斯响应的方差。
func laplacianVariance(gray *image.NRGBA) float64 {
	bounds := gray.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width < 3 || height < 3 {
		return 0
	}
	values := make([]float64, 0, width*height)
	for y := bounds.Min.Y + 1; y < bounds.Max.Y-1; y++ {
		for x := bounds.Min.X + 1; x < bounds.Max.X-1; x++ {
			center := float64(gray.NRGBAAt(x, y).R)
			response := 4*center -
				float64(gray.NRGBAAt(x-1, y).R) -
				float64(gray.NRGBAAt(x+1, y).R) -
				float64(gray.NRGBAAt(x, y-1).R) -
				float64(gray.NRGBAAt(x, y+1).R)
			values = append(values, response)
		}
	}
	if len(values) == 0 {
		return 0
	}
	mean := 0.0
	for _, value := range values {
		mean += value
	}
	mean /= float64(len(values))
	variance := 0.0
	for _, value := range values {
		difference := value - mean
		variance += difference * difference
	}
	return variance / float64(len(values))
}

// SimilarityFeatureFromRecord 从分析结果里取回特征。
func SimilarityFeatureFromRecord(record AIAnalysisRecord) (SimilarityFeature, bool) {
	if record.Status != "processed" || len(record.Data) == 0 {
		return SimilarityFeature{}, false
	}
	var feature SimilarityFeature
	if err := json.Unmarshal(record.Data, &feature); err != nil {
		return SimilarityFeature{}, false
	}
	if feature.SHA256 == "" {
		return SimilarityFeature{}, false
	}
	return feature, true
}

// similarityHashDistance 返回两个 64 位哈希的汉明距离。
func similarityHashDistance(left, right uint64) int {
	return bits.OnesCount64(left ^ right)
}

// similarityQualityScore 把质量指标折算成 0～1 的代表评分。
//
// 权重：清晰度 0.45、分辨率 0.25、曝光 0.30。
// 三个分项各自可解释，界面上会把它们分别摆出来，
// 不让一个总分变成黑箱。
func similarityQualityScore(feature SimilarityFeature) SimilarityQuality {
	quality := SimilarityQuality{}
	quality.Sharpness = feature.Sharpness
	quality.Exposure = feature.Exposure
	quality.ClippedHigh = feature.ClippedHigh
	quality.ClippedLow = feature.ClippedLow
	quality.Megapixels = float64(feature.Width) * float64(feature.Height) / 1e6
	quality.SharpnessScore = similaritySharpnessScore(feature.Sharpness)
	quality.ResolutionScore = similarityResolutionScore(quality.Megapixels)
	quality.ExposureScore = similarityExposureScore(feature)
	quality.Score = 0.45*quality.SharpnessScore + 0.25*quality.ResolutionScore + 0.30*quality.ExposureScore
	return quality
}

// similaritySharpnessScore 把拉普拉斯方差折算成 0～1。
//
// 方差随分辨率与噪声变化很大，取对数后在大致 0～4000 的区间里铺开。
func similaritySharpnessScore(variance float64) float64 {
	if variance <= 0 {
		return 0
	}
	score := math.Log10(1+variance) / math.Log10(1+4000)
	return math.Min(1, math.Max(0, score))
}

// similarityResolutionScore 把像素数折算成 0～1。
func similarityResolutionScore(megapixels float64) float64 {
	if megapixels <= 0 {
		return 0
	}
	score := math.Log10(megapixels) / math.Log10(48)
	return math.Min(1, math.Max(0, score))
}

// similarityExposureScore 按过曝、欠曝与中间调偏离给曝光打分。
func similarityExposureScore(feature SimilarityFeature) float64 {
	clipping := feature.ClippedHigh + feature.ClippedLow
	penalty := math.Min(1, clipping*4)
	penalty += math.Abs(feature.Exposure-0.45) * 0.8
	return math.Min(1, math.Max(0, 1-penalty))
}

// SimilarityQuality 是一张照片的质量分项。
type SimilarityQuality struct {
	// Sharpness 是拉普拉斯响应的方差。
	Sharpness float64 `json:"sharpness"`
	// SharpnessScore 是清晰度分项，0～1。
	SharpnessScore float64 `json:"sharpnessScore"`
	// Megapixels 是原图百万像素数。
	Megapixels float64 `json:"megapixels"`
	// ResolutionScore 是分辨率分项，0～1。
	ResolutionScore float64 `json:"resolutionScore"`
	// Exposure 是灰度均值，0～1。
	Exposure float64 `json:"exposure"`
	// ClippedHigh / ClippedLow 是过曝与欠曝像素占比。
	ClippedHigh float64 `json:"clippedHigh"`
	ClippedLow  float64 `json:"clippedLow"`
	// ExposureScore 是曝光分项，0～1。
	ExposureScore float64 `json:"exposureScore"`
	// Score 是代表评分，0～1。
	Score float64 `json:"score"`
}

// formatSimilarityFeatureError 把解码失败归一成可公开的原因。
