package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"sparkstudio/backend/internal/models"
)

var workflowNodeLabels = map[string]string{
	"trigger": "触发", "collect": "采集", "filter": "筛选", "foreach": "批量循环",
	"clone_video": "视频复刻", "product": "商品素材", "scene_variation": "场景裂变",
	"generate": "生成", "archive": "归档", "article": "图文生成",
}

func (s *Server) enqueueWorkflow(userID uint, workflow models.Workflow, trigger string) (models.StudioJob, models.User, error) {
	var user models.User
	if err := s.DB.First(&user, userID).Error; err != nil {
		return models.StudioJob{}, models.User{}, errors.New("用户不存在")
	}
	if user.Status != "active" {
		return models.StudioJob{}, models.User{}, errors.New("当前账号不可运行流水线")
	}
	model, _, err := s.resolveStudioModel(userID, "platform", "", "image")
	if err != nil {
		return models.StudioJob{}, models.User{}, err
	}
	cost := model.Credits
	if cost < 0 {
		cost = 0
	}
	if user.Credits < cost {
		return models.StudioJob{}, models.User{}, fmt.Errorf("可用积分不足，本次实际需要 %d 积分", cost)
	}
	var provider models.ProviderConfig
	if err := s.DB.First(&provider, model.ProviderID).Error; err != nil {
		return models.StudioJob{}, models.User{}, errors.New("图片模型供应商配置不存在")
	}
	var nodes []string
	_ = json.Unmarshal([]byte(workflow.NodesJSON), &nodes)
	labels := make([]string, 0, len(nodes))
	for _, node := range nodes {
		label := workflowNodeLabels[strings.TrimSpace(node)]
		if label == "" {
			label = strings.TrimSpace(node)
		}
		if label != "" {
			labels = append(labels, label)
		}
	}
	nodeText := "采集、生成、归档"
	if len(labels) > 0 {
		nodeText = strings.Join(labels, " → ")
	}
	prompt := fmt.Sprintf(
		"为自动化内容流水线「%s」生成一张可直接用于内容的成品主视觉。执行节点：%s。画面需要具备清晰的商业摄影构图、真实材质、自然光影和充足标题留白，避免文字、水印与品牌侵权元素。",
		workflow.Name, nodeText,
	)
	params := map[string]interface{}{
		"count": 1, "duration": 1, "workflowId": workflow.ID, "workflowTrigger": trigger,
		"nodes": nodes, "references": []interface{}{},
	}
	paramsJSON, _ := json.Marshal(params)
	job := models.StudioJob{
		OwnerUserID: userID, ProviderID: model.ProviderID, Tool: "workflow_image",
		ToolName: workflow.Name, ModelSource: "platform", ModelID: model.ModelID,
		ModelLabel: model.DisplayName, Prompt: prompt, ParamsJSON: string(paramsJSON),
		Status: "queued", CreditsCharged: cost,
	}
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&job).Error; err != nil {
			return err
		}
		if cost > 0 {
			if err := s.reserveCredits(tx, userID, cost, "workflow", fmt.Sprint(job.ID), workflow.Name+" 预冻结"); err != nil {
				return err
			}
		}
		now := time.Now()
		return tx.Model(&workflow).Updates(map[string]interface{}{
			"last_run": now.Format("2006-01-02 15:04") + " · 已提交，等待生成", "last_run_at": &now,
		}).Error
	})
	if err != nil {
		return models.StudioJob{}, models.User{}, err
	}
	s.DB.First(&user, userID)
	return job, user, nil
}

func (s *Server) workflowSchedulerLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	s.runScheduledWorkflows(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !workflowScanning.CompareAndSwap(false, true) {
				continue
			}
			go func() {
				defer workflowScanning.Store(false)
				s.runScheduledWorkflows(ctx)
			}()
		}
	}
}

func (s *Server) runScheduledWorkflows(ctx context.Context) {
	var workflows []models.Workflow
	s.DB.Where("enabled = ? AND schedule <> ?", true, "manual").Order("id asc").Find(&workflows)
	now := time.Now()
	for _, workflow := range workflows {
		select {
		case <-ctx.Done():
			return
		default:
		}
		occurrence := previousWorkflowSchedule(workflow.Schedule, now)
		if occurrence.IsZero() || !workflow.CreatedAt.Before(occurrence) {
			continue
		}
		if workflow.LastRunAt != nil && !workflow.LastRunAt.Before(occurrence) {
			continue
		}
		if _, _, err := s.enqueueWorkflow(workflow.OwnerUserID, workflow, "schedule"); err != nil {
			s.DB.Model(&workflow).Updates(map[string]interface{}{
				"last_run":    now.Format("2006-01-02 15:04") + " · 自动运行失败：" + truncateRunes(err.Error(), 70),
				"last_run_at": &now,
			})
		}
	}
}

func previousWorkflowSchedule(schedule string, now time.Time) time.Time {
	location := now.Location()
	switch strings.ToLower(strings.TrimSpace(schedule)) {
	case "daily":
		slot := time.Date(now.Year(), now.Month(), now.Day(), 9, 0, 0, 0, location)
		if now.Before(slot) {
			slot = slot.AddDate(0, 0, -1)
		}
		return slot
	case "weekly":
		slot := time.Date(now.Year(), now.Month(), now.Day(), 9, 0, 0, 0, location)
		weekday := int(now.Weekday())
		if weekday == 0 {
			weekday = 7
		}
		slot = slot.AddDate(0, 0, -(weekday - 1))
		if now.Before(slot) {
			slot = slot.AddDate(0, 0, -7)
		}
		return slot
	case "hourly":
		hour := (now.Hour() / 6) * 6
		slot := time.Date(now.Year(), now.Month(), now.Day(), hour, 0, 0, 0, location)
		if now.Before(slot) {
			slot = slot.Add(-6 * time.Hour)
		}
		return slot
	default:
		return time.Time{}
	}
}

func updateWorkflowRunResult(tx *gorm.DB, job models.StudioJob, result string, assetCount int) error {
	var params map[string]interface{}
	if strings.TrimSpace(job.ParamsJSON) != "" {
		_ = json.Unmarshal([]byte(job.ParamsJSON), &params)
	}
	workflowID := uint(numberAsInt(params["workflowId"]))
	if workflowID == 0 {
		return nil
	}
	text := time.Now().Format("2006-01-02 15:04") + " · " + result
	if assetCount > 0 {
		text += fmt.Sprintf("，产出 %d 个文件", assetCount)
	}
	return tx.Model(&models.Workflow{}).Where("id = ? AND owner_user_id = ?", workflowID, job.OwnerUserID).
		Update("last_run", text).Error
}
