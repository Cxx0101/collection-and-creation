package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"sparkstudio/backend/internal/models"
)

var toolDisplayNames = map[string]string{
	"image": "图片生成", "video": "视频生成", "product": "产品图生视频", "article": "公众号文章",
	"image_variation": "相似图裂变", "similar": "相似图裂变",
	"scene_variation": "场景裂变", "pose_variation": "姿势裂变",
	"print_extract": "印花提取", "virtual_try_on": "AI 穿衣", "apparel_set": "服装套图",
	"product_retouch": "商品精修", "image_inpaint": "涂抹局部重绘", "image_erase": "涂抹局部消除",
}

type studioJobReq struct {
	Tool        string                 `json:"tool"`
	ToolName    string                 `json:"toolName"`
	ModelSource string                 `json:"modelSource"`
	ModelID     string                 `json:"modelId"`
	ModelLabel  string                 `json:"modelLabel"`
	Prompt      string                 `json:"prompt"`
	Params      map[string]interface{} `json:"params"`
	Count       int                    `json:"count"`
	Duration    int                    `json:"duration"`
	SkillID     uint                   `json:"skillId"`
}

func (s *Server) CreateStudioJob(c *gin.Context) {
	var req studioJobReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, 400, "请求参数有误")
		return
	}
	req.Tool = strings.TrimSpace(req.Tool)
	if _, ok := toolDisplayNames[req.Tool]; !ok {
		Fail(c, 400, "不支持的创作能力")
		return
	}
	if toolRequiresPrompt(req.Tool) && strings.TrimSpace(req.Prompt) == "" {
		Fail(c, 400, "请填写创作提示词或需求描述")
		return
	}
	if req.Count < 1 {
		req.Count = 1
	}
	if req.Count > 20 {
		req.Count = 20
	}
	if req.Duration < 1 {
		req.Duration = 15
	}
	if req.Duration > 60 {
		req.Duration = 60
	}
	u := CurrentUser(c)
	modelSource := req.ModelSource
	if modelSource == "" {
		modelSource = "platform"
	}
	model, custom, err := s.resolveStudioModel(u.ID, modelSource, req.ModelID, req.Tool)
	if err != nil {
		Fail(c, 400, err.Error())
		return
	}
	unit := int64(0)
	modelLabel := req.ModelLabel
	if modelSource == "platform" && model != nil {
		unit = modelUnitCredits(model, studioResolution(req.Params))
		if modelLabel == "" {
			modelLabel = model.DisplayName
		}
	} else if custom != nil {
		modelSource = "custom"
		if modelLabel == "" {
			modelLabel = custom.DisplayName + " · " + custom.Models
		}
	}
	estimated := unit
	if model != nil {
		switch {
		case model.Unit == "秒" || req.Tool == "video" || req.Tool == "product":
			estimated = unit * int64(req.Duration)
		case model.Unit == "次" || req.Tool == "article":
			estimated = unit
		default:
			estimated = unit * int64(req.Count)
		}
	}
	if estimated < 0 {
		estimated = 0
	}
	if u.Credits < estimated {
		Fail(c, 400, fmt.Sprintf("可用积分不足，本次预计需要 %d 积分", estimated))
		return
	}

	paramsCopy := req.Params
	if paramsCopy == nil {
		paramsCopy = map[string]interface{}{}
	}
	paramsCopy["count"] = req.Count
	paramsCopy["duration"] = req.Duration
	paramsCopy["skillId"] = req.SkillID
	paramsJSON, _ := json.Marshal(paramsCopy)
	toolName := req.ToolName
	if toolName == "" {
		toolName = toolDisplayNames[req.Tool]
	}
	job := models.StudioJob{
		OwnerUserID: u.ID, Tool: req.Tool, ToolName: toolName,
		ModelSource: modelSource, ModelID: req.ModelID, ModelLabel: modelLabel,
		Prompt: req.Prompt, ParamsJSON: string(paramsJSON), Status: "queued",
		CreditsCharged: estimated, ResultCount: 0,
	}
	if modelSource == "platform" && model != nil {
		job.ModelID = model.ModelID
		job.ProviderID = model.ProviderID
	}
	if custom != nil {
		job.ModelID = customModelName(req.ModelID, custom.Models)
		job.UserProviderID = custom.ID
		job.ModelSource = "custom"
	}

	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&job).Error; err != nil {
			return err
		}
		if estimated > 0 {
			if err := s.reserveCredits(tx, u.ID, estimated, jobBizType(req.Tool), fmt.Sprint(job.ID), fmt.Sprintf("%s任务预冻结", toolName)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, errInsufficientCredits) {
			Fail(c, 400, "可用积分不足")
		} else {
			Fail(c, 500, "创作任务创建失败："+err.Error())
		}
		return
	}

	s.DB.First(&job, job.ID)
	var user models.User
	s.DB.First(&user, u.ID)
	OK(c, gin.H{"job": job, "user": user})
}

