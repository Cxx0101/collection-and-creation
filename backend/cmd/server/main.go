package main

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"sparkstudio/backend/internal/httpapi"
	"sparkstudio/backend/internal/models"
)

func main() {
	appEnv := env("APP_ENV", "development")
	if appEnv == "production" {
		if strings.TrimSpace(os.Getenv("JWT_SECRET")) == "" || os.Getenv("JWT_SECRET") == "change-me-in-production" {
			log.Fatal("production requires a strong JWT_SECRET")
		}
		if len(strings.TrimSpace(os.Getenv("DATA_ENCRYPTION_KEY"))) < 32 {
			log.Fatal("production requires DATA_ENCRYPTION_KEY with at least 32 characters")
		}
	}
	dsn := env("DB_DSN", "spark:password@tcp(127.0.0.1:3307)/sparkstudio?charset=utf8mb4&parseTime=True&loc=Local")
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Warn)})
	if err != nil {
		log.Fatalf("connect mysql: %v", err)
	}
	if err := db.AutoMigrate(
		&models.User{}, &models.SystemSetting{}, &models.SmsCode{},
		&models.CreditPackage{}, &models.PaymentOrder{}, &models.CreditTransaction{},
		&models.ProviderConfig{}, &models.ProviderModel{}, &models.UserProviderConfig{},
		&models.StorageConfig{}, &models.TikhubConfig{},
		&models.Asset{}, &models.Product{}, &models.ProductImage{},
		&models.CollectionBatch{}, &models.CollectionItem{}, &models.CollectionKeyword{}, &models.StudioJob{},
		&models.Skill{}, &models.WechatAccount{}, &models.Workflow{}, &models.CloneDraft{},
	); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	uploadDir := env("UPLOAD_DIR", "./data/uploads")
	if err := os.MkdirAll(uploadDir, 0o755); err != nil {
		log.Fatalf("create upload dir: %v", err)
	}
	port := env("PORT", "8080")
	publicURL := strings.TrimRight(strings.TrimSpace(os.Getenv("PUBLIC_BASE_URL")), "/")
	if publicURL == "" {
		publicURL = "http://127.0.0.1:" + port
	}
	s := &httpapi.Server{
		DB:        db,
		UploadDir: uploadDir,
		PublicURL: publicURL,
	}
	if err := s.Seed(); err != nil {
		log.Fatalf("seed: %v", err)
	}
	s.StartWorkers(context.Background())

	if appEnv == "production" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	origins := splitList(env("CORS_ORIGINS", "http://localhost:5183,http://127.0.0.1:5183,http://localhost:5184,http://127.0.0.1:5184"))
	_ = r.SetTrustedProxies([]string{"127.0.0.1", "::1"})
	r.Use(cors.New(cors.Config{
		AllowOriginFunc: func(origin string) bool {
			for _, allowed := range origins {
				if origin == allowed {
					return true
				}
			}
			if appEnv != "production" {
				return strings.HasPrefix(origin, "http://localhost:") ||
					strings.HasPrefix(origin, "http://127.0.0.1:")
			}
			return false
		},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))
	r.Static("/uploads", uploadDir)
	s.RegisterRoutes(r)

	addr := ":" + port
	log.Printf("SparkStudio API listening on %s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("server: %v", err)
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func splitList(value string) []string {
	parts := strings.Split(value, ",")
	items := make([]string, 0, len(parts))
	for _, part := range parts {
		if item := strings.TrimSpace(part); item != "" {
			items = append(items, item)
		}
	}
	return items
}
