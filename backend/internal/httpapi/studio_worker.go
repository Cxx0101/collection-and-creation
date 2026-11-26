package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"sparkstudio/backend/internal/ai"
	"sparkstudio/backend/internal/models"
)

var errJobCancelled = errors.New("任务已取消")

func (s *Server) studioWorkerLoop(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !studioScanning.CompareAndSwap(false, true) {
				continue
			}
			go func() {
				defer studioScanning.Store(false)
				s.claimStudioJobs(ctx)
			}()
		}
	}
}

func (s *Server) claimStudioJobs(ctx context.Context) {
	for {
		select {
		case studioSlots <- struct{}{}:
		default:
			return
		}
		var job models.StudioJob
		err := s.DB.Where("status = ?", "queued").Order("id asc").Limit(1).Find(&job).Error
		if err != nil || job.ID == 0 {
			<-studioSlots
			return
		}
		res := s.DB.Model(&models.StudioJob{}).
			Where("id = ? AND status = ?", job.ID, "queued").
			Updates(map[string]interface{}{"status": "running", "started_at": time.Now(), "error_message": ""})
		if res.Error != nil || res.RowsAffected == 0 {
			<-studioSlots
			continue
		}
		go func(jobID uint) {
			defer func() {
				if recovered := recover(); recovered != nil {
					s.failStudioJob(jobID, fmt.Sprintf("生成任务异常终止：%v", recovered))
				}
				<-studioSlots
			}()
			runCtx, cancel := context.WithTimeout(ctx, 35*time.Minute)
			defer cancel()
			s.processStudioJob(runCtx, jobID)
		}(job.ID)
	}
}

func (s *Server) processStudioJob(ctx context.Context, jobID uint) {
	var job models.StudioJob
	if err := s.DB.First(&job, jobID).Error; err != nil || job.Status != "running" {
		return
	}
	params := map[string]interface{}{}
	if job.ParamsJSON != "" {
		_ = json.Unmarshal([]byte(job.ParamsJSON), &params)
	}
	provider, model, err := s.jobProvider(job)
	if err != nil {
		s.failStudioJob(job.ID, err.Error())
		return
	}
	references, err := s.jobReferences(ctx, job, params, model.MaxRefImages, provider.Protocol)
	if err != nil {
		s.failStudioJob(job.ID, err.Error())
		return
	}
	prompt := composeStudioPrompt(job.Tool, job.Prompt)
	if skillText := s.additionalSkillPrompt(job.OwnerUserID, job.Tool, params); skillText != "" {
		prompt += "\n\n【创作技能参考，仅用于视觉与写作规范】\n" + skillText
	}
	capability := capabilityForTool(job.Tool)
	var generated []models.Asset
	switch capability {
	case "video":
		generated, err = s.generateVideoAssets(ctx, job, provider, model, prompt, params, references)
	case "understanding":
		generated, err = s.generateArticleAsset(ctx, job, provider, prompt, references)
	default:
		generated, err = s.generateImageAssets(ctx, job, provider, model, prompt, params, references)
	}
	if err != nil {
		if errors.Is(err, errJobCancelled) {
			return
		}
		s.failStudioJob(job.ID, err.Error())
		return
	}
	if err := s.finishStudioSuccess(job.ID, generated); err != nil {
		for _, asset := range generated {
			_ = s.deleteObject(context.Background(), asset.ObjectKey)
		}
		if !errors.Is(err, errJobCancelled) {
			s.failStudioJob(job.ID, "产物入库失败："+err.Error())
		}
	}
}

