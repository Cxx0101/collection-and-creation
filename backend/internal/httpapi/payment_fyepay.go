package httpapi

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"sparkstudio/backend/internal/models"
)

const fyepayDefaultGateway = "https://api.fyepay.com/getaway"

type fyepayConfig struct {
	MchID   string
	Key     string
	Gateway string
}

func (s *Server) fyepayEnabled() bool {
	return s.SettingBool("payment.fyepay.enabled", false)
}

func (s *Server) fyepayConfig() (fyepayConfig, error) {
	cfg := fyepayConfig{
		MchID:   strings.TrimSpace(s.Setting("payment.fyepay.mchId", "")),
		Key:     strings.TrimSpace(decryptSecret(s.Setting("payment.fyepay.key", ""))),
		Gateway: strings.TrimSpace(s.Setting("payment.fyepay.gateway", fyepayDefaultGateway)),
	}
	if cfg.MchID == "" || cfg.Key == "" {
		return cfg, errors.New("合众纵横商户号或商户密钥尚未配置")
	}
	if cfg.Gateway == "" {
		cfg.Gateway = fyepayDefaultGateway
	}
	parsed, err := url.Parse(cfg.Gateway)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return cfg, errors.New("合众纵横网关地址格式无效")
	}
	return cfg, nil
}

func (s *Server) fyepayReady() bool {
	_, err := s.fyepayConfig()
	return err == nil
}

func (s *Server) fyepayNotifyURL() string {
	if custom := strings.TrimSpace(s.Setting("payment.fyepay.notifyUrl", "")); custom != "" {
		return custom
	}
	return strings.TrimRight(s.PublicURL, "/") + "/api/v1/payments/fyepay/notify"
}

func fyepayPayType(channel string) (string, error) {
	switch channel {
	case "alipay":
		return "1", nil
	case "wechat":
		return "2", nil
	default:
		return "", errors.New("合众纵横暂不支持该支付渠道")
	}
}

func fyepayChannel(payType string) string {
	switch strings.TrimSpace(payType) {
	case "1":
		return "alipay"
	case "2":
		return "wechat"
	default:
		return ""
	}
}

func fyepayParams(raw []byte) (map[string]string, error) {
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(raw, &payload); err != nil || payload == nil {
		return nil, errors.New("合众纵横返回数据不是有效 JSON 对象")
	}
	result := make(map[string]string, len(payload))
	for key, rawValue := range payload {
		value := bytes.TrimSpace(rawValue)
		if len(value) == 0 || bytes.Equal(value, []byte("null")) {
			continue
		}
		switch value[0] {
		case '"':
			var text string
			if err := json.Unmarshal(value, &text); err != nil {
				return nil, fmt.Errorf("字段 %s 的字符串格式无效", key)
			}
			result[key] = text
		case '{', '[':
			var compact bytes.Buffer
			if err := json.Compact(&compact, value); err != nil {
				return nil, fmt.Errorf("字段 %s 的 JSON 格式无效", key)
			}
			result[key] = compact.String()
		default:
			result[key] = string(value)
		}
	}
	return result, nil
}

func fyepaySign(payload map[string]string, key string) string {
	keys := make([]string, 0, len(payload))
	for name, value := range payload {
		if name == "sign" || value == "" {
			continue
		}
		keys = append(keys, name)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, name := range keys {
		parts = append(parts, name+"="+payload[name])
	}
	source := strings.Join(parts, "&") + "&key=" + key
	sum := md5.Sum([]byte(source))
	return hex.EncodeToString(sum[:])
}

func verifyFyepaySignature(payload map[string]string, key string) error {
	provided := strings.ToLower(strings.TrimSpace(payload["sign"]))
	if len(provided) != md5.Size*2 {
		return errors.New("合众纵横签名缺失或格式无效")
	}
	expected := fyepaySign(payload, key)
	if subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
		return errors.New("合众纵横签名校验失败")
	}
	return nil
}

