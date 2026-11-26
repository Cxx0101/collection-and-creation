package ai

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const maxMediaSize = 80 << 20

type Provider struct {
	Protocol  string
	BaseURL   string
	APIKey    string
	SecretKey string
	Model     string
}

type Reference struct {
	Name string
	Kind string
	Role string
	URL  string
	MIME string
	Data []byte
}

type ImageRequest struct {
	Prompt     string
	Size       string
	References []Reference
}

type ImageResult struct {
	Data []byte
	MIME string
}

type TextMessage struct {
	Role string
	Text string
}

type VideoRequest struct {
	Prompt     string
	Duration   int
	Ratio      string
	Resolution string
	Audio      bool
	References []Reference
}

type VideoTask struct {
	ID         string
	CreatePath string
}

type VideoStatus struct {
	State string
	URL   string
}

func GenerateImage(ctx context.Context, provider Provider, req ImageRequest) (ImageResult, error) {
	switch normalizeProtocol(provider.Protocol) {
	case "ark":
		return generateArkImage(ctx, provider, req)
	case "google":
		return generateGoogleImage(ctx, provider, req)
	case "openai", "custom", "deepseek", "glm", "aliyun", "qwen", "minimax", "kling", "midjourney":
		return generateOpenAIImage(ctx, provider, req)
	default:
		return ImageResult{}, fmt.Errorf("供应商协议 %s 暂不支持生图", provider.Protocol)
	}
}

func GenerateText(ctx context.Context, provider Provider, system, prompt string, references []Reference) (string, error) {
	if normalizeProtocol(provider.Protocol) == "google" {
		return generateGoogleText(ctx, provider, system, prompt, references)
	}
	return generateOpenAIText(ctx, provider, system, prompt, references)
}

func SubmitVideo(ctx context.Context, provider Provider, req VideoRequest) (VideoTask, error) {
	switch normalizeProtocol(provider.Protocol) {
	case "ark":
		return submitArkVideo(ctx, provider, req)
	case "minimax":
		return submitMiniMaxVideo(ctx, provider, req)
	case "kling":
		return submitKlingVideo(ctx, provider, req)
	case "qwen", "aliyun":
		return submitQwenVideo(ctx, provider, req)
	default:
		return VideoTask{}, fmt.Errorf("供应商协议 %s 暂不支持视频生成", provider.Protocol)
	}
}

func PollVideo(ctx context.Context, provider Provider, task VideoTask) (VideoStatus, error) {
	switch normalizeProtocol(provider.Protocol) {
	case "ark":
		return pollArkVideo(ctx, provider, task)
	case "minimax":
		return pollMiniMaxVideo(ctx, provider, task)
	case "kling":
		return pollKlingVideo(ctx, provider, task)
	case "qwen", "aliyun":
		return pollQwenVideo(ctx, provider, task)
	default:
		return VideoStatus{}, fmt.Errorf("供应商协议 %s 暂不支持视频查询", provider.Protocol)
	}
}

func Download(ctx context.Context, rawURL string) ([]byte, string, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" || parsed.User != nil {
		return nil, "", errors.New("模型返回的下载地址无效")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := (&http.Client{Timeout: 3 * time.Minute}).Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("下载生成产物失败（HTTP %d）", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxMediaSize+1))
	if err != nil {
		return nil, "", err
	}
	if len(data) > maxMediaSize {
		return nil, "", errors.New("生成产物超过 80MB 限制")
	}
	mimeType := strings.Split(resp.Header.Get("Content-Type"), ";")[0]
	if mimeType == "" {
		mimeType = http.DetectContentType(data)
	}
	return data, mimeType, nil
}

