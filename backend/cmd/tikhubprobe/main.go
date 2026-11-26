package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"sparkstudio/backend/internal/tikhub"
)

type tikhubConfig struct {
	Enabled bool
	BaseURL string
	APIKey  string
}

func decryptSecret(stored string) string {
	const prefix = "enc:v1:"
	if stored == "" || !strings.HasPrefix(stored, prefix) {
		return stored
	}
	parts := strings.Split(strings.TrimPrefix(stored, prefix), ":")
	if len(parts) != 2 {
		return ""
	}
	nonce, err := base64.RawStdEncoding.DecodeString(parts[0])
	if err != nil {
		return ""
	}
	data, err := base64.RawStdEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	raw := os.Getenv("DATA_ENCRYPTION_KEY")
	if raw == "" {
		raw = "sparkstudio-local-data-key-change-in-production:" + os.Getenv("JWT_SECRET")
	}
	sum := sha256.Sum256([]byte(raw))
	block, err := aes.NewCipher(sum[:])
	if err != nil {
		return ""
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return ""
	}
	plain, err := gcm.Open(nil, nonce, data, nil)
	if err != nil {
		return ""
	}
	return string(plain)
}

func main() {
	clientOnly := flag.Bool("client-only", false, "skip raw endpoint probes and only run the client search")
	rawOnly := flag.Bool("raw-only", false, "run raw endpoint probes without the client search")
	rawName := flag.String("raw-name", "", "run only one raw endpoint probe with this name")
	platform := flag.String("platform", "douyin", "collection platform: douyin, xiaohongshu or tiktok")
	keyword := flag.String("keyword", "冲锋衣", "search keyword")
	contentType := flag.String("type", "video", "content type: video or image")
	days := flag.Int("days", 0, "published within days")
	pages := flag.Int("pages", 1, "pages to fetch")
	limit := flag.Int("limit", 20, "maximum items")
	flag.Parse()

	dsn := os.Getenv("DB_DSN")
	if dsn == "" {
		dsn = "spark:password@tcp(127.0.0.1:3307)/sparkstudio?charset=utf8mb4&parseTime=True&loc=Local"
	}
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		panic(err)
	}
	var config tikhubConfig
	db.Raw(`SELECT enabled, base_url, api_key FROM tikhub_configs ORDER BY id LIMIT 1`).Scan(&config)
	key := decryptSecret(config.APIKey)
	if !config.Enabled || key == "" {
		panic("TikHub config unavailable")
	}
	base := strings.TrimRight(config.BaseURL, "/")

	type test struct {
		Name   string
		Method string
		Path   string
		Body   interface{}
	}
	tests := []test{
		{
			Name: "douyin_v2", Method: http.MethodPost,
			Path: "/api/v1/douyin/search/fetch_video_search_v2",
			Body: map[string]interface{}{
				"keyword": "冲锋衣", "cursor": 0, "sort_type": "0", "publish_time": "0",
				"filter_duration": "0", "content_type": "1", "search_id": "", "backtrace": "",
			},
		},
		{
			Name: "douyin_v5_minimal", Method: http.MethodPost,
			Path: "/api/v1/douyin/search/fetch_video_search_v5",
			Body: map[string]interface{}{"keyword": "冲锋衣", "offset": 0, "page": 1, "search_id": "", "backtrace": ""},
		},
		{
			Name: "douyin_v4", Method: http.MethodPost,
			Path: "/api/v1/douyin/search/fetch_video_search_v4",
			Body: map[string]interface{}{"keyword": "冲锋衣", "cursor": 0},
		},
		{
			Name: "douyin_v3", Method: http.MethodPost,
			Path: "/api/v1/douyin/search/fetch_video_search_v3",
			Body: map[string]interface{}{"query": "冲锋衣", "date_type": 0, "label_type": 0, "duration_type": 0},
		},
		{
			Name: "douyin_general_v3", Method: http.MethodPost,
			Path: "/api/v1/douyin/search/fetch_general_search_v3",
			Body: map[string]interface{}{"keyword": "冲锋衣", "offset": 0, "page": 1, "search_id": "", "backtrace": ""},
		},
		{
			Name: "douyin_multi", Method: http.MethodPost,
			Path: "/api/v1/douyin/search/fetch_multi_search",
			Body: map[string]interface{}{
				"keyword": "冲锋衣", "cursor": 0, "sort_type": "0", "publish_time": "0",
				"filter_duration": "0", "content_type": "1", "search_id": "",
			},
		},
		{
			Name: "douyin_image_v3", Method: http.MethodPost,
			Path: "/api/v1/douyin/search/fetch_image_search_v3",
			Body: map[string]interface{}{"keyword": "冲锋衣", "cursor": 0, "search_id": ""},
		},
		{
			Name: "xhs_notes_minimal", Method: http.MethodGet,
			Path: "/api/v1/xiaohongshu/app_v2/search_notes?keyword=" + url.QueryEscape("冲锋衣") + "&page=1",
		},
		{
			Name: "xhs_notes_defaults", Method: http.MethodGet,
			Path: "/api/v1/xiaohongshu/app_v2/search_notes?keyword=" + url.QueryEscape("美食推荐") +
				"&page=1&sort_type=general&note_type=" + url.QueryEscape("不限") +
				"&time_filter=" + url.QueryEscape("不限") + "&source=explore_feed&ai_mode=0",
		},
		{
			Name: "xhs_notes_source", Method: http.MethodGet,
			Path: "/api/v1/xiaohongshu/app_v2/search_notes?keyword=" + url.QueryEscape("美食推荐") +
				"&page=1&source=explore_feed&ai_mode=0",
		},
		{
			Name: "xhs_images_minimal", Method: http.MethodGet,
			Path: "/api/v1/xiaohongshu/app_v2/search_images?keyword=" + url.QueryEscape("冲锋衣") + "&page=1",
		},
		{
			Name: "xhs_images_defaults", Method: http.MethodGet,
			Path: "/api/v1/xiaohongshu/app_v2/search_images?keyword=" + url.QueryEscape("壁纸") +
				"&page=1&source=explore_feed",
		},
		{
			Name: "xhs_groups", Method: http.MethodGet,
			Path: "/api/v1/xiaohongshu/app_v2/search_groups?keyword=" + url.QueryEscape("冲锋衣") +
				"&page_no=0&source=unifiedSearchGroup&is_recommend=0",
		},
		{
			Name: "xhs_web_v3_int", Method: http.MethodGet,
			Path: "/api/v1/xiaohongshu/web_v3/fetch_search_notes?keyword=" + url.QueryEscape("冲锋衣") + "&page=1&sort=general&note_type=0",
		},
		{
			Name: "xhs_web_v3_string", Method: http.MethodGet,
			Path: "/api/v1/xiaohongshu/web_v3/fetch_search_notes?keyword=" + url.QueryEscape("冲锋衣") + "&page=1&sort=general&note_type=" + url.QueryEscape("不限"),
		},
		{
			Name: "xhs_app_v1", Method: http.MethodGet,
			Path: "/api/v1/xiaohongshu/app/search_notes?keyword=" + url.QueryEscape("冲锋衣") + "&page=1",
		},
	}
	if !*clientOnly {
		client := &http.Client{Timeout: 30 * time.Second}
		for _, item := range tests {
			if *rawName != "" && item.Name != *rawName {
				continue
			}
			var body io.Reader
			if item.Body != nil {
				raw, _ := json.Marshal(item.Body)
				body = bytes.NewReader(raw)
			}
			req, err := http.NewRequest(item.Method, base+item.Path, body)
			if err != nil {
				fmt.Printf("%s request_error=%v\n", item.Name, err)
				continue
			}
			req.Header.Set("Authorization", "Bearer "+key)
			req.Header.Set("Accept", "application/json")
			if item.Body != nil {
				req.Header.Set("Content-Type", "application/json")
			}
			resp, err := client.Do(req)
			if err != nil {
				fmt.Printf("%s transport_error=%v\n", item.Name, err)
				continue
			}
			raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
			resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				_ = os.WriteFile("../.tools/"+item.Name+".json", raw, 0o600)
			}
			fmt.Printf("%s status=%d body=%s\n", item.Name, resp.StatusCode, compact(string(raw[:min(len(raw), 4096)]), 700))
		}
	}

	if !*rawOnly {
		tikhubClient, err := tikhub.New(tikhub.Config{BaseURL: base, APIKey: key})
		if err == nil {
			result, searchErr := tikhubClient.Search(context.Background(), *platform, *keyword, *pages, *limit, *contentType, *days)
			firstID := ""
			if len(result.Items) > 0 {
				firstID = result.Items[0].ExternalID
			}
			fmt.Printf("CLIENT_SEARCH error=%v pages=%d items=%d first=%s\n", searchErr, result.PagesFetched, len(result.Items), firstID)
		}
	}
}

func min(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func compact(value string, limit int) string {
	value = strings.Join(strings.Fields(value), " ")
	runes := []rune(value)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return value
}
