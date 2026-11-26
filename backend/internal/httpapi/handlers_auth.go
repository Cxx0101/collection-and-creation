package httpapi

import (
	"context"
	"crypto/sha256"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"sparkstudio/backend/internal/auth"
	"sparkstudio/backend/internal/models"
)

var phoneRe = regexp.MustCompile(`^1[3-9]\d{9}$`)

type registerReq struct {
	Phone    string `json:"phone"`
	Password string `json:"password"`
	Nickname string `json:"nickname"`
	Code     string `json:"code"`
}

func (s *Server) Register(c *gin.Context) {
	if !s.SettingBool("registration.enabled", true) {
		Fail(c, 403, "当前未开放注册，请联系管理员")
		return
	}
	var req registerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, 400, "请求参数有误")
		return
	}
	req.Phone = strings.TrimSpace(req.Phone)
	if !phoneRe.MatchString(req.Phone) {
		Fail(c, 400, "请输入正确的 11 位手机号")
		return
	}
	if len(req.Password) < 8 {
		Fail(c, 400, "密码至少 8 位")
		return
	}
	if s.SettingBool("registration.smsRequired", false) {
		if !s.consumeCode(req.Phone, "register", req.Code) {
			Fail(c, 400, "短信验证码错误或已过期")
			return
		}
	}
	var exists int64
	s.DB.Model(&models.User{}).Where("phone = ?", req.Phone).Count(&exists)
	if exists > 0 {
		Fail(c, 409, "该手机号已注册，请直接登录")
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		Fail(c, 500, "密码加密失败")
		return
	}
	nickname := strings.TrimSpace(req.Nickname)
	if nickname == "" {
		nickname = "创作者" + req.Phone[len(req.Phone)-4:]
	}
	gift := s.SettingInt("registration.giftCredits", 0)
	u := models.User{Phone: req.Phone, PasswordHash: hash, Nickname: nickname, Role: "user", Status: "active", TokenVersion: 1, Credits: gift, LastLoginAt: ptrTime(time.Now())}
	if err := s.DB.Create(&u).Error; err != nil {
		Fail(c, 500, "注册失败，请稍后重试")
		return
	}
	if gift > 0 {
		s.DB.Create(&models.CreditTransaction{UserID: u.ID, Kind: "register_bonus", BizType: "register", BizID: fmt.Sprint(u.ID), DeltaAvailable: gift, BalanceAfter: gift, Note: "新用户注册赠送积分"})
	}
	token, err := auth.IssueToken(u.ID, u.Role, u.TokenVersion)
	if err != nil {
		Fail(c, 500, "登录凭证生成失败")
		return
	}
	OK(c, gin.H{"token": token, "user": u})
}

type loginReq struct {
	Phone    string `json:"phone"`
	Password string `json:"password"`
}

func (s *Server) Login(c *gin.Context) {
	var req loginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, 400, "请求参数有误")
		return
	}
	var u models.User
	if err := s.DB.Where("phone = ?", strings.TrimSpace(req.Phone)).First(&u).Error; err != nil {
		Fail(c, 401, "手机号或密码错误")
		return
	}
	if u.Status != "active" {
		Fail(c, 403, "账号已被禁用，请联系管理员")
		return
	}
	if !auth.CheckPassword(u.PasswordHash, req.Password) {
		Fail(c, 401, "手机号或密码错误")
		return
	}
	now := time.Now()
	u.LastLoginAt = &now
	s.DB.Save(&u)
	token, err := auth.IssueToken(u.ID, u.Role, u.TokenVersion)
	if err != nil {
		Fail(c, 500, "登录失败")
		return
	}
	OK(c, gin.H{"token": token, "user": u})
}

type sendCodeReq struct {
	Phone string `json:"phone"`
	Scene string `json:"scene"`
}

