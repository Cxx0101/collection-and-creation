package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"sparkstudio/backend/internal/auth"
	"sparkstudio/backend/internal/models"
	"sparkstudio/backend/internal/storage"
)

func (s *Server) AdminStats(c *gin.Context) {
	today := time.Now().Truncate(24 * time.Hour)
	var totalUsers, activeUsers, todayUsers, activeJobs, pendingOrders, collectionPages int64
	s.DB.Model(&models.User{}).Where("role = ?", "user").Count(&totalUsers)
	s.DB.Model(&models.User{}).Where("role = ? AND status = ?", "user", "active").Count(&activeUsers)
	s.DB.Model(&models.User{}).Where("created_at >= ?", today).Count(&todayUsers)
	s.DB.Model(&models.StudioJob{}).Where("status IN ?", []string{"running", "queued", "waiting_for_user"}).Count(&activeJobs)
	s.DB.Model(&models.PaymentOrder{}).Where("status = ?", "pending").Count(&pendingOrders)
	s.DB.Model(&models.CollectionBatch{}).Where("created_at >= ?", today).Select("COALESCE(SUM(pages_fetched),0)").Scan(&collectionPages)
	var revenue int64
	s.DB.Model(&models.PaymentOrder{}).Where("status = ?", "paid").Select("COALESCE(SUM(amount_cents),0)").Scan(&revenue)
	var todayConsumed int64
	s.DB.Model(&models.CreditTransaction{}).Where("created_at >= ? AND delta_consumed > 0", today).Select("COALESCE(SUM(delta_consumed),0)").Scan(&todayConsumed)
	var storage models.StorageConfig
	s.DB.Where("enabled = ?", true).First(&storage)
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
		"totalUsers": totalUsers, "activeUsers": activeUsers, "todayNewUsers": todayUsers,
		"revenueCents": revenue, "todayConsumed": todayConsumed, "activeJobs": activeJobs,
		"pendingOrders": pendingOrders, "collectionPagesToday": collectionPages,
		"storage": gin.H{"provider": storage.Provider, "bucket": storage.Bucket, "enabled": storage.Enabled},
		"tikhub":  gin.H{"enabled": tk.Enabled, "baseUrl": tk.BaseURL},
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

func (s *Server) AdminTrend(c *gin.Context) {
	now := time.Now()
	out := make([]gin.H, 0, 7)
	for i := 6; i >= 0; i-- {
		day := now.AddDate(0, 0, -i)
		start := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, day.Location())
		end := start.AddDate(0, 0, 1)
		var recharge, consumed int64
		s.DB.Model(&models.PaymentOrder{}).Where("status = ? AND paid_at >= ? AND paid_at < ?", "paid", start, end).Select("COALESCE(SUM(amount_cents),0)").Scan(&recharge)
		s.DB.Model(&models.CreditTransaction{}).Where("created_at >= ? AND created_at < ? AND delta_consumed > 0", start, end).Select("COALESCE(SUM(delta_consumed),0)").Scan(&consumed)
		out = append(out, gin.H{
			"date": start.Format("2006-01-02"), "label": start.Format("01-02"),
			"rechargeCents": recharge, "consumedCredits": consumed,
		})
	}
	OK(c, out)
}