func toolRequiresPrompt(tool string) bool {
	switch tool {
	case "image", "video", "product", "article", "image_inpaint":
		return true
	default:
		return false
	}
}

func (s *Server) ListStudioJobs(c *gin.Context) {
	u := CurrentUser(c)
	q := s.DB.Where("owner_user_id = ?", u.ID)
	if v := c.Query("status"); v != "" && v != "all" {
		q = q.Where("status = ?", v)
	}
	var list []models.StudioJob
	q.Order("id desc").Limit(80).Find(&list)
	OK(c, list)
}

func canDeleteStudioJob(status string) bool {
	switch status {
	case "succeeded", "failed", "cancelled":
		return true
	default:
		return false
	}
}

func (s *Server) GetStudioJob(c *gin.Context) {
	u := CurrentUser(c)
	var job models.StudioJob
	if err := s.DB.Where("id = ? AND owner_user_id = ?", IDParam(c, "id"), u.ID).First(&job).Error; err != nil {
		Fail(c, 404, "任务不存在")
		return
	}
	var assets []models.Asset
	s.DB.Where("job_id = ? AND owner_user_id = ?", job.ID, u.ID).Order("id asc").Find(&assets)
	s.resolveAssetURLs(assets)
	var params interface{}
	if job.ParamsJSON != "" {
		_ = json.Unmarshal([]byte(job.ParamsJSON), &params)
	}
	OK(c, gin.H{"job": job, "assets": assets, "params": params})
}

func (s *Server) DeleteStudioJob(c *gin.Context) {
	u := CurrentUser(c)
	var job models.StudioJob
	if err := s.DB.Where("id = ? AND owner_user_id = ?", IDParam(c, "id"), u.ID).First(&job).Error; err != nil {
		Fail(c, 404, "任务不存在")
		return
	}
	if !canDeleteStudioJob(job.Status) {
		Fail(c, 409, "任务仍在运行中，无法删除")
		return
	}
	result := s.DB.Where(
		"id = ? AND owner_user_id = ? AND status IN ?",
		job.ID, u.ID, []string{"succeeded", "failed", "cancelled"},
	).Delete(&models.StudioJob{})
	if result.Error != nil {
		Fail(c, 500, "任务删除失败")
		return
	}
	if result.RowsAffected == 0 {
		Fail(c, 409, "任务状态已变化，请刷新后重试")
		return
	}
	OK(c, gin.H{"deleted": true})
}

