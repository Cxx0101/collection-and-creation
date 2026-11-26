package httpapi

import (
	"archive/zip"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"sparkstudio/backend/internal/models"
)

func (s *Server) ListAssets(c *gin.Context) {
	u := CurrentUser(c)
	q := s.DB.Where("owner_user_id = ?", u.ID)
	if k := c.Query("kind"); k != "" && k != "all" {
		q = q.Where("kind = ?", k)
	}
	if kw := strings.TrimSpace(c.Query("q")); kw != "" {
		q = q.Where("name LIKE ?", "%"+kw+"%")
	}
	var list []models.Asset
	q.Order("id desc").Limit(300).Find(&list)
	s.resolveAssetURLs(list)
	OK(c, list)
}

type assetRecordReq struct {
	Name   string `json:"name"`
	Kind   string `json:"kind"`
	Source string `json:"source"`
	Size   string `json:"size"`
	URL    string `json:"url"`
	Seed   int    `json:"seed"`
}

func (s *Server) CreateAssetRecord(c *gin.Context) {
	var req assetRecordReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		Fail(c, 400, "素材名称不能为空")
		return
	}
	u := CurrentUser(c)
	kind := req.Kind
	if kind == "" {
		kind = "image"
	}
	source := req.Source
	if source == "" {
		source = "个人上传"
	}
	a := models.Asset{OwnerUserID: u.ID, Name: req.Name, Kind: kind, Source: source, Size: defaultStr(req.Size, "0 KB"), URL: req.URL, Seed: req.Seed}
	if err := s.DB.Create(&a).Error; err != nil {
		Fail(c, 500, "资产创建失败")
		return
	}
	OK(c, a)
}

func (s *Server) UploadAsset(c *gin.Context) {
	u := CurrentUser(c)
	fh, err := c.FormFile("file")
	if err != nil {
		Fail(c, 400, "请选择需要上传的文件")
		return
	}
	if fh.Size > 200*1024*1024 {
		Fail(c, 400, "单个文件不能超过 200MB")
		return
	}
	ext := strings.ToLower(filepath.Ext(fh.Filename))
	contentType, allowed := allowedUploadType(ext)
	if !allowed {
		Fail(c, 400, "仅支持 JPG / PNG / WebP / GIF、MP4 / MOV / WebM、Markdown / TXT 文件")
		return
	}
	name := c.PostForm("name")
	if name == "" {
		name = fh.Filename
	}
	objectKey := newObjectKey("uploads", ext)
	file, err := fh.Open()
	if err != nil {
		Fail(c, 400, "无法读取上传文件")
		return
	}
	defer file.Close()
	if err := s.putObject(c.Request.Context(), objectKey, file, fh.Size, contentType); err != nil {
		Fail(c, 500, "对象存储上传失败："+err.Error())
		return
	}
	kind := detectKind(contentType, name)
	a := models.Asset{
		OwnerUserID: u.ID, Name: name, Kind: kind, Source: "个人上传",
		Size: humanSize(fh.Size), URL: s.objectURL(objectKey),
		ObjectKey: objectKey, MimeType: contentType, Seed: int(time.Now().UnixNano() % 6),
	}
	if err := s.DB.Create(&a).Error; err != nil {
		_ = s.deleteObject(c.Request.Context(), objectKey)
		Fail(c, 500, "资产记录创建失败")
		return
	}
	OK(c, a)
}

func (s *Server) DeleteAsset(c *gin.Context) {
	u := CurrentUser(c)
	var a models.Asset
	if err := s.DB.Where("id = ? AND owner_user_id = ?", IDParam(c, "id"), u.ID).First(&a).Error; err != nil {
		Fail(c, 404, "资产不存在")
		return
	}
	s.DB.Delete(&a)
	_ = s.deleteObject(c.Request.Context(), a.ObjectKey)
	OK(c, gin.H{"deleted": true})
}