func (s *Server) AdminListUsers(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	q := s.DB.Model(&models.User{})
	if kw := strings.TrimSpace(c.Query("q")); kw != "" {
		q = q.Where("phone LIKE ? OR nickname LIKE ?", "%"+kw+"%", "%"+kw+"%")
	}
	if role := strings.TrimSpace(c.Query("role")); role != "" && role != "all" {
		q = q.Where("role = ?", role)
	}
	if status := strings.TrimSpace(c.Query("status")); status != "" && status != "all" {
		q = q.Where("status = ?", status)
	}
	var total int64
	q.Count(&total)
	var list []models.User
	q.Order("id desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&list)
	out := make([]gin.H, 0, len(list))
	for _, item := range list {
		out = append(out, adminUserResponse(item))
	}
	OK(c, gin.H{"list": out, "total": total, "page": page, "pageSize": pageSize})
}

func adminUserResponse(u models.User) gin.H {
	return gin.H{
		"id": u.ID, "phone": u.Phone, "nickname": u.Nickname, "role": u.Role,
		"status": u.Status, "credits": u.Credits, "frozenCredits": u.FrozenCredits,
		"totalRecharged": u.TotalRecharged, "totalConsumed": u.TotalConsumed,
		"tokenVersion": u.TokenVersion, "createdAt": u.CreatedAt, "lastLoginAt": u.LastLoginAt,
	}
}

type adminUserReq struct {
	Phone    string `json:"phone"`
	Password string `json:"password"`
	Nickname string `json:"nickname"`
	Role     string `json:"role"`
	Status   string `json:"status"`
	Credits  int64  `json:"credits"`
}

func (s *Server) AdminCreateUser(c *gin.Context) {
	var req adminUserReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, 400, "请求参数有误")
		return
	}
	req.Phone = strings.TrimSpace(req.Phone)
	if !phoneRe.MatchString(req.Phone) {
		Fail(c, 400, "请输入正确的手机号")
		return
	}
	if len(req.Password) < 8 {
		Fail(c, 400, "密码至少 8 位")
		return
	}
	if req.Role != "admin" && req.Role != "user" {
		req.Role = "user"
	}
	if req.Status != "active" && req.Status != "disabled" {
		req.Status = "active"
	}
	var exists int64
	s.DB.Model(&models.User{}).Where("phone = ?", req.Phone).Count(&exists)
	if exists > 0 {
		Fail(c, 409, "手机号已存在")
		return
	}
	hash, _ := auth.HashPassword(req.Password)
	if strings.TrimSpace(req.Nickname) == "" {
		req.Nickname = "用户" + req.Phone[len(req.Phone)-4:]
	}
	if req.Credits < 0 {
		req.Credits = 0
	}
	u := models.User{Phone: req.Phone, PasswordHash: hash, Nickname: req.Nickname, Role: req.Role, Status: req.Status, Credits: req.Credits, TokenVersion: 1}
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&u).Error; err != nil {
			return err
		}
		if req.Credits > 0 {
			return tx.Create(&models.CreditTransaction{
				UserID: u.ID, Kind: "admin_adjust", BizType: "admin_user_create", BizID: fmt.Sprint(u.ID),
				DeltaAvailable: req.Credits, BalanceAfter: req.Credits, Note: "管理员创建用户并设置初始积分",
			}).Error
		}
		return nil
	})
	if err != nil {
		Fail(c, 500, "用户创建失败")
		return
	}
	OK(c, adminUserResponse(u))
}

type adminUpdateUserReq struct {
	Nickname string `json:"nickname"`
	Role     string `json:"role"`
	Status   string `json:"status"`
}

func (s *Server) AdminUpdateUser(c *gin.Context) {
	var req adminUpdateUserReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, 400, "请求参数有误")
		return
	}
	var u models.User
	if err := s.DB.First(&u, IDParam(c, "id")).Error; err != nil {
		Fail(c, 404, "用户不存在")
		return
	}
	me := CurrentUser(c)
	if u.ID == me.ID && req.Status != "" && req.Status != "active" {
		Fail(c, 400, "不能禁用当前登录的管理员账号")
		return
	}
	updates := map[string]interface{}{}
	if strings.TrimSpace(req.Nickname) != "" {
		updates["nickname"] = strings.TrimSpace(req.Nickname)
	}
	if req.Role == "admin" || req.Role == "user" {
		if u.ID == me.ID && req.Role != "admin" {
			Fail(c, 400, "不能取消当前管理员权限")
			return
		}
		updates["role"] = req.Role
	}
	if req.Status == "active" || req.Status == "disabled" {
		updates["status"] = req.Status
	}
	if u.Status != req.Status && req.Status != "" {
		var fresh models.User
		s.DB.First(&fresh, u.ID)
		updates["token_version"] = fresh.TokenVersion + 1
	}
	if len(updates) > 0 {
		if err := s.DB.Model(&u).Updates(updates).Error; err != nil {
			Fail(c, 500, "用户更新失败")
			return
		}
	}
	s.DB.First(&u, u.ID)
	OK(c, adminUserResponse(u))
}

func (s *Server) AdminDeleteUser(c *gin.Context) {
	id := IDParam(c, "id")
	if id == CurrentUser(c).ID {
		Fail(c, 400, "不能删除当前登录的管理员账号")
		return
	}
	var u models.User
	if err := s.DB.First(&u, id).Error; err != nil {
		Fail(c, 404, "用户不存在")
		return
	}
	var objectKeys []string
	s.DB.Unscoped().Model(&models.Asset{}).
		Where("owner_user_id = ? AND object_key <> ''", id).
		Pluck("object_key", &objectKeys)
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var productIDs []uint
		if err := tx.Model(&models.Product{}).Where("owner_user_id = ?", id).Pluck("id", &productIDs).Error; err != nil {
			return err
		}
		if len(productIDs) > 0 {
			if err := tx.Where("product_id IN ?", productIDs).Delete(&models.ProductImage{}).Error; err != nil {
				return err
			}
		}
		if err := tx.Unscoped().Where("owner_user_id = ?", id).Delete(&models.Asset{}).Error; err != nil {
			return err
		}
		tables := []interface{}{
			&models.Product{}, &models.CollectionItem{}, &models.CollectionBatch{},
			&models.CollectionKeyword{}, &models.StudioJob{}, &models.Skill{}, &models.Workflow{},
			&models.CloneDraft{}, &models.UserProviderConfig{}, &models.WechatAccount{},
		}
		for _, table := range tables {
			if err := tx.Where("owner_user_id = ?", id).Delete(table).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("user_id = ?", id).Delete(&models.PaymentOrder{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", id).Delete(&models.CreditTransaction{}).Error; err != nil {
			return err
		}
		return tx.Delete(&u).Error
	})
	if err != nil {
		Fail(c, 500, "用户删除失败")
		return
	}
	for _, key := range objectKeys {
		_ = s.deleteObject(context.Background(), key)
	}
	OK(c, gin.H{"deleted": true})
}