func generateArkImage(ctx context.Context, provider Provider, req ImageRequest) (ImageResult, error) {
	body := map[string]interface{}{
		"model": provider.Model, "prompt": req.Prompt, "size": normalizeImageSize(req.Size),
		"watermark": false, "response_format": "b64_json",
	}
	if len(req.References) > 0 {
		images := make([]string, 0, len(req.References))
		for _, reference := range req.References {
			images = append(images, "data:"+referenceMIME(reference)+";base64,"+base64.StdEncoding.EncodeToString(reference.Data))
		}
		body["image"] = images
	}
	payload, err := doJSON(ctx, http.MethodPost, joinURL(provider.BaseURL, "/images/generations"), provider.APIKey, nil, body)
	if err != nil {
		return ImageResult{}, err
	}
	items, _ := payload["data"].([]interface{})
	if len(items) == 0 {
		return ImageResult{}, errors.New("生图接口未返回图片")
	}
	first, _ := items[0].(map[string]interface{})
	return imageFromPayload(ctx, first)
}

func generateGoogleImage(ctx context.Context, provider Provider, req ImageRequest) (ImageResult, error) {
	input := []interface{}{map[string]interface{}{"type": "text", "text": req.Prompt}}
	for _, reference := range req.References {
		input = append(input, map[string]interface{}{
			"type": "image", "mime_type": referenceMIME(reference),
			"data": base64.StdEncoding.EncodeToString(reference.Data),
		})
	}
	body := map[string]interface{}{
		"model": provider.Model, "input": input, "store": false,
		"response_format": map[string]interface{}{
			"type": "image", "mime_type": "image/png",
			"aspect_ratio": googleAspectRatio(req.Size), "image_size": "2K",
		},
	}
	base := ensureGoogleBase(provider.BaseURL)
	payload, err := doJSON(ctx, http.MethodPost, joinURL(base, "/interactions"), "", map[string]string{
		"x-goog-api-key": provider.APIKey,
	}, body)
	if err != nil {
		return ImageResult{}, err
	}
	if image, ok := payload["output_image"].(map[string]interface{}); ok {
		if text := stringValue(image["data"]); text != "" {
			data, decodeErr := base64.StdEncoding.DecodeString(text)
			if decodeErr != nil {
				return ImageResult{}, errors.New("Google 返回的图片 Base64 无效")
			}
			return ImageResult{Data: data, MIME: stringValue(image["mime_type"])}, nil
		}
	}
	var outputs []interface{}
	if list, ok := payload["outputs"].([]interface{}); ok {
		outputs = append(outputs, list...)
	}
	if steps, ok := payload["steps"].([]interface{}); ok {
		for _, rawStep := range steps {
			step, _ := rawStep.(map[string]interface{})
			if stringValue(step["type"]) != "model_output" {
				continue
			}
			if list, ok := step["content"].([]interface{}); ok {
				outputs = append(outputs, list...)
			}
		}
	}
	for _, rawOutput := range outputs {
		output, _ := rawOutput.(map[string]interface{})
		if stringValue(output["type"]) != "image" || stringValue(output["data"]) == "" {
			continue
		}
		data, err := base64.StdEncoding.DecodeString(stringValue(output["data"]))
		if err != nil {
			continue
		}
		mimeType := stringValue(output["mime_type"])
		if mimeType == "" {
			mimeType = "image/png"
		}
		return ImageResult{Data: data, MIME: mimeType}, nil
	}
	return ImageResult{}, errors.New("Google 未返回图片，可能被内容审核拦截")
}