func (s *Server) resolveStudioModel(userID uint, source, modelID, tool string) (*models.ProviderModel, *models.UserProviderConfig, error) {
	capability := "image"
	if tool == "video" || tool == "product" || tool == "clone_video" {
		capability = "video"
	}
	if tool == "article" {
		capability = "understanding"
	}
	if source == "custom" || strings.HasPrefix(modelID, "custom:") {
		rest := strings.TrimPrefix(modelID, "custom:")
		idText, _, _ := strings.Cut(rest, ":")
		id, _ := strconv.ParseUint(idText, 10, 64)
		var p models.UserProviderConfig
		q := s.DB.Where("owner_user_id = ? AND enabled = ?", userID, true)
		if id > 0 {
			q = q.Where("id = ?", id)
		}
		if err := q.First(&p).Error; err != nil {
			return nil, nil, errors.New("未找到可用的自有模型配置")
		}
		if p.Capability != capability {
			return nil, nil, errors.New("自有模型能力与当前创作区不匹配")
		}
		return nil, &p, nil
	}
	var providers []models.ProviderConfig
	s.DB.Preload("Models").Where("enabled = ?", true).Order("sort_order asc, id asc").Find(&providers)
	var fallback *models.ProviderModel
	preferredModelID := ""
	switch capability {
	case "image":
		preferredModelID = s.Setting("models.defaultImage", "")
	case "understanding":
		preferredModelID = s.Setting("models.defaultUnderstanding", "")
	}
	var preferred *models.ProviderModel
	for i := range providers {
		for j := range providers[i].Models {
			m := &providers[i].Models[j]
			if !m.Enabled {
				continue
			}
			if fallback == nil && m.Capability == capability {
				fallback = m
			}
			if preferred == nil && preferredModelID != "" && m.ModelID == preferredModelID && m.Capability == capability {
				preferred = m
			}
			if modelID != "" && m.ModelID == modelID {
				if m.Capability == capability {
					return m, nil, nil
				}
			}
		}
	}
	if preferred != nil {
		return preferred, nil, nil
	}
	if fallback != nil {
		return fallback, nil, nil
	}
	return nil, nil, errors.New("后台尚未配置适用于该能力的平台模型")
}

func customModelName(value, modelsCSV string) string {
	rest := strings.TrimPrefix(value, "custom:")
	if _, modelName, ok := strings.Cut(rest, ":"); ok && strings.TrimSpace(modelName) != "" {
		return strings.TrimSpace(modelName)
	}
	for _, item := range strings.Split(modelsCSV, ",") {
		if model := strings.TrimSpace(item); model != "" {
			return model
		}
	}
	return strings.TrimSpace(modelsCSV)
}

func jobBizType(tool string) string {
	switch tool {
	case "video", "product", "clone_video":
		return "video_generate"
	case "article":
		return "understanding"
	case "clone_photo":
		return "image_generate"
	default:
		return "image_generate"
	}
}

func resultCount(tool string, count int) int {
	if tool == "article" {
		return 1
	}
	if tool == "video" || tool == "product" {
		return 1
	}
	if count < 1 {
		count = 1
	}
	return count
}

func buildGeneratedAssets(userID uint, job models.StudioJob, req studioJobReq) []models.Asset {
	n := resultCount(req.Tool, req.Count)
	base := strings.TrimSpace(req.Prompt)
	if base == "" {
		base = toolDisplayNames[req.Tool]
	}
	base = truncateRunes(base, 36)
	kind := "image"
	if req.Tool == "video" || req.Tool == "product" {
		kind = "video"
	}
	if req.Tool == "article" {
		kind = "markdown"
	}
	nowSeed := int(job.ID % 6)
	assets := make([]models.Asset, 0, n)
	for i := 0; i < n; i++ {
		ext := ".png"
		source := toolDisplayNames[req.Tool]
		if kind == "video" {
			ext = ".mp4"
		} else if kind == "markdown" {
			ext = ".md"
		}
		name := fmt.Sprintf("%s_%s%02d%s", base, strings.ReplaceAll(job.ToolName, " ", ""), i+1, ext)
		if n == 1 {
			name = base + "_" + strings.ReplaceAll(job.ToolName, " ", "") + ext
		}
		assets = append(assets, models.Asset{
			OwnerUserID: userID, JobID: job.ID, Name: name, Kind: kind, Source: source,
			Size: map[string]string{"image": "2.4 MB", "video": "12.6 MB", "markdown": "18 KB"}[kind],
			Seed: (nowSeed + i) % 6,
		})
	}
	return assets
}

func truncateRunes(v string, max int) string {
	r := []rune(strings.TrimSpace(v))
	if len(r) <= max {
		return string(r)
	}
	return string(r[:max])
}