func (s *Server) AdminAdjustCredits(c *gin.Context) {
	var req struct {
		Delta int64  `json:"delta"`
		Note  string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Delta == 0 {
		Fail(c, 400, "请输入非零的积分调整值")
		return
	}
	var u models.User
	if err := s.DB.First(&u, IDParam(c, "id")).Error; err != nil {
		Fail(c, 404, "用户不存在")
		return
	}
	if req.Note == "" {
		req.Note = "管理员调整积分"
	}
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var fresh models.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&fresh, u.ID).Error; err != nil {
			return err
		}
		if fresh.Credits+req.Delta < 0 {
			return fmt.Errorf("调减后积分不能小于 0")
		}
		fresh.Credits += req.Delta
		if err := tx.Model(&fresh).Update("credits", fresh.Credits).Error; err != nil {
			return err
		}
		return tx.Create(&models.CreditTransaction{
			UserID: fresh.ID, Kind: "admin_adjust", BizType: "admin_adjust", BizID: fmt.Sprint(time.Now().UnixNano()),
			DeltaAvailable: req.Delta, BalanceAfter: fresh.Credits, Note: req.Note,
		}).Error
	})
	if err != nil {
		Fail(c, 400, err.Error())
		return
	}
	s.DB.First(&u, u.ID)
	OK(c, adminUserResponse(u))
}

func (s *Server) AdminResetPassword(c *gin.Context) {
	var req struct {
		NewPassword string `json:"newPassword"`
	}
	_ = c.ShouldBindJSON(&req)
	tempPassword := strings.TrimSpace(req.NewPassword)
	if tempPassword == "" {
		tempPassword = randomPassword(10)
	}
	if len(tempPassword) < 8 {
		Fail(c, 400, "新密码至少 8 位")
		return
	}
	var u models.User
	if err := s.DB.First(&u, IDParam(c, "id")).Error; err != nil {
		Fail(c, 404, "用户不存在")
		return
	}
	hash, _ := auth.HashPassword(tempPassword)
	if err := s.DB.Model(&u).Updates(map[string]interface{}{"password_hash": hash, "token_version": u.TokenVersion + 1}).Error; err != nil {
		Fail(c, 500, "密码重置失败")
		return
	}
	OK(c, gin.H{"reset": true, "temporaryPassword": tempPassword})
}

type adminPackageReq struct {
	Name         string `json:"name"`
	BadgeText    string `json:"badgeText"`
	Description  string `json:"description"`
	PriceCents   int64  `json:"priceCents"`
	Credits      int64  `json:"credits"`
	BonusCredits int64  `json:"bonusCredits"`
	SortOrder    int    `json:"sortOrder"`
	Enabled      bool   `json:"enabled"`
}

func (s *Server) AdminListPackages(c *gin.Context) {
	var list []models.CreditPackage
	s.DB.Order("sort_order asc, id asc").Find(&list)
	OK(c, list)
}

func (s *Server) AdminCreatePackage(c *gin.Context) {
	var req adminPackageReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		Fail(c, 400, "套餐名称不能为空")
		return
	}
	if req.PriceCents < 0 || req.Credits <= 0 || req.BonusCredits < 0 {
		Fail(c, 400, "套餐价格或积分设置无效")
		return
	}
	row := models.CreditPackage{
		Name: req.Name, BadgeText: req.BadgeText, Description: req.Description,
		PriceCents: req.PriceCents, Credits: req.Credits, BonusCredits: req.BonusCredits,
		SortOrder: req.SortOrder, Enabled: req.Enabled,
	}
	if err := s.DB.Create(&row).Error; err != nil {
		Fail(c, 500, "套餐创建失败")
		return
	}
	OK(c, row)
}

func (s *Server) AdminUpdatePackage(c *gin.Context) {
	var req adminPackageReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		Fail(c, 400, "套餐名称不能为空")
		return
	}
	var row models.CreditPackage
	if err := s.DB.First(&row, IDParam(c, "id")).Error; err != nil {
		Fail(c, 404, "套餐不存在")
		return
	}
	row.Name, row.BadgeText, row.Description = req.Name, req.BadgeText, req.Description
	row.PriceCents, row.Credits, row.BonusCredits = req.PriceCents, req.Credits, req.BonusCredits
	row.SortOrder, row.Enabled = req.SortOrder, req.Enabled
	if err := s.DB.Save(&row).Error; err != nil {
		Fail(c, 500, "套餐保存失败")
		return
	}
	OK(c, row)
}