func (s *Server) fyepayRequest(ctx context.Context, service string, payload map[string]string) (map[string]string, error) {
	cfg, err := s.fyepayConfig()
	if err != nil {
		return nil, err
	}
	requestPayload := make(map[string]string, len(payload)+4)
	for key, value := range payload {
		if value != "" {
			requestPayload[key] = value
		}
	}
	requestPayload["service"] = service
	requestPayload["mchId"] = cfg.MchID
	nonce, err := randomNonce()
	if err != nil {
		return nil, err
	}
	requestPayload["nonceStr"] = nonce
	requestPayload["sign"] = fyepaySign(requestPayload, cfg.Key)
	body, err := json.Marshal(requestPayload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.Gateway, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json;charset=UTF-8")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "SparkStudio/1.0")
	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("连接合众纵横支付网关失败：%w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	result, err := fyepayParams(raw)
	if err != nil {
		return nil, fmt.Errorf("合众纵横返回数据无法解析（HTTP %d）：%w", resp.StatusCode, err)
	}
	code := strings.TrimSpace(result["code"])
	message := firstNonEmptyText(result["msg"], result["stateMsg"])
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("合众纵横网关 HTTP %d：%s", resp.StatusCode, firstNonEmptyText(message, truncateRunes(string(raw), 200)))
	}
	if code == "" {
		return nil, fmt.Errorf("合众纵横网关缺少返回码：%s", truncateRunes(string(raw), 200))
	}
	if code != "00000" {
		return nil, fmt.Errorf("合众纵横接口返回 %s：%s", code, firstNonEmptyText(message, truncateRunes(string(raw), 200)))
	}
	if err := verifyFyepaySignature(result, cfg.Key); err != nil {
		return nil, err
	}
	if returnedMchID := strings.TrimSpace(result["mchId"]); returnedMchID != "" && returnedMchID != cfg.MchID {
		return nil, errors.New("合众纵横返回的商户号不匹配")
	}
	return result, nil
}

func (s *Server) createFyepayPayment(ctx context.Context, order *models.PaymentOrder, clientIP string) error {
	payType, err := fyepayPayType(order.Channel)
	if err != nil {
		return err
	}
	body := strings.NewReplacer("\r", " ", "\n", " ").Replace("星芒创作积分-" + order.PackageName)
	body = truncateRunes(body, 80)
	result, err := s.fyepayRequest(ctx, "unified", map[string]string{
		"thirdOrderNo": order.OrderNo,
		"money":        formatYuan(order.AmountCents),
		"payType":      payType,
		"tradeType":    "2",
		"body":         body,
		"expireIn":     "30",
		"tradeIp":      s.fyepayTradeIP(clientIP),
		"attach":       order.OrderNo,
		"notifyUrl":    s.fyepayNotifyURL(),
	})
	if err != nil {
		return err
	}
	if returnedOrderNo := strings.TrimSpace(result["thirdOrderNo"]); returnedOrderNo != "" && returnedOrderNo != order.OrderNo {
		return errors.New("合众纵横返回的开发者订单号不匹配")
	}
	codeURL := strings.TrimSpace(result["codeUrl"])
	if codeURL == "" {
		return errors.New("合众纵横未返回二维码支付链接")
	}
	order.PayMode = "qrcode"
	order.PayURL = codeURL
	return nil
}

func (s *Server) fyepayTradeIP(clientIP string) string {
	if configured := strings.TrimSpace(s.Setting("payment.fyepay.tradeIp", "")); configured != "" {
		if len(configured) > 16 {
			return configured[:16]
		}
		return configured
	}
	if ip := net.ParseIP(strings.TrimSpace(clientIP)); ip != nil {
		if ipv4 := ip.To4(); ipv4 != nil {
			return ipv4.String()
		}
	}
	value := strings.TrimSpace(clientIP)
	if value != "" && len(value) <= 16 {
		return value
	}
	return "127.0.0.1"
}

func (s *Server) FyepayNotify(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.String(http.StatusBadRequest, "fail")
		return
	}
	payload, err := fyepayParams(body)
	if err != nil {
		log.Printf("fyepay notify parse failed: %v", err)
		c.String(http.StatusBadRequest, "fail")
		return
	}
	cfg, err := s.fyepayConfig()
	if err != nil {
		log.Printf("fyepay notify config failed: %v", err)
		c.String(http.StatusBadRequest, "fail")
		return
	}
	if err := verifyFyepaySignature(payload, cfg.Key); err != nil {
		log.Printf("fyepay notify verify failed: %v", err)
		c.String(http.StatusBadRequest, "fail")
		return
	}
	if strings.TrimSpace(payload["mchId"]) != cfg.MchID {
		log.Printf("fyepay notify merchant mismatch")
		c.String(http.StatusBadRequest, "fail")
		return
	}
	if state := strings.TrimSpace(payload["state"]); state != "" && state != "2" {
		c.String(http.StatusOK, "success")
		return
	}
	orderNo := strings.TrimSpace(payload["thirdOrderNo"])
	if orderNo == "" {
		c.String(http.StatusBadRequest, "fail")
		return
	}
	var order models.PaymentOrder
	if err := s.DB.Where("order_no = ?", orderNo).First(&order).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("fyepay notify unknown order: %s", orderNo)
			c.String(http.StatusOK, "success")
			return
		}
		log.Printf("fyepay notify order lookup failed: %v", err)
		c.String(http.StatusBadRequest, "fail")
		return
	}
	if order.Gateway != "fyepay" {
		log.Printf("fyepay notify order gateway mismatch: %s/%s", orderNo, order.Gateway)
		c.String(http.StatusBadRequest, "fail")
		return
	}
	channel := fyepayChannel(payload["payType"])
	if channel == "" || channel != order.Channel {
		log.Printf("fyepay notify channel mismatch: %s/%s/%s", orderNo, channel, order.Channel)
		c.String(http.StatusBadRequest, "fail")
		return
	}
	amountCents, err := yuanToCents(payload["money"])
	if err != nil {
		c.String(http.StatusBadRequest, "fail")
		return
	}
	tradeNo := firstNonEmptyText(payload["transactionId"], payload["orderNo"], orderNo)
	if _, err := s.settlePaidOrder(orderNo, channel, tradeNo, amountCents, "fyepay_notify"); err != nil {
		log.Printf("fyepay notify credit failed: %v", err)
		c.String(http.StatusBadRequest, "fail")
		return
	}
	c.String(http.StatusOK, "success")
}

