package tikhub

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	platformDouyin      = "douyin"
	platformXiaohongshu = "xiaohongshu"
	platformTikTok      = "tiktok"
)

type Config struct {
	BaseURL  string
	APIKey   string
	ProxyURL string
}

type Item struct {
	ExternalID  string
	Title       string
	Description string
	Author      string
	URL         string
	CoverURL    string
	MediaURL    string
	ContentType string
	Duration    int
	PublishedAt *time.Time
	Heat        int
	Metrics     map[string]int64
	Raw         map[string]interface{}
}

type SearchResult struct {
	Items        []Item
	PagesFetched int
}

type APIError struct {
	StatusCode int
	RequestID  string
	Message    string
	Docs       string
}

func (e *APIError) Error() string {
	message := strings.TrimSpace(e.Message)
	if message == "" {
		message = "请求失败"
	}
	if e.RequestID != "" {
		message += "，请求 ID " + e.RequestID
	}
	return fmt.Sprintf("TikHub 请求失败（HTTP %d）：%s", e.StatusCode, message)
}

type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func New(cfg Config) (*Client, error) {
	base := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if base == "" {
		base = "https://api.tikhub.io"
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if proxyText := strings.TrimSpace(cfg.ProxyURL); proxyText != "" {
		proxy, err := url.Parse(proxyText)
		if err != nil {
			return nil, fmt.Errorf("TikHub 代理地址无效：%w", err)
		}
		transport.Proxy = http.ProxyURL(proxy)
	}
	return &Client{
		baseURL: base, apiKey: strings.TrimSpace(cfg.APIKey),
		http: &http.Client{Timeout: 45 * time.Second, Transport: transport},
	}, nil
}

func (c *Client) Test(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 500 {
		return fmt.Errorf("TikHub 网关返回 HTTP %d", resp.StatusCode)
	}
	return nil
}

func (c *Client) Search(ctx context.Context, platform, keyword string, pages, limit int, contentType string, days int) (SearchResult, error) {
	result := SearchResult{}
	if c.apiKey == "" {
		return result, errors.New("TikHub API Token 未配置")
	}
	if pages < 1 {
		pages = 1
	}
	if limit < 1 {
		limit = 40
	}
	if platform == platformDouyin {
		return c.searchDouyin(ctx, keyword, pages, limit, contentType, days)
	}
	seen := map[string]Item{}
	stagnant := 0
	offset, page := 0, 1
	searchID, backtrace, searchSessionID := "", "", ""

	for pageRequest := 0; pageRequest < pages && len(seen) < limit; pageRequest++ {
		payload, err := c.searchPage(ctx, platform, keyword, page, offset, contentType, days, searchID, backtrace, searchSessionID)
		if err != nil && platform == platformXiaohongshu && retryableTikhubError(err) {
			for attempt := 1; attempt <= 2; attempt++ {
				select {
				case <-ctx.Done():
					return result, ctx.Err()
				case <-time.After(time.Duration(attempt) * 700 * time.Millisecond):
				}
				payload, err = c.searchPage(ctx, platform, keyword, page, offset, contentType, days, searchID, backtrace, searchSessionID)
				if err == nil {
					break
				}
			}
		}
		if err != nil {
			if platform == platformXiaohongshu {
				var apiErr *APIError
				if errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusBadRequest {
					message := "小红书采集通道当前不可用（TikHub 上游 HTTP 400，本次未扣费），请稍后重试"
					if apiErr.RequestID != "" {
						message += "；请求 ID " + apiErr.RequestID
					}
					return result, errors.New(message)
				}
				return result, fmt.Errorf("小红书搜索通道暂时不可用：%w", err)
			}
			return result, err
		}
		result.PagesFetched++
		candidates := extractItems(platform, payload, contentType)
		before := len(seen)
		for _, item := range candidates {
			if item.ExternalID == "" {
				continue
			}
			if days > 0 && item.PublishedAt != nil && time.Since(*item.PublishedAt) > time.Duration(days)*24*time.Hour {
				continue
			}
			if _, exists := seen[item.ExternalID]; !exists {
				seen[item.ExternalID] = item
			}
		}
		if len(seen) == before {
			stagnant++
		} else {
			stagnant = 0
		}
		if len(seen) >= limit || stagnant >= 2 {
			break
		}
		next, exhausted := advancePage(platform, payload, &offset, &page, &searchID, &backtrace, &searchSessionID)
		if exhausted || !next {
			break
		}
	}
	for _, item := range seen {
		result.Items = append(result.Items, item)
		if len(result.Items) >= limit {
			break
		}
	}
	return result, nil
}

func retryableTikhubError(err error) bool {
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		return false
	}
	return apiErr.StatusCode == http.StatusBadRequest ||
		apiErr.StatusCode == http.StatusRequestTimeout ||
		apiErr.StatusCode == http.StatusTooManyRequests ||
		apiErr.StatusCode >= 500
}