func generateOpenAIImage(ctx context.Context, provider Provider, req ImageRequest) (ImageResult, error) {
	base := strings.TrimRight(provider.BaseURL, "/")
	if len(req.References) == 0 {
		body := map[string]interface{}{
			"model": provider.Model, "prompt": req.Prompt, "n": 1,
			"size": normalizeOpenAIImageSize(req.Size), "response_format": "b64_json",
		}
		payload, err := doJSON(ctx, http.MethodPost, joinURL(base, "/images/generations"), provider.APIKey, nil, body)
		if err != nil {
			return ImageResult{}, err
		}
		items, _ := payload["data"].([]interface{})
		if len(items) == 0 {
			return ImageResult{}, errors.New("生图接口未返回图片")
		}
		first, _ := items[0].(map[string]interface{})
		return imageFromPayload(ctx, first)
	}

	var buffer bytes.Buffer
	writer := multipart.NewWriter(&buffer)
	_ = writer.WriteField("model", provider.Model)
	_ = writer.WriteField("prompt", req.Prompt)
	_ = writer.WriteField("n", "1")
	_ = writer.WriteField("size", normalizeOpenAIImageSize(req.Size))
	_ = writer.WriteField("response_format", "b64_json")
	for index, reference := range req.References {
		part, err := writer.CreateFormFile("image[]", fmt.Sprintf("reference-%d%s", index+1, extensionForMIME(referenceMIME(reference))))
		if err != nil {
			return ImageResult{}, err
		}
		if _, err := part.Write(reference.Data); err != nil {
			return ImageResult{}, err
		}
	}
	_ = writer.Close()
	reqHTTP, err := http.NewRequestWithContext(ctx, http.MethodPost, joinURL(base, "/images/edits"), &buffer)
	if err != nil {
		return ImageResult{}, err
	}
	reqHTTP.Header.Set("Authorization", "Bearer "+provider.APIKey)
	reqHTTP.Header.Set("Content-Type", writer.FormDataContentType())
	resp, err := (&http.Client{Timeout: 5 * time.Minute}).Do(reqHTTP)
	if err != nil {
		return ImageResult{}, fmt.Errorf("连接生图接口失败：%w", err)
	}
	defer resp.Body.Close()
	payload, err := decodeResponse(resp)
	if err != nil {
		return ImageResult{}, err
	}
	items, _ := payload["data"].([]interface{})
	if len(items) == 0 {
		return ImageResult{}, errors.New("生图接口未返回图片")
	}
	first, _ := items[0].(map[string]interface{})
	return imageFromPayload(ctx, first)
}

func generateOpenAIText(ctx context.Context, provider Provider, system, prompt string, references []Reference) (string, error) {
	content := make([]interface{}, 0, 1+len(references))
	content = append(content, map[string]interface{}{"type": "text", "text": prompt})
	for _, reference := range references {
		content = append(content, map[string]interface{}{
			"type": "image_url", "image_url": map[string]interface{}{
				"url": "data:" + referenceMIME(reference) + ";base64," + base64.StdEncoding.EncodeToString(reference.Data),
			},
		})
	}
	messages := make([]interface{}, 0, 2)
	if strings.TrimSpace(system) != "" {
		messages = append(messages, map[string]interface{}{"role": "system", "content": system})
	}
	messages = append(messages, map[string]interface{}{"role": "user", "content": content})
	payload, err := doJSON(ctx, http.MethodPost, joinURL(provider.BaseURL, "/chat/completions"), provider.APIKey, nil, map[string]interface{}{
		"model": provider.Model, "stream": false,
		"messages": messages,
	})
	if err != nil {
		return "", err
	}
	choices, _ := payload["choices"].([]interface{})
	if len(choices) == 0 {
		return "", errors.New("文本模型没有返回结果")
	}
	choice, _ := choices[0].(map[string]interface{})
	message, _ := choice["message"].(map[string]interface{})
	text := stringValue(message["content"])
	if text == "" {
		return "", errors.New("文本模型返回内容为空")
	}
	return text, nil
}

func generateGoogleText(ctx context.Context, provider Provider, system, prompt string, references []Reference) (string, error) {
	parts := make([]interface{}, 0, 1+len(references))
	parts = append(parts, map[string]interface{}{"text": prompt})
	for _, reference := range references {
		parts = append(parts, map[string]interface{}{
			"inline_data": map[string]interface{}{
				"mime_type": referenceMIME(reference), "data": base64.StdEncoding.EncodeToString(reference.Data),
			},
		})
	}
	base := ensureGoogleBase(provider.BaseURL)
	endpoint := joinURL(base, "/models/"+url.PathEscape(provider.Model)+":generateContent")
	payload, err := doJSON(ctx, http.MethodPost, endpoint, "", map[string]string{
		"x-goog-api-key": provider.APIKey,
	}, map[string]interface{}{
		"system_instruction": map[string]interface{}{"parts": []interface{}{map[string]interface{}{"text": system}}},
		"contents":           []interface{}{map[string]interface{}{"role": "user", "parts": parts}},
	})
	if err != nil {
		return "", err
	}
	candidates, _ := payload["candidates"].([]interface{})
	if len(candidates) == 0 {
		return "", errors.New("Google 文本模型没有返回结果")
	}
	candidate, _ := candidates[0].(map[string]interface{})
	content, _ := candidate["content"].(map[string]interface{})
	responseParts, _ := content["parts"].([]interface{})
	var builder strings.Builder
	for _, rawPart := range responseParts {
		part, _ := rawPart.(map[string]interface{})
		builder.WriteString(stringValue(part["text"]))
	}
	if builder.Len() == 0 {
		return "", errors.New("Google 文本模型返回内容为空")
	}
	return builder.String(), nil
}

