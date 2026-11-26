package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSubmitArkVideoUsesURLForVideoReferences(t *testing.T) {
	var payload map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"task-1"}`))
	}))
	defer server.Close()

	_, err := submitArkVideo(context.Background(), Provider{
		Protocol: "ark",
		BaseURL:  server.URL,
		APIKey:   "test-key",
		Model:    "doubao-seedance-2-0-fast",
	}, VideoRequest{
		Prompt: "参考视频主体动作生成新视频",
		References: []Reference{
			{Kind: "video", MIME: "video/mp4", URL: "https://cdn.example.com/reference.mp4"},
			{
				Kind: "image", Role: "first_frame", MIME: "image/png", Data: []byte("image"),
				URL: "https://cdn.example.com/reference.png",
			},
		},
	})
	if err != nil {
		t.Fatalf("submitArkVideo: %v", err)
	}

	content, ok := payload["content"].([]interface{})
	if !ok || len(content) != 3 {
		t.Fatalf("content = %#v", payload["content"])
	}
	video, _ := content[1].(map[string]interface{})
	if video["type"] != "video_url" || video["role"] != "reference_video" {
		t.Fatalf("video reference = %#v", video)
	}
	videoURL, _ := video["video_url"].(map[string]interface{})
	if videoURL["url"] != "https://cdn.example.com/reference.mp4" {
		t.Fatalf("video url = %#v", videoURL["url"])
	}
	image, _ := content[2].(map[string]interface{})
	if image["type"] != "image_url" || image["role"] != "first_frame" {
		t.Fatalf("image reference = %#v", image)
	}
	imageURL, _ := image["image_url"].(map[string]interface{})
	if imageURL["url"] != "https://cdn.example.com/reference.png" {
		t.Fatalf("image url = %#v", imageURL["url"])
	}
}