func (c *Client) searchDouyin(
	ctx context.Context, keyword string, pages, limit int, contentType string, days int,
) (SearchResult, error) {
	if contentType == "image" {
		return c.searchDouyinImages(ctx, keyword, limit, days)
	}

	var failures []string
	result, err := c.searchDouyinV5(ctx, keyword, pages, limit, days)
	if err == nil && len(result.Items) > 0 {
		return result, nil
	}
	if err != nil {
		failures = append(failures, "V5："+err.Error())
	}

	result, err = c.searchDouyinV4(ctx, keyword, pages, limit, days)
	if err == nil && len(result.Items) > 0 {
		return result, nil
	}
	if err != nil {
		failures = append(failures, "V4："+err.Error())
	}

	result, err = c.searchDouyinV3(ctx, keyword, limit, days)
	if err == nil && len(result.Items) > 0 {
		return result, nil
	}
	if err != nil {
		failures = append(failures, "V3："+err.Error())
	}
	if len(failures) == 0 {
		return SearchResult{}, errors.New("抖音搜索未返回可用内容")
	}
	return SearchResult{}, fmt.Errorf("抖音搜索接口均未返回内容：%s", strings.Join(failures, "；"))
}

func (c *Client) searchDouyinV5(
	ctx context.Context, keyword string, pages, limit int, days int,
) (SearchResult, error) {
	result := SearchResult{}
	seen := map[string]Item{}
	stagnant := 0
	offset, page := 0, 1
	searchID, backtrace := "", ""
	for pageRequest := 0; pageRequest < pages && len(seen) < limit; pageRequest++ {
		payload, err := c.fetch(
			ctx, http.MethodPost,
			"/api/v1/douyin/search/fetch_video_search_v5",
			nil,
			map[string]interface{}{
				"keyword": keyword, "offset": offset, "page": page,
				"search_id": searchID, "backtrace": backtrace,
			},
		)
		if err != nil {
			return result, err
		}
		result.PagesFetched++
		before := len(seen)
		mergeItems(seen, extractItems(platformDouyin, payload, "video"), days, limit)
		if len(seen) == before {
			stagnant++
		} else {
			stagnant = 0
		}
		if len(seen) >= limit || stagnant >= 2 {
			break
		}
		next, exhausted := advancePage(platformDouyin, payload, &offset, &page, &searchID, &backtrace, new(string))
		if exhausted || !next {
			break
		}
	}
	result.Items = itemsFromSeen(seen, limit)
	return result, nil
}

func (c *Client) searchDouyinV4(
	ctx context.Context, keyword string, pages, limit int, days int,
) (SearchResult, error) {
	result := SearchResult{}
	seen := map[string]Item{}
	cursor := 0
	for pageRequest := 0; pageRequest < pages && len(seen) < limit; pageRequest++ {
		payload, err := c.fetch(
			ctx, http.MethodPost,
			"/api/v1/douyin/search/fetch_video_search_v4",
			nil,
			map[string]interface{}{"keyword": keyword, "cursor": cursor},
		)
		if err != nil {
			return result, err
		}
		result.PagesFetched++
		before := len(seen)
		mergeItems(seen, extractItems(platformDouyin, payload, "video"), days, limit)
		if len(seen) >= limit {
			break
		}
		nested, _ := payload["data"].(map[string]interface{})
		if nested == nil {
			break
		}
		if hasMore := boolValue(firstAny(nested, "hasMore", "has_more")); hasMore != nil && !*hasMore {
			break
		}
		next := int(numberValue(firstAny(nested, "cursor", "offset")))
		if next <= cursor || next == 0 {
			break
		}
		cursor = next
		if len(seen) == before {
			break
		}
	}
	result.Items = itemsFromSeen(seen, limit)
	return result, nil
}

