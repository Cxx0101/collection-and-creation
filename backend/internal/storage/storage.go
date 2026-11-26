package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"
	"github.com/google/uuid"
	"github.com/tencentyun/cos-go-sdk-v5"
	"github.com/volcengine/ve-tos-golang-sdk/v2/tos"
	"github.com/volcengine/ve-tos-golang-sdk/v2/tos/enum"
)

type Engine interface {
	Provider() string
	Put(ctx context.Context, key string, reader io.Reader, size int64, contentType string) error
	Open(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
	SignedURL(ctx context.Context, key string, expires time.Duration) (string, error)
	Test(ctx context.Context) error
}

type Config struct {
	Provider      string
	Endpoint      string
	Region        string
	Bucket        string
	AccessKey     string
	SecretKey     string
	PublicBaseURL string
	LocalDir      string
	LocalBaseURL  string
}

func New(cfg Config) (Engine, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.Provider)) {
	case "", "local":
		if strings.TrimSpace(cfg.LocalDir) == "" {
			return nil, errors.New("本地存储目录不能为空")
		}
		return &localEngine{root: cfg.LocalDir, baseURL: strings.TrimRight(cfg.LocalBaseURL, "/")}, nil
	case "oss":
		return newOSS(cfg)
	case "tos":
		return newTOS(cfg)
	case "cos":
		return newCOS(cfg)
	default:
		return nil, fmt.Errorf("不支持的存储引擎：%s", cfg.Provider)
	}
}

type localEngine struct {
	root    string
	baseURL string
}

func (e *localEngine) Provider() string { return "local" }

func (e *localEngine) Put(_ context.Context, key string, reader io.Reader, _ int64, _ string) error {
	full, err := e.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(full, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = io.Copy(file, reader)
	return err
}

func (e *localEngine) Open(_ context.Context, key string) (io.ReadCloser, error) {
	full, err := e.path(key)
	if err != nil {
		return nil, err
	}
	return os.Open(full)
}

func (e *localEngine) Delete(_ context.Context, key string) error {
	full, err := e.path(key)
	if err != nil {
		return err
	}
	err = os.Remove(full)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (e *localEngine) SignedURL(_ context.Context, key string, _ time.Duration) (string, error) {
	if _, err := e.path(key); err != nil {
		return "", err
	}
	return e.baseURL + "/uploads/" + strings.TrimLeft(key, "/"), nil
}

func (e *localEngine) Test(ctx context.Context) error {
	key := ".health/" + uuid.NewString() + ".txt"
	if err := e.Put(ctx, key, strings.NewReader("ok"), 2, "text/plain"); err != nil {
		return err
	}
	reader, err := e.Open(ctx, key)
	if err != nil {
		return err
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, 16))
	if err != nil || string(data) != "ok" {
		return errors.New("本地存储写入后读取校验失败")
	}
	return e.Delete(ctx, key)
}

func (e *localEngine) path(key string) (string, error) {
	root, err := filepath.Abs(e.root)
	if err != nil {
		return "", err
	}
	clean := filepath.Clean(filepath.FromSlash(strings.TrimLeft(key, "/")))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", errors.New("非法对象路径")
	}
	full := filepath.Join(root, clean)
	rel, err := filepath.Rel(root, full)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("非法对象路径")
	}
	return full, nil
}

type ossEngine struct {
	bucket *oss.Bucket
}

func newOSS(cfg Config) (Engine, error) {
	endpoint := strings.TrimRight(cfg.Endpoint, "/")
	if !strings.HasPrefix(endpoint, "http://") && !strings.HasPrefix(endpoint, "https://") {
		endpoint = "https://" + endpoint
	}
	client, err := oss.New(endpoint, cfg.AccessKey, cfg.SecretKey)
	if err != nil {
		return nil, fmt.Errorf("初始化 OSS 客户端失败：%w", err)
	}
	bucket, err := client.Bucket(cfg.Bucket)
	if err != nil {
		return nil, fmt.Errorf("连接 OSS Bucket 失败：%w", err)
	}
	return &ossEngine{bucket: bucket}, nil
}

