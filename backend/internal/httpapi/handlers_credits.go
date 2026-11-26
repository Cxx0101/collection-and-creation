package httpapi

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"sparkstudio/backend/internal/models"
)

func (s *Server) ListMyLedger(c *gin.Context) {
	u := CurrentUser(c)
	limit := 100
	var list []models.CreditTransaction
	s.DB.Where("user_id = ?", u.ID).Order("id desc").Limit(limit).Find(&list)
	OK(c, list)
}

func (s *Server) ListMyOrders(c *gin.Context) {
	u := CurrentUser(c)
	var list []models.PaymentOrder
	s.DB.Where("user_id = ?", u.ID).Order("id desc").Limit(50).Find(&list)
	for index := range list {
		hydrateOrderQRCode(&list[index])
	}
	OK(c, list)
}

type createOrderReq struct {
	PackageID uint   `json:"packageId"`
	Channel   string `json:"channel"`
}

func (s *Server) CreateOrder(c *gin.Context) {
	var req createOrderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, 400, "请求参数有误")
		return
	}
	if req.Channel != "alipay" && req.Channel != "wechat" {
		Fail(c, 400, "请选择支付宝或微信支付")
		return
	}
	mockMode := s.mockPaymentsEnabled()
	fyepayEnabled := s.fyepayEnabled() && s.fyepayReady()
	enabled := s.SettingBool("payment."+req.Channel+".enabled", false) || fyepayEnabled
	if !enabled && !mockMode {
		Fail(c, 400, "该支付通道暂未启用")
		return
	}
	var pkg models.CreditPackage
	if err := s.DB.Where("id = ? AND enabled = ?", req.PackageID, true).First(&pkg).Error; err != nil {
		Fail(c, 404, "积分套餐不存在或已下架")
		return
	}
	u := CurrentUser(c)
	gateway := "direct"
	if mockMode {
		gateway = "mock"
	} else if fyepayEnabled {
		gateway = "fyepay"
	}
	order := models.PaymentOrder{
		OrderNo:      newOrderNo(),
		UserID:       u.ID,
		PackageID:    pkg.ID,
		PackageName:  pkg.Name,
		AmountCents:  pkg.PriceCents,
		Credits:      pkg.Credits,
		BonusCredits: pkg.BonusCredits,
		Channel:      req.Channel,
		Gateway:      gateway,
		Status:       "pending",
		ExpiresAt:    time.Now().Add(30 * time.Minute),
	}
	if mockMode {
		order.PayURL = "/credits?mockOrder=" + order.OrderNo
		order.PayMode = "redirect"
	} else {
		order.PayMode = "qrcode"
	}
	if err := s.DB.Create(&order).Error; err != nil {
		Fail(c, 500, "订单创建失败")
		return
	}
	if !mockMode {
		var err error
		if gateway == "fyepay" {
			err = s.createFyepayPayment(c.Request.Context(), &order, c.ClientIP())
		} else if req.Channel == "alipay" {
			err = s.createAlipayPayment(c.Request.Context(), &order)
		} else {
			err = s.createWechatPayment(c.Request.Context(), &order)
		}
		if err != nil {
			log.Printf("payment order %s create failed: %v", order.OrderNo, err)
			s.DB.Model(&order).Update("status", "failed")
			Fail(c, 502, err.Error())
			return
		}
		if err := s.DB.Model(&order).Updates(map[string]interface{}{
			"pay_url": order.PayURL, "pay_mode": order.PayMode,
		}).Error; err != nil {
			Fail(c, 500, "支付订单保存失败")
			return
		}
	}
	hydrateOrderQRCode(&order)
	OK(c, gin.H{"order": order, "mockMode": mockMode})
}

func (s *Server) GetMyOrder(c *gin.Context) {
	u := CurrentUser(c)
	var order models.PaymentOrder
	if err := s.DB.Where("order_no = ? AND user_id = ?", c.Param("orderNo"), u.ID).First(&order).Error; err != nil {
		Fail(c, 404, "订单不存在")
		return
	}
	if order.Status == "pending" && order.Gateway == "fyepay" {
		refreshed, err := s.reconcilePendingFyepayOrder(c.Request.Context(), &order)
		if err != nil {
			log.Printf("fyepay order query failed for %s: %v", order.OrderNo, err)
		} else {
			order = refreshed
		}
	}
	hydrateOrderQRCode(&order)
	OK(c, order)
}

func (s *Server) MockPayOrder(c *gin.Context) {
	if !s.mockPaymentsEnabled() {
		Fail(c, 400, "生产环境未开启模拟支付")
		return
	}
	u := CurrentUser(c)
	var order models.PaymentOrder
	if err := s.DB.Where("order_no = ? AND user_id = ?", c.Param("orderNo"), u.ID).First(&order).Error; err != nil {
		Fail(c, 404, "订单不存在")
		return
	}
	if order.Status == "paid" {
		OK(c, order)
		return
	}
	if order.Status != "pending" {
		Fail(c, 400, "订单状态不可支付")
		return
	}
	order, err := s.settlePaidOrder(order.OrderNo, order.Channel, "mock-"+order.OrderNo, order.AmountCents, "mock")
	if err != nil {
		Fail(c, 500, "支付入账失败")
		return
	}
	hydrateOrderQRCode(&order)
	OK(c, gin.H{"order": order, "credits": CurrentUserBalance(s, u.ID)})
}

