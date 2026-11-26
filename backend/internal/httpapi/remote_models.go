package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"sparkstudio/backend/internal/models"
)

const (
	remoteModelsTimeout  = 15 * time.Second
	remoteModelsMaxBytes = 4 << 20
	remoteModelsMaxItems = 500
)

type remoteModelOption struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName,omitempty"`
	OwnedBy     string `json:"ownedBy,omitempty"`
	Capability  string `json:"capability,omitempty"`
}

type remoteModelsError struct {
	status  int
	message string
}

func (e *remoteModelsError) Error() string { return e.message }

func (s *Server) AdminListRemoteModels(c *gin.Context) {
	var provider models.ProviderConfig
	if err := s.DB.First(&provider, IDParam(c, "id")).Error; err != nil {
		Fail(c, 404, "供应商不存在")
		return
	}
	apiKey := strings.TrimSpace(decryptSecret(provider.APIKey))
	if apiKey == "" {
		Fail(c, 400, "尚未保存 API Key，请先补齐供应商密钥再拉取模型")
		return
	}
	list, err := fetchRemoteModels(c.Request.Context(), provider, apiKey)
	if err != nil {
		writeRemoteModelsError(c, err)
		return
	}
	OK(c, gin.H{"models": list, "count": len(list)})
}

func fetchRemoteModels(ctx context.Context, provider models.ProviderConfig, apiKey string) ([]remoteModelOption, error) {
	if strings.TrimSpace(apiKey) == "" {
		return nil, &remoteModelsError{status: http.StatusBadRequest, message: "尚未保存 API Key，请先补齐供应商密钥再拉取模型"}
	}
	req, _, err := newRemoteModelsRequest(ctx, provider, apiKey)
	if err != nil {
		return nil, &remoteModelsError{status: http.StatusBadRequest, message: err.Error()}
	}
	client := &http.Client{Timeout: remoteModelsTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, &remoteModelsError{status: http.StatusBadGateway, message: "拉取模型列表连接失败：" + remoteModelsNetworkError(err)}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, remoteModelsMaxBytes+1))
	if err != nil {
		return nil, &remoteModelsError{status: http.StatusBadGateway, message: "读取供应商模型列表失败"}
	}
	if len(body) > remoteModelsMaxBytes {
		return nil, &remoteModelsError{status: http.StatusBadGateway, message: "供应商返回的模型列表过大，已停止处理"}
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, &remoteModelsError{status: http.StatusBadGateway, message: remoteModelsHTTPError(resp.StatusCode, body)}
	}

	list, err := parseRemoteModels(body)
	if err != nil {
		return nil, &remoteModelsError{status: http.StatusBadGateway, message: err.Error()}
	}
	if len(list) == 0 {
		return nil, &remoteModelsError{status: http.StatusBadGateway, message: "供应商未返回可用模型，可改为手动填写模型 ID"}
	}
	return list, nil
}

func writeRemoteModelsError(c *gin.Context, err error) {
	var remoteErr *remoteModelsError
	if errors.As(err, &remoteErr) {
		Fail(c, remoteErr.status, remoteErr.message)
		return
	}
	Fail(c, http.StatusInternalServerError, "拉取模型列表失败")
}

func newRemoteModelsRequest(ctx context.Context, provider models.ProviderConfig, apiKey string) (*http.Request, string, error) {
	endpoint, err := remoteModelsEndpoint(provider)
	if err != nil {
		return nil, "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, "", fmt.Errorf("供应商 Base URL 无效")
	}
	if normalizeProviderProtocol(provider.Provider) == "google" {
		req.Header.Set("x-goog-api-key", apiKey)
	} else {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "SparkStudio/1.0")
	return req, endpoint, nil
}

func remoteModelsEndpoint(provider models.ProviderConfig) (string, error) {
	raw := strings.TrimSpace(provider.BaseURL)
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", fmt.Errorf("供应商 Base URL 无效，请填写完整的 http(s) 地址")
	}
	path := strings.TrimRight(parsed.Path, "/")
	if strings.HasSuffix(strings.ToLower(path), "/models") {
		parsed.Path = path
		parsed.RawPath = ""
		return parsed.String(), nil
	}

	protocol := normalizeProviderProtocol(provider.Provider)
	if protocol == "google" {
		switch {
		case path == "":
			path = "/v1beta/models"
		case strings.HasSuffix(path, "/v1") || strings.HasSuffix(path, "/v1beta"):
			path += "/models"
		default:
			path += "/models"
		}
	} else if protocol == "qwen" || protocol == "aliyun" {
		switch {
		case path == "":
			path = "/compatible-mode/v1/models"
		case strings.HasSuffix(path, "/compatible-mode/v1"):
			path += "/models"
		default:
			path += "/models"
		}
	} else {
		path += "/models"
	}
	parsed.Path = path
	parsed.RawPath = ""
	return parsed.String(), nil
}

