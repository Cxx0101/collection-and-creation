package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
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

	"sparkstudio/backend/internal/storage"
)

type studioJob struct {
	ID          uint
	OwnerUserID uint
	Status      string
	ErrorText   string
	ParamsJSON  string
}

type asset struct {
	ID          uint
	OwnerUserID uint
	Name        string
	Kind        string
	ObjectKey   string
	URL         string
	MimeType    string
	Size        string
	CreatedAt   time.Time
}

type storageConfig struct {
	ID            uint
	Provider      string
	Enabled       bool
	Endpoint      string
	Region        string
	Bucket        string
	PublicBaseURL string
	AccessKey     string
	SecretKey     string
}

type collectionBatch struct {
	ID             uint
	OwnerUserID    uint
	Platform       string
	Keyword        string
	Pages          int
	PagesFetched   int
	Status         string
	ItemCount      int
	Mode           string
	ContentType    string
	CreditsCharged int64
	ErrorMessage   string
	CreatedAt      time.Time
}

type tikhubConfig struct {
	Enabled  bool
	BaseURL  string
	APIKey   string
	ProxyURL string
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
	dsn := os.Getenv("DB_DSN")
	if dsn == "" {
		dsn = "spark:password@tcp(127.0.0.1:3307)/sparkstudio?charset=utf8mb4&parseTime=True&loc=Local"
	}
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		panic(err)
	}

	var probeUser struct {
		ID           uint
		Phone        string
		Nickname     string
		Role         string
		Status       string
		TokenVersion int
	}
	db.Raw(`SELECT id, phone, nickname, role, status, token_version FROM users WHERE id = 8`).Scan(&probeUser)
	fmt.Printf("USER id=%d phone=%s nickname=%s role=%s status=%s token_version=%d\n",
		probeUser.ID, probeUser.Phone, probeUser.Nickname, probeUser.Role, probeUser.Status, probeUser.TokenVersion)

	var job studioJob
	db.Raw(`SELECT id, owner_user_id, status, COALESCE(error_message, '') AS error_text, COALESCE(params_json, '') AS params_json
		FROM studio_jobs WHERE id = 7`).Scan(&job)
	fmt.Printf("JOB %+v\n", job)

	var assets []asset
	db.Raw(`SELECT id, owner_user_id, name, kind, object_key, url, mime_type, size, created_at
		FROM assets WHERE owner_user_id = ? AND name LIKE ? ORDER BY id DESC`,
		job.OwnerUserID, "%guide-remove-pen%").Scan(&assets)
	for _, item := range assets {
		fmt.Printf("ASSET %+v\n", item)
		if item.URL != "" {
			client := &http.Client{Timeout: 20 * time.Second}
			resp, err := client.Get(item.URL)
			if err != nil {
				fmt.Printf("ASSET_FETCH error=%v\n", err)
			} else {
				body, _ := io.ReadAll(io.LimitReader(resp.Body, 300))
				_ = resp.Body.Close()
				fmt.Printf("ASSET_FETCH status=%d type=%s bytes=%s\n", resp.StatusCode, resp.Header.Get("Content-Type"), string(body))
			}
		}
	}

	var configs []storageConfig
	db.Raw(`SELECT id, provider, enabled, endpoint, region, bucket, public_base_url, access_key, secret_key
		FROM storage_configs ORDER BY id`).Scan(&configs)
	for _, item := range configs {
		fmt.Printf("STORAGE id=%d provider=%s enabled=%v endpoint=%s region=%s bucket=%s public=%s access=%t secret=%t\n",
			item.ID, item.Provider, item.Enabled, item.Endpoint, item.Region, item.Bucket, item.PublicBaseURL,
			item.AccessKey != "", decryptSecret(item.SecretKey) != "")
		if item.Enabled {
			engine, err := storage.New(storage.Config{
				Provider: item.Provider, Endpoint: item.Endpoint, Region: item.Region, Bucket: item.Bucket,
				AccessKey: item.AccessKey, SecretKey: decryptSecret(item.SecretKey), PublicBaseURL: item.PublicBaseURL,
			})
			if err != nil {
				fmt.Printf("ENGINE error=%v\n", err)
				continue
			}
			for _, asset := range assets {
				reader, err := engine.Open(nil, asset.ObjectKey)
				if err != nil {
					fmt.Printf("ENGINE_OPEN error=%v\n", err)
					continue
				}
				n, _ := io.ReadAll(io.LimitReader(reader, 32))
				_ = reader.Close()
				fmt.Printf("ENGINE_OPEN ok bytes=%d\n", len(n))
				reader, err = engine.Open(nil, asset.ObjectKey)
				if err == nil {
					out, createErr := os.Create("probe-video.mp4")
					if createErr != nil {
						fmt.Printf("ENGINE_SAVE_CREATE error=%v\n", createErr)
					} else {
						_, copyErr := io.Copy(out, reader)
						_ = out.Close()
						fmt.Printf("ENGINE_SAVE error=%v\n", copyErr)
					}
					_ = reader.Close()
				} else {
					fmt.Printf("ENGINE_SAVE_OPEN error=%v\n", err)
				}
			}
		}
	}

	var batches []collectionBatch
	db.Raw(`SELECT id, owner_user_id, platform, keyword, pages, pages_fetched, status, item_count, mode, content_type,
		credits_charged, COALESCE(error_message, '') AS error_message, created_at
		FROM collection_batches ORDER BY id DESC LIMIT 10`).Scan(&batches)
	for _, item := range batches {
		fmt.Printf("COLLECTION %+v\n", item)
	}

	var tk tikhubConfig
	db.Raw(`SELECT enabled, base_url, api_key, COALESCE(proxy_url, '') AS proxy_url FROM tikhub_configs ORDER BY id LIMIT 1`).Scan(&tk)
	key := decryptSecret(tk.APIKey)
	fmt.Printf("TIKHUB enabled=%v base=%s key=%t proxy=%t\n", tk.Enabled, tk.BaseURL, key != "", tk.ProxyURL != "")
	if tk.Enabled && key != "" {
		base := strings.TrimRight(tk.BaseURL, "/")
		for _, path := range []string{
			"/api/v1/tikhub/user/get_user_info",
			"/api/v1/tikhub/user/get_endpoint_info?endpoint=" + url.QueryEscape("/api/v1/douyin/search/fetch_video_search_v5"),
			"/api/v1/tikhub/user/get_endpoint_info?endpoint=" + url.QueryEscape("/api/v1/xiaohongshu/app_v2/search_notes"),
		} {
			req, _ := http.NewRequest(http.MethodGet, base+path, nil)
			req.Header.Set("Authorization", "Bearer "+key)
			req.Header.Set("Accept", "application/json")
			resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
			if err != nil {
				fmt.Printf("TIKHUB_META path=%s error=%v\n", path, err)
			} else {
				body, _ := io.ReadAll(io.LimitReader(resp.Body, 1800))
				_ = resp.Body.Close()
				fmt.Printf("TIKHUB_META path=%s status=%d body=%s\n", path, resp.StatusCode, string(body))
			}
		}
		for _, test := range []struct {
			Keyword  string
			NoteType string
		}{
			{"冲锋衣", "视频笔记"},
			{"冲锋衣", "不限"},
			{"冲锋衣", "普通笔记"},
			{"猫咪", "视频笔记"},
		} {
			requestURL := base + "/api/v1/xiaohongshu/app_v2/search_notes?keyword=" +
				url.QueryEscape(test.Keyword) + "&page=1&sort_type=general&note_type=" + url.QueryEscape(test.NoteType) +
				"&time_filter=" + url.QueryEscape("不限")
			req, _ := http.NewRequest(http.MethodGet, requestURL, nil)
			req.Header.Set("Authorization", "Bearer "+key)
			req.Header.Set("Accept", "application/json")
			resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
			if err != nil {
				fmt.Printf("TIKHUB_XHS keyword=%s type=%s error=%v\n", test.Keyword, test.NoteType, err)
			} else {
				body, _ := io.ReadAll(io.LimitReader(resp.Body, 700))
				_ = resp.Body.Close()
				fmt.Printf("TIKHUB_XHS keyword=%s type=%s status=%d body=%s\n", test.Keyword, test.NoteType, resp.StatusCode, string(body))
			}
		}
		for _, keyword := range []string{"冲锋衣", "猫咪"} {
			payload, _ := json.Marshal(map[string]interface{}{
				"keyword": keyword, "offset": 0, "page": 1, "search_id": "", "backtrace": "",
			})
			req, _ := http.NewRequest(http.MethodPost, base+"/api/v1/douyin/search/fetch_video_search_v5", bytes.NewReader(payload))
			req.Header.Set("Authorization", "Bearer "+key)
			req.Header.Set("Accept", "application/json")
			req.Header.Set("Content-Type", "application/json")
			resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
			if err != nil {
				fmt.Printf("TIKHUB_DOUYIN keyword=%s error=%v\n", keyword, err)
			} else {
				body, _ := io.ReadAll(io.LimitReader(resp.Body, 700))
				_ = resp.Body.Close()
				fmt.Printf("TIKHUB_DOUYIN keyword=%s status=%d body=%s\n", keyword, resp.StatusCode, string(body))
			}
		}
	}
}
