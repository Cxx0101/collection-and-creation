package models

import (
	"time"

	"gorm.io/gorm"
)

type User struct {
	ID             uint       `gorm:"primaryKey" json:"id"`
	Phone          string     `gorm:"size:32;uniqueIndex" json:"phone"`
	PasswordHash   string     `gorm:"size:255" json:"-"`
	Nickname       string     `gorm:"size:64" json:"nickname"`
	Role           string     `gorm:"size:16;index" json:"role"`
	Status         string     `gorm:"size:16;default:active" json:"status"`
	TokenVersion   int        `gorm:"default:1" json:"-"`
	Credits        int64      `gorm:"default:0" json:"credits"`
	FrozenCredits  int64      `gorm:"default:0" json:"frozenCredits"`
	TotalRecharged int64      `gorm:"default:0" json:"totalRecharged"`
	TotalConsumed  int64      `gorm:"default:0" json:"totalConsumed"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	LastLoginAt    *time.Time `json:"lastLoginAt"`
}

type SystemSetting struct {
	Key       string    `gorm:"primaryKey;size:64" json:"key"`
	Value     string    `gorm:"type:longtext" json:"value"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type SmsCode struct {
	ID        uint       `gorm:"primaryKey" json:"id"`
	Phone     string     `gorm:"size:32;index" json:"phone"`
	Scene     string     `gorm:"size:32" json:"scene"`
	CodeHash  string     `gorm:"size:128" json:"-"`
	ExpiresAt time.Time  `json:"expiresAt"`
	UsedAt    *time.Time `json:"usedAt"`
	CreatedAt time.Time  `json:"createdAt"`
}

type CreditPackage struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	Name         string    `gorm:"size:64" json:"name"`
	BadgeText    string    `gorm:"size:32" json:"badgeText"`
	Description  string    `gorm:"size:255" json:"description"`
	PriceCents   int64     `json:"priceCents"`
	Credits      int64     `json:"credits"`
	BonusCredits int64     `json:"bonusCredits"`
	SortOrder    int       `gorm:"default:0" json:"sortOrder"`
	Enabled      bool      `gorm:"default:true" json:"enabled"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type PaymentOrder struct {
	ID              uint       `gorm:"primaryKey" json:"id"`
	OrderNo         string     `gorm:"size:64;uniqueIndex" json:"orderNo"`
	UserID          uint       `gorm:"index" json:"userId"`
	PackageID       uint       `json:"packageId"`
	PackageName     string     `gorm:"size:64" json:"packageName"`
	AmountCents     int64      `json:"amountCents"`
	Credits         int64      `json:"credits"`
	BonusCredits    int64      `json:"bonusCredits"`
	Channel         string     `gorm:"size:16;index" json:"channel"`
	Gateway         string     `gorm:"size:16;index" json:"gateway"`
	Status          string     `gorm:"size:16;index" json:"status"`
	PayURL          string     `gorm:"size:1024" json:"payUrl"`
	PayMode         string     `gorm:"size:16" json:"payMode"`
	ExternalTradeNo string     `gorm:"size:128" json:"externalTradeNo"`
	PaidAt          *time.Time `json:"paidAt"`
	ExpiresAt       time.Time  `json:"expiresAt"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
	QRCodeURL       string     `gorm:"-" json:"qrCodeUrl,omitempty"`
}

type CreditTransaction struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	UserID         uint      `gorm:"index" json:"userId"`
	Kind           string    `gorm:"size:24;index" json:"kind"`
	BizType        string    `gorm:"size:32;index" json:"bizType"`
	BizID          string    `gorm:"size:64;index" json:"bizId"`
	DeltaAvailable int64     `json:"deltaAvailable"`
	DeltaFrozen    int64     `json:"deltaFrozen"`
	DeltaConsumed  int64     `json:"deltaConsumed"`
	BalanceAfter   int64     `json:"balanceAfter"`
	Note           string    `gorm:"size:255" json:"note"`
	DetailJSON     string    `gorm:"type:longtext" json:"detail"`
	CreatedAt      time.Time `json:"createdAt"`
}

