package tikhub

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestExtractDouyinV4Items(t *testing.T) {
	data := map[string]interface{}{
		"data": map[string]interface{}{
			"itemList": []interface{}{
				map[string]interface{}{
					"AwemeInfo": map[string]interface{}{
						"AwemeId":    "7711038565760732442",
						"Desc":       "冲锋衣实测",
						"CreateTime": "1795428000",
						"Author":     map[string]interface{}{"Nickname": "星野先生"},
						"Video": map[string]interface{}{
							"Cover": map[string]interface{}{
								"UrlList": []interface{}{"https://cdn.example.com/cover.jpg"},
							},
							"PlayAddr": map[string]interface{}{
								"UrlList": []interface{}{"https://cdn.example.com/video.mp4"},
							},
						},
						"Statistics": map[string]interface{}{
							"DiggCount":    float64(1551),
							"CommentCount": float64(23),
							"ShareCount":   float64(258),
						},
					},
				},
			},
		},
	}
	items := extractItems(platformDouyin, data, "video")
	if len(items) != 1 {
		t.Fatalf("items = %d, want 1", len(items))
	}
	item := items[0]
	if item.ExternalID != "7711038565760732442" || item.Author != "星野先生" {
		t.Fatalf("item = %#v", item)
	}
	if item.CoverURL != "https://cdn.example.com/cover.jpg" || item.MediaURL != "https://cdn.example.com/video.mp4" {
		t.Fatalf("media = %#v", item)
	}
}

func TestExtractDouyinV3Items(t *testing.T) {
	data := map[string]interface{}{
		"data": []interface{}{
			map[string]interface{}{
				"itemId":     "7711593537598751334",
				"title":      "冲锋衣怎么选",
				"thumbnail":  "https://cdn.example.com/v3-cover.jpg",
				"duration":   float64(12),
				"nickname":   "阿建欢乐多",
				"likes":      "27591",
				"createTime": "2026-11-24 12:41:27",
			},
		},
	}
	items := extractItems(platformDouyin, data, "video")
	if len(items) != 1 {
		t.Fatalf("items = %d, want 1", len(items))
	}
	item := items[0]
	if item.ExternalID != "7711593537598751334" || item.Duration != 12 || item.Heat == 0 {
		t.Fatalf("item = %#v", item)
	}
	if item.PublishedAt == nil || item.CoverURL != "https://cdn.example.com/v3-cover.jpg" {
		t.Fatalf("item = %#v", item)
	}
}

func TestExtractDouyinImageItems(t *testing.T) {
	data := map[string]interface{}{
		"business_data": []interface{}{
			map[string]interface{}{
				"data": map[string]interface{}{
					"aweme_info": map[string]interface{}{
						"aweme_id":   "7704500212559013353",
						"desc":       "冲锋衣穿搭",
						"aweme_type": float64(68),
						"author":     map[string]interface{}{"nickname": "穿搭作者"},
						"images": []interface{}{
							map[string]interface{}{
								"url_list": []interface{}{"https://cdn.example.com/image.jpg"},
							},
						},
					},
				},
			},
		},
	}
	items := extractItems(platformDouyin, data, "image")
	if len(items) != 1 || items[0].ContentType != "image" {
		t.Fatalf("items = %#v", items)
	}
	if items[0].CoverURL != "https://cdn.example.com/image.jpg" {
		t.Fatalf("cover = %q", items[0].CoverURL)
	}
}

func TestDouyinSearchFallsBackToV3(t *testing.T) {
	requests := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/fetch_video_search_v5"),
			strings.HasSuffix(r.URL.Path, "/fetch_video_search_v4"):
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"detail": map[string]interface{}{
					"code": 400, "request_id": "req-test",
					"message_zh": "请求失败，请重试",
				},
			})
		case strings.HasSuffix(r.URL.Path, "/fetch_video_search_v3"):
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"code": 200,
				"data": map[string]interface{}{
					"data": []interface{}{
						map[string]interface{}{
							"itemId": "1", "title": "冲锋衣", "thumbnail": "https://cdn.example.com/cover.jpg",
							"duration": float64(10), "nickname": "作者", "likes": "100",
							"createTime": "2026-11-24 12:41:27",
						},
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, err := New(Config{BaseURL: server.URL, APIKey: "test-key"})
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.Search(context.Background(), "douyin", "冲锋衣", 1, 20, "video", 0)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(result.Items) != 1 || result.Items[0].ExternalID != "1" {
		t.Fatalf("result = %#v", result)
	}
	if len(requests) != 3 {
		t.Fatalf("requests = %#v", requests)
	}
}

func TestTimeFilterForXiaohongshu(t *testing.T) {
	cases := []struct {
		days int
		want string
	}{
		{0, "不限"},
		{1, "一天内"},
		{7, "一周内"},
		{180, "半年内"},
	}
	for _, item := range cases {
		if got := timeFilter(item.days); got != item.want {
			t.Fatalf("timeFilter(%d) = %q, want %q", item.days, got, item.want)
		}
	}
}

func TestXiaohongshuSearchUsesPlatformNoteTypes(t *testing.T) {
	var query url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"code": 200,
			"data": map[string]interface{}{
				"success": true,
				"code":    0,
				"items": []interface{}{
					map[string]interface{}{
						"note_id": "note-1",
						"note_card": map[string]interface{}{
							"display_title": "冲锋衣穿搭",
							"user":          map[string]interface{}{"nickname": "小红书作者"},
							"cover":         map[string]interface{}{"url_list": []interface{}{"https://cdn.example.com/xhs.jpg"}},
						},
					},
				},
			},
		})
	}))
	defer server.Close()

	client, err := New(Config{BaseURL: server.URL, APIKey: "test-key"})
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.Search(context.Background(), "xiaohongshu", "冲锋衣", 1, 20, "image", 0)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if query.Get("note_type") != "普通笔记" || query.Get("time_filter") != "不限" {
		t.Fatalf("query = %#v", query)
	}
	if len(result.Items) != 1 || result.Items[0].ExternalID != "note-1" {
		t.Fatalf("result = %#v", result)
	}
}

func TestXiaohongshuSearchRejectsPlatformFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"code": 200,
			"data": map[string]interface{}{
				"success": false,
				"code":    -1,
				"message": "搜索暂时不可用",
			},
		})
	}))
	defer server.Close()

	client, err := New(Config{BaseURL: server.URL, APIKey: "test-key"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Search(context.Background(), "xiaohongshu", "冲锋衣", 1, 20, "image", 0)
	if err == nil || !strings.Contains(err.Error(), "搜索暂时不可用") {
		t.Fatalf("err = %v", err)
	}
}

func TestXiaohongshuSearchExplainsUpstreamBadRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"detail": map[string]interface{}{
				"code": 400, "request_id": "req-xhs-400",
				"message_zh": "请求失败，请重试。请查看下方文档核对参数。",
			},
		})
	}))
	defer server.Close()

	client, err := New(Config{BaseURL: server.URL, APIKey: "test-key"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Search(context.Background(), "xiaohongshu", "冲锋衣", 1, 20, "image", 0)
	if err == nil || !strings.Contains(err.Error(), "TikHub 上游 HTTP 400") ||
		!strings.Contains(err.Error(), "req-xhs-400") {
		t.Fatalf("err = %v", err)
	}
}
