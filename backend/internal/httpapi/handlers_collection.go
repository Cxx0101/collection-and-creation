package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"sparkstudio/backend/internal/models"
)

var collectionPlatformNames = map[string]string{
	"douyin": "抖音", "xiaohongshu": "小红书", "tiktok": "TikTok",
}

func (s *Server) ListBatches(c *gin.Context) {
	u := CurrentUser(c)
	var list []models.CollectionBatch
	s.DB.Where("owner_user_id = ?", u.ID).Order("id desc").Limit(50).Find(&list)
	OK(c, list)
}

type createBatchReq struct {
	Platform    string `json:"platform"`
	Keyword     string `json:"keyword"`
	Pages       int    `json:"pages"`
	Limit       int    `json:"limit"`
	ContentType string `json:"contentType"`
	Days        int    `json:"days"`
	Mode        string `json:"mode"`
}

func (s *Server) CreateBatch(c *gin.Context) {
	var req createBatchReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, 400, "请求参数有误")
		return
	}
	req.Platform = strings.TrimSpace(req.Platform)
	req.Keyword = strings.TrimSpace(req.Keyword)
	if _, ok := collectionPlatformNames[req.Platform]; !ok {
		Fail(c, 400, "请选择支持的采集平台")
		return
	}
	if req.Keyword == "" {
		Fail(c, 400, "请输入采集关键词")
		return
	}
	if req.Pages < 1 {
		req.Pages = 1
	}
	if req.Pages > 30 {
		req.Pages = 30
	}
	if req.Limit < 1 {
		req.Limit = 40
	}
	if req.Limit > 500 {
		req.Limit = 500
	}
	if req.ContentType == "" {
		req.ContentType = "video"
	}

	var tk models.TikhubConfig
	s.DB.First(&tk)
	isDev := env("APP_ENV", "development") != "production"
	if !tk.Enabled && !isDev {
		Fail(c, 400, "后台尚未启用 TikHub 采集通道")
		return
	}
	if tk.Enabled && decryptSecret(tk.APIKey) == "" {
		Fail(c, 400, "TikHub API Token 尚未配置")
		return
	}
	unit := creditsPerPage(tk, req.Platform)
	reserved := int64(req.Pages) * unit
	u := CurrentUser(c)

	batch := models.CollectionBatch{
		OwnerUserID: u.ID, Platform: req.Platform, Keyword: req.Keyword,
		Pages: req.Pages, Limit: req.Limit, Status: "queued", Mode: req.Mode, ContentType: req.ContentType,
		PublishedDays: req.Days, CreditsCharged: reserved,
	}

	err := s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&batch).Error; err != nil {
			return err
		}
		if err := s.reserveCredits(tx, u.ID, reserved, "tikhub_collect", fmt.Sprint(batch.ID), fmt.Sprintf("TikHub 采集最多 %d 页 · 单价 %d 积分", req.Pages, unit)); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		if err == errInsufficientCredits {
			Fail(c, 400, "可用积分不足")
		} else {
			Fail(c, 500, "采集任务提交失败："+err.Error())
		}
		return
	}
	s.DB.First(&batch, batch.ID)
	var balance models.User
	s.DB.First(&balance, u.ID)
	OK(c, gin.H{"batch": batch, "user": balance})
}

func (s *Server) ListBatchItems(c *gin.Context) {
	u := CurrentUser(c)
	var batch models.CollectionBatch
	if err := s.DB.Where("id = ? AND owner_user_id = ?", IDParam(c, "id"), u.ID).First(&batch).Error; err != nil {
		Fail(c, 404, "采集批次不存在")
		return
	}
	var items []models.CollectionItem
	s.DB.Where("batch_id = ? AND owner_user_id = ?", batch.ID, u.ID).Order("heat desc, id desc").Find(&items)
	OK(c, gin.H{"batch": batch, "items": items})
}