func (s *Server) AdminDeletePackage(c *gin.Context) {
	var count int64
	s.DB.Model(&models.PaymentOrder{}).Where("package_id = ? AND status = ?", IDParam(c, "id"), "pending").Count(&count)
	if count > 0 {
		Fail(c, 409, "该套餐存在待支付订单，暂时无法删除，可先下架")
		return
	}
	res := s.DB.Delete(&models.CreditPackage{}, IDParam(c, "id"))
	if res.RowsAffected == 0 {
		Fail(c, 404, "套餐不存在")
		return
	}
	OK(c, gin.H{"deleted": true})
}

func (s *Server) AdminListOrders(c *gin.Context) {
	q := s.DB.Model(&models.PaymentOrder{})
	if status := c.Query("status"); status != "" && status != "all" {
		q = q.Where("status = ?", status)
	}
	if channel := c.Query("channel"); channel != "" && channel != "all" {
		q = q.Where("channel = ?", channel)
	}
	var list []models.PaymentOrder
	q.Order("id desc").Limit(200).Find(&list)
	users := userBriefMap(s, orderUserIDs(list))
	out := make([]gin.H, 0, len(list))
	for _, order := range list {
		out = append(out, gin.H{"order": order, "user": users[order.UserID]})
	}
	OK(c, out)
}

func (s *Server) AdminMarkPaid(c *gin.Context) {
	var order models.PaymentOrder
	if err := s.DB.First(&order, IDParam(c, "id")).Error; err != nil {
		Fail(c, 404, "订单不存在")
		return
	}
	paid, err := s.settlePaidOrder(order.OrderNo, order.Channel, "admin-"+order.OrderNo, order.AmountCents, "admin")
	if err != nil {
		Fail(c, 400, err.Error())
		return
	}
	OK(c, paid)
}

func (s *Server) AdminGetSettings(c *gin.Context) {
	var rows []models.SystemSetting
	s.DB.Order("`key` asc").Find(&rows)
	settings := make(map[string]string)
	secrets := make(map[string]bool)
	for _, row := range rows {
		if isSecretSetting(row.Key) {
			secrets[row.Key] = row.Value != ""
			continue
		}
		settings[row.Key] = row.Value
	}
	OK(c, gin.H{"settings": settings, "secretsConfigured": secrets})
}