func (c *Client) searchDouyinV3(
	ctx context.Context, keyword string, limit, days int,
) (SearchResult, error) {
	dateType := 0
	switch {
	case days > 0 && days <= 3:
		dateType = 3
	case days > 3 && days <= 7:
		dateType = 7
	case days > 7:
		dateType = 30
	}
	payload, err := c.fetch(
		ctx, http.MethodPost,
		"/api/v1/douyin/search/fetch_video_search_v3",
		nil,
		map[string]interface{}{
			"query": keyword, "date_type": dateType, "label_type": 0, "duration_type": 0,
		},
	)
	if err != nil {
		return SearchResult{}, err
	}
	seen := map[string]Item{}
	mergeItems(seen, extractItems(platformDouyin, payload, "video"), days, limit)
	return SearchResult{Items: itemsFromSeen(seen, limit), PagesFetched: 1}, nil
}

func (c *Client) searchDouyinImages(
	ctx context.Context, keyword string, limit, days int,
) (SearchResult, error) {
	payload, err := c.fetch(
		ctx, http.MethodPost,
		"/api/v1/douyin/search/fetch_image_search_v3",
		nil,
		map[string]interface{}{"keyword": keyword, "cursor": 0, "search_id": ""},
	)
	if err != nil {
		return SearchResult{}, err
	}
	seen := map[string]Item{}
	mergeItems(seen, extractItems(platformDouyin, payload, "image"), days, limit)
	if len(seen) == 0 {
		return SearchResult{}, errors.New("抖音图文搜索未返回可用内容")
	}
	return SearchResult{Items: itemsFromSeen(seen, limit), PagesFetched: 1}, nil
}

func mergeItems(seen map[string]Item, candidates []Item, days, limit int) {
	for _, item := range candidates {
		if item.ExternalID == "" {
			continue
		}
		if days > 0 && item.PublishedAt != nil && time.Since(*item.PublishedAt) > time.Duration(days)*24*time.Hour {
			continue
		}
		if _, exists := seen[item.ExternalID]; !exists {
			seen[item.ExternalID] = item
		}
		if len(seen) >= limit {
			return
		}
	}
}

func itemsFromSeen(seen map[string]Item, limit int) []Item {
	items := make([]Item, 0, len(seen))
	for _, item := range seen {
		items = append(items, item)
		if len(items) >= limit {
			break
		}
	}
	return items
}

func (c *Client) fetch(
	ctx context.Context, method, endpoint string, query url.Values, body interface{},
) (map[string]interface{}, error) {
	requestURL := c.baseURL + endpoint
	if len(query) > 0 {
		requestURL += "?" + query.Encode()
	}
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, requestURL, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("无法连接 TikHub：%w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, fmt.Errorf("读取 TikHub 响应失败：%w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, decodeAPIError(resp.StatusCode, raw)
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, errors.New("TikHub 返回的数据不是有效 JSON")
	}
	code := numberValue(payload["code"])
	if payload["code"] != nil && code != 200 && code != 0 {
		return nil, fmt.Errorf("TikHub 返回错误码 %v", payload["code"])
	}
	data, ok := payload["data"].(map[string]interface{})
	if !ok {
		return nil, errors.New("TikHub 未返回可解析的数据")
	}
	return data, nil
}