func (s *Server) jobProvider(job models.StudioJob) (ai.Provider, models.ProviderModel, error) {
	if job.ModelSource == "custom" {
		var config models.UserProviderConfig
		q := s.DB.Where("owner_user_id = ?", job.OwnerUserID)
		if job.UserProviderID > 0 {
			q = q.Where("id = ?", job.UserProviderID)
		}
		if err := q.First(&config).Error; err != nil {
			return ai.Provider{}, models.ProviderModel{}, errors.New("自有模型配置已不存在")
		}
		if !config.Enabled {
			return ai.Provider{}, models.ProviderModel{}, errors.New("自有模型配置已停用")
		}
		if !modelListContains(config.Models, job.ModelID) {
			return ai.Provider{}, models.ProviderModel{}, errors.New("自有模型列表中已无当前模型")
		}
		return ai.Provider{
				Protocol: config.Provider, BaseURL: config.BaseURL,
				APIKey: decryptSecret(config.APIKey), SecretKey: decryptSecret(config.SecretKey),
				Model: job.ModelID,
			}, models.ProviderModel{
				ModelID: job.ModelID, DisplayName: job.ModelLabel, Capability: config.Capability,
				Unit: unitForCapability(config.Capability), Credits: 0, MaxRefImages: 4,
			}, nil
	}
	var provider models.ProviderConfig
	if err := s.DB.First(&provider, job.ProviderID).Error; err != nil {
		return ai.Provider{}, models.ProviderModel{}, errors.New("平台模型供应商已不存在")
	}
	var model models.ProviderModel
	if err := s.DB.Where("provider_id = ? AND model_id = ?", provider.ID, job.ModelID).First(&model).Error; err != nil {
		return ai.Provider{}, models.ProviderModel{}, errors.New("平台模型配置已不存在")
	}
	if !provider.Enabled {
		return ai.Provider{}, models.ProviderModel{}, errors.New("平台模型供应商已停用")
	}
	return ai.Provider{
		Protocol: provider.Provider, BaseURL: provider.BaseURL,
		APIKey: decryptSecret(provider.APIKey), SecretKey: decryptSecret(provider.SecretKey),
		Model: model.ModelID,
	}, model, nil
}

func (s *Server) jobReferences(
	ctx context.Context, job models.StudioJob, params map[string]interface{}, maxReferences int, protocol string,
) ([]ai.Reference, error) {
	raw, _ := params["references"].([]interface{})
	if maxReferences < 1 {
		maxReferences = 4
	}
	if len(raw) > 20 {
		raw = raw[:20]
	}
	references := make([]ai.Reference, 0, len(raw))
	imageCount, videoCount := 0, 0
	for _, entry := range raw {
		mapping, _ := entry.(map[string]interface{})
		idText := firstText(mapping["id"], mapping["assetId"])
		assetID, _ := strconv.ParseUint(strings.TrimSpace(idText), 10, 64)
		if assetID == 0 {
			continue
		}
		var asset models.Asset
		if err := s.DB.Where("id = ? AND owner_user_id = ?", assetID, job.OwnerUserID).First(&asset).Error; err != nil {
			return nil, fmt.Errorf("参考素材 #%d 已不存在", assetID)
		}
		kind := strings.ToLower(firstText(mapping["kind"], asset.Kind))
		mimeType := strings.ToLower(asset.MimeType)
		if kind == "video" || strings.HasPrefix(mimeType, "video/") {
			if videoCount >= 10 {
				continue
			}
			videoCount++
			referenceURL := s.assetURL(asset)
			if strings.EqualFold(protocol, "ark") {
				normalizedURL, err := s.normalizeArkVideoReference(ctx, job, asset, referenceURL)
				if err != nil {
					return nil, err
				}
				referenceURL = normalizedURL
			}
			if strings.TrimSpace(referenceURL) == "" {
				return nil, fmt.Errorf("参考视频「%s」缺少可访问地址", asset.Name)
			}
			if mimeType == "" {
				mimeType = "video/mp4"
			}
			references = append(references, ai.Reference{
				Name: firstText(mapping["name"], asset.Name),
				Kind: "video",
				Role: firstText(mapping["role"], "reference_video"),
				URL:  referenceURL,
				MIME: mimeType,
			})
			continue
		}
		if imageCount >= maxReferences {
			continue
		}
		imageCount++
		var data []byte
		var err error
		if asset.ObjectKey != "" {
			reader, openErr := s.openObject(ctx, asset.ObjectKey)
			if openErr != nil {
				return nil, fmt.Errorf("参考素材「%s」读取失败", asset.Name)
			}
			data, err = io.ReadAll(io.LimitReader(reader, 30<<20))
			_ = reader.Close()
		} else if asset.URL != "" {
			data, _, err = ai.Download(ctx, asset.URL)
		}
		if err != nil || len(data) == 0 {
			return nil, fmt.Errorf("参考素材「%s」不可用", asset.Name)
		}
		if mimeType == "" {
			mimeType = http.DetectContentType(data)
		}
		references = append(references, ai.Reference{
			Name: firstText(mapping["name"], asset.Name),
			Kind: asset.Kind,
			Role: firstText(mapping["role"]),
			URL:  s.assetURL(asset),
			MIME: mimeType,
			Data: data,
		})
	}
	return references, nil
}