func (s *Server) SendCode(c *gin.Context) {
	var req sendCodeReq
	if err := c.ShouldBindJSON(&req); err != nil || !phoneRe.MatchString(req.Phone) {
		Fail(c, 400, "请输入正确的手机号")
		return
	}
	if req.Scene == "" {
		req.Scene = "register"
	}
	var recent models.SmsCode
	if err := s.DB.Where("phone = ? AND scene = ? AND created_at > ?", req.Phone, req.Scene, time.Now().Add(-60*time.Second)).
		Order("id desc").First(&recent).Error; err == nil {
		Fail(c, 429, "验证码发送过于频繁，请 60 秒后重试")
		return
	}
	code, err := newSmsCode()
	if err != nil {
		Fail(c, 500, "验证码生成失败")
		return
	}
	sum := sha256.Sum256([]byte(code))
	rec := models.SmsCode{Phone: req.Phone, Scene: req.Scene, CodeHash: fmt.Sprintf("%x", sum), ExpiresAt: time.Now().Add(5 * time.Minute)}
	if err := s.DB.Create(&rec).Error; err != nil {
		Fail(c, 500, "验证码保存失败")
		return
	}
	smsRequired := s.SettingBool("registration.smsRequired", false)
	if smsRequired {
		sendCtx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
		defer cancel()
		if err := sendSmsCode(sendCtx, req.Phone, code, s.Setting("sms.signName", ""), s.Setting("sms.templateCode", "")); err != nil {
			s.DB.Delete(&rec)
			Fail(c, 502, err.Error())
			return
		}
	}
	resp := gin.H{"sent": true, "expiresIn": 300}
	if !smsRequired {
		resp["note"] = "短信验证码当前关闭，无需填写"
	}
	if env("APP_ENV", "development") != "production" {
		resp["devCode"] = code
	}
	OK(c, resp)
}

func (s *Server) consumeCode(phone, scene, code string) bool {
	code = strings.TrimSpace(code)
	if code == "" {
		return false
	}
	sum := sha256.Sum256([]byte(code))
	hash := fmt.Sprintf("%x", sum)
	var rec models.SmsCode
	if err := s.DB.Where("phone = ? AND scene = ? AND used_at IS NULL AND expires_at > ?", phone, scene, time.Now()).Order("id desc").First(&rec).Error; err != nil {
		return false
	}
	if rec.CodeHash != hash {
		return false
	}
	now := time.Now()
	res := s.DB.Model(&models.SmsCode{}).Where("id = ? AND used_at IS NULL", rec.ID).Update("used_at", &now)
	return res.Error == nil && res.RowsAffected == 1
}

func (s *Server) Me(c *gin.Context) {
	u := CurrentUser(c)
	OK(c, u)
}

type updateMeReq struct {
	Nickname string `json:"nickname"`
}

func (s *Server) UpdateMe(c *gin.Context) {
	var req updateMeReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Nickname) == "" {
		Fail(c, 400, "昵称不能为空")
		return
	}
	u := CurrentUser(c)
	u.Nickname = strings.TrimSpace(req.Nickname)
	s.DB.Model(u).Update("nickname", u.Nickname)
	OK(c, u)
}

type changePwdReq struct {
	OldPassword string `json:"oldPassword"`
	NewPassword string `json:"newPassword"`
}

func (s *Server) ChangePassword(c *gin.Context) {
	var req changePwdReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, 400, "请求参数有误")
		return
	}
	u := CurrentUser(c)
	if !auth.CheckPassword(u.PasswordHash, req.OldPassword) {
		Fail(c, 400, "当前密码不正确")
		return
	}
	if len(req.NewPassword) < 8 {
		Fail(c, 400, "新密码至少 8 位")
		return
	}
	hash, _ := auth.HashPassword(req.NewPassword)
	u.PasswordHash = hash
	u.TokenVersion++
	s.DB.Save(u)
	token, _ := auth.IssueToken(u.ID, u.Role, u.TokenVersion)
	OK(c, gin.H{"token": token})
}

func (s *Server) MeSummary(c *gin.Context) {
	u := CurrentUser(c)
	var assets, products, jobs, unread int64
	s.DB.Model(&models.Asset{}).Where("owner_user_id = ?", u.ID).Count(&assets)
	s.DB.Model(&models.Product{}).Where("owner_user_id = ?", u.ID).Count(&products)
	s.DB.Model(&models.StudioJob{}).Where("owner_user_id = ?", u.ID).Count(&jobs)
	s.DB.Model(&models.StudioJob{}).
		Where("owner_user_id = ? AND status IN ?", u.ID, []string{"queued", "running", "waiting_for_user"}).
		Count(&unread)
	OK(c, gin.H{"user": u, "assets": assets, "products": products, "jobs": jobs, "activeTasks": unread})
}

func ptrTime(t time.Time) *time.Time { return &t }
