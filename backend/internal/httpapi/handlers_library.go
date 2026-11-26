package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"sparkstudio/backend/internal/models"
)

type skillReq struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Content     string `json:"content"`
}

func (s *Server) ListSkills(c *gin.Context) {
	u := CurrentUser(c)
	var list []models.Skill
	s.DB.Where("builtin = ? OR owner_user_id = ?", true, u.ID).Order("builtin desc, id asc").Find(&list)
	OK(c, list)
}

func (s *Server) CreateSkill(c *gin.Context) {
	var req skillReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		Fail(c, 400, "技能名称不能为空")
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		Fail(c, 400, "技能内容不能为空")
		return
	}
	u := CurrentUser(c)
	row := models.Skill{OwnerUserID: u.ID, Name: strings.TrimSpace(req.Name), Description: req.Description, Content: req.Content}
	if err := s.DB.Create(&row).Error; err != nil {
		Fail(c, 500, "技能创建失败")
		return
	}
	OK(c, row)
}

func (s *Server) UpdateSkill(c *gin.Context) {
	var req skillReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		Fail(c, 400, "技能名称不能为空")
		return
	}
	u := CurrentUser(c)
	var row models.Skill
	if err := s.DB.Where("id = ? AND owner_user_id = ? AND builtin = ?", IDParam(c, "id"), u.ID, false).First(&row).Error; err != nil {
		Fail(c, 404, "个人技能不存在或不可编辑")
		return
	}
	row.Name, row.Description, row.Content = strings.TrimSpace(req.Name), req.Description, req.Content
	if err := s.DB.Save(&row).Error; err != nil {
		Fail(c, 500, "技能保存失败")
		return
	}
	OK(c, row)
}

func (s *Server) DeleteSkill(c *gin.Context) {
	u := CurrentUser(c)
	res := s.DB.Where("id = ? AND owner_user_id = ? AND builtin = ?", IDParam(c, "id"), u.ID, false).Delete(&models.Skill{})
	if res.RowsAffected == 0 {
		Fail(c, 404, "个人技能不存在或不可删除")
		return
	}
	OK(c, gin.H{"deleted": true})
}

type workflowReq struct {
	Name             string          `json:"name"`
	Schedule         string          `json:"schedule"`
	Enabled          bool            `json:"enabled"`
	Nodes            json.RawMessage `json:"nodes"`
	EstimatedCredits int             `json:"estimatedCredits"`
}

func (s *Server) ListWorkflows(c *gin.Context) {
	u := CurrentUser(c)
	var list []models.Workflow
	s.DB.Where("owner_user_id = ?", u.ID).Order("id desc").Find(&list)
	OK(c, list)
}

func (s *Server) CreateWorkflow(c *gin.Context) {
	var req workflowReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		Fail(c, 400, "流水线名称不能为空")
		return
	}
	if req.EstimatedCredits < 0 {
		req.EstimatedCredits = 0
	}
	u := CurrentUser(c)
	nodes := string(req.Nodes)
	if nodes == "" || nodes == "null" {
		nodes = `["trigger","collect","archive"]`
	}
	row := models.Workflow{
		OwnerUserID: u.ID, Name: strings.TrimSpace(req.Name), Schedule: req.Schedule,
		Enabled: req.Enabled, NodesJSON: nodes, EstimatedCredits: req.EstimatedCredits,
	}
	if err := s.DB.Create(&row).Error; err != nil {
		Fail(c, 500, "流水线创建失败")
		return
	}
	OK(c, row)
}

func (s *Server) UpdateWorkflow(c *gin.Context) {
	var req workflowReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		Fail(c, 400, "流水线名称不能为空")
		return
	}
	u := CurrentUser(c)
	var row models.Workflow
	if err := s.DB.Where("id = ? AND owner_user_id = ?", IDParam(c, "id"), u.ID).First(&row).Error; err != nil {
		Fail(c, 404, "流水线不存在")
		return
	}
	row.Name, row.Schedule, row.Enabled = strings.TrimSpace(req.Name), req.Schedule, req.Enabled
	row.EstimatedCredits = req.EstimatedCredits
	if len(req.Nodes) > 0 && string(req.Nodes) != "null" {
		row.NodesJSON = string(req.Nodes)
	}
	if err := s.DB.Save(&row).Error; err != nil {
		Fail(c, 500, "流水线保存失败")
		return
	}
	OK(c, row)
}