const arkReferenceVideoMinPixels = 407696

type referenceVideoProbe struct {
	Streams []struct {
		Width  int `json:"width"`
		Height int `json:"height"`
	} `json:"streams"`
}

func (s *Server) normalizeArkVideoReference(
	ctx context.Context, job models.StudioJob, asset models.Asset, sourceURL string,
) (string, error) {
	probeCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	command := exec.CommandContext(
		probeCtx, "ffprobe", "-v", "error", "-select_streams", "v:0",
		"-show_entries", "stream=width,height", "-of", "json", sourceURL,
	)
	output, err := command.Output()
	if err != nil {
		return "", fmt.Errorf("参考视频「%s」无法解析，请上传 MP4 / MOV 格式", asset.Name)
	}
	var probe referenceVideoProbe
	if err := json.Unmarshal(output, &probe); err != nil || len(probe.Streams) == 0 {
		return "", fmt.Errorf("参考视频「%s」缺少有效画面轨道", asset.Name)
	}
	width, height := probe.Streams[0].Width, probe.Streams[0].Height
	pixels := width * height
	if width < 300 || height < 300 || width > 6000 || height > 6000 {
		return "", fmt.Errorf("参考视频「%s」尺寸 %d×%d 不受模型支持", asset.Name, width, height)
	}
	if pixels >= arkReferenceVideoMinPixels {
		return sourceURL, nil
	}

	targetWidth, targetHeight := arkReferenceSize(width, height)
	key := fmt.Sprintf(
		"normalized/%d/%d/ark-r2v-%dx%d-v1.mp4",
		job.OwnerUserID, asset.ID, targetWidth, targetHeight,
	)
	if reader, openErr := s.openObject(ctx, key); openErr == nil {
		_ = reader.Close()
		return s.objectURL(key), nil
	}

	tempFile, err := os.CreateTemp("", "sparkstudio-reference-*.mp4")
	if err != nil {
		return "", errors.New("无法创建参考视频临时文件")
	}
	tempPath := tempFile.Name()
	_ = tempFile.Close()
	defer os.Remove(tempPath)

	encodeCtx, encodeCancel := context.WithTimeout(ctx, 3*time.Minute)
	defer encodeCancel()
	args := []string{
		"-y", "-hide_banner", "-loglevel", "error", "-i", sourceURL,
		"-vf", fmt.Sprintf("scale=%d:%d:flags=lanczos,fps=30", targetWidth, targetHeight),
		"-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
		"-pix_fmt", "yuv420p", "-movflags", "+faststart", tempPath,
	}
	if output, err := exec.CommandContext(encodeCtx, "ffmpeg", args...).CombinedOutput(); err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return "", fmt.Errorf("参考视频「%s」自动适配失败：%s", asset.Name, truncateRunes(message, 180))
	}
	encoded, err := os.Open(tempPath)
	if err != nil {
		return "", fmt.Errorf("参考视频「%s」适配结果不可读", asset.Name)
	}
	defer encoded.Close()
	info, err := encoded.Stat()
	if err != nil || info.Size() == 0 {
		return "", fmt.Errorf("参考视频「%s」适配结果为空", asset.Name)
	}
	if info.Size() > 50<<20 {
		return "", fmt.Errorf("参考视频「%s」适配后超过 50MB，请压缩后重试", asset.Name)
	}
	if err := s.putObject(ctx, key, encoded, info.Size(), "video/mp4"); err != nil {
		return "", fmt.Errorf("参考视频「%s」适配结果转存失败", asset.Name)
	}
	return s.objectURL(key), nil
}