func submitArkVideo(ctx context.Context, provider Provider, req VideoRequest) (VideoTask, error) {
	content := []interface{}{map[string]interface{}{"type": "text", "text": req.Prompt}}
	for _, reference := range req.References {
		if reference.Kind == "video" || strings.HasPrefix(strings.ToLower(reference.MIME), "video/") {
			if strings.TrimSpace(reference.URL) == "" {
				return VideoTask{}, errors.New("参考视频缺少可供模型读取的 URL")
			}
			content = append(content, map[string]interface{}{
				"type": "video_url", "role": "reference_video",
				"video_url": map[string]interface{}{"url": reference.URL},
			})
			continue
		}
		role := strings.TrimSpace(reference.Role)
		if role == "" || role == "source" || strings.HasPrefix(role, "try_on_") || strings.HasPrefix(role, "apparel_") {
			role = "reference_image"
		}
		imageURL := strings.TrimSpace(reference.URL)
		if imageURL == "" {
			return VideoTask{}, fmt.Errorf("参考图片「%s」缺少可供模型读取的 URL", reference.Name)
		}
		content = append(content, map[string]interface{}{
			"type": "image_url", "role": role,
			"image_url": map[string]interface{}{
				"url": imageURL,
			},
		})
	}
	payload, err := doJSON(ctx, http.MethodPost, joinURL(provider.BaseURL, "/contents/generations/tasks"), provider.APIKey, nil, map[string]interface{}{
		"model": provider.Model, "content": content, "duration": maxInt(req.Duration, 4),
		"ratio": defaultString(req.Ratio, "9:16"), "resolution": defaultString(req.Resolution, "720p"),
		"generate_audio": req.Audio, "watermark": false,
	})
	if err != nil {
		return VideoTask{}, err
	}
	id := stringValue(payload["id"])
	if id == "" {
		return VideoTask{}, errors.New("方舟创建响应缺少任务 ID")
	}
	return VideoTask{ID: id, CreatePath: "/contents/generations/tasks"}, nil
}

func pollArkVideo(ctx context.Context, provider Provider, task VideoTask) (VideoStatus, error) {
	payload, err := doJSON(ctx, http.MethodGet, joinURL(provider.BaseURL, "/contents/generations/tasks/"+url.PathEscape(task.ID)), provider.APIKey, nil, nil)
	if err != nil {
		return VideoStatus{}, err
	}
	status := stringValue(payload["status"])
	content, _ := payload["content"].(map[string]interface{})
	videoURL := stringValue(content["video_url"])
	if status == "succeeded" && videoURL == "" {
		return VideoStatus{}, errors.New("方舟任务成功但未返回视频地址")
	}
	return VideoStatus{State: status, URL: videoURL}, nil
}

func submitMiniMaxVideo(ctx context.Context, provider Provider, req VideoRequest) (VideoTask, error) {
	content := []interface{}{map[string]interface{}{"type": "text", "text": req.Prompt}}
	for _, reference := range req.References {
		content = append(content, map[string]interface{}{
			"type": "image_url", "image_url": map[string]interface{}{
				"url": "data:" + referenceMIME(reference) + ";base64," + base64.StdEncoding.EncodeToString(reference.Data),
			},
		})
	}
	payload, err := doJSON(ctx, http.MethodPost, joinURL(provider.BaseURL, "/v2/video_generation"), provider.APIKey, nil, map[string]interface{}{
		"model": provider.Model, "content": content, "duration": maxInt(req.Duration, 4),
		"ratio": defaultString(req.Ratio, "9:16"), "resolution": strings.ToUpper(defaultString(req.Resolution, "720p")),
	})
	if err != nil {
		return VideoTask{}, err
	}
	id := stringValue(payload["task_id"])
	if id == "" {
		return VideoTask{}, errors.New("MiniMax 创建响应缺少 task_id")
	}
	return VideoTask{ID: id, CreatePath: "/v2/video_generation"}, nil
}