func normalizeProviderProtocol(value string) string {
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

func parseRemoteModels(raw []byte) ([]remoteModelOption, error) {
	var payload interface{}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		return nil, fmt.Errorf("供应商返回的模型列表不是有效 JSON")
	}

	objects := collectRemoteModelObjects(payload, 0)
	seen := make(map[string]struct{}, len(objects))
	list := make([]remoteModelOption, 0, len(objects))
	for _, object := range objects {
		id := firstRemoteString(object, "id", "model_id", "modelId", "endpoint_id", "endpointId", "model", "name", "slug")
		id = strings.TrimSpace(id)
		id = strings.TrimPrefix(id, "models/")
		if id == "" {
			continue
		}
		key := strings.ToLower(id)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		displayName := firstRemoteString(object, "display_name", "displayName", "title", "label", "name")
		displayName = strings.TrimSpace(displayName)
		if displayName == id || displayName == "models/"+id {
			displayName = ""
		}
		item := remoteModelOption{
			ID:          id,
			DisplayName: displayName,
			OwnedBy:     strings.TrimSpace(firstRemoteString(object, "owned_by", "ownedBy", "publisher", "provider", "owner")),
			Capability:  normalizeRemoteCapability(firstRemoteString(object, "capability", "cap", "domain", "model_type", "type")),
		}
		list = append(list, item)
		if len(list) >= remoteModelsMaxItems {
			break
		}
	}
	sort.SliceStable(list, func(i, j int) bool {
		left := strings.ToLower(firstNonBlank(list[i].DisplayName, list[i].ID))
		right := strings.ToLower(firstNonBlank(list[j].DisplayName, list[j].ID))
		return left < right
	})
	return list, nil
}

func collectRemoteModelObjects(node interface{}, depth int) []map[string]interface{} {
	if depth > 5 {
		return nil
	}
	switch value := node.(type) {
	case []interface{}:
		var out []map[string]interface{}
		for _, item := range value {
			out = append(out, collectRemoteModelObjects(item, depth+1)...)
		}
		return out
	case map[string]interface{}:
		for _, key := range []string{"data", "models", "items", "list", "result", "output", "payload"} {
			if child, exists := value[key]; exists {
				if nested := collectRemoteModelObjects(child, depth+1); len(nested) > 0 {
					return nested
				}
			}
		}
		if firstRemoteString(value, "id", "model_id", "modelId", "endpoint_id", "endpointId", "model", "name", "slug") != "" {
			return []map[string]interface{}{value}
		}
		return nil
	default:
		return nil
	}
}

func firstRemoteString(object map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if value, ok := object[key].(string); ok && strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func normalizeRemoteCapability(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	switch {
	case strings.Contains(normalized, "video"):
		return "video"
	case strings.Contains(normalized, "image"):
		return "image"
	case normalized == "llm", normalized == "vlm", normalized == "chat", normalized == "text",
		normalized == "audio", normalized == "embedding", normalized == "understanding":
		return "understanding"
	default:
		return ""
	}
}

func remoteModelsHTTPError(status int, body []byte) string {
	switch status {
	case http.StatusUnauthorized, http.StatusForbidden:
		return fmt.Sprintf("API Key 鉴权失败或没有模型列表权限（HTTP %d）", status)
	case http.StatusNotFound:
		return "该供应商未开放 /models 接口，请手动填写模型 ID（HTTP 404）"
	case http.StatusTooManyRequests:
		return "供应商模型列表接口触发限流，请稍后重试（HTTP 429）"
	}
	if status >= 500 {
		return fmt.Sprintf("供应商模型列表接口暂不可用（HTTP %d）", status)
	}
	if message := remoteUpstreamMessage(body); message != "" {
		return fmt.Sprintf("拉取模型失败（HTTP %d）：%s", status, message)
	}
	return fmt.Sprintf("拉取模型失败（HTTP %d）", status)
}

func remoteUpstreamMessage(body []byte) string {
	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return ""
	}
	if errorValue, ok := payload["error"].(map[string]interface{}); ok {
		return truncateText(firstRemoteString(errorValue, "message", "msg", "detail"), 180)
	}
	if errorValue, ok := payload["error"].(string); ok {
		return truncateText(errorValue, 180)
	}
	return truncateText(firstRemoteString(payload, "message", "msg", "detail"), 180)
}

func remoteModelsNetworkError(err error) string {
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "timeout") || strings.Contains(message, "deadline exceeded") {
		return "连接超时，请检查 Base URL 或稍后重试"
	}
	return truncateText(err.Error(), 180)
}

func firstNonBlank(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func truncateText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "…"
}
