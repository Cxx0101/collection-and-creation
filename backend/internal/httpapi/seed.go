package httpapi

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"gorm.io/gorm"

	"sparkstudio/backend/internal/auth"
	"sparkstudio/backend/internal/models"
)

const demoShowcaseVersion = "2026-11-26.1"

func (s *Server) Seed() error {
	defaults := map[string]string{
		"registration.enabled":             "true",
		"registration.smsRequired":         "false",
		"registration.giftCredits":         "100",
		"registration.contactAdmin":        "当前已关闭短信验证码，忘记密码请联系管理员在后台重置。",
		"sms.signName":                     "星芒创作",
		"sms.templateCode":                 "SMS_465201",
		"site.name":                        "星芒创作 SparkStudio",
		"payment.alipay.enabled":           "false",
		"payment.wechat.enabled":           "false",
		"payment.mockMode":                 "true",
		"payment.alipay.appId":             "",
		"payment.alipay.privateKey":        "",
		"payment.alipay.publicKey":         "",
		"payment.alipay.gateway":           "https://openapi.alipay.com/gateway.do",
		"payment.alipay.notifyUrl":         "",
		"payment.alipay.sellerId":          "",
		"payment.wechat.mchId":             "",
		"payment.wechat.appId":             "",
		"payment.wechat.apiV3Key":          "",
		"payment.wechat.serialNo":          "",
		"payment.wechat.privateKey":        "",
		"payment.wechat.platformPublicKey": "",
		"payment.wechat.apiBase":           "https://api.mch.weixin.qq.com",
		"payment.wechat.notifyUrl":         "",
		"payment.fyepay.enabled":           "false",
		"payment.fyepay.mchId":             "",
		"payment.fyepay.key":               "",
		"payment.fyepay.gateway":           "https://api.fyepay.com/getaway",
		"payment.fyepay.notifyUrl":         "",
		"payment.fyepay.tradeIp":           "",
	}
	for k, v := range defaults {
		var count int64
		s.DB.Model(&models.SystemSetting{}).Where("`key` = ?", k).Count(&count)
		if count == 0 {
			if err := s.SetSetting(k, v); err != nil {
				return err
			}
		}
	}

	var adminCount int64
	s.DB.Model(&models.User{}).Where("role = ?", "admin").Count(&adminCount)
	if adminCount == 0 {
		adminPhone := env("ADMIN_INIT_PHONE", "13800000000")
		adminPwd := os.Getenv("ADMIN_INIT_PASSWORD")
		if adminPwd == "" {
			if env("APP_ENV", "development") == "production" {
				adminPwd = randomPassword(18)
				log.Printf("initial administrator password (change after first login): %s", adminPwd)
			} else {
				adminPwd = "Admin@123456"
			}
		}
		adminHash, _ := auth.HashPassword(adminPwd)
		admin := models.User{
			Phone: adminPhone, PasswordHash: adminHash, Nickname: "系统管理员",
			Role: "admin", Status: "active", TokenVersion: 1, Credits: 0,
			CreatedAt: time.Now().AddDate(0, -1, 0),
		}
		if err := s.DB.Create(&admin).Error; err != nil {
			return err
		}
	}

	var demoUserCount int64
	s.DB.Model(&models.User{}).Where("role = ?", "user").Count(&demoUserCount)
	if demoUserCount == 0 && env("APP_ENV", "development") != "production" {
		demoPhone := env("DEMO_USER_PHONE", "13812349021")
		demoPwd := env("DEMO_USER_PASSWORD", "Demo@123456")
		demoHash, _ := auth.HashPassword(demoPwd)
		now := time.Now()
		users := []models.User{
			{Phone: demoPhone, PasswordHash: demoHash, Nickname: "陈小星", Role: "user", Status: "active", TokenVersion: 1, Credits: 1280, TotalRecharged: 2500, TotalConsumed: 1190, CreatedAt: now.AddDate(0, 0, -10), LastLoginAt: &now},
			{Phone: "13966778820", PasswordHash: demoHash, Nickname: "林夕选品组", Role: "user", Status: "active", TokenVersion: 1, Credits: 460, CreatedAt: now.AddDate(0, 0, -5)},
		}
		if err := s.DB.Create(&users).Error; err != nil {
			return err
		}
		demo := users[0]

		assets := []models.Asset{
			{OwnerUserID: demo.ID, Name: "防晒衣海边外景生成图_01.png", Kind: "image", Source: "AI 生成", Size: "2.4 MB", Seed: 1, CreatedAt: now.Add(-10 * time.Minute)},
			{OwnerUserID: demo.ID, Name: "冷萃咖啡分镜成片_15s.mp4", Kind: "video", Source: "爆款复刻", Size: "14.8 MB", Seed: 4, CreatedAt: now.Add(-1 * time.Hour)},
			{OwnerUserID: demo.ID, Name: "模特素颜棚拍原图.jpg", Kind: "image", Source: "个人上传", Size: "3.1 MB", Seed: 3, CreatedAt: now.AddDate(0, 0, -1)},
			{OwnerUserID: demo.ID, Name: "夏季爆品文案规范.md", Kind: "markdown", Source: "技能文档", Size: "18 KB", Seed: 2, CreatedAt: now.AddDate(0, 0, -2)},
			{OwnerUserID: demo.ID, Name: "山茶花精华滴管棚拍精修.png", Kind: "image", Source: "AI 精修", Size: "2.9 MB", Seed: 0, CreatedAt: now.AddDate(0, 0, -3)},
			{OwnerUserID: demo.ID, Name: "POD冲锋衣6场景套图_V1.png", Kind: "image", Source: "POD 裂变", Size: "3.6 MB", Seed: 5, CreatedAt: now.AddDate(0, 0, -4)},
			{OwnerUserID: demo.ID, Name: "通勤托特包街拍实景成片.mp4", Kind: "video", Source: "商品视频", Size: "11.2 MB", Seed: 2, CreatedAt: now.AddDate(0, 0, -5)},
			{OwnerUserID: demo.ID, Name: "冰感防晒衣种草排版指南.md", Kind: "markdown", Source: "技能文档", Size: "24 KB", Seed: 4, CreatedAt: now.AddDate(0, 0, -6)},
			{OwnerUserID: demo.ID, Name: "法式冷萃商业棚拍_主图.png", Kind: "image", Source: "AI 生图", Size: "2.7 MB", Seed: 1, CreatedAt: now.AddDate(0, 0, -7)},
			{OwnerUserID: demo.ID, Name: "不锈钢保温杯去杂光精修.png", Kind: "image", Source: "AI 精修", Size: "3.0 MB", Seed: 5, CreatedAt: now.AddDate(0, 0, -8)},
		}
		s.DB.Create(&assets)

		products := []models.Product{
			{OwnerUserID: demo.ID, Name: "法式冷萃咖啡礼盒", Description: "主打冷萃即溶，送礼与自用双场景", Seed: 1},
			{OwnerUserID: demo.ID, Name: "冰感原纱防晒衣", Description: "轻薄凉感，户外通勤两用", Seed: 5},
			{OwnerUserID: demo.ID, Name: "山茶花精华滴管瓶", Description: "清透玻璃瓶身与高级金属滴管", Seed: 0},
		}
		s.DB.Create(&products)
		for i := range products {
			imgs := []models.ProductImage{
				{ProductID: products[i].ID, Name: products[i].Name + "正面主图.png", Seed: products[i].Seed, SortOrder: 1},
				{ProductID: products[i].ID, Name: products[i].Name + "细节特写.png", Seed: products[i].Seed + 2, SortOrder: 2},
				{ProductID: products[i].ID, Name: products[i].Name + "场景展示.png", Seed: products[i].Seed + 3, SortOrder: 3},
			}
			s.DB.Create(&imgs)
		}

		workflows := []models.Workflow{
			{OwnerUserID: demo.ID, Name: "每日防晒衣抖音采集 + 自动视频复刻", Schedule: "daily", Enabled: true, NodesJSON: `["trigger","collect","filter","foreach","clone_video","archive"]`, EstimatedCredits: 65, LastRun: "今天 09:00 · 已提交"},
			{OwnerUserID: demo.ID, Name: "每周 POD 服装场景裂变套图", Schedule: "weekly", Enabled: false, NodesJSON: `["trigger","product","scene_variation","archive"]`, EstimatedCredits: 48, LastRun: "已暂停"},
		}
		s.DB.Create(&workflows)

		skills := []models.Skill{
			{Name: "wechat-article-layout", Description: "内置 · 公众号文章 Fresh 清新排版与配图规范", Content: "# WeChat Article Layout\n- 段落控制在 120 字以内\n- 保持 375px 移动端留白呼吸感", Builtin: true},
			{Name: "xiaohongshu-hook", OwnerUserID: demo.ID, Description: "个人 · 小红书强痛点前三秒标题与情绪钩子", Content: "# 小红书钩子模板\n1. 数字冲突开头\n2. 真实场景切入\n3. 避免硬广词"},
			{Name: "pod-studio-lighting", OwnerUserID: demo.ID, Description: "个人 · 服装 POD 棚拍白底与织物纹理增强", Content: "# POD Studio Lighting\n- 保持接缝走线清晰\n- 禁止篡改印花图案比例"},
		}
		s.DB.Create(&skills)

		batch := models.CollectionBatch{OwnerUserID: demo.ID, Platform: "douyin", Keyword: "夏季防晒衣", Pages: 2, PagesFetched: 2, CreditsCharged: 20, CreditsSettled: true, Status: "succeeded", ItemCount: 8, Mode: "demo", CreatedAt: now.Add(-2 * time.Hour)}
		s.DB.Create(&batch)
		items := []models.CollectionItem{
			{BatchID: batch.ID, OwnerUserID: demo.ID, Platform: "douyin", ExternalID: "dy-001", Title: "护肤精华 15s 质地微距 + 场景转场分镜", Author: "美妆研究所", Heat: 96, Seed: 4, ContentType: "video", Duration: 15, MetricsJSON: `{"likes":62000,"comments":2300,"saves":11400,"shares":5400}`},
			{BatchID: batch.ID, OwnerUserID: demo.ID, Platform: "xiaohongshu", ExternalID: "xhs-001", Title: "户外露营机能夹克 6-9 张全场景服装套图", Author: "山野穿搭志", Heat: 93, Seed: 2, ContentType: "image", MetricsJSON: `{"likes":48200,"comments":1940,"saves":15200,"shares":6300}`},
			{BatchID: batch.ID, OwnerUserID: demo.ID, Platform: "xiaohongshu", ExternalID: "xhs-002", Title: "极简桌面香薰蜡烛 4 图种草笔记复刻", Author: "居家氛围组", Heat: 91, Seed: 5, ContentType: "image", MetricsJSON: `{"likes":22400,"comments":860,"saves":18900,"shares":3100}`},
			{BatchID: batch.ID, OwnerUserID: demo.ID, Platform: "douyin", ExternalID: "dy-002", Title: "不锈钢保温杯夏日冰饮场景实拍", Author: "杯具研究所", Heat: 89, Seed: 1, ContentType: "video", Duration: 18, MetricsJSON: `{"likes":38400,"comments":1410,"saves":13200,"shares":4600}`},
			{BatchID: batch.ID, OwnerUserID: demo.ID, Platform: "xiaohongshu", ExternalID: "xhs-003", Title: "冰感防晒衣通勤穿搭 3 套场景", Author: "通勤衣橱", Heat: 88, Seed: 3, ContentType: "image", MetricsJSON: `{"likes":19600,"comments":740,"saves":16200,"shares":2450}`},
			{BatchID: batch.ID, OwnerUserID: demo.ID, Platform: "tiktok", ExternalID: "tt-001", Title: "夏日冷萃咖啡 15 秒质感动画", Author: "Coffee Lab", Heat: 87, Seed: 0, ContentType: "video", Duration: 15, MetricsJSON: `{"likes":31500,"comments":1120,"saves":9400,"shares":4100}`},
			{BatchID: batch.ID, OwnerUserID: demo.ID, Platform: "douyin", ExternalID: "dy-003", Title: "法式冷萃礼盒开箱 + 手持特写", Author: "礼盒开箱局", Heat: 85, Seed: 4, ContentType: "video", Duration: 9, MetricsJSON: `{"likes":28900,"comments":980,"saves":11800,"shares":3820}`},
			{BatchID: batch.ID, OwnerUserID: demo.ID, Platform: "xiaohongshu", ExternalID: "xhs-004", Title: "小户型桌面香薰布置指南", Author: "慢生活手记", Heat: 83, Seed: 2, ContentType: "image", MetricsJSON: `{"likes":16800,"comments":620,"saves":14500,"shares":1980}`},
		}
		s.DB.Create(&items)

		txs := []models.CreditTransaction{
			{UserID: demo.ID, Kind: "recharge", BizType: "payment_order", BizID: "seed-1", DeltaAvailable: 1000, BalanceAfter: 1000, Note: "支付宝充值 1000 积分", CreatedAt: now.AddDate(0, 0, -6)},
			{UserID: demo.ID, Kind: "recharge", BizType: "payment_order", BizID: "seed-2", DeltaAvailable: 1500, BalanceAfter: 2500, Note: "微信充值 1500 积分", CreatedAt: now.AddDate(0, 0, -3)},
			{UserID: demo.ID, Kind: "settle", BizType: "tikhub_collect", BizID: fmt.Sprint(batch.ID), DeltaAvailable: -20, DeltaConsumed: 20, BalanceAfter: 2480, Note: "TikHub 采集 2 页", CreatedAt: now.Add(-2 * time.Hour)},
			{UserID: demo.ID, Kind: "settle", BizType: "image_generate", BizID: "seed-job-1", DeltaAvailable: -72, DeltaConsumed: 72, BalanceAfter: 2408, Note: "服装套图 6 张", CreatedAt: now.Add(-90 * time.Minute)},
		}
		s.DB.Create(&txs)
	}

	var pkgCount int64
	s.DB.Model(&models.CreditPackage{}).Count(&pkgCount)
	if pkgCount == 0 {
		s.DB.Create(&[]models.CreditPackage{
			{Name: "轻量体验包", BadgeText: "新手首选", Description: "适合体验 TikHub 采集与单张 AI 生图创作", PriceCents: 1900, Credits: 200, BonusCredits: 20, SortOrder: 1, Enabled: true},
			{Name: "创作者标准包", BadgeText: "最受欢迎", Description: "覆盖约 60 次采集翻页或 40 次视频/套图生成", PriceCents: 4900, Credits: 600, BonusCredits: 100, SortOrder: 2, Enabled: true},
			{Name: "爆款团队包", BadgeText: "高性价比", Description: "高频视频复刻、POD 服装套图与自动化计划首选", PriceCents: 9900, Credits: 1400, BonusCredits: 300, SortOrder: 3, Enabled: true},
			{Name: "旗舰创作包", BadgeText: "赠送最多", Description: "全平台大模型高频调用与大批量流水线专属", PriceCents: 29900, Credits: 4500, BonusCredits: 1200, SortOrder: 4, Enabled: true},
		})
	}

	var providerCount int64
	s.DB.Model(&models.ProviderConfig{}).Count(&providerCount)
	if providerCount == 0 {
		providerEnabled := appIsDev()
		providers := []models.ProviderConfig{
			{Provider: "ark", DisplayName: "火山方舟主节点", BaseURL: "https://ark.cn-beijing.volces.com/api/v3", Enabled: providerEnabled, SortOrder: 1},
			{Provider: "openai", DisplayName: "OpenAI 官方企业通道", BaseURL: "https://api.openai.com/v1", Enabled: providerEnabled, SortOrder: 2},
			{Provider: "google", DisplayName: "Google Nano Banana", BaseURL: "https://generativelanguage.googleapis.com/v1beta", Enabled: providerEnabled, SortOrder: 3},
			{Provider: "kling", DisplayName: "可灵官方视频生成", BaseURL: "https://api.klingai.com", Enabled: providerEnabled, SortOrder: 4},
			{Provider: "deepseek", DisplayName: "DeepSeek 主集群", BaseURL: "https://api.deepseek.com/v1", Enabled: providerEnabled, SortOrder: 5},
			{Provider: "midjourney", DisplayName: "Midjourney 兼容网关", BaseURL: "https://mj-proxy.example.com/v1", Enabled: providerEnabled, SortOrder: 6},
			{Provider: "minimax", DisplayName: "MiniMax 海螺平台", BaseURL: "https://api.minimax.chat", Enabled: providerEnabled, SortOrder: 7},
			{Provider: "qwen", DisplayName: "通义万相 / 阿里百炼", BaseURL: "https://dashscope.aliyuncs.com", Enabled: providerEnabled, SortOrder: 8},
		}
		s.DB.Create(&providers)
		modelsByProvider := map[string][]models.ProviderModel{
			"ark": {
				{ModelID: "doubao-seedream-3-0-t2i", DisplayName: "Seedream 3.0", Capability: "image", Unit: "张", Credits: 12, Enabled: true},
				{ModelID: "doubao-seedance-2-5", DisplayName: "Seedance 2.5", Capability: "video", Unit: "秒", Credits: 6, Enabled: true, SupportsVideoRef: true, MaxRefImages: 4},
				{ModelID: "doubao-1-5-vision-pro", DisplayName: "Doubao 1.5 Vision Pro", Capability: "understanding", Unit: "次", Credits: 2, Enabled: true},
			},
			"openai": {
				{ModelID: "gpt-image-1", DisplayName: "GPT Image 1", Capability: "image", Unit: "张", Credits: 18, Enabled: true},
				{ModelID: "gpt-4.1", DisplayName: "GPT-4.1", Capability: "understanding", Unit: "次", Credits: 3, Enabled: true},
			},
			"google": {
				{ModelID: "nano-banana-pro", DisplayName: "Nano Banana Pro", Capability: "image", Unit: "张", Credits: 16, Enabled: true},
				{ModelID: "gemini-2.5-pro", DisplayName: "Gemini 2.5 Pro", Capability: "understanding", Unit: "次", Credits: 2, Enabled: true},
			},
			"kling": {
				{ModelID: "kling-v2", DisplayName: "可灵 V2", Capability: "video", Unit: "秒", Credits: 10, Enabled: true, SupportsVideoRef: true, MaxRefImages: 2},
			},
			"deepseek": {
				{ModelID: "deepseek-v3", DisplayName: "DeepSeek V3", Capability: "understanding", Unit: "次", Credits: 2, Enabled: true},
			},
			"midjourney": {
				{ModelID: "mj-v6.1", DisplayName: "Midjourney V6.1", Capability: "image", Unit: "张", Credits: 20, Enabled: true},
			},
			"minimax": {
				{ModelID: "hailuo-v2", DisplayName: "海螺 V2", Capability: "video", Unit: "秒", Credits: 8, Enabled: true, SupportsVideoRef: true, MaxRefImages: 1},
			},
			"qwen": {
				{ModelID: "wan-2.1", DisplayName: "通义万相 2.1", Capability: "video", Unit: "秒", Credits: 7, Enabled: true, SupportsVideoRef: true, MaxRefImages: 1},
			},
		}
		for _, p := range providers {
			for _, m := range modelsByProvider[p.Provider] {
				m.ProviderID = p.ID
				s.DB.Create(&m)
			}
		}
	}

	storageDefaults := []models.StorageConfig{
		{Provider: "oss", Endpoint: "oss-cn-hangzhou.aliyuncs.com", Region: "cn-hangzhou", Bucket: "sparkstudio-media-prod", Enabled: false},
		{Provider: "tos", Endpoint: "tos-cn-beijing.volces.com", Region: "cn-beijing", Bucket: "sparkstudio-tos", Enabled: false},
		{Provider: "cos", Endpoint: "cos.ap-shanghai.myqcloud.com", Region: "ap-shanghai", Bucket: "sparkstudio-13098123", Enabled: false},
	}
	for _, storageDefault := range storageDefaults {
		var storageCount int64
		s.DB.Model(&models.StorageConfig{}).Where("provider = ?", storageDefault.Provider).Count(&storageCount)
		if storageCount == 0 {
			if err := s.DB.Create(&storageDefault).Error; err != nil {
				return err
			}
		}
	}
	var tikhubCount int64
	s.DB.Model(&models.TikhubConfig{}).Count(&tikhubCount)
	if tikhubCount == 0 {
		s.DB.Create(&models.TikhubConfig{BaseURL: "https://api.tikhub.io", CreditsPerPage: 10, Enabled: false})
	}
	if err := s.seedBuiltinStudioSkills(); err != nil {
		return err
	}
	s.SeedDemoCollectionMetrics()
	return s.seedDevelopmentShowcase()
}