func (s *Server) AdminUpdateSettings(c *gin.Context) {
	var req struct {
		Settings map[string]interface{} `json:"settings"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Settings) == 0 {
		Fail(c, 400, "没有可保存的配置")
		return
	}
	for key, value := range req.Settings {
		if !strings.Contains(key, ".") {
			continue
		}
		text := fmt.Sprint(value)
		if isSecretSetting(key) {
			if text == "" || strings.HasPrefix(text, "****") {
				continue
			}
			encrypted, err := encryptSecret(text)
			if err != nil {
				Fail(c, 500, "敏感配置加密失败")
				return
			}
			text = encrypted
		}
		if err := s.SetSetting(key, text); err != nil {
			Fail(c, 500, "配置保存失败："+key)
			return
		}
	}
	OK(c, gin.H{"saved": true})
}

func (s *Server) AdminListProviders(c *gin.Context) {
	var list []models.ProviderConfig
	s.DB.Preload("Models").Order("sort_order asc, id asc").Find(&list)
	out := make([]gin.H, 0, len(list))
	for _, p := range list {
		out = append(out, gin.H{
			"id": p.ID, "provider": p.Provider, "displayName": p.DisplayName, "baseUrl": p.BaseURL,
			"enabled": p.Enabled, "sortOrder": p.SortOrder, "hasApiKey": p.APIKey != "",
			"hasSecretKey": p.SecretKey != "", "models": p.Models,
			"createdAt": p.CreatedAt, "updatedAt": p.UpdatedAt,
		})
	}
	OK(c, out)
}

type providerReq struct {
	Provider    string `json:"provider"`
	DisplayName string `json:"displayName"`
	BaseURL     string `json:"baseUrl"`
	APIKey      string `json:"apiKey"`
	SecretKey   string `json:"secretKey"`
	Enabled     bool   `json:"enabled"`
	SortOrder   int    `json:"sortOrder"`
}

func (s *Server) AdminCreateProvider(c *gin.Context) {
	var req providerReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Provider) == "" || strings.TrimSpace(req.DisplayName) == "" {
		Fail(c, 400, "供应商协议与显示名称不能为空")
		return
	}
	if strings.TrimSpace(req.BaseURL) == "" {
		Fail(c, 400, "Base URL 不能为空")
		return
	}
	apiKey, _ := encryptSecret(strings.TrimSpace(req.APIKey))
	secretKey, _ := encryptSecret(strings.TrimSpace(req.SecretKey))
	row := models.ProviderConfig{
		Provider: req.Provider, DisplayName: req.DisplayName, BaseURL: strings.TrimRight(req.BaseURL, "/"),
		APIKey: apiKey, SecretKey: secretKey, Enabled: req.Enabled, SortOrder: req.SortOrder,
	}
	if err := s.DB.Create(&row).Error; err != nil {
		Fail(c, 500, "供应商创建失败")
		return
	}
	OK(c, gin.H{"id": row.ID, "saved": true})
}

func (s *Server) AdminUpdateProvider(c *gin.Context) {
	var req providerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, 400, "请求参数有误")
		return
	}
	var row models.ProviderConfig
	if err := s.DB.First(&row, IDParam(c, "id")).Error; err != nil {
		Fail(c, 404, "供应商不存在")
		return
	}
	if req.Provider != "" {
		row.Provider = req.Provider
	}
	if req.DisplayName != "" {
		row.DisplayName = req.DisplayName
	}
	if req.BaseURL != "" {
		row.BaseURL = strings.TrimRight(req.BaseURL, "/")
	}
	row.Enabled, row.SortOrder = req.Enabled, req.SortOrder
	if strings.TrimSpace(req.APIKey) != "" && !strings.HasPrefix(req.APIKey, "****") {
		row.APIKey, _ = encryptSecret(strings.TrimSpace(req.APIKey))
	}
	if strings.TrimSpace(req.SecretKey) != "" && !strings.HasPrefix(req.SecretKey, "****") {
		row.SecretKey, _ = encryptSecret(strings.TrimSpace(req.SecretKey))
	}
	if err := s.DB.Save(&row).Error; err != nil {
		Fail(c, 500, "供应商保存失败")
		return
	}
	OK(c, gin.H{"saved": true})
}

func (s *Server) AdminDeleteProvider(c *gin.Context) {
	id := IDParam(c, "id")
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("provider_id = ?", id).Delete(&models.ProviderModel{}).Error; err != nil {
			return err
		}
		return tx.Delete(&models.ProviderConfig{}, id).Error
	})
	if err != nil {
		Fail(c, 500, "供应商删除失败")
		return
	}
	OK(c, gin.H{"deleted": true})
}

type modelReq struct {
	ModelID          string `json:"modelId"`
	DisplayName      string `json:"displayName"`
	Capability       string `json:"capability"`
	Unit             string `json:"unit"`
	Credits          int64  `json:"credits"`
	Credits480P      int64  `json:"credits480p"`
	Credits720P      int64  `json:"credits720p"`
	Credits1080P     int64  `json:"credits1080p"`
	Enabled          bool   `json:"enabled"`
	SupportsVideoRef bool   `json:"supportsVideoRef"`
	MaxRefImages     int    `json:"maxRefImages"`
}

func (s *Server) AdminCreateModel(c *gin.Context) {
	var req modelReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.ModelID) == "" {
		Fail(c, 400, "模型 ID 不能为空")
		return
	}
	var provider models.ProviderConfig
	if err := s.DB.First(&provider, IDParam(c, "id")).Error; err != nil {
		Fail(c, 404, "供应商不存在")
		return
	}
	req = normalizeModelReq(req)
	row := models.ProviderModel{
		ProviderID: provider.ID, ModelID: req.ModelID, DisplayName: defaultStr(req.DisplayName, req.ModelID),
		Capability: req.Capability, Unit: req.Unit, Credits: req.Credits,
		Credits480P: req.Credits480P, Credits720P: req.Credits720P, Credits1080P: req.Credits1080P,
		Enabled:          req.Enabled,
		SupportsVideoRef: req.SupportsVideoRef, MaxRefImages: req.MaxRefImages,
	}
	if err := s.DB.Create(&row).Error; err != nil {
		Fail(c, 500, "模型创建失败")
		return
	}
	OK(c, row)
}

func (s *Server) AdminUpdateModel(c *gin.Context) {
	var req modelReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, 400, "请求参数有误")
		return
	}
	var row models.ProviderModel
	if err := s.DB.Where("id = ? AND provider_id = ?", IDParam(c, "modelId"), IDParam(c, "id")).First(&row).Error; err != nil {
		Fail(c, 404, "模型不存在")
		return
	}
	req = normalizeModelReq(req)
	if req.ModelID != "" {
		row.ModelID = req.ModelID
	}
	row.DisplayName = defaultStr(req.DisplayName, row.ModelID)
	row.Capability, row.Unit, row.Credits = req.Capability, req.Unit, req.Credits
	row.Credits480P, row.Credits720P, row.Credits1080P = req.Credits480P, req.Credits720P, req.Credits1080P
	row.Enabled, row.SupportsVideoRef, row.MaxRefImages = req.Enabled, req.SupportsVideoRef, req.MaxRefImages
	if err := s.DB.Save(&row).Error; err != nil {
		Fail(c, 500, "模型保存失败")
		return
	}
	OK(c, row)
}

func (s *Server) AdminDeleteModel(c *gin.Context) {
	res := s.DB.Where("id = ? AND provider_id = ?", IDParam(c, "modelId"), IDParam(c, "id")).Delete(&models.ProviderModel{})
	if res.RowsAffected == 0 {
		Fail(c, 404, "模型不存在")
		return
	}
	OK(c, gin.H{"deleted": true})
}

func (s *Server) AdminTestProvider(c *gin.Context) {
	var p models.ProviderConfig
	if err := s.DB.First(&p, IDParam(c, "id")).Error; err != nil {
		Fail(c, 404, "供应商不存在")
		return
	}
	if p.APIKey == "" {
		OK(c, gin.H{"ok": false, "message": "尚未配置 API Key"})
		return
	}
	start := time.Now()
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, strings.TrimRight(p.BaseURL, "/")+"/models", nil)
	if err != nil {
		Fail(c, 400, "Base URL 无效")
		return
	}
	req.Header.Set("Authorization", "Bearer "+decryptSecret(p.APIKey))
	req.Header.Set("Accept", "application/json")
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		OK(c, gin.H{"ok": false, "message": "连接失败：" + err.Error()})
		return
	}
	defer resp.Body.Close()
	OK(c, gin.H{"ok": resp.StatusCode >= 200 && resp.StatusCode < 400, "statusCode": resp.StatusCode, "latencyMs": time.Since(start).Milliseconds(), "message": "供应商接口响应正常"})
}

func (s *Server) AdminGetStorage(c *gin.Context) {
	var list []models.StorageConfig
	s.DB.Order("id asc").Find(&list)
	out := make([]gin.H, 0, len(list))
	for _, item := range list {
		out = append(out, gin.H{
			"id": item.ID, "provider": item.Provider, "endpoint": item.Endpoint, "region": item.Region,
			"bucket": item.Bucket, "accessKey": item.AccessKey, "publicBaseUrl": item.PublicBaseURL,
			"enabled": item.Enabled, "hasSecretKey": item.SecretKey != "", "updatedAt": item.UpdatedAt,
		})
	}
	OK(c, out)
}

func (s *Server) AdminUpdateStorage(c *gin.Context) {
	var req struct {
		Provider      string `json:"provider"`
		Endpoint      string `json:"endpoint"`
		Region        string `json:"region"`
		Bucket        string `json:"bucket"`
		AccessKey     string `json:"accessKey"`
		SecretKey     string `json:"secretKey"`
		PublicBaseURL string `json:"publicBaseUrl"`
		Enabled       bool   `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || (req.Provider != "oss" && req.Provider != "tos" && req.Provider != "cos") {
		Fail(c, 400, "请选择 OSS / TOS / COS 存储引擎")
		return
	}
	if req.Bucket == "" || req.Endpoint == "" {
		Fail(c, 400, "Endpoint 与 Bucket 不能为空")
		return
	}
	var row models.StorageConfig
	err := s.DB.Where("provider = ?", req.Provider).First(&row).Error
	if err == gorm.ErrRecordNotFound {
		row.Provider = req.Provider
	}
	row.Endpoint, row.Region, row.Bucket, row.AccessKey = req.Endpoint, req.Region, req.Bucket, req.AccessKey
	row.PublicBaseURL = normalizePublicBaseURL(req.PublicBaseURL)
	row.Enabled = req.Enabled
	if strings.TrimSpace(req.SecretKey) != "" && !strings.HasPrefix(req.SecretKey, "****") {
		row.SecretKey, _ = encryptSecret(strings.TrimSpace(req.SecretKey))
	}
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if req.Enabled {
			if err := tx.Model(&models.StorageConfig{}).Where("id <> ?", row.ID).Update("enabled", false).Error; err != nil {
				return err
			}
		}
		if row.ID == 0 {
			return tx.Create(&row).Error
		}
		return tx.Save(&row).Error
	})
	if err != nil {
		Fail(c, 500, "存储配置保存失败")
		return
	}
	OK(c, gin.H{"saved": true})
}