func (e *ossEngine) Provider() string { return "oss" }

func (e *ossEngine) Put(ctx context.Context, key string, reader io.Reader, size int64, contentType string) error {
	options := []oss.Option{oss.ContentLength(size)}
	if contentType != "" {
		options = append(options, oss.ContentType(contentType))
	}
	if err := e.bucket.PutObject(key, reader, options...); err != nil {
		return fmt.Errorf("OSS 上传失败：%w", err)
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}

func (e *ossEngine) Open(_ context.Context, key string) (io.ReadCloser, error) {
	reader, err := e.bucket.GetObject(key)
	if err != nil {
		return nil, fmt.Errorf("OSS 读取失败：%w", err)
	}
	return reader, nil
}

func (e *ossEngine) Delete(_ context.Context, key string) error {
	if err := e.bucket.DeleteObject(key); err != nil && !strings.Contains(strings.ToLower(err.Error()), "not exist") {
		return fmt.Errorf("OSS 删除失败：%w", err)
	}
	return nil
}

func (e *ossEngine) SignedURL(_ context.Context, key string, expires time.Duration) (string, error) {
	if expires < time.Second {
		expires = time.Hour
	}
	signed, err := e.bucket.SignURL(key, oss.HTTPGet, int64(expires.Seconds()))
	if err != nil {
		return "", fmt.Errorf("OSS 签名失败：%w", err)
	}
	return signed, nil
}

func (e *ossEngine) Test(ctx context.Context) error {
	return testRoundTrip(ctx, e, "oss")
}

type tosEngine struct {
	client *tos.ClientV2
	bucket string
}

func newTOS(cfg Config) (Engine, error) {
	endpoint := strings.TrimSpace(cfg.Endpoint)
	if strings.HasPrefix(endpoint, "https://") {
		endpoint = strings.TrimPrefix(endpoint, "https://")
	}
	if strings.HasPrefix(endpoint, "http://") {
		endpoint = strings.TrimPrefix(endpoint, "http://")
	}
	options := []tos.ClientOption{tos.WithCredentials(tos.NewStaticCredentials(cfg.AccessKey, cfg.SecretKey))}
	if strings.TrimSpace(cfg.Region) != "" {
		options = append(options, tos.WithRegion(cfg.Region))
	}
	client, err := tos.NewClientV2(endpoint, options...)
	if err != nil {
		return nil, fmt.Errorf("初始化 TOS 客户端失败：%w", err)
	}
	return &tosEngine{client: client, bucket: cfg.Bucket}, nil
}

func (e *tosEngine) Provider() string { return "tos" }

func (e *tosEngine) Put(ctx context.Context, key string, reader io.Reader, size int64, contentType string) error {
	_, err := e.client.PutObjectV2(ctx, &tos.PutObjectV2Input{
		PutObjectBasicInput: tos.PutObjectBasicInput{
			Bucket: e.bucket, Key: key, ContentLength: size, ContentType: contentType,
		},
		Content: reader,
	})
	if err != nil {
		return fmt.Errorf("TOS 上传失败：%w", err)
	}
	return nil
}

func (e *tosEngine) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	output, err := e.client.GetObjectV2(ctx, &tos.GetObjectV2Input{Bucket: e.bucket, Key: key})
	if err != nil {
		return nil, fmt.Errorf("TOS 读取失败：%w", err)
	}
	return output.Content, nil
}

func (e *tosEngine) Delete(ctx context.Context, key string) error {
	_, err := e.client.DeleteObjectV2(ctx, &tos.DeleteObjectV2Input{Bucket: e.bucket, Key: key})
	if err != nil && !strings.Contains(strings.ToLower(err.Error()), "not found") {
		return fmt.Errorf("TOS 删除失败：%w", err)
	}
	return nil
}