func (s *Server) seedDevelopmentShowcase() error {
	if strings.EqualFold(env("APP_ENV", "development"), "production") {
		return nil
	}
	var marker models.SystemSetting
	if err := s.DB.First(&marker, "`key` = ?", "demo.showcaseVersion").Error; err == nil && marker.Value == demoShowcaseVersion {
		return nil
	}
	if err := s.upgradeLegacyDemoPackages(); err != nil {
		return err
	}
	if err := s.upgradeLegacyDemoProviders(); err != nil {
		return err
	}
	if err := s.seedDemoOrders(); err != nil {
		return err
	}
	return s.SetSetting("demo.showcaseVersion", demoShowcaseVersion)
}

func (s *Server) upgradeLegacyDemoPackages() error {
	var list []models.CreditPackage
	if err := s.DB.Order("sort_order asc, id asc").Find(&list).Error; err != nil || len(list) != 4 {
		return err
	}
	legacy := []models.CreditPackage{
		{Name: "轻量体验包", BadgeText: "", Description: "适合首次体验采集与单张生图", PriceCents: 6000, Credits: 600, BonusCredits: 0},
		{Name: "创作者标准包", BadgeText: "最受欢迎", Description: "日常采集与套图创作首选", PriceCents: 15000, Credits: 1500, BonusCredits: 100},
		{Name: "专业生产力包", BadgeText: "赠 300", Description: "适合高频视频复刻与批量套图", PriceCents: 30000, Credits: 3000, BonusCredits: 300},
		{Name: "团队协作包", BadgeText: "超值", Description: "大额创作与广告投放素材储备", PriceCents: 60000, Credits: 6000, BonusCredits: 900},
	}
	for index, old := range legacy {
		row := list[index]
		if row.Name != old.Name || row.PriceCents != old.PriceCents || row.Credits != old.Credits || row.BonusCredits != old.BonusCredits {
			return nil
		}
	}
	defaults := []models.CreditPackage{
		{Name: "轻量体验包", BadgeText: "新手首选", Description: "适合体验 TikHub 采集与单张 AI 生图创作", PriceCents: 1900, Credits: 200, BonusCredits: 20, SortOrder: 1, Enabled: true},
		{Name: "创作者标准包", BadgeText: "最受欢迎", Description: "覆盖约 60 次采集翻页或 40 次视频/套图生成", PriceCents: 4900, Credits: 600, BonusCredits: 100, SortOrder: 2, Enabled: true},
		{Name: "爆款团队包", BadgeText: "高性价比", Description: "高频视频复刻、POD 服装套图与自动化计划首选", PriceCents: 9900, Credits: 1400, BonusCredits: 300, SortOrder: 3, Enabled: true},
		{Name: "旗舰创作包", BadgeText: "赠送最多", Description: "全平台大模型高频调用与大批量流水线专属", PriceCents: 29900, Credits: 4500, BonusCredits: 1200, SortOrder: 4, Enabled: true},
	}
	return s.DB.Transaction(func(tx *gorm.DB) error {
		for index, row := range defaults {
			updates := map[string]interface{}{
				"name": row.Name, "badge_text": row.BadgeText, "description": row.Description,
				"price_cents": row.PriceCents, "credits": row.Credits, "bonus_credits": row.BonusCredits,
				"sort_order": row.SortOrder, "enabled": row.Enabled,
			}
			if err := tx.Model(&models.CreditPackage{}).Where("id = ?", list[index].ID).Updates(updates).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Server) upgradeLegacyDemoProviders() error {
	var existing []models.ProviderConfig
	if err := s.DB.Order("sort_order asc, id asc").Find(&existing).Error; err != nil || len(existing) != 4 {
		return err
	}
	legacyNames := map[string]string{
		"ark": "火山方舟", "openai": "OpenAI", "google": "Google Gemini", "deepseek": "DeepSeek",
	}
	for _, row := range existing {
		if legacyNames[row.Provider] != row.DisplayName {
			return nil
		}
	}

	type providerSeed struct {
		Provider    models.ProviderConfig
		ProviderKey string
		Models      []models.ProviderModel
	}
	seeds := []providerSeed{
		{Provider: models.ProviderConfig{Provider: "ark", DisplayName: "火山方舟主节点", BaseURL: "https://ark.cn-beijing.volces.com/api/v3", Enabled: true, SortOrder: 1}, Models: []models.ProviderModel{
			{ModelID: "doubao-seedream-3-0-t2i", DisplayName: "Seedream 3.0", Capability: "image", Unit: "张", Credits: 12, Enabled: true},
			{ModelID: "doubao-seedance-2-5", DisplayName: "Seedance 2.5", Capability: "video", Unit: "秒", Credits: 6, Enabled: true, SupportsVideoRef: true, MaxRefImages: 4},
			{ModelID: "doubao-1-5-vision-pro", DisplayName: "Doubao 1.5 Vision Pro", Capability: "understanding", Unit: "次", Credits: 2, Enabled: true},
		}},
		{Provider: models.ProviderConfig{Provider: "openai", DisplayName: "OpenAI 官方企业通道", BaseURL: "https://api.openai.com/v1", Enabled: true, SortOrder: 2}, Models: []models.ProviderModel{
			{ModelID: "gpt-image-1", DisplayName: "GPT Image 1", Capability: "image", Unit: "张", Credits: 18, Enabled: true},
			{ModelID: "gpt-4.1", DisplayName: "GPT-4.1", Capability: "understanding", Unit: "次", Credits: 3, Enabled: true},
		}},
		{Provider: models.ProviderConfig{Provider: "google", DisplayName: "Google Nano Banana", BaseURL: "https://generativelanguage.googleapis.com/v1beta", Enabled: true, SortOrder: 3}, Models: []models.ProviderModel{
			{ModelID: "nano-banana-pro", DisplayName: "Nano Banana Pro", Capability: "image", Unit: "张", Credits: 16, Enabled: true},
			{ModelID: "gemini-2.5-pro", DisplayName: "Gemini 2.5 Pro", Capability: "understanding", Unit: "次", Credits: 2, Enabled: true},
		}},
		{Provider: models.ProviderConfig{Provider: "kling", DisplayName: "可灵官方视频生成", BaseURL: "https://api.klingai.com", Enabled: true, SortOrder: 4}, Models: []models.ProviderModel{
			{ModelID: "kling-v2", DisplayName: "可灵 V2", Capability: "video", Unit: "秒", Credits: 10, Enabled: true, SupportsVideoRef: true, MaxRefImages: 2},
		}},
		{Provider: models.ProviderConfig{Provider: "deepseek", DisplayName: "DeepSeek 主集群", BaseURL: "https://api.deepseek.com/v1", Enabled: true, SortOrder: 5}, Models: []models.ProviderModel{
			{ModelID: "deepseek-v3", DisplayName: "DeepSeek V3", Capability: "understanding", Unit: "次", Credits: 2, Enabled: true},
		}},
		{Provider: models.ProviderConfig{Provider: "midjourney", DisplayName: "Midjourney 兼容网关", BaseURL: "https://mj-proxy.example.com/v1", Enabled: true, SortOrder: 6}, Models: []models.ProviderModel{
			{ModelID: "mj-v6.1", DisplayName: "Midjourney V6.1", Capability: "image", Unit: "张", Credits: 20, Enabled: true},
		}},
		{Provider: models.ProviderConfig{Provider: "minimax", DisplayName: "MiniMax 海螺平台", BaseURL: "https://api.minimax.chat", Enabled: true, SortOrder: 7}, Models: []models.ProviderModel{
			{ModelID: "hailuo-v2", DisplayName: "海螺 V2", Capability: "video", Unit: "秒", Credits: 8, Enabled: true, SupportsVideoRef: true, MaxRefImages: 1},
		}},
		{Provider: models.ProviderConfig{Provider: "qwen", DisplayName: "通义万相 / 阿里百炼", BaseURL: "https://dashscope.aliyuncs.com", Enabled: true, SortOrder: 8}, Models: []models.ProviderModel{
			{ModelID: "wan-2.1", DisplayName: "通义万相 2.1", Capability: "video", Unit: "秒", Credits: 7, Enabled: true, SupportsVideoRef: true, MaxRefImages: 1},
		}},
	}
	return s.DB.Transaction(func(tx *gorm.DB) error {
		for _, seed := range seeds {
			var provider models.ProviderConfig
			err := tx.Where("provider = ?", seed.Provider.Provider).First(&provider).Error
			if err == gorm.ErrRecordNotFound {
				provider = seed.Provider
				if err := tx.Create(&provider).Error; err != nil {
					return err
				}
			} else if err != nil {
				return err
			} else {
				if err := tx.Model(&provider).Updates(map[string]interface{}{
					"display_name": seed.Provider.DisplayName,
					"base_url":     seed.Provider.BaseURL,
					"enabled":      seed.Provider.Enabled,
					"sort_order":   seed.Provider.SortOrder,
				}).Error; err != nil {
					return err
				}
			}
			if err := tx.Where("provider_id = ?", provider.ID).Delete(&models.ProviderModel{}).Error; err != nil {
				return err
			}
			for _, model := range seed.Models {
				model.ProviderID = provider.ID
				if err := tx.Create(&model).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func (s *Server) seedDemoOrders() error {
	var demo models.User
	if err := s.DB.Where("phone = ?", env("DEMO_USER_PHONE", "13812349021")).First(&demo).Error; err != nil {
		return nil
	}
	var secondary models.User
	if err := s.DB.Where("phone = ?", "13966778820").First(&secondary).Error; err != nil {
		return nil
	}
	var creatorPackage, teamPackage models.CreditPackage
	if err := s.DB.Where("name = ?", "创作者标准包").First(&creatorPackage).Error; err != nil {
		return err
	}
	if err := s.DB.Where("name = ?", "爆款团队包").First(&teamPackage).Error; err != nil {
		return err
	}
	now := time.Now()
	paidOne := now.AddDate(0, 0, -1)
	paidTwo := now.AddDate(0, 0, -3)
	orders := []models.PaymentOrder{
		{
			OrderNo: "ORD20261125164022", UserID: secondary.ID, PackageID: creatorPackage.ID, PackageName: creatorPackage.Name,
			AmountCents: creatorPackage.PriceCents, Credits: creatorPackage.Credits, BonusCredits: creatorPackage.BonusCredits,
			Channel: "wechat", Gateway: "direct", Status: "pending", PayMode: "qrcode",
			ExpiresAt: now.Add(28 * time.Minute), CreatedAt: now.Add(-2 * time.Hour),
		},
		{
			OrderNo: "ORD20261125104208", UserID: demo.ID, PackageID: teamPackage.ID, PackageName: teamPackage.Name,
			AmountCents: teamPackage.PriceCents, Credits: teamPackage.Credits, BonusCredits: teamPackage.BonusCredits,
			Channel: "alipay", Gateway: "direct", Status: "paid", ExternalTradeNo: "seed-alipay-1700", PayMode: "qrcode",
			PaidAt: &paidOne, ExpiresAt: paidOne.Add(30 * time.Minute), CreatedAt: paidOne.Add(-8 * time.Hour),
		},
		{
			OrderNo: "ORD20261123162011", UserID: demo.ID, PackageID: creatorPackage.ID, PackageName: creatorPackage.Name,
			AmountCents: creatorPackage.PriceCents, Credits: creatorPackage.Credits, BonusCredits: creatorPackage.BonusCredits,
			Channel: "wechat", Gateway: "direct", Status: "paid", ExternalTradeNo: "seed-wechat-700", PayMode: "qrcode",
			PaidAt: &paidTwo, ExpiresAt: paidTwo.Add(30 * time.Minute), CreatedAt: paidTwo.Add(-6 * time.Hour),
		},
	}
	for _, order := range orders {
		var count int64
		s.DB.Model(&models.PaymentOrder{}).Where("order_no = ?", order.OrderNo).Count(&count)
		if count == 0 {
			if err := s.DB.Create(&order).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Server) SeedDemoCollectionMetrics() {
	metrics := map[string]string{
		"dy-001":  `{"likes":62000,"comments":2300,"saves":11400,"shares":5400}`,
		"xhs-001": `{"likes":48200,"comments":1940,"saves":15200,"shares":6300}`,
		"xhs-002": `{"likes":22400,"comments":860,"saves":18900,"shares":3100}`,
		"dy-002":  `{"likes":38400,"comments":1410,"saves":13200,"shares":4600}`,
		"xhs-003": `{"likes":19600,"comments":740,"saves":16200,"shares":2450}`,
		"tt-001":  `{"likes":31500,"comments":1120,"saves":9400,"shares":4100}`,
		"dy-003":  `{"likes":28900,"comments":980,"saves":11800,"shares":3820}`,
		"xhs-004": `{"likes":16800,"comments":620,"saves":14500,"shares":1980}`,
	}
	for externalID, value := range metrics {
		s.DB.Model(&models.CollectionItem{}).
			Where("external_id = ? AND (metrics_json IS NULL OR metrics_json = '')", externalID).
			Update("metrics_json", value)
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