func (s *Server) AdminTestStorage(c *gin.Context) {
	var req struct {
		Provider string `json:"provider"`
	}
	_ = c.ShouldBindJSON(&req)
	q := s.DB.Model(&models.StorageConfig{})
	if req.Provider != "" {
		q = q.Where("provider = ?", req.Provider)
	} else {
		q = q.Where("enabled = ?", true)
	}
	var cfg models.StorageConfig
	if err := q.First(&cfg).Error; err != nil {
		Fail(c, 400, "尚未配置对应存储引擎")
		return
	}
	secret := decryptSecret(cfg.SecretKey)
	if cfg.Bucket == "" || cfg.AccessKey == "" || secret == "" {
		OK(c, gin.H{"ok": false, "message": "存储 AccessKey / SecretKey / Bucket 尚未配置完整"})
		return
	}
	engine, err := storage.New(storage.Config{
		Provider: cfg.Provider, Endpoint: cfg.Endpoint, Region: cfg.Region, Bucket: cfg.Bucket,
		AccessKey: cfg.AccessKey, SecretKey: secret, PublicBaseURL: cfg.PublicBaseURL,
		LocalDir: s.UploadDir, LocalBaseURL: s.PublicURL,
	})
	if err != nil {
		OK(c, gin.H{"ok": false, "message": err.Error()})
		return
	}
	start := time.Now()
	if err := engine.Test(c.Request.Context()); err != nil {
		OK(c, gin.H{"ok": false, "message": "对象存储测试失败：" + err.Error()})
		return
	}
	OK(c, gin.H{
		"ok": true, "message": "已完成真实上传、读取与删除测试", "provider": cfg.Provider,
		"bucket": cfg.Bucket, "latencyMs": time.Since(start).Milliseconds(),
	})
}