type fyepayOrderStatus struct {
	State         string
	Money         string
	PayType       string
	TransactionID string
	OrderNo       string
	ThirdOrderNo  string
	PayTime       string
}

func (s *Server) queryFyepayOrder(ctx context.Context, orderNo string) (fyepayOrderStatus, error) {
	result, err := s.fyepayRequest(ctx, "query", map[string]string{"thirdOrderNo": orderNo})
	if err != nil {
		return fyepayOrderStatus{}, err
	}
	if returnedOrderNo := strings.TrimSpace(result["thirdOrderNo"]); returnedOrderNo != "" && returnedOrderNo != orderNo {
		return fyepayOrderStatus{}, errors.New("合众纵横查询返回的开发者订单号不匹配")
	}
	return fyepayOrderStatus{
		State:         strings.TrimSpace(result["state"]),
		Money:         strings.TrimSpace(result["money"]),
		PayType:       strings.TrimSpace(result["payType"]),
		TransactionID: strings.TrimSpace(result["transactionId"]),
		OrderNo:       strings.TrimSpace(result["orderNo"]),
		ThirdOrderNo:  strings.TrimSpace(result["thirdOrderNo"]),
		PayTime:       strings.TrimSpace(result["payTime"]),
	}, nil
}

func (s *Server) reconcilePendingFyepayOrder(ctx context.Context, order *models.PaymentOrder) (models.PaymentOrder, error) {
	if order == nil || order.Status != "pending" || order.Gateway != "fyepay" || s.mockPaymentsEnabled() || !s.fyepayReady() {
		if order == nil {
			return models.PaymentOrder{}, errors.New("订单为空")
		}
		return *order, nil
	}
	queryCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	status, err := s.queryFyepayOrder(queryCtx, order.OrderNo)
	if err != nil {
		return *order, err
	}
	if status.State != "2" {
		return *order, nil
	}
	channel := fyepayChannel(status.PayType)
	if channel == "" || channel != order.Channel {
		return *order, errors.New("合众纵横查询结果的支付渠道与订单不一致")
	}
	amountCents, err := yuanToCents(status.Money)
	if err != nil {
		return *order, err
	}
	tradeNo := firstNonEmptyText(status.TransactionID, status.OrderNo, order.OrderNo)
	paid, err := s.settlePaidOrder(order.OrderNo, channel, tradeNo, amountCents, "fyepay_query")
	if err != nil {
		return *order, err
	}
	return paid, nil
}