func (s *Server) AlipayNotify(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	if err := c.Request.ParseForm(); err != nil {
		c.String(http.StatusBadRequest, "failure")
		return
	}
	values := c.Request.PostForm
	publicKeyRaw := decryptSecret(s.Setting("payment.alipay.publicKey", ""))
	publicKey, err := parseRSAPublicKey(publicKeyRaw)
	if err != nil {
		log.Printf("alipay notify public key error: %v", err)
		c.String(http.StatusBadRequest, "failure")
		return
	}
	if err := verifyAlipayNotify(values, publicKey); err != nil {
		log.Printf("alipay notify verify failed: %v", err)
		c.String(http.StatusBadRequest, "failure")
		return
	}
	if expected := strings.TrimSpace(s.Setting("payment.alipay.appId", "")); expected == "" || values.Get("app_id") != expected {
		c.String(http.StatusBadRequest, "failure")
		return
	}
	if sellerID := strings.TrimSpace(s.Setting("payment.alipay.sellerId", "")); sellerID != "" && values.Get("seller_id") != sellerID {
		c.String(http.StatusBadRequest, "failure")
		return
	}
	status := values.Get("trade_status")
	if status != "TRADE_SUCCESS" && status != "TRADE_FINISHED" {
		c.String(http.StatusOK, "success")
		return
	}
	amountCents, err := yuanToCents(values.Get("total_amount"))
	if err != nil {
		c.String(http.StatusBadRequest, "failure")
		return
	}
	if _, err := s.settlePaidOrder(
		values.Get("out_trade_no"), "alipay", firstNonEmptyText(values.Get("trade_no"), values.Get("out_trade_no")),
		amountCents, "alipay_notify",
	); err != nil {
		log.Printf("alipay notify credit failed: %v", err)
		c.String(http.StatusBadRequest, "failure")
		return
	}
	c.String(http.StatusOK, "success")
}

func (s *Server) WechatNotify(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "FAIL", "message": "读取回调失败"})
		return
	}
	if err := s.verifyWechatNotify(
		c.GetHeader("Wechatpay-Timestamp"), c.GetHeader("Wechatpay-Nonce"),
		c.GetHeader("Wechatpay-Signature"), body,
	); err != nil {
		log.Printf("wechat notify verify failed: %v", err)
		c.JSON(http.StatusUnauthorized, gin.H{"code": "FAIL", "message": err.Error()})
		return
	}
	var event struct {
		EventType string `json:"event_type"`
		Resource  struct {
			Algorithm      string `json:"algorithm"`
			Ciphertext     string `json:"ciphertext"`
			Nonce          string `json:"nonce"`
			AssociatedData string `json:"associated_data"`
		} `json:"resource"`
	}
	if err := json.Unmarshal(body, &event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "FAIL", "message": "回调格式无效"})
		return
	}
	if event.EventType != "TRANSACTION.SUCCESS" {
		c.JSON(http.StatusOK, gin.H{"code": "SUCCESS", "message": "成功"})
		return
	}
	plain, err := s.decryptWechatResource(event.Resource.Ciphertext, event.Resource.Nonce, event.Resource.AssociatedData)
	if err != nil {
		log.Printf("wechat notify decrypt failed: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"code": "FAIL", "message": err.Error()})
		return
	}
	var transaction struct {
		AppID       string `json:"appid"`
		MchID       string `json:"mchid"`
		OutTradeNo  string `json:"out_trade_no"`
		Transaction string `json:"transaction_id"`
		TradeState  string `json:"trade_state"`
		Amount      struct {
			Total int64 `json:"total"`
		} `json:"amount"`
	}
	if err := json.Unmarshal(plain, &transaction); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "FAIL", "message": "交易数据格式无效"})
		return
	}
	if transaction.TradeState != "SUCCESS" {
		c.JSON(http.StatusOK, gin.H{"code": "SUCCESS", "message": "成功"})
		return
	}
	if transaction.AppID != s.Setting("payment.wechat.appId", "") || transaction.MchID != s.Setting("payment.wechat.mchId", "") {
		c.JSON(http.StatusBadRequest, gin.H{"code": "FAIL", "message": "商户信息不匹配"})
		return
	}
	if _, err := s.settlePaidOrder(
		transaction.OutTradeNo, "wechat", transaction.Transaction,
		transaction.Amount.Total, "wechat_notify",
	); err != nil {
		log.Printf("wechat notify credit failed: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"code": "FAIL", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": "SUCCESS", "message": "成功"})
}

func newOrderNo() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return "SS" + time.Now().Format("20060102150405") + fmt.Sprintf("%x", b)
}

func CurrentUserBalance(s *Server, userID uint) int64 {
	var u models.User
	if err := s.DB.First(&u, userID).Error; err != nil {
		return 0
	}
	return u.Credits
}

func formatCredits(n int64) string { return strconv.FormatInt(n, 10) }