func pollMiniMaxVideo(ctx context.Context, provider Provider, task VideoTask) (VideoStatus, error) {
	payload, err := doJSON(ctx, http.MethodGet, joinURL(provider.BaseURL, "/v2/query/video_generation/"+url.PathEscape(task.ID)), provider.APIKey, nil, nil)
	if err != nil {
		return VideoStatus{}, err
	}
	data, _ := payload["task"].(map[string]interface{})
	status := strings.ToLower(stringValue(data["status"]))
	content, _ := data["content"].(map[string]interface{})
	videoURL := stringValue(content["url"])
	return VideoStatus{State: normalizeVideoState(status), URL: videoURL}, nil
}

func submitKlingVideo(ctx context.Context, provider Provider, req VideoRequest) (VideoTask, error) {
	if strings.TrimSpace(provider.SecretKey) == "" {
		return VideoTask{}, errors.New("可灵 Secret Key 未配置")
	}
	token, err := klingToken(provider.APIKey, provider.SecretKey)
	if err != nil {
		return VideoTask{}, err
	}
	body := map[string]interface{}{
		"model_name": provider.Model, "prompt": req.Prompt, "duration": strconv.Itoa(maxInt(req.Duration, 5)),
		"mode":           map[bool]string{true: "pro", false: "std"}[strings.EqualFold(req.Resolution, "1080p")],
		"watermark_info": map[string]interface{}{"enabled": false},
	}
	createPath := "/v1/videos/text2video"
	if len(req.References) > 0 {
		createPath = "/v1/videos/image2video"
		body["image"] = base64.StdEncoding.EncodeToString(req.References[0].Data)
		if len(req.References) > 1 {
			body["image_tail"] = base64.StdEncoding.EncodeToString(req.References[1].Data)
		}
	} else {
		body["aspect_ratio"] = defaultString(req.Ratio, "9:16")
	}
	payload, err := doJSON(ctx, http.MethodPost, joinURL(provider.BaseURL, createPath), token, nil, body)
	if err != nil {
		return VideoTask{}, err
	}
	data, _ := payload["data"].(map[string]interface{})
	id := stringValue(data["task_id"])
	if id == "" {
		return VideoTask{}, errors.New("可灵创建响应缺少 task_id")
	}
	return VideoTask{ID: id, CreatePath: createPath}, nil
}

func pollKlingVideo(ctx context.Context, provider Provider, task VideoTask) (VideoStatus, error) {
	token, err := klingToken(provider.APIKey, provider.SecretKey)
	if err != nil {
		return VideoStatus{}, err
	}
	payload, err := doJSON(ctx, http.MethodGet, joinURL(provider.BaseURL, task.CreatePath+"/"+url.PathEscape(task.ID)), token, nil, nil)
	if err != nil {
		return VideoStatus{}, err
	}
	data, _ := payload["data"].(map[string]interface{})
	status := strings.ToLower(stringValue(data["task_status"]))
	result, _ := data["task_result"].(map[string]interface{})
	videos, _ := result["videos"].([]interface{})
	videoURL := ""
	if len(videos) > 0 {
		first, _ := videos[0].(map[string]interface{})
		videoURL = stringValue(first["url"])
	}
	return VideoStatus{State: normalizeVideoState(status), URL: videoURL}, nil
}

