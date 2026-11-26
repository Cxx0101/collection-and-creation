package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"sparkstudio/backend/internal/models"
	"sparkstudio/backend/internal/storage"
)

func (s *Server) storageEngine() (storage.Engine, error) {
	var cfg models.StorageConfig
	err := s.DB.Where("enabled = ?", true).Order("id desc").First(&cfg).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return storage.New(storage.Config{
			Provider: "local", LocalDir: s.UploadDir, LocalBaseURL: s.PublicURL,
		})
	}
	if err != nil {
		return nil, err
	}
	secret := decryptSecret(cfg.SecretKey)
	if cfg.Provider == "" || cfg.Endpoint == "" || cfg.Bucket == "" || cfg.AccessKey == "" || secret == "" {
		return nil, errors.New("当前启用的对象存储配置不完整，请到后台补齐 AccessKey / SecretKey / Bucket")
	}
	return storage.New(storage.Config{
		Provider: cfg.Provider, Endpoint: cfg.Endpoint, Region: cfg.Region, Bucket: cfg.Bucket,
		AccessKey: cfg.AccessKey, SecretKey: secret, PublicBaseURL: cfg.PublicBaseURL,
		LocalDir: s.UploadDir, LocalBaseURL: s.PublicURL,
	})
}

func (s *Server) putObject(ctx context.Context, key string, reader io.Reader, size int64, contentType string) error {
	engine, err := s.storageEngine()
	if err != nil {
		return err
	}
	return engine.Put(ctx, key, reader, size, contentType)
}

func (s *Server) openObject(ctx context.Context, key string) (io.ReadCloser, error) {
	engine, err := s.storageEngine()
	if err != nil {
		return nil, err
	}
	return engine.Open(ctx, key)
}

func (s *Server) deleteObject(ctx context.Context, key string) error {
	if strings.TrimSpace(key) == "" {
		return nil
	}
	engine, err := s.storageEngine()
	if err != nil {
		return err
	}
	return engine.Delete(ctx, key)
}

func (s *Server) objectURL(key string) string {
	key = sanitizeObjectKey(key)
	if key == "" {
		return ""
	}
	var cfg models.StorageConfig
	err := s.DB.Where("enabled = ?", true).Order("id desc").First(&cfg).Error
	if err == nil {
		provider := strings.ToLower(strings.TrimSpace(cfg.Provider))
		if provider == "" || provider == "local" {
			return strings.TrimRight(s.PublicURL, "/") + "/uploads/" + key
		}
		if publicBaseURL := normalizePublicBaseURL(cfg.PublicBaseURL); publicBaseURL != "" {
			if signedURL, err := s.signedObjectURL(key); err == nil {
				if rebasedURL, err := rebaseObjectURL(signedURL, publicBaseURL, key); err == nil {
					return rebasedURL
				}
			}
		}
	}
	return strings.TrimRight(s.PublicURL, "/") + "/api/v1/media/" + key + "?sig=" + mediaSignature(key)
}

func (s *Server) signedObjectURL(key string) (string, error) {
	engine, err := s.storageEngine()
	if err != nil {
		return "", err
	}
	return engine.SignedURL(context.Background(), key, 24*time.Hour)
}

func rebaseObjectURL(rawURL, publicBaseURL, key string) (string, error) {
	signed, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}
	base, err := url.Parse(publicBaseURL)
	if err != nil {
		return "", err
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/" + strings.TrimLeft(key, "/")
	base.RawPath = ""
	base.RawQuery = signed.RawQuery
	base.Fragment = ""
	return base.String(), nil
}

func (s *Server) assetURL(asset models.Asset) string {
	if strings.TrimSpace(asset.ObjectKey) != "" {
		return s.objectURL(asset.ObjectKey)
	}
	return asset.URL
}

func (s *Server) resolveAssetURLs(assets []models.Asset) {
	for index := range assets {
		assets[index].URL = s.assetURL(assets[index])
	}
}

func normalizePublicBaseURL(raw string) string {
	base := strings.TrimSpace(raw)
	if base == "" {
		return ""
	}
	if !strings.HasPrefix(base, "http://") && !strings.HasPrefix(base, "https://") {
		base = "https://" + strings.TrimLeft(base, "/")
	}
	return strings.TrimRight(base, "/")
}

func mediaSignature(key string) string {
	mac := hmac.New(sha256.New, []byte("sparkstudio-media:"+os.Getenv("JWT_SECRET")+":"+os.Getenv("DATA_ENCRYPTION_KEY")))
	_, _ = mac.Write([]byte(key))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func validMediaSignature(key, signature string) bool {
	expected := mediaSignature(key)
	return hmac.Equal([]byte(expected), []byte(signature))
}

func (s *Server) MediaFile(c *gin.Context) {
	key := strings.TrimPrefix(c.Param("key"), "/")
	if key == "" || strings.Contains(key, "..") {
		Fail(c, http.StatusNotFound, "文件不存在")
		return
	}
	if !validMediaSignature(key, c.Query("sig")) {
		Fail(c, http.StatusForbidden, "文件访问签名无效")
		return
	}
	reader, err := s.openObject(c.Request.Context(), key)
	if err != nil {
		Fail(c, http.StatusNotFound, "文件不存在或对象存储不可用")
		return
	}
	defer reader.Close()
	contentType := mime.TypeByExtension(path.Ext(key))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	disposition := "inline"
	if c.Query("download") == "1" {
		disposition = "attachment"
	}
	c.Header("Content-Type", contentType)
	c.Header("Content-Disposition", fmt.Sprintf(`%s; filename*=UTF-8''%s`, disposition, url.PathEscape(filepath.Base(key))))
	c.Header("Cache-Control", "private, max-age=86400")
	if _, err := io.Copy(c.Writer, reader); err != nil && !errors.Is(err, context.Canceled) {
		_ = c.Error(err)
	}
}

func sanitizeObjectKey(key string) string {
	clean := path.Clean("/" + strings.TrimLeft(key, "/"))
	return strings.TrimLeft(clean, "/")
}

func newObjectKey(prefix, ext string) string {
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	return strings.Trim(prefix, "/") + "/" + time.Now().Format("200601/02") + "/" + randomObjectID() + ext
}

func randomObjectID() string {
	return uuid.NewString()
}