func (s *Server) DeleteWorkflow(c *gin.Context) {
	u := CurrentUser(c)
	res := s.DB.Where("id = ? AND owner_user_id = ?", IDParam(c, "id"), u.ID).Delete(&models.Workflow{})
	if res.RowsAffected == 0 {
		Fail(c, 404, "流水线不存在")
		return
	}
	OK(c, gin.H{"deleted": true})
}

func (s *Server) RunWorkflow(c *gin.Context) {
	u := CurrentUser(c)
	var row models.Workflow
	if err := s.DB.Where("id = ? AND owner_user_id = ?", IDParam(c, "id"), u.ID).First(&row).Error; err != nil {
		Fail(c, 404, "流水线不存在")
		return
	}
	if !row.Enabled {
		Fail(c, 400, "请先启用该流水线")
		return
	}
	job, user, err := s.enqueueWorkflow(u.ID, row, "manual")
	if err != nil {
		if errors.Is(err, errInsufficientCredits) {
			Fail(c, 400, "可用积分不足")
		} else {
			Fail(c, 400, err.Error())
		}
		return
	}
	OK(c, gin.H{"job": job, "user": user})
}

func (s *Server) ListCloneDrafts(c *gin.Context) {
	u := CurrentUser(c)
	var list []models.CloneDraft
	s.DB.Where("owner_user_id = ?", u.ID).Order("id desc").Find(&list)
	OK(c, list)
}

type cloneDraftReq struct {
	Title     string `json:"title"`
	SourceURL string `json:"sourceUrl"`
	Platform  string `json:"platform"`
	Status    string `json:"status"`
	Seed      int    `json:"seed"`
}

func (s *Server) CreateCloneDraft(c *gin.Context) {
	var req cloneDraftReq
	if err := c.ShouldBindJSON(&req); err != nil || (strings.TrimSpace(req.Title) == "" && strings.TrimSpace(req.SourceURL) == "") {
		Fail(c, 400, "请填写草稿标题或来源链接")
		return
	}
	if req.Title == "" {
		req.Title = "未命名复刻草稿"
	}
	if req.Status == "" {
		req.Status = "draft"
	}
	u := CurrentUser(c)
	row := models.CloneDraft{OwnerUserID: u.ID, Title: req.Title, SourceURL: req.SourceURL, Platform: req.Platform, Status: req.Status, Seed: req.Seed}
	if err := s.DB.Create(&row).Error; err != nil {
		Fail(c, 500, "复刻草稿保存失败")
		return
	}
	OK(c, row)
}

func (s *Server) UpdateCloneDraft(c *gin.Context) {
	var req cloneDraftReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, 400, "请求参数有误")
		return
	}
	u := CurrentUser(c)
	var row models.CloneDraft
	if err := s.DB.Where("id = ? AND owner_user_id = ?", IDParam(c, "id"), u.ID).First(&row).Error; err != nil {
		Fail(c, 404, "复刻草稿不存在")
		return
	}
	if req.Title != "" {
		row.Title = req.Title
	}
	if req.SourceURL != "" {
		row.SourceURL = req.SourceURL
	}
	if req.Platform != "" {
		row.Platform = req.Platform
	}
	if req.Status != "" {
		row.Status = req.Status
	}
	if req.Seed != 0 {
		row.Seed = req.Seed
	}
	s.DB.Save(&row)
	OK(c, row)
}

func (s *Server) DeleteCloneDraft(c *gin.Context) {
	u := CurrentUser(c)
	res := s.DB.Where("id = ? AND owner_user_id = ?", IDParam(c, "id"), u.ID).Delete(&models.CloneDraft{})
	if res.RowsAffected == 0 {
		Fail(c, 404, "复刻草稿不存在")
		return
	}
	OK(c, gin.H{"deleted": true})
}