func arkReferenceSize(width, height int) (int, int) {
	targetPixels := int(math.Ceil(float64(arkReferenceVideoMinPixels) * 1.03))
	scale := math.Sqrt(float64(targetPixels) / float64(width*height))
	targetWidth := int(math.Ceil(float64(width) * scale))
	targetHeight := int(math.Ceil(float64(height) * scale))
	if targetWidth%2 != 0 {
		targetWidth++
	}
	if targetHeight%2 != 0 {
		targetHeight++
	}
	for targetWidth*targetHeight < targetPixels {
		targetHeight += 2
	}
	return targetWidth, targetHeight
}

func (s *Server) generateImageAssets(
	ctx context.Context, job models.StudioJob, provider ai.Provider, model models.ProviderModel,
	prompt string, params map[string]interface{}, references []ai.Reference,
) ([]models.Asset, error) {
	count := numberAsInt(params["count"])
	if count < 1 {
		count = 1
	}
	if count > 20 {
		count = 20
	}
	size := firstText(params["ratio"], "1:1")
	assets := make([]models.Asset, 0, count)
	for index := 0; index < count; index++ {
		if err := s.ensureJobRunning(job.ID); err != nil {
			return nil, err
		}
		requestPrompt := composeImagePrompt(job.Tool, prompt, params, index, len(references))
		result, err := ai.GenerateImage(ctx, provider, ai.ImageRequest{
			Prompt: requestPrompt, Size: size, References: references,
		})
		if err != nil {
			return nil, fmt.Errorf("第 %d/%d 张生成失败：%w", index+1, count, err)
		}
		ext := extensionForMIME(result.MIME, "")
		key := newObjectKey(fmt.Sprintf("generated/%d/%d", job.OwnerUserID, job.ID), ext)
		if err := s.putObject(ctx, key, bytes.NewReader(result.Data), int64(len(result.Data)), result.MIME); err != nil {
			return nil, fmt.Errorf("第 %d 张产物转存失败：%w", index+1, err)
		}
		name := generatedName(job, job.Prompt, index+1, count, ext)
		assets = append(assets, models.Asset{
			OwnerUserID: job.OwnerUserID, JobID: job.ID, Name: name, Kind: "image",
			Source: job.ToolName, Size: humanSize(int64(len(result.Data))), URL: s.objectURL(key),
			ObjectKey: key, MimeType: result.MIME, Seed: index % 6,
		})
	}
	return assets, nil
}

func (s *Server) generateVideoAssets(
	ctx context.Context, job models.StudioJob, provider ai.Provider, model models.ProviderModel,
	prompt string, params map[string]interface{}, references []ai.Reference,
) ([]models.Asset, error) {
	duration := numberAsInt(params["duration"])
	if duration < 1 {
		duration = 15
	}
	task, err := ai.SubmitVideo(ctx, provider, ai.VideoRequest{
		Prompt: prompt, Duration: duration, Ratio: firstText(params["ratio"], "9:16"),
		Resolution: firstText(params["resolution"], "720p"), Audio: boolAsBool(params["audio"]),
		References: references,
	})
	if err != nil {
		return nil, err
	}
	s.DB.Model(&models.StudioJob{}).Where("id = ? AND status = ?", job.ID, "running").Update("remote_task_id", task.ID)
	deadline := time.Now().Add(30 * time.Minute)
	for time.Now().Before(deadline) {
		if err := s.ensureJobRunning(job.ID); err != nil {
			return nil, err
		}
		status, err := ai.PollVideo(ctx, provider, task)
		if err != nil {
			return nil, err
		}
		switch status.State {
		case "succeeded":
			if status.URL == "" {
				return nil, errors.New("视频任务已完成但没有下载地址")
			}
			data, mimeType, err := ai.Download(ctx, status.URL)
			if err != nil {
				return nil, fmt.Errorf("视频产物下载失败：%w", err)
			}
			ext := ".mp4"
			if strings.Contains(mimeType, "quicktime") {
				ext = ".mov"
			}
			key := newObjectKey(fmt.Sprintf("generated/%d/%d", job.OwnerUserID, job.ID), ext)
			if err := s.putObject(ctx, key, bytes.NewReader(data), int64(len(data)), mimeType); err != nil {
				return nil, fmt.Errorf("视频产物转存失败：%w", err)
			}
			return []models.Asset{{
				OwnerUserID: job.OwnerUserID, JobID: job.ID,
				Name: generatedName(job, prompt, 1, 1, ext), Kind: "video", Source: job.ToolName,
				Size: humanSize(int64(len(data))), URL: s.objectURL(key), ObjectKey: key,
				MimeType: mimeType, Seed: 0,
			}}, nil
		case "failed", "cancelled", "expired":
			return nil, fmt.Errorf("视频供应商任务结束：%s", status.State)
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(10 * time.Second):
		}
	}
	return nil, errors.New("视频生成等待超时，供应商任务 ID 已保存，请稍后联系管理员核对")
}