func submitQwenVideo(ctx context.Context, provider Provider, req VideoRequest) (VideoTask, error) {
	body := map[string]interface{}{
		"model": provider.Model,
		"input": map[string]interface{}{"prompt": req.Prompt},
		"parameters": map[string]interface{}{
			"duration": maxInt(req.Duration, 5), "watermark": false, "prompt_extend": false,
		},
	}
	if len(req.References) > 0 {
		body["input"].(map[string]interface{})["img_url"] =
			"data:" + referenceMIME(req.References[0]) + ";base64," + base64.StdEncoding.EncodeToString(req.References[0].Data)
		body["parameters"].(map[string]interface{})["resolution"] = strings.ToUpper(defaultString(req.Resolution, "720p"))
	} else {
		body["parameters"].(map[string]interface{})["size"] = ratioSize(req.Ratio, req.Resolution)
	}
	headers := map[string]string{"X-DashScope-Async": "enable"}
	payload, err := doJSON(ctx, http.MethodPost, joinURL(provider.BaseURL, "/api/v1/services/aigc/video-generation/video-synthesis"), provider.APIKey, headers, body)
	if err != nil {
		return VideoTask{}, err
	}
	output, _ := payload["output"].(map[string]interface{})
	id := stringValue(output["task_id"])
	if id == "" {
		return VideoTask{}, errors.New("通义万相创建响应缺少 task_id")
	}
	return VideoTask{ID: id, CreatePath: "/api/v1/services/aigc/video-generation/video-synthesis"}, nil
}

func pollQwenVideo(ctx context.Context, provider Provider, task VideoTask) (VideoStatus, error) {
	payload, err := doJSON(ctx, http.MethodGet, joinURL(provider.BaseURL, "/api/v1/tasks/"+url.PathEscape(task.ID)), provider.APIKey, nil, nil)
	if err != nil {
		return VideoStatus{}, err
	}
	output, _ := payload["output"].(map[string]interface{})
	status := strings.ToLower(stringValue(output["task_status"]))
	return VideoStatus{State: normalizeVideoState(status), URL: stringValue(output["video_url"])}, nil
}

func doJSON(ctx context.Context, method, endpoint, bearer string, headers map[string]string, body interface{}) (map[string]interface{}, error) {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	req.Header.Set("Accept", "application/json")
	resp, err := (&http.Client{Timeout: 6 * time.Minute}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("模型接口连接失败：%w", err)
	}
	defer resp.Body.Close()
	return decodeResponse(resp)
}

func decodeResponse(resp *http.Response) (map[string]interface{}, error) {
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, err
	}
	var payload map[string]interface{}
	_ = json.Unmarshal(raw, &payload)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		detail := extractError(payload)
		if detail == "" {
			detail = truncate(strings.TrimSpace(string(raw)), 240)
		}
		if detail != "" {
			return nil, fmt.Errorf("模型接口拒绝请求（HTTP %d）：%s", resp.StatusCode, detail)
		}
		return nil, fmt.Errorf("模型接口拒绝请求（HTTP %d）", resp.StatusCode)
	}
	if payload == nil {
		return nil, errors.New("模型接口返回的数据不是有效 JSON")
	}
	return payload, nil
}

func imageFromPayload(ctx context.Context, payload map[string]interface{}) (ImageResult, error) {
	if payload == nil {
		return ImageResult{}, errors.New("生图接口返回结构无效")
	}
	if encoded := stringValue(payload["b64_json"]); encoded != "" {
		data, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return ImageResult{}, errors.New("生图接口返回的 Base64 图片无效")
		}
		return ImageResult{Data: data, MIME: http.DetectContentType(data)}, nil
	}
	rawURL := stringValue(payload["url"])
	if rawURL == "" {
		return ImageResult{}, errors.New("生图接口未返回图片数据")
	}
	data, mimeType, err := Download(ctx, rawURL)
	if err != nil {
		return ImageResult{}, err
	}
	return ImageResult{Data: data, MIME: mimeType}, nil
}

func extractError(payload map[string]interface{}) string {
	if payload == nil {
		return ""
	}
	errorValue, _ := payload["error"].(map[string]interface{})
	if errorValue != nil {
		parts := []string{stringValue(errorValue["code"]), stringValue(errorValue["message"])}
		return truncate(strings.TrimSpace(strings.Join(parts, " · ")), 240)
	}
	return truncate(firstNonEmpty(stringValue(payload["message"]), stringValue(payload["msg"])), 240)
}