type cloneAnalyzeReq struct {
	SourceURL string `json:"sourceUrl"`
	Platform  string `json:"platform"`
	Mode      string `json:"mode"`
	Title     string `json:"title"`
	Summary   string `json:"summary"`
	Product   string `json:"product"`
}

func (s *Server) AnalyzeClone(c *gin.Context) {
	var req cloneAnalyzeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, 400, "请求参数有误")
		return
	}
	if strings.TrimSpace(req.SourceURL) == "" {
		Fail(c, 400, "请粘贴爆款链接或选择个人采集作品")
		return
	}
	if req.Platform == "" {
		req.Platform = "douyin"
	}
	mode := req.Mode
	if mode == "" {
		mode = "video"
	}
	u := CurrentUser(c)
	if req.Title == "" || req.Summary == "" {
		var item models.CollectionItem
		if err := s.DB.Where("owner_user_id = ? AND url = ?", u.ID, req.SourceURL).Order("id desc").First(&item).Error; err == nil {
			req.Title = firstNonEmptyText(req.Title, item.Title)
			req.Summary = firstNonEmptyText(req.Summary, item.Description)
		}
	}
	platformLabel := collectionPlatformNames[req.Platform]
	if platformLabel == "" {
		platformLabel = req.Platform
	}
	prompt := fmt.Sprintf(
		"平台：%s\n内容形式：%s\n来源链接：%s\n原内容标题：%s\n原内容摘要：%s\n目标商品：%s\n请拆解可复刻的内容结构，不要声称已经观看无法访问的视频。输出要能直接指导生成。",
		platformLabel, map[string]string{"video": "短视频", "photo": "图文笔记"}[mode], req.SourceURL,
		defaultStr(req.Title, "未提供"), defaultStr(req.Summary, "未提供"), defaultStr(req.Product, "未限定"),
	)
	system := "你是短视频与图文爆款结构分析师。只输出 JSON 对象，不要 Markdown 或解释。格式：{\"title\":\"方案标题\",\"scenes\":[{\"index\":1,\"time\":\"0-3s\",\"title\":\"镜头标题\",\"description\":\"画面与动作说明\",\"prompt\":\"可直接用于生图或生视频的视觉提示词\"}],\"copywriting\":[\"第一句文案\",\"第二句文案\"]}。视频生成 4 到 6 个分镜，总时长 15 秒；图文生成 4 到 6 个页面。文案必须结合目标商品，避免空泛。"
	var parsed struct {
		Title  string `json:"title"`
		Scenes []struct {
			Index       int    `json:"index"`
			Time        string `json:"time"`
			Title       string `json:"title"`
			Description string `json:"description"`
			Prompt      string `json:"prompt"`
		} `json:"scenes"`
		Copywriting []string `json:"copywriting"`
	}
	_, charged, err := s.runPlatformUnderstanding(
		c.Request.Context(), u.ID, "clone_analyze", "爆款结构解析", system, prompt,
		func(value string) error {
			if err := decodeModelJSON(value, &parsed); err != nil {
				return err
			}
			if len(parsed.Scenes) < 3 || len(parsed.Scenes) > 8 {
				return errors.New("模型返回的分镜数量不在 3 到 8 个之间，请重试")
			}
			if len(parsed.Copywriting) == 0 {
				return errors.New("模型没有返回可用文案，请重试")
			}
			return nil
		},
	)
	if err != nil {
		Fail(c, 400, err.Error())
		return
	}
	scenes := make([]gin.H, 0, len(parsed.Scenes))
	for index, scene := range parsed.Scenes {
		scenes = append(scenes, gin.H{
			"index": index + 1, "time": defaultStr(scene.Time, fmt.Sprintf("%d-%ds", index*3, (index+1)*3)),
			"title":       defaultStr(scene.Title, fmt.Sprintf("镜头 %d", index+1)),
			"description": scene.Description, "prompt": scene.Prompt,
		})
	}
	title := defaultStr(parsed.Title, platformLabel+"爆款复刻方案")
	var user models.User
	s.DB.First(&user, u.ID)
	OK(c, gin.H{
		"title": title, "platform": req.Platform, "mode": mode, "scenes": scenes,
		"copywriting": parsed.Copywriting, "modelNote": "已由平台理解模型完成结构拆解，可在第三步继续调整。",
		"creditsCharged": charged, "user": user,
	})
}