func (s *Server) generateArticleAsset(
	ctx context.Context, job models.StudioJob, provider ai.Provider, prompt string, references []ai.Reference,
) ([]models.Asset, error) {
	if err := s.ensureJobRunning(job.ID); err != nil {
		return nil, err
	}
	system := "你是中文内容编辑。根据用户要求与参考素材创作原创内容。只能描述可见事实，不编造品牌、价格、材质、功效或数据。" +
		"优先输出结构清晰的公众号 Markdown；如用户要求 JSON，则严格返回 JSON。"
	text, err := ai.GenerateText(ctx, provider, system, prompt, references)
	if err != nil {
		return nil, err
	}
	markdown := articleAsMarkdown(text)
	key := newObjectKey(fmt.Sprintf("generated/%d/%d", job.OwnerUserID, job.ID), ".md")
	if err := s.putObject(ctx, key, strings.NewReader(markdown), int64(len(markdown)), "text/markdown; charset=utf-8"); err != nil {
		return nil, err
	}
	return []models.Asset{{
		OwnerUserID: job.OwnerUserID, JobID: job.ID,
		Name: generatedName(job, prompt, 1, 1, ".md"), Kind: "markdown", Source: job.ToolName,
		Size: humanSize(int64(len(markdown))), URL: s.objectURL(key), ObjectKey: key,
		MimeType: "text/markdown", Seed: 0,
	}}, nil
}

func (s *Server) finishStudioSuccess(jobID uint, assets []models.Asset) error {
	return s.DB.Transaction(func(tx *gorm.DB) error {
		var job models.StudioJob
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&job, jobID).Error; err != nil {
			return err
		}
		if job.CreditsSettled {
			return nil
		}
		if job.Status == "cancelled" {
			return errJobCancelled
		}
		if job.Status != "running" {
			return errors.New("任务状态已变化")
		}
		if job.CreditsCharged > 0 {
			detail, _ := json.Marshal(map[string]interface{}{
				"tool": job.Tool, "model": job.ModelID, "modelSource": job.ModelSource,
				"resultCount": len(assets), "remoteTaskId": job.RemoteTaskID,
			})
			if err := s.settleCredits(tx, job.OwnerUserID, job.CreditsCharged, job.CreditsCharged, jobBizType(job.Tool), fmt.Sprint(job.ID), job.ToolName+"任务结算", string(detail)); err != nil {
				return err
			}
		}
		if len(assets) > 0 {
			if err := tx.Create(&assets).Error; err != nil {
				return err
			}
		}
		now := time.Now()
		if err := tx.Model(&job).Updates(map[string]interface{}{
			"status": "succeeded", "result_count": len(assets), "credits_settled": true,
			"completed_at": &now, "error_message": "",
		}).Error; err != nil {
			return err
		}
		return updateWorkflowRunResult(tx, job, "成功", len(assets))
	})
}

func (s *Server) failStudioJob(jobID uint, message string) {
	message = truncateRunes(strings.TrimSpace(message), 900)
	_ = s.DB.Transaction(func(tx *gorm.DB) error {
		var job models.StudioJob
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&job, jobID).Error; err != nil {
			return nil
		}
		if job.CreditsSettled || job.Status == "cancelled" {
			return nil
		}
		if job.CreditsCharged > 0 {
			if err := s.refundReserved(tx, job.OwnerUserID, job.CreditsCharged, jobBizType(job.Tool), fmt.Sprint(job.ID), "生成失败，全额退回预冻结积分"); err != nil {
				return err
			}
		}
		now := time.Now()
		if err := tx.Model(&job).Updates(map[string]interface{}{
			"status": "failed", "credits_settled": true, "error_message": message,
			"completed_at": &now,
		}).Error; err != nil {
			return err
		}
		return updateWorkflowRunResult(tx, job, "失败："+truncateRunes(message, 60), 0)
	})
}

