package httpapi

import (
	"fmt"
	"net"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"

	"sparkstudio/backend/internal/models"
)

type userProviderReq struct {
	Provider    string `json:"provider"`
	DisplayName string `json:"displayName"`
	BaseURL     string `json:"baseUrl"`
	APIKey      string `json:"apiKey"`
	SecretKey   string `json:"secretKey"`
	Models      string `json:"models"`
	Capability  string `json:"capability"`
	Enabled     bool   `json:"enabled"`
}

type userRemoteModelsReq struct {
	ProviderID uint   `json:"providerId"`
	Provider   string `json:"provider"`
	BaseURL    string `json:"baseUrl"`
	APIKey     string `json:"apiKey"`
}

func (s *Server) ListUserProviders(c *gin.Context) {
	u := CurrentUser(c)
	var list []models.UserProviderConfig
	s.DB.Where("owner_user_id = ?", u.ID).Order("id desc").Find(&list)
	out := make([]gin.H, 0, len(list))
	for _, p := range list {
		out = append(out, gin.H{
			"id": p.ID, "provider": p.Provider, "displayName": p.DisplayName, "baseUrl": p.BaseURL,
			"models": p.Models, "capability": p.Capability, "enabled": p.Enabled,
			"hasApiKey": p.APIKey != "", "hasSecretKey": p.SecretKey != "",
			"createdAt": p.CreatedAt, "updatedAt": p.UpdatedAt,
		})
	}
	OK(c, out)
}

func (s *Server) CreateUserProvider(c *gin.Context) {
	var req userProviderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, 400, "请求参数有误")
		return
	}
	if err := validateProviderRequest(req); err != nil {
		Fail(c, 400, err.Error())
		return
	}
	u := CurrentUser(c)
	apiKey, err := encryptSecret(strings.TrimSpace(req.APIKey))
	if err != nil {
		Fail(c, 500, "密钥加密失败")
		return
	}
	secretKey, _ := encryptSecret(strings.TrimSpace(req.SecretKey))
	row := models.UserProviderConfig{
		OwnerUserID: u.ID, Provider: req.Provider, DisplayName: req.DisplayName,
		BaseURL: strings.TrimRight(req.BaseURL, "/"), APIKey: apiKey, SecretKey: secretKey,
		Models: req.Models, Capability: req.Capability, Enabled: req.Enabled,
	}
	if err := s.DB.Create(&row).Error; err != nil {
		Fail(c, 500, "自有模型配置保存失败")
		return
	}
	OK(c, gin.H{"id": row.ID, "saved": true})
}

func (s *Server) UpdateUserProvider(c *gin.Context) {
	var req userProviderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, 400, "请求参数有误")
		return
	}
	if err := validateProviderRequest(req); err != nil {
		Fail(c, 400, err.Error())
		return
	}
	u := CurrentUser(c)
	var row models.UserProviderConfig
	if err := s.DB.Where("id = ? AND owner_user_id = ?", IDParam(c, "id"), u.ID).First(&row).Error; err != nil {
		Fail(c, 404, "自有模型配置不存在")
		return
	}
	row.Provider, row.DisplayName, row.BaseURL = req.Provider, req.DisplayName, strings.TrimRight(req.BaseURL, "/")
	row.Models, row.Capability, row.Enabled = req.Models, req.Capability, req.Enabled
	if strings.TrimSpace(req.APIKey) != "" {
		row.APIKey, _ = encryptSecret(strings.TrimSpace(req.APIKey))
	}
	if strings.TrimSpace(req.SecretKey) != "" {
		row.SecretKey, _ = encryptSecret(strings.TrimSpace(req.SecretKey))
	}
	if err := s.DB.Save(&row).Error; err != nil {
		Fail(c, 500, "自有模型配置保存失败")
		return
	}
	OK(c, gin.H{"updated": true})
}

func (s *Server) DeleteUserProvider(c *gin.Context) {
	u := CurrentUser(c)
	res := s.DB.Where("id = ? AND owner_user_id = ?", IDParam(c, "id"), u.ID).Delete(&models.UserProviderConfig{})
	if res.RowsAffected == 0 {
		Fail(c, 404, "自有模型配置不存在")
		return
	}
	OK(c, gin.H{"deleted": true})
}

func (s *Server) ListUserRemoteModels(c *gin.Context) {
	var req userRemoteModelsReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, 400, "请求参数有误")
		return
	}

	u := CurrentUser(c)
	if req.ProviderID > 0 {
		var saved models.UserProviderConfig
		if err := s.DB.Where("id = ? AND owner_user_id = ?", req.ProviderID, u.ID).First(&saved).Error; err != nil {
			Fail(c, 404, "自有模型配置不存在")
			return
		}
		if strings.TrimSpace(req.Provider) == "" {
			req.Provider = saved.Provider
		}
		if strings.TrimSpace(req.BaseURL) == "" {
			req.BaseURL = saved.BaseURL
		}
		if strings.TrimSpace(req.APIKey) == "" {
			req.APIKey = decryptSecret(saved.APIKey)
		}
	}

	if err := validateProviderBaseURL(req.BaseURL); err != nil {
		Fail(c, 400, err.Error())
		return
	}
	if strings.TrimSpace(req.APIKey) == "" {
		Fail(c, 400, "尚未填写 API Key，请先输入或保存供应商密钥后再拉取模型")
		return
	}

	provider := models.ProviderConfig{
		Provider: defaultStr(strings.TrimSpace(req.Provider), "openai"),
		BaseURL:  strings.TrimRight(strings.TrimSpace(req.BaseURL), "/"),
	}
	list, err := fetchRemoteModels(c.Request.Context(), provider, strings.TrimSpace(req.APIKey))
	if err != nil {
		writeRemoteModelsError(c, err)
		return
	}
	OK(c, gin.H{"models": list, "count": len(list)})
}