func (s *Server) BatchDeleteAssets(c *gin.Context) {
	var req struct {
		IDs []uint `json:"ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.IDs) == 0 {
		Fail(c, 400, "请选择需要删除的资产")
		return
	}
	u := CurrentUser(c)
	var assets []models.Asset
	s.DB.Where("owner_user_id = ? AND id IN ?", u.ID, req.IDs).Find(&assets)
	for _, asset := range assets {
		_ = s.deleteObject(c.Request.Context(), asset.ObjectKey)
	}
	s.DB.Where("owner_user_id = ? AND id IN ?", u.ID, req.IDs).Delete(&models.Asset{})
	OK(c, gin.H{"deleted": len(req.IDs)})
}

func (s *Server) DownloadAssetsZip(c *gin.Context) {
	u := CurrentUser(c)
	raw := c.Query("ids")
	if raw == "" {
		Fail(c, 400, "请选择需要打包的资产")
		return
	}
	parts := strings.Split(raw, ",")
	ids := make([]uint, 0, len(parts))
	for _, p := range parts {
		if n, err := strconv.Atoi(strings.TrimSpace(p)); err == nil && n > 0 {
			ids = append(ids, uint(n))
		}
	}
	var list []models.Asset
	s.DB.Where("owner_user_id = ? AND id IN ?", u.ID, ids).Find(&list)
	if len(list) == 0 {
		Fail(c, 404, "没有可打包的资产")
		return
	}
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="sparkstudio-assets-%s.zip"`, time.Now().Format("20060102-150405")))
	zw := zip.NewWriter(c.Writer)
	defer zw.Close()
	for _, a := range list {
		if a.ObjectKey == "" {
			continue
		}
		f, err := s.openObject(c.Request.Context(), a.ObjectKey)
		if err != nil {
			continue
		}
		w, err := zw.Create(filepath.Base(a.Name))
		if err == nil {
			_, _ = io.Copy(w, f)
		}
		f.Close()
	}
}

func detectKind(contentType, name string) string {
	ct := strings.ToLower(contentType)
	ext := strings.ToLower(filepath.Ext(name))
	if strings.HasPrefix(ct, "video/") || ext == ".mp4" || ext == ".mov" || ext == ".webm" {
		return "video"
	}
	if strings.Contains(ct, "markdown") || ext == ".md" || ext == ".txt" {
		return "markdown"
	}
	return "image"
}

func allowedUploadType(ext string) (string, bool) {
	types := map[string]string{
		".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
		".webp": "image/webp", ".gif": "image/gif",
		".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".m4v": "video/x-m4v",
		".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8",
	}
	value, ok := types[strings.ToLower(ext)]
	return value, ok
}

func humanSize(n int64) string {
	if n >= 1024*1024 {
		return fmt.Sprintf("%.1f MB", float64(n)/1024/1024)
	}
	if n >= 1024 {
		return fmt.Sprintf("%.1f KB", float64(n)/1024)
	}
	return fmt.Sprintf("%d B", n)
}

func defaultStr(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

func (s *Server) ListProducts(c *gin.Context) {
	u := CurrentUser(c)
	var list []models.Product
	s.DB.Preload("Images").Where("owner_user_id = ?", u.ID).Order("id desc").Find(&list)
	OK(c, list)
}

type productReq struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Seed        int    `json:"seed"`
	Images      []struct {
		Name string `json:"name"`
		URL  string `json:"url"`
		Seed int    `json:"seed"`
	} `json:"images"`
}

func (s *Server) CreateProduct(c *gin.Context) {
	var req productReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		Fail(c, 400, "商品名称不能为空")
		return
	}
	u := CurrentUser(c)
	p := models.Product{OwnerUserID: u.ID, Name: req.Name, Description: req.Description, Seed: req.Seed}
	if err := s.DB.Create(&p).Error; err != nil {
		Fail(c, 500, "商品创建失败")
		return
	}
	s.replaceProductImages(p.ID, req)
	s.DB.Preload("Images").First(&p, p.ID)
	OK(c, p)
}

func (s *Server) UpdateProduct(c *gin.Context) {
	var req productReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		Fail(c, 400, "商品名称不能为空")
		return
	}
	u := CurrentUser(c)
	var p models.Product
	if err := s.DB.Where("id = ? AND owner_user_id = ?", IDParam(c, "id"), u.ID).First(&p).Error; err != nil {
		Fail(c, 404, "商品不存在")
		return
	}
	p.Name, p.Description, p.Seed = req.Name, req.Description, req.Seed
	s.DB.Save(&p)
	s.DB.Where("product_id = ?", p.ID).Delete(&models.ProductImage{})
	s.replaceProductImages(p.ID, req)
	s.DB.Preload("Images").First(&p, p.ID)
	OK(c, p)
}

func (s *Server) replaceProductImages(productID uint, req productReq) {
	for i, img := range req.Images {
		name := img.Name
		if strings.TrimSpace(name) == "" {
			name = fmt.Sprintf("参考图_%02d.png", i+1)
		}
		s.DB.Create(&models.ProductImage{ProductID: productID, Name: name, URL: img.URL, Seed: img.Seed, SortOrder: i + 1})
	}
}

func (s *Server) DeleteProduct(c *gin.Context) {
	u := CurrentUser(c)
	var p models.Product
	if err := s.DB.Where("id = ? AND owner_user_id = ?", IDParam(c, "id"), u.ID).First(&p).Error; err != nil {
		Fail(c, 404, "商品不存在")
		return
	}
	s.DB.Where("product_id = ?", p.ID).Delete(&models.ProductImage{})
	s.DB.Delete(&p)
	OK(c, gin.H{"deleted": true})
}

func (s *Server) AssetsHandlerFallback(c *gin.Context) { c.Status(http.StatusNotFound) }