func (s *Server) ensureJobRunning(jobID uint) error {
	var status string
	if err := s.DB.Model(&models.StudioJob{}).Where("id = ?", jobID).Pluck("status", &status).Error; err != nil {
		return err
	}
	if status == "cancelled" {
		return errJobCancelled
	}
	if status != "running" {
		return errJobCancelled
	}
	return nil
}

func generatedName(job models.StudioJob, prompt string, index, total int, ext string) string {
	base := truncateRunes(strings.TrimSpace(prompt), 32)
	if base == "" {
		base = job.ToolName
	}
	base = strings.NewReplacer("/", "-", "\\", "-", "\n", " ", "\r", " ").Replace(base)
	if total > 1 {
		return fmt.Sprintf("%s_%s_%02d%s", base, strings.ReplaceAll(job.ToolName, " ", ""), index, ext)
	}
	return fmt.Sprintf("%s_%s%s", base, strings.ReplaceAll(job.ToolName, " ", ""), ext)
}

func articleAsMarkdown(value string) string {
	start, end := strings.Index(value, "{"), strings.LastIndex(value, "}")
	if start < 0 || end <= start {
		return value
	}
	var article struct {
		Title    string `json:"title"`
		Digest   string `json:"digest"`
		Intro    string `json:"intro"`
		Sections []struct {
			Heading    string   `json:"heading"`
			Paragraphs []string `json:"paragraphs"`
		} `json:"sections"`
		Closing string `json:"closing"`
	}
	if err := json.Unmarshal([]byte(value[start:end+1]), &article); err != nil || article.Title == "" {
		return value
	}
	var builder strings.Builder
	builder.WriteString("# " + article.Title + "\n\n")
	if article.Digest != "" {
		builder.WriteString("> " + article.Digest + "\n\n")
	}
	if article.Intro != "" {
		builder.WriteString(article.Intro + "\n\n")
	}
	for _, section := range article.Sections {
		builder.WriteString("## " + section.Heading + "\n\n")
		for _, paragraph := range section.Paragraphs {
			builder.WriteString(paragraph + "\n\n")
		}
	}
	if article.Closing != "" {
		builder.WriteString(article.Closing + "\n")
	}
	return builder.String()
}

func capabilityForTool(tool string) string {
	switch tool {
	case "video", "product", "clone_video":
		return "video"
	case "article":
		return "understanding"
	default:
		return "image"
	}
}

func numberAsInt(value interface{}) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case int64:
		return int(typed)
	case json.Number:
		n, _ := typed.Int64()
		return int(n)
	case string:
		n, _ := strconv.Atoi(typed)
		return n
	default:
		return 0
	}
}

func boolAsBool(value interface{}) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return typed == "true" || typed == "1"
	case float64:
		return typed != 0
	default:
		return false
	}
}

func firstText(values ...interface{}) string {
	for _, value := range values {
		switch typed := value.(type) {
		case string:
			if strings.TrimSpace(typed) != "" {
				return strings.TrimSpace(typed)
			}
		case float64:
			return strconv.Itoa(int(typed))
		case int:
			return strconv.Itoa(typed)
		}
	}
	return ""
}

func modelListContains(modelsCSV, modelID string) bool {
	for _, item := range strings.Split(modelsCSV, ",") {
		if strings.TrimSpace(item) == strings.TrimSpace(modelID) {
			return true
		}
	}
	return false
}

func videoExtension(mimeType string) string {
	if extensions, err := mime.ExtensionsByType(strings.Split(mimeType, ";")[0]); err == nil && len(extensions) > 0 {
		for _, extension := range extensions {
			if extension == ".mp4" || extension == ".webm" || extension == ".mov" {
				return extension
			}
		}
	}
	return path.Ext("video.mp4")
}
