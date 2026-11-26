package services

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"path/filepath"
	"testing"
)

func TestPortraitVerificationRejectsOtherFacesAndAmbiguity(t *testing.T) {
	f := PersonFace{recordHash: "original", Box: []float32{10, 20, 40, 50}, embedding: []float32{1, 0}}
	other := detectedPortrait{Box: f.Box, Embedding: []float32{0, 1}}
	upright := detectedPortrait{Box: []float32{300, 80, 40, 50}, Embedding: []float32{1, 0}, PortraitQuality: 0.9, EyeCenter: []float32{320, 96}}
	if got := verifyPortrait(f, []detectedPortrait{other, upright}); len(got.Box) != 4 || got.Box[0] != 300 || got.Eyes[0] != 320 {
		t.Fatalf("wrong face: %+v", got)
	}
	if got := verifyPortrait(f, []detectedPortrait{other}); got.Box != nil {
		t.Fatal("accepted another person")
	}
	if got := verifyPortrait(f, []detectedPortrait{upright, upright}); got.Box != nil {
		t.Fatal("accepted ambiguous match")
	}
}
func TestPortraitCorrectionAndFallback(t *testing.T) {
	dir := t.TempDir()
	state, index := filepath.Join(dir, "state.json"), filepath.Join(dir, "index.json")
	records := []AIAnalysisRecord{
		peopleCoverFaceRecord("a", [][]float32{{10, 10, 90, 90}}, [][]float32{peopleTestVector(0, 0)}),
		peopleCoverFaceRecord("b", [][]float32{{20, 10, 500, 500}}, [][]float32{peopleTestVector(0, 0)})}
	open := func() *PeopleService {
		p, err := OpenPeopleService(state, index)
		if err != nil {
			t.Fatal(err)
		}
		if err = p.Sync(records); err != nil {
			t.Fatal(err)
		}
		return p
	}
	p := open()
	groups, _ := p.TopGroups(1, false, nil)
	id := groups[0].ID
	if err := p.SetPortrait(id, PersonFaceKey("a", 0)); err != nil {
		t.Fatal(err)
	}
	p = open()
	g, _, _ := p.GroupAndFaces(id)
	if g.CoverResourceID != "a" || g.PortraitURL == "" {
		t.Fatal("manual portrait did not survive restart")
	}
	if err := p.SetPortrait(id, "foreign"); err == nil {
		t.Fatal("accepted unknown face")
	}
	f := p.faces[PersonFaceKey("a", 0)]
	p.portraits = map[string]portraitEvidence{f.Key: {Hash: f.recordHash}}
	g, _, _ = p.GroupAndFaces(id)
	if g.CoverResourceID != "b" {
		t.Fatal("invalid manual choice blocks fallback")
	}
	if err := p.SetPortrait(id, ""); err != nil {
		t.Fatal(err)
	}
}
func TestPortraitImageUsesUprightCoordinatesAndCurrentFile(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 160, 96))
	for y := 0; y < 96; y++ {
		for x := 0; x < 160; x++ {
			c := color.RGBA{0, 0, 200, 255}
			if x < 64 && y < 55 {
				c = color.RGBA{220, 0, 0, 255}
			}
			src.SetRGBA(x, y, c)
		}
	}
	var raw bytes.Buffer
	if err := jpeg.Encode(&raw, src, nil); err != nil {
		t.Fatal(err)
	}
	// TIFF 小端方向标记。源图左上角色块经镜像、旋转后仍须被人脸框准确裁出。
	for _, sample := range []struct {
		orientation byte
		x, y        float32
	}{{1, 26, 22}, {2, 130, 22}, {3, 130, 70}, {6, 70, 26}, {8, 22, 130}} {
		exif := []byte{0xff, 0xe1, 0, 34, 'E', 'x', 'i', 'f', 0, 0, 'I', 'I', 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, sample.orientation, 0, 0, 0, 0, 0, 0, 0}
		data := append([]byte{0xff, 0xd8}, exif...)
		data = append(data, raw.Bytes()[2:]...)
		path := filepath.Join(t.TempDir(), "photo.jpg")
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
		stat, _ := os.Stat(path)
		thumbs, err := NewThumbnailService(ThumbnailOptions{CacheDir: t.TempDir()})
		if err != nil {
			t.Fatal(err)
		}
		f := PersonFace{Size: stat.Size(), MTimeNs: stat.ModTime().UnixNano(), Box: []float32{sample.x - 8, sample.y - 8, 16, 16}}
		for _, size := range []int{160, 320} {
			encoded, err := thumbs.Portrait(path, f, size)
			if err != nil {
				t.Fatal(err)
			}
			img, err := jpeg.Decode(bytes.NewReader(encoded))
			if err != nil || img.Bounds().Dx() != size {
				t.Fatal("invalid rendition")
			}
			r, _, b, _ := img.At(size/2, size/2).RGBA()
			if r <= b {
				t.Fatalf("orientation %d selected wrong region", sample.orientation)
			}
		}
		f.MTimeNs++
		if _, err := thumbs.Portrait(path, f, 160); err == nil {
			t.Fatal("stale source returned cached portrait")
		}
	}
}

func TestPortraitQualityOutweighsSurplusResolution(t *testing.T) {
	blown, clear := float32(0.45), float32(0.92)
	var group PersonGroup
	group.considerCover(PersonFace{Key: "large", ResourceID: "large", Box: []float32{0, 0, 334, 366}, Score: .95, portraitQuality: &blown})
	group.considerCover(PersonFace{Key: "clear", ResourceID: "clear", Box: []float32{0, 0, 159, 179}, Score: .95, portraitQuality: &clear})
	if group.CoverResourceID != "clear" {
		t.Fatal("overexposed face won on pixel count")
	}
}