func (s *Server) DeleteBatch(c *gin.Context) {
	u := CurrentUser(c)
	var batch models.CollectionBatch
	if err := s.DB.Where("id = ? AND owner_user_id = ?", IDParam(c, "id"), u.ID).First(&batch).Error; err != nil {
		Fail(c, 404, "采集批次不存在")
		return
	}
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var current models.CollectionBatch
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND owner_user_id = ?", batch.ID, u.ID).First(&current).Error; err != nil {
			return err
		}
		if !current.CreditsSettled && current.CreditsCharged > 0 {
			if err := s.refundReserved(tx, u.ID, current.CreditsCharged, "tikhub_collect", fmt.Sprint(current.ID), "删除采集批次，退回预冻结积分"); err != nil {
				return err
			}
		}
		if err := tx.Where("batch_id = ? AND owner_user_id = ?", batch.ID, u.ID).Delete(&models.CollectionItem{}).Error; err != nil {
			return err
		}
		return tx.Delete(&batch).Error
	})
	if err != nil {
		Fail(c, 500, "删除采集批次失败")
		return
	}
	OK(c, gin.H{"deleted": true})
}

func (s *Server) ListAllItems(c *gin.Context) {
	u := CurrentUser(c)
	q := s.DB.Model(&models.CollectionItem{}).Where("owner_user_id = ?", u.ID)
	if v := strings.TrimSpace(c.Query("platform")); v != "" && v != "all" {
		q = q.Where("platform = ?", v)
	}
	if v := strings.TrimSpace(c.Query("batchId")); v != "" && v != "all" {
		q = q.Where("batch_id = ?", v)
	}
	if v := strings.TrimSpace(c.Query("q")); v != "" {
		q = q.Where("title LIKE ? OR author LIKE ?", "%"+v+"%", "%"+v+"%")
	}
	sort := "heat desc, id desc"
	if c.Query("sort") == "newest" {
		sort = "id desc"
	}
	var list []models.CollectionItem
	q.Order(sort).Limit(500).Find(&list)
	OK(c, list)
}

func (s *Server) DeleteItem(c *gin.Context) {
	u := CurrentUser(c)
	res := s.DB.Where("id = ? AND owner_user_id = ?", IDParam(c, "id"), u.ID).Delete(&models.CollectionItem{})
	if res.Error != nil {
		Fail(c, http.StatusInternalServerError, "删除采集内容失败")
		return
	}
	if res.RowsAffected == 0 {
		Fail(c, http.StatusNotFound, "采集内容不存在")
		return
	}
	OK(c, gin.H{"deleted": true})
}

func (s *Server) ListCollectionKeywords(c *gin.Context) {
	u := CurrentUser(c)
	var list []models.CollectionKeyword
	s.DB.Where("owner_user_id = ?", u.ID).Order("id desc").Limit(100).Find(&list)
	if len(list) == 0 {
		defaults := []string{"防晒衣显瘦穿搭", "法式冷萃咖啡", "夏日香薰蜡烛", "户外露营机能夹克"}
		for _, keyword := range defaults {
			row := models.CollectionKeyword{OwnerUserID: u.ID, Keyword: keyword}
			s.DB.Create(&row)
			list = append(list, row)
		}
	}
	OK(c, list)
}