func validateProviderRequest(req userProviderReq) error {
	if strings.TrimSpace(req.DisplayName) == "" {
		return fmt.Errorf("供应商名称不能为空")
	}
	if strings.TrimSpace(req.Models) == "" {
		return fmt.Errorf("请填写模型 ID")
	}
	if err := validateProviderBaseURL(req.BaseURL); err != nil {
		return err
	}
	if req.Capability == "" {
		req.Capability = "image"
	}
	if req.Capability != "image" && req.Capability != "video" && req.Capability != "understanding" {
		return fmt.Errorf("模型能力类型无效")
	}
	return nil
}

func validateProviderBaseURL(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return fmt.Errorf("请填写有效的 Base URL")
	}
	if u.Scheme != "https" && !appIsDev() {
		return fmt.Errorf("自有模型 Base URL 必须使用 HTTPS")
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return fmt.Errorf("Base URL 仅支持 HTTP 或 HTTPS")
	}
	if u.User != nil {
		return fmt.Errorf("Base URL 不允许包含用户名或密码")
	}
	host := strings.ToLower(u.Hostname())
	if host == "" {
		return fmt.Errorf("请填写有效的 Base URL")
	}
	if !appIsDev() && isPrivateProviderHost(host) {
		return fmt.Errorf("不允许使用内网或回环地址")
	}
	return nil
}

func isPrivateProviderHost(host string) bool {
	host = strings.ToLower(strings.Trim(strings.TrimSpace(host), "[]"))
	if host == "localhost" || strings.HasSuffix(host, ".localhost") ||
		strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified()
}

type wechatReq struct {
	AccountName string `json:"accountName"`
	AppID       string `json:"appId"`
	AppSecret   string `json:"appSecret"`
	Enabled     bool   `json:"enabled"`
}

func (s *Server) ListWechats(c *gin.Context) {
	u := CurrentUser(c)
	var list []models.WechatAccount
	s.DB.Where("owner_user_id = ?", u.ID).Order("id desc").Find(&list)
	out := make([]gin.H, 0, len(list))
	for _, w := range list {
		out = append(out, gin.H{"id": w.ID, "accountName": w.AccountName, "appId": w.AppID, "enabled": w.Enabled, "hasSecret": w.AppSecret != "", "createdAt": w.CreatedAt})
	}
	OK(c, out)
}

func (s *Server) CreateWechat(c *gin.Context) {
	var req wechatReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.AccountName) == "" || strings.TrimSpace(req.AppID) == "" {
		Fail(c, 400, "公众号名称与 AppID 不能为空")
		return
	}
	u := CurrentUser(c)
	secret, _ := encryptSecret(strings.TrimSpace(req.AppSecret))
	row := models.WechatAccount{OwnerUserID: u.ID, AccountName: req.AccountName, AppID: req.AppID, AppSecret: secret, Enabled: req.Enabled}
	if err := s.DB.Create(&row).Error; err != nil {
		Fail(c, 500, "公众号绑定失败")
		return
	}
	OK(c, gin.H{"id": row.ID, "saved": true})
}

func (s *Server) UpdateWechat(c *gin.Context) {
	var req wechatReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.AccountName) == "" || strings.TrimSpace(req.AppID) == "" {
		Fail(c, 400, "公众号名称与 AppID 不能为空")
		return
	}
	u := CurrentUser(c)
	var row models.WechatAccount
	if err := s.DB.Where("id = ? AND owner_user_id = ?", IDParam(c, "id"), u.ID).First(&row).Error; err != nil {
		Fail(c, 404, "公众号绑定不存在")
		return
	}
	row.AccountName, row.AppID, row.Enabled = req.AccountName, req.AppID, req.Enabled
	if strings.TrimSpace(req.AppSecret) != "" {
		row.AppSecret, _ = encryptSecret(strings.TrimSpace(req.AppSecret))
	}
	s.DB.Save(&row)
	OK(c, gin.H{"updated": true})
}

func (s *Server) DeleteWechat(c *gin.Context) {
	u := CurrentUser(c)
	res := s.DB.Where("id = ? AND owner_user_id = ?", IDParam(c, "id"), u.ID).Delete(&models.WechatAccount{})
	if res.RowsAffected == 0 {
		Fail(c, 404, "公众号绑定不存在")
		return
	}
	OK(c, gin.H{"deleted": true})
}

func (s *Server) EgressIP(c *gin.Context) {
	OK(c, gin.H{"ip": s.Setting("server.egressIp", "")})
}