func (e *tosEngine) SignedURL(ctx context.Context, key string, expires time.Duration) (string, error) {
	seconds := int64(expires.Seconds())
	if seconds < 1 {
		seconds = 3600
	}
	if seconds > 604800 {
		seconds = 604800
	}
	output, err := e.client.PreSignedURL(&tos.PreSignedURLInput{
		HTTPMethod: enum.HttpMethodGet, Bucket: e.bucket, Key: key, Expires: seconds,
	})
	if err != nil {
		return "", fmt.Errorf("TOS 签名失败：%w", err)
	}
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	default:
		return output.SignedUrl, nil
	}
}

func (e *tosEngine) Test(ctx context.Context) error {
	return testRoundTrip(ctx, e, "tos")
}

type cosEngine struct {
	client    *cos.Client
	secretID  string
	secretKey string
}

func newCOS(cfg Config) (Engine, error) {
	endpoint := strings.TrimSpace(cfg.Endpoint)
	endpoint = strings.TrimPrefix(endpoint, "https://")
	endpoint = strings.TrimPrefix(endpoint, "http://")
	endpoint = strings.TrimRight(endpoint, "/")
	if !strings.Contains(endpoint, cfg.Bucket+".") {
		endpoint = cfg.Bucket + "." + endpoint
	}
	bucketURL, err := url.Parse("https://" + endpoint)
	if err != nil {
		return nil, fmt.Errorf("COS Endpoint 无效：%w", err)
	}
	client := cos.NewClient(&cos.BaseURL{BucketURL: bucketURL}, &http.Client{
		Transport: &cos.AuthorizationTransport{SecretID: cfg.AccessKey, SecretKey: cfg.SecretKey},
		Timeout:   2 * time.Minute,
	})
	return &cosEngine{client: client, secretID: cfg.AccessKey, secretKey: cfg.SecretKey}, nil
}

func (e *cosEngine) Provider() string { return "cos" }

func (e *cosEngine) Put(ctx context.Context, key string, reader io.Reader, size int64, contentType string) error {
	options := &cos.ObjectPutOptions{ObjectPutHeaderOptions: &cos.ObjectPutHeaderOptions{ContentLength: size}}
	if contentType != "" {
		options.ObjectPutHeaderOptions.ContentType = contentType
	}
	if _, err := e.client.Object.Put(ctx, key, reader, options); err != nil {
		return fmt.Errorf("COS 上传失败：%w", err)
	}
	return nil
}

func (e *cosEngine) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	response, err := e.client.Object.Get(ctx, key, nil)
	if err != nil {
		return nil, fmt.Errorf("COS 读取失败：%w", err)
	}
	return response.Body, nil
}

func (e *cosEngine) Delete(ctx context.Context, key string) error {
	_, err := e.client.Object.Delete(ctx, key)
	if err != nil && !strings.Contains(strings.ToLower(err.Error()), "not exist") {
		return fmt.Errorf("COS 删除失败：%w", err)
	}
	return nil
}

func (e *cosEngine) SignedURL(ctx context.Context, key string, expires time.Duration) (string, error) {
	if expires < time.Second {
		expires = time.Hour
	}
	signed, err := e.client.Object.GetPresignedURL(ctx, http.MethodGet, key, e.secretID, e.secretKey, expires, nil)
	if err != nil {
		return "", fmt.Errorf("COS 签名失败：%w", err)
	}
	return signed.String(), nil
}

func (e *cosEngine) Test(ctx context.Context) error {
	return testRoundTrip(ctx, e, "cos")
}

func testRoundTrip(ctx context.Context, engine Engine, provider string) error {
	key := ".health/" + uuid.NewString() + ".txt"
	payload := []byte("sparkstudio-storage-health")
	if err := engine.Put(ctx, key, bytes.NewReader(payload), int64(len(payload)), "text/plain"); err != nil {
		return err
	}
	reader, err := engine.Open(ctx, key)
	if err != nil {
		return err
	}
	data, readErr := io.ReadAll(io.LimitReader(reader, 1024))
	_ = reader.Close()
	if readErr != nil || !bytes.Equal(data, payload) {
		return fmt.Errorf("%s 上传后读取校验失败", strings.ToUpper(provider))
	}
	return engine.Delete(ctx, key)
}