func normalizeProtocol(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "volcengine", "volc", "doubao", "seedream":
		return "ark"
	case "gemini":
		return "google"
	case "dashscope":
		return "qwen"
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func ensureGoogleBase(base string) string {
	base = strings.TrimRight(base, "/")
	if strings.Contains(base, "/v1beta") || strings.Contains(base, "/v1") {
		return base
	}
	return base + "/v1beta"
}

func joinURL(base, route string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	route = "/" + strings.TrimLeft(route, "/")
	if strings.HasSuffix(base, route) {
		return base
	}
	return base + route
}

func referenceMIME(reference Reference) string {
	if strings.TrimSpace(reference.MIME) != "" {
		return reference.MIME
	}
	return http.DetectContentType(reference.Data)
}

func normalizeImageSize(size string) string {
	size = strings.TrimSpace(strings.ToLower(size))
	switch size {
	case "1:1":
		return "1024x1024"
	case "3:4":
		return "1024x1365"
	case "4:3":
		return "1365x1024"
	case "9:16":
		return "768x1365"
	case "16:9":
		return "1365x768"
	case "2:3":
		return "1024x1536"
	case "3:2":
		return "1536x1024"
	}
	if strings.Contains(size, "x") {
		return size
	}
	return "1024x1024"
}

func normalizeOpenAIImageSize(size string) string {
	normalized := normalizeImageSize(size)
	parts := strings.Split(normalized, "x")
	if len(parts) != 2 {
		return "1024x1024"
	}
	width, _ := strconv.Atoi(parts[0])
	height, _ := strconv.Atoi(parts[1])
	if width == height {
		return "1024x1024"
	}
	if height > width {
		return "1024x1536"
	}
	return "1536x1024"
}

func googleAspectRatio(size string) string {
	size = strings.ToLower(strings.TrimSpace(size))
	allowed := map[string]bool{"1:1": true, "2:3": true, "3:2": true, "3:4": true, "4:3": true, "4:5": true, "5:4": true, "9:16": true, "16:9": true, "21:9": true}
	if allowed[size] {
		return size
	}
	return "1:1"
}

func ratioSize(ratio, resolution string) string {
	ratio = defaultString(ratio, "9:16")
	sizes := map[string]map[string]string{
		"720p": {
			"16:9": "1280*720", "9:16": "720*1280", "1:1": "960*960", "4:3": "1088*832", "3:4": "832*1088",
		},
		"1080p": {
			"16:9": "1920*1080", "9:16": "1080*1920", "1:1": "1440*1440", "4:3": "1632*1248", "3:4": "1248*1632",
		},
	}
	tier := sizes[strings.ToLower(resolution)]
	if tier == nil || tier[ratio] == "" {
		return "1280*720"
	}
	return tier[ratio]
}

func normalizeVideoState(value string) string {
	switch strings.ToLower(value) {
	case "success", "succeed", "succeeded", "successful":
		return "succeeded"
	case "failed", "fail", "cancelled", "canceled", "expired":
		return "failed"
	case "processing", "running", "queued", "pending", "submitted":
		return "running"
	default:
		return value
	}
}

func klingToken(accessKey, secretKey string) (string, error) {
	encode := func(value interface{}) (string, error) {
		raw, err := json.Marshal(value)
		if err != nil {
			return "", err
		}
		return base64.RawURLEncoding.EncodeToString(raw), nil
	}
	header, err := encode(map[string]interface{}{"alg": "HS256", "typ": "JWT"})
	if err != nil {
		return "", err
	}
	now := time.Now().Unix()
	claims, err := encode(map[string]interface{}{"iss": accessKey, "exp": now + 1800, "nbf": now - 5})
	if err != nil {
		return "", err
	}
	message := header + "." + claims
	mac := hmac.New(sha256.New, []byte(secretKey))
	_, _ = mac.Write([]byte(message))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return message + "." + signature, nil
}

func stringValue(value interface{}) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatInt(int64(typed), 10)
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	default:
		return ""
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}

func maxInt(value, minimum int) int {
	if value < minimum {
		return minimum
	}
	return value
}

func truncate(value string, max int) string {
	runes := []rune(value)
	if len(runes) > max {
		return string(runes[:max])
	}
	return value
}

func extensionForMIME(mimeType string) string {
	switch strings.ToLower(strings.Split(mimeType, ";")[0]) {
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	default:
		return ".jpg"
	}
}