type ProviderConfig struct {
	ID          uint            `gorm:"primaryKey" json:"id"`
	Provider    string          `gorm:"size:32;index" json:"provider"`
	DisplayName string          `gorm:"size:64" json:"displayName"`
	BaseURL     string          `gorm:"size:255" json:"baseUrl"`
	APIKey      string          `gorm:"type:text" json:"apiKey,omitempty"`
	SecretKey   string          `gorm:"type:text" json:"secretKey,omitempty"`
	Enabled     bool            `gorm:"default:true" json:"enabled"`
	SortOrder   int             `gorm:"default:0" json:"sortOrder"`
	Models      []ProviderModel `gorm:"foreignKey:ProviderID" json:"models"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
}

type ProviderModel struct {
	ID               uint      `gorm:"primaryKey" json:"id"`
	ProviderID       uint      `gorm:"index" json:"providerId"`
	ModelID          string    `gorm:"size:120;index" json:"modelId"`
	DisplayName      string    `gorm:"size:120" json:"displayName"`
	Capability       string    `gorm:"size:24;index" json:"capability"`
	Unit             string    `gorm:"size:24" json:"unit"`
	Credits          int64     `json:"credits"`
	Credits480P      int64     `gorm:"column:credits_480p;default:0" json:"credits480p"`
	Credits720P      int64     `gorm:"column:credits_720p;default:0" json:"credits720p"`
	Credits1080P     int64     `gorm:"column:credits_1080p;default:0" json:"credits1080p"`
	Enabled          bool      `gorm:"default:true" json:"enabled"`
	SupportsVideoRef bool      `gorm:"default:false" json:"supportsVideoRef"`
	MaxRefImages     int       `gorm:"default:4" json:"maxRefImages"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type UserProviderConfig struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	OwnerUserID uint      `gorm:"index" json:"ownerUserId"`
	Provider    string    `gorm:"size:32" json:"provider"`
	DisplayName string    `gorm:"size:64" json:"displayName"`
	BaseURL     string    `gorm:"size:255" json:"baseUrl"`
	APIKey      string    `gorm:"type:text" json:"-"`
	SecretKey   string    `gorm:"type:text" json:"-"`
	Models      string    `gorm:"type:text" json:"models"`
	Capability  string    `gorm:"size:24" json:"capability"`
	Enabled     bool      `gorm:"default:true" json:"enabled"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type StorageConfig struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	Provider      string    `gorm:"size:16" json:"provider"`
	Endpoint      string    `gorm:"size:255" json:"endpoint"`
	Region        string    `gorm:"size:64" json:"region"`
	Bucket        string    `gorm:"size:128" json:"bucket"`
	AccessKey     string    `gorm:"size:255" json:"accessKey"`
	SecretKey     string    `gorm:"type:text" json:"-"`
	PublicBaseURL string    `gorm:"size:255" json:"publicBaseUrl"`
	Enabled       bool      `gorm:"default:false" json:"enabled"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type TikhubConfig struct {
	ID                  uint      `gorm:"primaryKey" json:"id"`
	BaseURL             string    `gorm:"size:255" json:"baseUrl"`
	APIKey              string    `gorm:"type:text" json:"-"`
	CreditsPerPage      int64     `gorm:"default:10" json:"creditsPerPage"`
	ProxyURL            string    `gorm:"size:255" json:"proxyUrl"`
	VideoLinkCredits    int64     `gorm:"default:0" json:"videoLinkCredits"`
	PlatformPricingJSON string    `gorm:"type:text" json:"platformPricing"`
	HeatWeightsJSON     string    `gorm:"type:text" json:"heatWeights"`
	Enabled             bool      `gorm:"default:false" json:"enabled"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type CollectionKeyword struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	OwnerUserID uint      `gorm:"index" json:"ownerUserId"`
	Keyword     string    `gorm:"size:128;index" json:"keyword"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Asset struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	OwnerUserID uint           `gorm:"index" json:"ownerUserId"`
	JobID       uint           `gorm:"index;default:0" json:"jobId"`
	Name        string         `gorm:"size:255" json:"name"`
	Kind        string         `gorm:"size:16;index" json:"kind"`
	Source      string         `gorm:"size:64" json:"source"`
	Size        string         `gorm:"size:32" json:"size"`
	URL         string         `gorm:"size:512" json:"url"`
	ObjectKey   string         `gorm:"size:255" json:"objectKey"`
	MimeType    string         `gorm:"size:128" json:"mimeType"`
	Seed        int            `json:"seed"`
	CreatedAt   time.Time      `json:"createdAt"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}

type Product struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	OwnerUserID uint           `gorm:"index" json:"ownerUserId"`
	Name        string         `gorm:"size:128" json:"name"`
	Description string         `gorm:"size:255" json:"description"`
	Seed        int            `json:"seed"`
	Images      []ProductImage `gorm:"foreignKey:ProductID" json:"images"`
	CreatedAt   time.Time      `json:"createdAt"`
	UpdatedAt   time.Time      `json:"updatedAt"`
}

type ProductImage struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ProductID uint      `gorm:"index" json:"productId"`
	Name      string    `gorm:"size:255" json:"name"`
	URL       string    `gorm:"size:512" json:"url"`
	Seed      int       `json:"seed"`
	SortOrder int       `json:"sortOrder"`
	CreatedAt time.Time `json:"createdAt"`
}

type CollectionBatch struct {
	ID             uint             `gorm:"primaryKey" json:"id"`
	OwnerUserID    uint             `gorm:"index" json:"ownerUserId"`
	Platform       string           `gorm:"size:32;index" json:"platform"`
	Keyword        string           `gorm:"size:128" json:"keyword"`
	Pages          int              `json:"pages"`
	Limit          int              `json:"limit"`
	PagesFetched   int              `json:"pagesFetched"`
	CreditsCharged int64            `json:"creditsCharged"`
	CreditsSettled bool             `gorm:"default:false" json:"creditsSettled"`
	Status         string           `gorm:"size:16;index" json:"status"`
	ItemCount      int              `json:"itemCount"`
	Mode           string           `gorm:"size:16" json:"mode"`
	ContentType    string           `gorm:"size:16" json:"contentType"`
	PublishedDays  int              `json:"publishedDays"`
	ErrorMessage   string           `gorm:"type:text" json:"errorMessage"`
	CreatedAt      time.Time        `json:"createdAt"`
	UpdatedAt      time.Time        `json:"updatedAt"`
	Items          []CollectionItem `gorm:"foreignKey:BatchID" json:"items,omitempty"`
}

type CollectionItem struct {
	ID             uint       `gorm:"primaryKey" json:"id"`
	BatchID        uint       `gorm:"index" json:"batchId"`
	OwnerUserID    uint       `gorm:"index" json:"ownerUserId"`
	Platform       string     `gorm:"size:32;index" json:"platform"`
	ExternalID     string     `gorm:"size:128" json:"externalId"`
	Title          string     `gorm:"size:255" json:"title"`
	Description    string     `gorm:"type:text" json:"description"`
	Author         string     `gorm:"size:128" json:"author"`
	Heat           int        `json:"heat"`
	URL            string     `gorm:"size:768" json:"url"`
	CoverURL       string     `gorm:"size:1024" json:"coverUrl"`
	CoverObjectKey string     `gorm:"size:255" json:"-"`
	MediaURL       string     `gorm:"size:1024" json:"mediaUrl"`
	ContentType    string     `gorm:"size:16" json:"contentType"`
	Duration       int        `json:"duration"`
	PublishedAt    *time.Time `json:"publishedAt"`
	MetricsJSON    string     `gorm:"type:text" json:"metrics"`
	RawJSON        string     `gorm:"type:longtext" json:"-"`
	Seed           int        `json:"seed"`
	Saved          bool       `json:"saved"`
	CreatedAt      time.Time  `json:"createdAt"`
}

type StudioJob struct {
	ID             uint       `gorm:"primaryKey" json:"id"`
	OwnerUserID    uint       `gorm:"index" json:"ownerUserId"`
	ProviderID     uint       `gorm:"index;default:0" json:"providerId"`
	UserProviderID uint       `gorm:"index;default:0" json:"userProviderId"`
	Tool           string     `gorm:"size:64;index" json:"tool"`
	ToolName       string     `gorm:"size:64" json:"toolName"`
	ModelSource    string     `gorm:"size:16" json:"modelSource"`
	ModelID        string     `gorm:"size:120" json:"modelId"`
	ModelLabel     string     `gorm:"size:140" json:"modelLabel"`
	Prompt         string     `gorm:"type:text" json:"prompt"`
	ParamsJSON     string     `gorm:"type:longtext" json:"params"`
	Status         string     `gorm:"size:24;index" json:"status"`
	CreditsCharged int64      `json:"creditsCharged"`
	CreditsSettled bool       `gorm:"default:false" json:"creditsSettled"`
	ResultCount    int        `json:"resultCount"`
	RemoteTaskID   string     `gorm:"size:255" json:"remoteTaskId"`
	ErrorMessage   string     `gorm:"type:text" json:"errorMessage"`
	StartedAt      *time.Time `json:"startedAt"`
	CompletedAt    *time.Time `json:"completedAt"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

type Skill struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	OwnerUserID uint      `gorm:"index" json:"ownerUserId"`
	Name        string    `gorm:"size:64" json:"name"`
	Description string    `gorm:"size:255" json:"description"`
	Content     string    `gorm:"type:longtext" json:"content"`
	Builtin     bool      `gorm:"default:false" json:"builtin"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type WechatAccount struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	OwnerUserID uint      `gorm:"index" json:"ownerUserId"`
	AccountName string    `gorm:"size:128" json:"accountName"`
	AppID       string    `gorm:"size:64" json:"appId"`
	AppSecret   string    `gorm:"type:text" json:"-"`
	Enabled     bool      `gorm:"default:true" json:"enabled"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type Workflow struct {
	ID               uint       `gorm:"primaryKey" json:"id"`
	OwnerUserID      uint       `gorm:"index" json:"ownerUserId"`
	Name             string     `gorm:"size:128" json:"name"`
	Schedule         string     `gorm:"size:64" json:"schedule"`
	Enabled          bool       `gorm:"default:true" json:"enabled"`
	NodesJSON        string     `gorm:"type:longtext" json:"nodes"`
	EstimatedCredits int        `json:"estimatedCredits"`
	LastRun          string     `gorm:"size:128" json:"lastRun"`
	LastRunAt        *time.Time `json:"lastRunAt"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

type CloneDraft struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	OwnerUserID uint      `gorm:"index" json:"ownerUserId"`
	Title       string    `gorm:"size:255" json:"title"`
	SourceURL   string    `gorm:"size:512" json:"sourceUrl"`
	Platform    string    `gorm:"size:32" json:"platform"`
	Status      string    `gorm:"size:16" json:"status"`
	Seed        int       `json:"seed"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
