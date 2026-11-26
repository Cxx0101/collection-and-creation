package httpapi

import (
	"strings"

	"sparkstudio/backend/internal/models"
)

func modelUnitCredits(model *models.ProviderModel, resolution string) int64 {
	if model == nil {
		return 0
	}
	credits := model.Credits
	if model.Unit == "秒" {
		switch strings.ToLower(strings.TrimSpace(resolution)) {
		case "480p":
			if model.Credits480P > 0 {
				credits = model.Credits480P
			}
		case "720p":
			if model.Credits720P > 0 {
				credits = model.Credits720P
			}
		case "1080p":
			if model.Credits1080P > 0 {
				credits = model.Credits1080P
			}
		}
	}
	if credits < 0 {
		return 0
	}
	return credits
}

func studioResolution(params map[string]interface{}) string {
	if params == nil {
		return ""
	}
	value, _ := params["resolution"].(string)
	return strings.TrimSpace(value)
}