func (s *Server) AdminGetTikhub(c *gin.Context) {
	var row models.TikhubConfig
	s.DB.First(&row)
	var platformPricing, heatWeights interface{}
	if row.PlatformPricingJSON != "" {
		_ = json.Unmarshal([]byte(row.PlatformPricingJSON), &platformPricing)
	}
	if row.HeatWeightsJSON != "" {
		_ = json.Unmarshal([]byte(row.HeatWeightsJSON), &heatWeights)
	}
	OK(c, gin.H{
		"id": row.ID, "baseUrl": row.BaseURL, "creditsPerPage": row.CreditsPerPage,
		"proxyUrl": row.ProxyURL, "videoLinkCredits": row.VideoLinkCredits,
		"platformPricing": platformPricing, "heatWeights": heatWeights,
		"enabled": row.Enabled, "hasApiKey": row.APIKey != "", "updatedAt": row.UpdatedAt,
	})
}

func (s *Server) AdminUpdateTikhub(c *gin.Context) {
	var req struct {
		BaseURL          string                 `json:"baseUrl"`
		APIKey           string                 `json:"apiKey"`
		CreditsPerPage   int64                  `json:"creditsPerPage"`
		ProxyURL         string                 `json:"proxyUrl"`
		VideoLinkCredits int64                  `json:"videoLinkCredits"`
		PlatformPricing  map[string]interface{} `json:"platformPricing"`
		HeatWeights      map[string]interface{} `json:"heatWeights"`
		Enabled          bool                   `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, 400, "请求参数有误")
		return
	}
	if req.BaseURL == "" {
		Fail(c, 400, "TikHub Base URL 不能为空")
		return
	}
	if req.CreditsPerPage < 0 {
		req.CreditsPerPage = 0
	}
	var row models.TikhubConfig
	s.DB.First(&row)
	row.BaseURL = strings.TrimRight(req.BaseURL, "/")
	row.CreditsPerPage = req.CreditsPerPage
	row.ProxyURL = req.ProxyURL
	row.VideoLinkCredits = req.VideoLinkCredits
	row.Enabled = req.Enabled
	if strings.TrimSpace(req.APIKey) != "" && !strings.HasPrefix(req.APIKey, "****") {
		row.APIKey, _ = encryptSecret(strings.TrimSpace(req.APIKey))
	}
	if req.PlatformPricing != nil {
		data, _ := json.Marshal(req.PlatformPricing)
		row.PlatformPricingJSON = string(data)
	}
	if req.HeatWeights != nil {
		data, _ := json.Marshal(req.HeatWeights)
		row.HeatWeightsJSON = string(data)
	}
	if row.ID == 0 {
		if err := s.DB.Create(&row).Error; err != nil {
			Fail(c, 500, "TikHub 配置保存失败")
			return
		}
	} else if err := s.DB.Save(&row).Error; err != nil {
		Fail(c, 500, "TikHub 配置保存失败")
		return
	}
	OK(c, gin.H{"saved": true})
}

func (s *Server) AdminTestTikhub(c *gin.Context) {
	var row models.TikhubConfig
	s.DB.First(&row)
	if row.BaseURL == "" {
		OK(c, gin.H{"ok": false, "message": "尚未配置 TikHub Base URL"})
		return
	}
	start := time.Now()
	req, _ := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, row.BaseURL+"/", nil)
	if row.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+decryptSecret(row.APIKey))
	}
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		OK(c, gin.H{"ok": false, "message": "连接失败：" + err.Error()})
		return
	}
	defer resp.Body.Close()
	OK(c, gin.H{"ok": resp.StatusCode < 500, "statusCode": resp.StatusCode, "latencyMs": time.Since(start).Milliseconds(), "message": "TikHub 网关响应正常"})
}

func (s *Server) AdminListJobs(c *gin.Context) {
	q := s.DB.Model(&models.StudioJob{})
	if status := c.Query("status"); status != "" && status != "all" {
		q = q.Where("status = ?", status)
	}
	if userID := c.Query("userId"); userID != "" && userID != "all" {
		q = q.Where("owner_user_id = ?", userID)
	}
	var list []models.StudioJob
	q.Order("id desc").Limit(200).Find(&list)
	ids := make([]uint, 0, len(list))
	for _, job := range list {
		ids = append(ids, job.OwnerUserID)
	}
	users := userBriefMap(s, ids)
	out := make([]gin.H, 0, len(list))
	for _, job := range list {
		out = append(out, gin.H{"job": job, "user": users[job.OwnerUserID]})
	}
	OK(c, out)
}

func (s *Server) AdminCancelJob(c *gin.Context) {
	var job models.StudioJob
	if err := s.DB.First(&job, IDParam(c, "id")).Error; err != nil {
		Fail(c, 404, "任务不存在")
		return
	}
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var fresh models.StudioJob
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&fresh, job.ID).Error; err != nil {
			return err
		}
		if fresh.Status == "succeeded" || fresh.Status == "failed" || fresh.Status == "cancelled" {
			return fmt.Errorf("该任务已结束，无法取消")
		}
		if fresh.Status != "running" && fresh.Status != "queued" && fresh.Status != "waiting_for_user" {
			return fmt.Errorf("任务状态已变化，无法取消")
		}
		if !fresh.CreditsSettled && fresh.CreditsCharged > 0 {
			if err := s.refundReserved(tx, fresh.OwnerUserID, fresh.CreditsCharged, jobBizType(fresh.Tool), fmt.Sprint(fresh.ID), "管理员取消任务，全额退回"); err != nil {
				return err
			}
		}
		now := time.Now()
		return tx.Model(&fresh).Updates(map[string]interface{}{
			"status": "cancelled", "credits_settled": true, "completed_at": &now,
			"error_message": "管理员已取消任务，预冻结积分已全额退回",
		}).Error
	})
	if err != nil {
		Fail(c, 400, "取消任务失败："+err.Error())
		return
	}
	OK(c, gin.H{"cancelled": true})
}

func (s *Server) AdminListLedger(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	pageSize := 50
	q := s.DB.Model(&models.CreditTransaction{})
	if bizType := c.Query("bizType"); bizType != "" && bizType != "all" {
		q = q.Where("biz_type = ?", bizType)
	}
	if userID := c.Query("userId"); userID != "" && userID != "all" {
		q = q.Where("user_id = ?", userID)
	}
	var total int64
	q.Count(&total)
	var list []models.CreditTransaction
	q.Order("id desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&list)
	ids := make([]uint, 0, len(list))
	for _, tx := range list {
		ids = append(ids, tx.UserID)
	}
	users := userBriefMap(s, ids)
	out := make([]gin.H, 0, len(list))
	for _, tx := range list {
		out = append(out, gin.H{"transaction": tx, "user": users[tx.UserID]})
	}
	OK(c, gin.H{"list": out, "total": total, "page": page, "pageSize": pageSize})
}

func normalizeModelReq(req modelReq) modelReq {
	if req.Capability != "image" && req.Capability != "video" && req.Capability != "understanding" {
		req.Capability = "image"
	}
	if req.Unit == "" {
		req.Unit = "张"
		if req.Capability == "video" {
			req.Unit = "秒"
		}
		if req.Capability == "understanding" {
			req.Unit = "次"
		}
	}
	if req.Credits < 0 {
		req.Credits = 0
	}
	if req.Credits480P < 0 {
		req.Credits480P = 0
	}
	if req.Credits720P < 0 {
		req.Credits720P = 0
	}
	if req.Credits1080P < 0 {
		req.Credits1080P = 0
	}
	if req.Capability != "video" {
		req.Credits480P, req.Credits720P, req.Credits1080P = 0, 0, 0
	}
	if req.MaxRefImages <= 0 {
		req.MaxRefImages = 4
	}
	return req
}

func isSecretSetting(key string) bool {
	lower := strings.ToLower(key)
	return strings.Contains(lower, "privatekey") ||
		strings.Contains(lower, "apikey") ||
		strings.Contains(lower, "secret") ||
		strings.Contains(lower, "publickey") ||
		strings.Contains(lower, "apiv3key") ||
		strings.HasSuffix(lower, ".key")
}

func randomPassword(n int) string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
	b := make([]byte, n)
	raw := make([]byte, n)
	_, _ = rand.Read(raw)
	for i := range b {
		b[i] = chars[int(raw[i])%len(chars)]
	}
	return string(b)
}

func userBriefMap(s *Server, ids []uint) map[uint]gin.H {
	out := make(map[uint]gin.H)
	if len(ids) == 0 {
		return out
	}
	unique := make([]uint, 0, len(ids))
	seen := map[uint]bool{}
	for _, id := range ids {
		if id > 0 && !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	var users []models.User
	s.DB.Where("id IN ?", unique).Find(&users)
	for _, u := range users {
		out[u.ID] = gin.H{"id": u.ID, "phone": u.Phone, "nickname": u.Nickname, "role": u.Role, "status": u.Status, "credits": u.Credits}
	}
	return out
}

func orderUserIDs(list []models.PaymentOrder) []uint {
	out := make([]uint, 0, len(list))
	for _, order := range list {
		out = append(out, order.UserID)
	}
	return out
}
