package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"sparkstudio/backend/internal/ai"
	"sparkstudio/backend/internal/models"
)

func (s *Server) runPlatformUnderstanding(
	ctx context.Context, userID uint, bizType, note, system, prompt string, validate func(string) error,
) (string, int64, error) {
	text, charged, _, err := s.runUnderstanding(ctx, userID, "platform", "", bizType, note, system, prompt, validate)
	return text, charged, err
}

func (s *Server) runUnderstanding(
	ctx context.Context, userID uint, modelSource, modelID, bizType, note, system, prompt string,
	validate func(string) error,
) (string, int64, string, error) {
	if strings.TrimSpace(modelSource) == "" {
		modelSource = "platform"
	}
	model, custom, err := s.resolveStudioModel(userID, modelSource, modelID, "article")
	if err != nil {
		return "", 0, "", err
	}
	if custom != nil {
		apiKey := decryptSecret(custom.APIKey)
		if strings.TrimSpace(apiKey) == "" {
			return "", 0, "custom", errors.New("自有理解模型尚未配置 API Key")
		}
		callCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		defer cancel()
		text, err := ai.GenerateText(callCtx, ai.Provider{
			Protocol: custom.Provider, BaseURL: custom.BaseURL, APIKey: apiKey,
			SecretKey: decryptSecret(custom.SecretKey), Model: customModelName(modelID, custom.Models),
		}, system, prompt, nil)
		if err != nil {
			return "", 0, "custom", err
		}
		if validate != nil {
			if err := validate(text); err != nil {
				return "", 0, "custom", err
			}
		}
		return text, 0, "custom", nil
	}
	var provider models.ProviderConfig
	if err := s.DB.First(&provider, model.ProviderID).Error; err != nil {
		return "", 0, "platform", errors.New("理解模型供应商配置不存在")
	}
	if !provider.Enabled {
		return "", 0, "platform", errors.New("理解模型供应商已停用")
	}
	apiKey := decryptSecret(provider.APIKey)
	if strings.TrimSpace(apiKey) == "" {
		return "", 0, "platform", errors.New("后台理解模型尚未配置 API Key")
	}
	credits := model.Credits
	if credits < 0 {
		credits = 0
	}
	bizID := fmt.Sprintf("%s-%d", bizType, time.Now().UnixNano())
	if credits > 0 {
		err := s.DB.Transaction(func(tx *gorm.DB) error {
			return s.reserveCredits(tx, userID, credits, bizType, bizID, note+"预冻结")
		})
		if err != nil {
			if errors.Is(err, errInsufficientCredits) {
				return "", 0, "platform", errors.New("可用积分不足，无法调用理解模型")
			}
			return "", 0, "platform", err
		}
	}
	callCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	text, err := ai.GenerateText(callCtx, ai.Provider{
		Protocol: provider.Provider, BaseURL: provider.BaseURL, APIKey: apiKey,
		SecretKey: decryptSecret(provider.SecretKey), Model: model.ModelID,
	}, system, prompt, nil)
	if err != nil {
		s.refundUnderstanding(userID, credits, bizType, bizID, note)
		return "", credits, "platform", err
	}
	if validate != nil {
		if err := validate(text); err != nil {
			s.refundUnderstanding(userID, credits, bizType, bizID, note)
			return "", credits, "platform", err
		}
	}
	if credits > 0 {
		err := s.DB.Transaction(func(tx *gorm.DB) error {
			return s.settleCredits(tx, userID, credits, credits, bizType, bizID, note, `{"source":"platform_understanding"}`)
		})
		if err != nil {
			return "", credits, "platform", err
		}
	}
	return text, credits, "platform", nil
}

func (s *Server) refundUnderstanding(userID uint, credits int64, bizType, bizID, note string) {
	if credits <= 0 {
		return
	}
	_ = s.DB.Transaction(func(tx *gorm.DB) error {
		return s.refundReserved(tx, userID, credits, bizType, bizID, note+"失败，全额退回")
	})
}

func jsonObjectText(value string) string {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, "```") {
		if newline := strings.IndexByte(value, '\n'); newline >= 0 {
			value = value[newline+1:]
		}
		if end := strings.LastIndex(value, "```"); end >= 0 {
			value = value[:end]
		}
		value = strings.TrimSpace(value)
	}
	start := strings.IndexByte(value, '{')
	end := strings.LastIndexByte(value, '}')
	if start >= 0 && end > start {
		return value[start : end+1]
	}
	return value
}

func decodeModelJSON(value string, target interface{}) error {
	text := jsonObjectText(value)
	if !json.Valid([]byte(text)) {
		return errors.New("模型输出不是有效 JSON，请重试")
	}
	if err := json.Unmarshal([]byte(text), target); err != nil {
		return errors.New("模型输出结构不正确，请重试")
	}
	return nil
}
