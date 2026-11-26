package httpapi

import (
	"strings"

	"github.com/gin-gonic/gin"

	"sparkstudio/backend/internal/models"
)

func (s *Server) PublicConfig(c *gin.Context) {
	var packages []models.CreditPackage
	s.DB.Where("enabled = ?", true).Order("sort_order asc, id asc").Find(&packages)
	var providers []models.ProviderConfig
	s.DB.Preload("Models").Where("enabled = ?", true).Order("sort_order asc, id asc").Find(&providers)
	modelsOut := make([]gin.H, 0)
	for _, p := range providers {
		for _, m := range p.Models {
			if !m.Enabled {
				continue
			}
			modelsOut = append(modelsOut, gin.H{
				"id": m.ID, "providerId": p.ID, "provider": p.Provider, "providerName": p.DisplayName,
				"modelId": m.ModelID, "displayName": m.DisplayName, "capability": m.Capability,
				"unit": m.Unit, "credits": m.Credits,
				"credits480p": m.Credits480P, "credits720p": m.Credits720P, "credits1080p": m.Credits1080P,
				"supportsVideoRef": m.SupportsVideoRef, "maxRefImages": m.MaxRefImages,
				"value": "platform:" + m.ModelID, "source": "platform",
			})
		}
	}
	var tk models.TikhubConfig
	s.DB.First(&tk)
	fyepayReady := s.fyepayEnabled() && s.fyepayReady()
	alipayDirectEnabled := s.SettingBool("payment.alipay.enabled", false)
	wechatDirectEnabled := s.SettingBool("payment.wechat.enabled", false)
	provider := "direct"
	if fyepayReady {
		provider = "fyepay"
	}
	OK(c, gin.H{
		"registration": gin.H{
			"enabled":      s.SettingBool("registration.enabled", true),
			"smsRequired":  s.SettingBool("registration.smsRequired", false),
			"giftCredits":  s.SettingInt("registration.giftCredits", 100),
			"contactAdmin": s.Setting("registration.contactAdmin", "请联系管理员重置密码。"),
		},
		"site":       gin.H{"name": s.Setting("site.name", "星芒创作 SparkStudio")},
		"packages":   packages,
		"models":     modelsOut,
		"collection": gin.H{"creditsPerPage": tk.CreditsPerPage, "enabled": tk.Enabled},
		"payments": gin.H{
			"alipayEnabled":       alipayDirectEnabled,
			"wechatEnabled":       wechatDirectEnabled,
			"alipayDirectEnabled": alipayDirectEnabled,
			"wechatDirectEnabled": wechatDirectEnabled,
			"fyepayEnabled":       fyepayReady,
			"mockMode":            s.mockPaymentsEnabled(),
			"provider":            provider,
		},
	})
}

func (s *Server) ListPublicPackages(c *gin.Context) {
	var list []models.CreditPackage
	s.DB.Where("enabled = ?", true).Order("sort_order asc, id asc").Find(&list)
	OK(c, list)
}

func (s *Server) ModelCatalog(c *gin.Context) {
	u := CurrentUser(c)
	var providers []models.ProviderConfig
	s.DB.Preload("Models").Where("enabled = ?", true).Order("sort_order asc, id asc").Find(&providers)
	platform := make([]gin.H, 0)
	for _, p := range providers {
		for _, m := range p.Models {
			if !m.Enabled {
				continue
			}
			platform = append(platform, gin.H{
				"id": m.ID, "provider": p.Provider, "providerName": p.DisplayName,
				"modelId": m.ModelID, "displayName": m.DisplayName, "capability": m.Capability,
				"unit": m.Unit, "credits": m.Credits,
				"credits480p": m.Credits480P, "credits720p": m.Credits720P, "credits1080p": m.Credits1080P,
				"supportsVideoRef": m.SupportsVideoRef, "maxRefImages": m.MaxRefImages,
				"value": "platform:" + m.ModelID, "source": "platform",
			})
		}
	}
	var custom []models.UserProviderConfig
	s.DB.Where("owner_user_id = ? AND enabled = ?", u.ID, true).Find(&custom)
	customOut := make([]gin.H, 0)
	for _, p := range custom {
		for _, rawModel := range strings.Split(p.Models, ",") {
			modelID := strings.TrimSpace(rawModel)
			if modelID == "" {
				continue
			}
			customOut = append(customOut, gin.H{
				"id": p.ID, "provider": p.Provider, "providerName": p.DisplayName,
				"modelId": modelID, "displayName": p.DisplayName + " · " + modelID,
				"capability": p.Capability, "unit": unitForCapability(p.Capability), "credits": 0,
				"value": "custom:" + itoa(p.ID) + ":" + modelID, "source": "custom",
			})
		}
	}
	OK(c, gin.H{"platform": platform, "custom": customOut})
}

func unitForCapability(capability string) string {
	switch capability {
	case "video":
		return "秒"
	case "understanding":
		return "次"
	default:
		return "张"
	}
}

func itoa(v uint) string {
	if v == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for v > 0 {
		i--
		b[i] = byte('0' + v%10)
		v /= 10
	}
	return string(b[i:])
}