type cloneRenderReq struct {
	DraftID     uint                   `json:"draftId"`
	Title       string                 `json:"title"`
	Platform    string                 `json:"platform"`
	Mode        string                 `json:"mode"`
	ModelSource string                 `json:"modelSource"`
	ModelID     string                 `json:"modelId"`
	ModelLabel  string                 `json:"modelLabel"`
	Prompt      string                 `json:"prompt"`
	Duration    int                    `json:"duration"`
	Count       int                    `json:"count"`
	Params      map[string]interface{} `json:"params"`
}

func (s *Server) RenderClone(c *gin.Context) {
	var req cloneRenderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, 400, "请求参数有误")
		return
	}
	u := CurrentUser(c)
	mode := req.Mode
	if mode == "" {
		mode = "video"
	}
	tool := "image"
	if mode == "video" {
		tool = "video"
	}
	model, custom, err := s.resolveStudioModel(u.ID, req.ModelSource, req.ModelID, tool)
	if err != nil {
		Fail(c, 400, err.Error())
		return
	}
	unit := int64(0)
	label := req.ModelLabel
	if model != nil {
		unit = model.Credits
		if label == "" {
			label = model.DisplayName
		}
	} else if custom != nil && label == "" {
		label = custom.DisplayName + " · " + custom.Models
	}
	if req.Duration < 1 {
		req.Duration = 15
	}
	if req.Count < 1 {
		req.Count = 1
	}
	if req.Count > 20 {
		req.Count = 20
	}
	estimated := unit
	if model != nil && model.Unit == "秒" {
		estimated = unit * int64(req.Duration)
	} else {
		estimated = unit * int64(req.Count)
	}
	if u.Credits < estimated {
		Fail(c, 400, fmt.Sprintf("可用积分不足，本次复刻预计需要 %d 积分", estimated))
		return
	}
	modelSource := req.ModelSource
	if modelSource == "" {
		modelSource = "platform"
	}
	paramsCopy := req.Params
	if paramsCopy == nil {
		paramsCopy = map[string]interface{}{}
	}
	paramsCopy["count"] = req.Count
	paramsCopy["duration"] = req.Duration
	paramsJSON, _ := json.Marshal(paramsCopy)
	job := models.StudioJob{
		OwnerUserID: u.ID, Tool: "clone_" + mode, ToolName: "爆款复刻",
		ModelSource: modelSource, ModelID: req.ModelID, ModelLabel: label,
		Prompt: req.Prompt, ParamsJSON: string(paramsJSON), Status: "queued",
		CreditsCharged: estimated, ResultCount: 0,
	}
	if modelSource == "platform" && model != nil {
		job.ModelID = model.ModelID
		job.ProviderID = model.ProviderID
	}
	if custom != nil {
		job.ModelSource = "custom"
		job.UserProviderID = custom.ID
		job.ModelID = customModelName(req.ModelID, custom.Models)
	}
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&job).Error; err != nil {
			return err
		}
		if estimated > 0 {
			if err := s.reserveCredits(tx, u.ID, estimated, "clone", fmt.Sprint(job.ID), "爆款复刻预冻结"); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, errInsufficientCredits) {
			Fail(c, 400, "可用积分不足")
		} else {
			Fail(c, 500, "复刻任务创建失败")
		}
		return
	}
	if req.DraftID > 0 {
		s.DB.Model(&models.CloneDraft{}).Where("id = ? AND owner_user_id = ?", req.DraftID, u.ID).Update("status", "queued")
	}
	var user models.User
	s.DB.First(&user, u.ID)
	OK(c, gin.H{"job": job, "user": user})
}
