package httpapi

import "testing"

func TestArkReferenceSizeMeetsMinimumPixels(t *testing.T) {
	for _, size := range [][2]int{{720, 480}, {640, 360}, {480, 854}} {
		width, height := arkReferenceSize(size[0], size[1])
		if width*height < arkReferenceVideoMinPixels {
			t.Fatalf("%dx%d -> %dx%d is below minimum", size[0], size[1], width, height)
		}
		if width%2 != 0 || height%2 != 0 {
			t.Fatalf("%dx%d -> %dx%d is not even", size[0], size[1], width, height)
		}
		originalRatio := float64(size[0]) / float64(size[1])
		targetRatio := float64(width) / float64(height)
		if targetRatio < originalRatio*0.98 || targetRatio > originalRatio*1.02 {
			t.Fatalf("%dx%d -> %dx%d changed aspect ratio", size[0], size[1], width, height)
		}
	}
}