func (s *Server) CreateCollectionKeyword(c *gin.Context) {
	var req struct {
		Keyword string `json:"keyword"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Keyword) == "" {
		Fail(c, 400, "关键词不能为空")
		return
	}
	u := CurrentUser(c)
	keyword := strings.TrimSpace(req.Keyword)
	var exists int64
	s.DB.Model(&models.CollectionKeyword{}).Where("owner_user_id = ? AND keyword = ?", u.ID, keyword).Count(&exists)
	if exists > 0 {
		Fail(c, 409, "关键词已存在")
		return
	}
	row := models.CollectionKeyword{OwnerUserID: u.ID, Keyword: keyword}
	if err := s.DB.Create(&row).Error; err != nil {
		Fail(c, 500, "关键词保存失败")
		return
	}
	OK(c, row)
}

func (s *Server) DeleteCollectionKeyword(c *gin.Context) {
	u := CurrentUser(c)
	res := s.DB.Where("id = ? AND owner_user_id = ?", IDParam(c, "id"), u.ID).Delete(&models.CollectionKeyword{})
	if res.RowsAffected == 0 {
		Fail(c, 404, "关键词不存在")
		return
	}
	OK(c, gin.H{"deleted": true})
}

func (s *Server) AIKeywords(c *gin.Context) {
	var req struct {
		Product     string `json:"product"`
		Topic       string `json:"topic"`
		ModelSource string `json:"modelSource"`
		ModelID     string `json:"modelId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, 400, "请求参数有误")
		return
	}
	topic := strings.TrimSpace(req.Topic)
	product := strings.TrimSpace(req.Product)
	if topic == "" && product == "" {
		Fail(c, 400, "请填写商品或主题后再提炼关键词")
		return
	}
	u := CurrentUser(c)
	prompt := fmt.Sprintf("商品：%s\n主题方向：%s\n平台语境：抖音 / 小红书 / TikTok 的中文内容创作。", defaultStr(product, "未限定商品"), defaultStr(topic, "通用内容"))
	system := "你是短视频与图文平台的关键词策略师。只输出 JSON 对象，不要 Markdown、解释或代码围栏。格式必须为 {\"keywords\":[\"关键词1\",\"关键词2\"]}，生成 8 到 12 个中文长尾检索词，兼顾商品、场景、痛点、内容形式，不得照抄输入。"
	var parsed struct {
		Keywords []string `json:"keywords"`
	}
	_, charged, source, err := s.runUnderstanding(
		c.Request.Context(), u.ID, req.ModelSource, req.ModelID,
		"ai_keywords", "AI 关键词提炼", system, prompt,
		func(value string) error {
			if err := decodeModelJSON(value, &parsed); err != nil {
				return err
			}
			if len(parsed.Keywords) == 0 {
				return errors.New("模型没有返回可用关键词，请重试")
			}
			return nil
		},
	)
	if err != nil {
		Fail(c, 400, err.Error())
		return
	}
	seen := make(map[string]bool, len(parsed.Keywords))
	out := make([]string, 0, 12)
	for _, keyword := range parsed.Keywords {
		keyword = strings.TrimSpace(keyword)
		if keyword == "" || seen[keyword] {
			continue
		}
		seen[keyword] = true
		out = append(out, keyword)
		if len(out) == 12 {
			break
		}
	}
	if len(out) == 0 {
		Fail(c, 502, "模型没有返回可用关键词")
		return
	}
	var user models.User
	s.DB.First(&user, u.ID)
	OK(c, gin.H{"keywords": out, "source": source, "creditsCharged": charged, "user": user})
}

func creditsPerPage(tk models.TikhubConfig, platform string) int64 {
	if tk.PlatformPricingJSON != "" {
		var prices map[string]int64
		if json.Unmarshal([]byte(tk.PlatformPricingJSON), &prices) == nil {
			if v := prices[platform]; v > 0 {
				return v
			}
		}
	}
	if tk.CreditsPerPage > 0 {
		return tk.CreditsPerPage
	}
	return 10
}

func buildCollectionItems(userID, batchID uint, req createBatchReq) []models.CollectionItem {
	limit := req.Limit
	if limit > req.Pages*10 {
		limit = req.Pages * 10
	}
	if limit > 80 {
		limit = 80
	}
	if limit < 1 {
		limit = 1
	}
	topics := []string{
		"%s 爆款实拍分镜", "%s 全场景套图", "%s 种草笔记复刻", "%s 开箱与细节特写",
		"%s 通勤场景搭配", "%s 15 秒商品质感视频", "%s 户外氛围展示", "%s 高级感棚拍",
	}
	authors := []string{"灵感研究所", "爆款观察室", "山野内容社", "品牌视觉志", "轻生活手记", "短视频拆解组"}
	now := time.Now().UnixNano()
	items := make([]models.CollectionItem, 0, limit)
	for i := 0; i < limit; i++ {
		heat := 98 - (i*7)%36
		title := fmt.Sprintf(topics[i%len(topics)], req.Keyword)
		items = append(items, models.CollectionItem{
			BatchID: batchID, OwnerUserID: userID, Platform: req.Platform,
			ExternalID: fmt.Sprintf("%s-%d-%02d", req.Platform, now, i+1),
			Title:      title, Author: authors[i%len(authors)], Heat: heat,
			ContentType: req.ContentType, Seed: i % 6, Saved: true,
			Description: title,
		})
	}
	return items
}

func parseUintParam(c *gin.Context, key string, def uint) uint {
	v, err := strconv.ParseUint(c.Query(key), 10, 64)
	if err != nil {
		return def
	}
	return uint(v)
}

func appIsDev() bool {
	return env("APP_ENV", "development") != "production"
}
