package httpapi

import (
	"testing"

	"sparkstudio/backend/internal/models"
)

func TestModelUnitCreditsUsesResolutionPricing(t *testing.T) {
	model := &models.ProviderModel{
		Unit:         "秒",
		Credits:      12,
		Credits480P:  6,
		Credits720P:  12,
		Credits1080P: 27,
	}

	tests := map[string]int64{
		"480p":  6,
		"720p":  12,
		"1080p": 27,
	}
	for resolution, want := range tests {
		if got := modelUnitCredits(model, resolution); got != want {
			t.Fatalf("modelUnitCredits(%q) = %d, want %d", resolution, got, want)
		}
	}
}

func TestModelUnitCreditsFallsBackToBasePrice(t *testing.T) {
	model := &models.ProviderModel{Unit: "秒", Credits: 12}
	for _, resolution := range []string{"480p", "720p", "1080p", ""} {
		if got := modelUnitCredits(model, resolution); got != 12 {
			t.Fatalf("modelUnitCredits(%q) = %d, want fallback 12", resolution, got)
		}
	}
}

func TestModelUnitCreditsKeepsNonVideoPricing(t *testing.T) {
	model := &models.ProviderModel{
		Unit:         "张",
		Credits:      12,
		Credits1080P: 27,
	}
	if got := modelUnitCredits(model, "1080p"); got != 12 {
		t.Fatalf("image model credits = %d, want 12", got)
	}
}