func decodeAPIError(statusCode int, raw []byte) error {
	var payload map[string]interface{}
	_ = json.Unmarshal(raw, &payload)
	detail, _ := payload["detail"].(map[string]interface{})
	if detail == nil {
		detail = payload
	}
	return &APIError{
		StatusCode: statusCode,
		RequestID:  firstString(detail, "request_id"),
		Message:    firstString(detail, "message_zh", "message", "detail"),
		Docs:       firstString(detail, "docs"),
	}
}

func (c *Client) searchPage(
	ctx context.Context, platform, keyword string, page, offset int, contentType string, days int,
	searchID, backtrace, searchSessionID string,
) (map[string]interface{}, error) {
	var method, requestURL string
	var body io.Reader
	query := url.Values{}
	switch platform {
	case platformDouyin:
		method = http.MethodPost
		requestURL = c.baseURL + "/api/v1/douyin/search/fetch_video_search_v5"
		payload := map[string]interface{}{
			"keyword": keyword, "offset": offset, "page": page,
			"search_id": searchID, "backtrace": backtrace,
		}
		encoded, _ := json.Marshal(payload)
		body = bytes.NewReader(encoded)
	case platformXiaohongshu:
		method = http.MethodGet
		requestURL = c.baseURL + "/api/v1/xiaohongshu/app_v2/search_notes"
		noteType := "不限"
		switch contentType {
		case "video":
			noteType = "视频笔记"
		case "image":
			noteType = "普通笔记"
		}
		query.Set("keyword", keyword)
		query.Set("page", strconv.Itoa(page))
		query.Set("note_type", noteType)
		query.Set("sort_type", "general")
		query.Set("time_filter", timeFilter(days))
		if searchID != "" {
			query.Set("search_id", searchID)
		}
		if searchSessionID != "" {
			query.Set("search_session_id", searchSessionID)
		}
		requestURL += "?" + query.Encode()
	case platformTikTok:
		method = http.MethodGet
		requestURL = c.baseURL + "/api/v1/tiktok/app/v3/fetch_video_search_result"
		query.Set("keyword", keyword)
		query.Set("count", "20")
		query.Set("offset", strconv.Itoa(offset))
		query.Set("sort_type", "0")
		query.Set("publish_time", strconv.Itoa(tikTokPublishTime(days)))
		query.Set("region", "US")
		requestURL += "?" + query.Encode()
	default:
		return nil, errors.New("不支持的采集平台")
	}

	req, err := http.NewRequestWithContext(ctx, method, requestURL, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("无法连接 TikHub：%w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, fmt.Errorf("读取 TikHub 响应失败：%w", err)
	}
	if resp.StatusCode == http.StatusPaymentRequired {
		return nil, errors.New("TikHub 请求被拒绝（HTTP 402，请检查账户余额或套餐）")
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, fmt.Errorf("TikHub 请求被拒绝（HTTP %d，请检查 API Token）", resp.StatusCode)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, decodeAPIError(resp.StatusCode, raw)
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, errors.New("TikHub 返回的数据不是有效 JSON")
	}
	code := numberValue(payload["code"])
	if len(payload) > 0 && payload["code"] != nil && code != 200 {
		return nil, fmt.Errorf("TikHub 返回错误码 %v", payload["code"])
	}
	data, ok := payload["data"].(map[string]interface{})
	if !ok {
		return nil, errors.New("TikHub 未返回可解析的数据")
	}
	if platform == platformXiaohongshu {
		if success, exists := data["success"].(bool); exists && !success {
			return nil, fmt.Errorf("小红书接口返回失败：%s", platformMessage(data))
		}
		if codeValue, exists := data["code"]; exists && codeValue != nil {
			code := numberValue(codeValue)
			if code != 0 && code != 200 {
				return nil, fmt.Errorf("小红书接口返回错误码 %v：%s", codeValue, platformMessage(data))
			}
		}
	}
	if platform == platformTikTok {
		if codeValue, exists := data["status_code"]; exists && codeValue != nil {
			if numberValue(codeValue) != 0 {
				return nil, fmt.Errorf("TikTok 接口返回错误码 %v：%s", codeValue, platformMessage(data))
			}
		}
	}
	return data, nil
}

func platformMessage(data map[string]interface{}) string {
	message := firstString(data, "msg", "message", "message_zh", "error")
	if message == "" {
		message = "平台未返回可用数据"
	}
	return message
}

func extractItems(platform string, data map[string]interface{}, wantedType string) []Item {
	found := map[string]Item{}
	score := map[string]int{}
	walk(data, func(value map[string]interface{}) {
		var item Item
		var ok bool
		switch platform {
		case platformDouyin:
			candidate, wrapped := value["aweme_info"].(map[string]interface{})
			if !wrapped {
				candidate, wrapped = value["AwemeInfo"].(map[string]interface{})
			}
			if !wrapped {
				candidate = value
			}
			item, ok = normalizeDouyin(candidate)
		case platformXiaohongshu:
			item, ok = normalizeXiaohongshu(value)
		case platformTikTok:
			candidate, wrapped := value["aweme_info"].(map[string]interface{})
			if !wrapped {
				candidate = value
			}
			item, ok = normalizeTikTok(candidate)
		}
		if !ok {
			return
		}
		if wantedType != "" && wantedType != "all" && item.ContentType != "" && item.ContentType != wantedType {
			return
		}
		currentScore := completeness(item)
		if previous, exists := found[item.ExternalID]; !exists || currentScore > score[item.ExternalID] {
			found[item.ExternalID] = item
			score[item.ExternalID] = currentScore
			_ = previous
		}
	})
	items := make([]Item, 0, len(found))
	for _, item := range found {
		items = append(items, item)
	}
	return items
}

func normalizeDouyin(value map[string]interface{}) (Item, bool) {
	id := firstString(value, "aweme_id", "AwemeId", "itemId", "item_id", "group_id")
	description := firstString(value, "desc", "Desc", "title", "Title", "description")
	if id == "" || strings.TrimSpace(description) == "" {
		return Item{}, false
	}
	video, _ := value["video"].(map[string]interface{})
	if video == nil {
		video, _ = value["Video"].(map[string]interface{})
	}
	author, _ := value["author"].(map[string]interface{})
	if author == nil {
		author, _ = value["Author"].(map[string]interface{})
	}
	statistics, _ := value["statistics"].(map[string]interface{})
	if statistics == nil {
		statistics, _ = value["Statistics"].(map[string]interface{})
	}
	if nested, ok := video["Statistics"].(map[string]interface{}); ok && len(nested) > 0 {
		statistics = nested
	}
	metrics := map[string]int64{
		"likes":    metricNumber(firstAny(statistics, "digg_count", "DiggCount", "like_count", "likes")),
		"comments": metricNumber(firstAny(statistics, "comment_count", "CommentCount", "comments_count")),
		"saves":    metricNumber(firstAny(statistics, "collect_count", "CollectCount", "collectCount")),
		"shares":   metricNumber(firstAny(statistics, "share_count", "ShareCount", "shareCount")),
	}
	if metrics["likes"] == 0 {
		metrics["likes"] = metricNumber(firstAny(value, "likes", "Likes", "digg_count"))
	}
	imageInfo, _ := value["image_post_info"].(map[string]interface{})
	images := firstAny(value, "images", "Images")
	isPhoto := boolValue(firstAny(value, "IsPhoto", "is_photo"))
	isImage := imageInfo != nil || images != nil || (isPhoto != nil && *isPhoto) ||
		numberValue(firstAny(value, "aweme_type", "AwemeType", "media_type")) == 68
	contentType := "video"
	mediaURL := firstURL(firstAny(video, "play_addr", "PlayAddr", "playAddr"))
	duration := 0
	if isImage {
		contentType = "image"
		mediaURL = ""
	} else {
		if numberValue(firstAny(value, "itemId", "item_id")) > 0 {
			duration = int(numberValue(value["duration"]))
		} else {
			durationMS := numberValue(firstAny(video, "duration", "Duration", "duration_ms"))
			if durationMS == 0 {
				durationMS = numberValue(value["duration"])
			}
			duration = int(math.Round(float64(durationMS) / 1000))
		}
	}
	cover := firstURL(images)
	if imageInfo != nil {
		cover = firstNonEmpty(cover, firstURL(firstAny(imageInfo, "images", "image_list")))
	}
	cover = firstNonEmpty(
		cover,
		firstURL(firstAny(video, "cover", "Cover", "origin_cover")),
		firstString(value, "thumbnail", "Thumbnail"),
	)
	sourceURL := firstString(value, "share_url", "ShareUrl", "url", "URL")
	if sourceURL == "" {
		resource := "video"
		if isImage {
			resource = "note"
		}
		sourceURL = "https://www.douyin.com/" + resource + "/" + id
	}
	publishedAt := unixTime(firstAny(value, "create_time", "CreateTime", "publish_time", "createTime"))
	if publishedAt == nil {
		publishedAt = parseTimeText(firstString(value, "createTime", "CreateTime"))
	}
	return Item{
		ExternalID: id, Title: firstLine(description, 300), Description: description,
		Author: firstNonEmpty(firstString(author, "nickname", "Nickname", "unique_id", "UniqueId"), firstString(value, "nickname")),
		URL:    sourceURL, CoverURL: cover, MediaURL: mediaURL,
		ContentType: contentType, Duration: duration,
		PublishedAt: publishedAt, Heat: heatFromMetrics(metrics), Metrics: metrics, Raw: value,
	}, true
}

func normalizeXiaohongshu(value map[string]interface{}) (Item, bool) {
	card, _ := value["note_card"].(map[string]interface{})
	if card == nil {
		card, _ = value["note"].(map[string]interface{})
	}
	if card == nil {
		card = value
	}
	id := firstString(card, "note_id", "id")
	if id == "" {
		id = firstString(value, "note_id", "id")
	}
	title := firstString(card, "display_title", "title")
	description := firstString(card, "desc", "description")
	if id == "" || (strings.TrimSpace(title) == "" && strings.TrimSpace(description) == "") {
		return Item{}, false
	}
	if title == "" {
		title = firstLine(description, 300)
	}
	user, _ := card["user"].(map[string]interface{})
	interact, _ := card["interact_info"].(map[string]interface{})
	video, _ := card["video"].(map[string]interface{})
	metrics := map[string]int64{
		"likes":    metricNumber(firstAny(interact, "liked_count", "like_count")),
		"comments": metricNumber(firstAny(interact, "comment_count", "comments_count")),
		"saves":    metricNumber(firstAny(interact, "collected_count", "collect_count")),
		"shares":   metricNumber(firstAny(interact, "shared_count", "share_count")),
	}
	contentType := "image"
	mediaURL := ""
	if video != nil {
		contentType = "video"
		mediaURL = firstURL(video["media"])
	}
	cover := firstAny(card, "cover", "images_list")
	published := unixTime(firstAny(card, "time", "create_time", "publish_time", "timestamp"))
	duration := int(numberValue(firstAny(video, "duration", "duration_ms", "duration_millis")))
	if duration > 1000 {
		duration = int(math.Round(float64(duration) / 1000))
	}
	sourceURL := "https://www.xiaohongshu.com/explore/" + id
	if token := firstString(value, "xsec_token"); token != "" {
		sourceURL += "?xsec_token=" + url.QueryEscape(token)
	}
	return Item{
		ExternalID: id, Title: title, Description: description,
		Author: firstString(user, "nickname", "nick_name"), URL: sourceURL,
		CoverURL: firstURL(cover), MediaURL: mediaURL, ContentType: contentType,
		Duration: duration, PublishedAt: published, Heat: heatFromMetrics(metrics),
		Metrics: metrics, Raw: value,
	}, true
}

func normalizeTikTok(value map[string]interface{}) (Item, bool) {
	id := firstString(value, "id", "itemId", "aweme_id")
	video, _ := value["video"].(map[string]interface{})
	if id == "" || video == nil {
		return Item{}, false
	}
	description := firstString(value, "desc", "description")
	author, _ := value["author"].(map[string]interface{})
	stats, _ := value["stats"].(map[string]interface{})
	if stats == nil {
		stats, _ = value["statistics"].(map[string]interface{})
	}
	username := strings.TrimPrefix(firstString(author, "uniqueId", "unique_id"), "@")
	sourceURL := "https://www.tiktok.com/video/" + id
	if username != "" {
		sourceURL = "https://www.tiktok.com/@" + username + "/video/" + id
	}
	metrics := map[string]int64{
		"likes":    metricNumber(firstAny(stats, "diggCount", "digg_count")),
		"comments": metricNumber(firstAny(stats, "commentCount", "comment_count")),
		"saves":    metricNumber(firstAny(stats, "collectCount", "collect_count")),
		"shares":   metricNumber(firstAny(stats, "shareCount", "share_count")),
	}
	duration := int(numberValue(video["duration"]))
	if duration > 1000 {
		duration = int(math.Round(float64(duration) / 1000))
	}
	return Item{
		ExternalID: id, Title: firstLine(description, 300), Description: description,
		Author: firstNonEmpty(firstString(author, "nickname"), username),
		URL:    sourceURL, CoverURL: firstURL(firstAny(video, "cover", "originCover")),
		MediaURL:    firstURL(firstAny(video, "playAddr", "play_addr", "downloadAddr", "download_addr")),
		ContentType: "video", Duration: duration,
		PublishedAt: unixTime(firstAny(value, "createTime", "create_time")),
		Heat:        heatFromMetrics(metrics), Metrics: metrics, Raw: value,
	}, true
}

func advancePage(
	platform string, data map[string]interface{}, offset, page *int,
	searchID, backtrace, searchSessionID *string,
) (bool, bool) {
	pagination := findMapByKey(data, "pagination")
	nested, _ := data["data"].(map[string]interface{})
	if platform == platformDouyin {
		if pagination == nil {
			return false, true
		}
		if hasMore := boolValue(firstAny(pagination, "has_more", "hasMore")); hasMore != nil && !*hasMore {
			return false, true
		}
		next := int(numberValue(pagination["offset"]))
		if next == 0 || next == *offset {
			return false, true
		}
		*offset = next
		*searchID = firstString(pagination, "search_id")
		*backtrace = firstString(pagination, "backtrace")
		(*page)++
		return true, false
	}
	if platform == platformXiaohongshu {
		sources := []map[string]interface{}{pagination, nested, data}
		for _, source := range sources {
			if source == nil {
				continue
			}
			if hasMore := boolValue(firstAny(source, "has_more", "hasMore")); hasMore != nil && !*hasMore {
				return false, true
			}
			if value := firstString(source, "search_id"); value != "" {
				*searchID = value
			}
			if value := firstString(source, "search_session_id"); value != "" {
				*searchSessionID = value
			}
			if next := int(numberValue(source["next_page"])); next > *page && next <= 200 {
				*page = next
				return true, false
			}
		}
		(*page)++
		return true, false
	}
	sources := []map[string]interface{}{nested, data}
	for _, source := range sources {
		if source == nil {
			continue
		}
		if hasMore := boolValue(firstAny(source, "has_more", "hasMore")); hasMore != nil && !*hasMore {
			return false, true
		}
		for _, key := range []string{"cursor", "offset"} {
			if next := int(numberValue(source[key])); next > *offset {
				*offset = next
				return true, false
			}
		}
	}
	(*offset) += 20
	return true, false
}

func walk(value interface{}, visit func(map[string]interface{})) {
	switch current := value.(type) {
	case map[string]interface{}:
		visit(current)
		for _, child := range current {
			walk(child, visit)
		}
	case []interface{}:
		for _, child := range current {
			walk(child, visit)
		}
	}
}

func findMapByKey(value interface{}, key string) map[string]interface{} {
	var found map[string]interface{}
	walk(value, func(current map[string]interface{}) {
		if found != nil {
			return
		}
		if candidate, ok := current[key].(map[string]interface{}); ok {
			found = candidate
		}
	})
	return found
}

func completeness(item Item) int {
	score := 0
	if item.CoverURL != "" {
		score += 4
	}
	if item.MediaURL != "" {
		score += 3
	}
	if item.Author != "" {
		score += 2
	}
	if item.PublishedAt != nil {
		score += 2
	}
	if item.Duration > 0 {
		score++
	}
	return score
}

func heatFromMetrics(metrics map[string]int64) int {
	score := 30000*float64(metrics["likes"]) + 1200*float64(metrics["comments"]) +
		10000*float64(metrics["saves"]) + 3500*float64(metrics["shares"])
	heat := 100 * (1 - math.Exp(-score/160000))
	if heat < 1 {
		return 1
	}
	if heat > 100 {
		return 100
	}
	return int(math.Round(heat))
}

func firstAny(values map[string]interface{}, keys ...string) interface{} {
	for _, key := range keys {
		if value, ok := values[key]; ok && value != nil {
			return value
		}
	}
	return nil
}

func firstString(values map[string]interface{}, keys ...string) string {
	return stringValue(firstAny(values, keys...))
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

func firstLine(value string, max int) string {
	line := strings.TrimSpace(strings.SplitN(value, "\n", 2)[0])
	runes := []rune(line)
	if len(runes) > max {
		return string(runes[:max])
	}
	return line
}

func numberValue(value interface{}) int64 {
	switch typed := value.(type) {
	case float64:
		return int64(typed)
	case int:
		return int64(typed)
	case int64:
		return typed
	case json.Number:
		n, _ := typed.Int64()
		return n
	case string:
		n, _ := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
		return n
	default:
		return 0
	}
}

func metricNumber(value interface{}) int64 {
	if text, ok := value.(string); ok {
		text = strings.TrimSpace(strings.ToLower(text))
		multiplier := float64(1)
		if strings.HasSuffix(text, "万") || strings.HasSuffix(text, "w") {
			multiplier = 10000
			text = strings.TrimSuffix(strings.TrimSuffix(text, "万"), "w")
		} else if strings.HasSuffix(text, "亿") {
			multiplier = 100000000
			text = strings.TrimSuffix(text, "亿")
		}
		n, _ := strconv.ParseFloat(text, 64)
		return int64(n * multiplier)
	}
	return numberValue(value)
}

func unixTime(value interface{}) *time.Time {
	n := metricNumber(value)
	if n <= 0 {
		return nil
	}
	if n > 10_000_000_000 {
		n /= 1000
	}
	t := time.Unix(n, 0)
	return &t
}

func parseTimeText(value string) *time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	for _, layout := range []string{"2006-01-02 15:04:05", "2006-01-02T15:04:05Z07:00", time.RFC3339} {
		if parsed, err := time.ParseInLocation(layout, value, time.Local); err == nil {
			return &parsed
		}
	}
	return nil
}

func boolValue(value interface{}) *bool {
	switch typed := value.(type) {
	case bool:
		return &typed
	case float64:
		result := typed != 0
		return &result
	case string:
		result := typed == "1" || strings.EqualFold(typed, "true")
		return &result
	default:
		return nil
	}
}

func firstURL(value interface{}) string {
	switch typed := value.(type) {
	case string:
		if strings.HasPrefix(typed, "http://") || strings.HasPrefix(typed, "https://") {
			return strings.Replace(typed, "http://", "https://", 1)
		}
	case []interface{}:
		for _, item := range typed {
			if found := firstURL(item); found != "" {
				return found
			}
		}
	case map[string]interface{}:
		for _, key := range []string{"url_list", "urlList", "url", "src", "uri"} {
			if found := firstURL(typed[key]); found != "" {
				return found
			}
		}
		for _, child := range typed {
			if found := firstURL(child); found != "" {
				return found
			}
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func timeFilter(days int) string {
	switch {
	case days <= 0:
		return "不限"
	case days <= 1:
		return "一天内"
	case days <= 7:
		return "一周内"
	case days <= 180:
		return "半年内"
	default:
		return "不限"
	}
}

func tikTokPublishTime(days int) int {
	switch {
	case days <= 1:
		return 1
	case days <= 7:
		return 7
	case days <= 30:
		return 30
	default:
		return 0
	}
}
