package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"gorm.io/gorm"
	"sparkstudio/backend/internal/auth"
	"sparkstudio/backend/internal/models"
)

type Server struct {
	DB        *gorm.DB
	UploadDir string
	PublicURL string
}

func OK(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "ok", "data": data})
}

func Fail(c *gin.Context, status int, msg string) {
	c.AbortWithStatusJSON(status, gin.H{"code": status, "message": msg, "data": nil})
}

func (s *Server) AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.GetHeader("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			Fail(c, http.StatusUnauthorized, "请先登录")
			return
		}
		claims, err := auth.ParseToken(strings.TrimPrefix(h, "Bearer "))
		if err != nil {
			Fail(c, http.StatusUnauthorized, "登录已失效，请重新登录")
			return
		}
		var u models.User
		if err := s.DB.First(&u, claims.UserID).Error; err != nil {
			Fail(c, http.StatusUnauthorized, "账号不存在")
			return
		}
		if u.Status != "active" || u.TokenVersion != claims.TokenVersion {
			Fail(c, http.StatusUnauthorized, "登录状态已失效，请重新登录")
			return
		}
		c.Set("user", &u)
		c.Next()
	}
}

func (s *Server) AdminRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		u := CurrentUser(c)
		if u == nil || u.Role != "admin" {
			Fail(c, http.StatusForbidden, "需要管理员权限")
			return
		}
		c.Next()
	}
}

func CurrentUser(c *gin.Context) *models.User {
	v, ok := c.Get("user")
	if !ok {
		return nil
	}
	u, _ := v.(*models.User)
	return u
}

func IDParam(c *gin.Context, name string) uint {
	n, _ := strconv.ParseUint(c.Param(name), 10, 64)
	return uint(n)
}
