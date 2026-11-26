package httpapi

import (
	"bytes"
	"context"
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/skip2/go-qrcode"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"sparkstudio/backend/internal/models"
)

const (
	alipayDefaultGateway = "https://openapi.alipay.com/gateway.do"
	wechatDefaultAPIBase = "https://api.mch.weixin.qq.com"
)

func (s *Server) mockPaymentsEnabled() bool {
	return os.Getenv("APP_ENV") != "production" && s.SettingBool("payment.mockMode", true)
}

func (s *Server) paymentNotifyURL(channel string) string {
	if custom := strings.TrimSpace(s.Setting("payment."+channel+".notifyUrl", "")); custom != "" {
		return custom
	}
	return strings.TrimRight(s.PublicURL, "/") + "/api/v1/payments/" + channel + "/notify"
}

func qrDataURI(content string) (string, error) {
	if strings.TrimSpace(content) == "" {
		return "", errors.New("二维码内容为空")
	}
	raw, err := qrcode.Encode(content, qrcode.Medium, 300)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(raw), nil
}

func hydrateOrderQRCode(order *models.PaymentOrder) {
	if order == nil || order.Status != "pending" || order.PayMode != "qrcode" || strings.TrimSpace(order.PayURL) == "" {
		if order != nil {
			order.QRCodeURL = ""
		}
		return
	}
	qr, err := qrDataURI(order.PayURL)
	if err != nil {
		order.QRCodeURL = ""
		return
	}
	order.QRCodeURL = qr
}

func (s *Server) createAlipayPayment(ctx context.Context, order *models.PaymentOrder) error {
	appID := strings.TrimSpace(s.Setting("payment.alipay.appId", ""))
	privateKeyRaw := decryptSecret(s.Setting("payment.alipay.privateKey", ""))
	if appID == "" || privateKeyRaw == "" {
		return errors.New("支付宝 AppID 或应用私钥尚未配置")
	}
	privateKey, err := parseRSAPrivateKey(privateKeyRaw)
	if err != nil {
		return fmt.Errorf("支付宝应用私钥格式错误：%w", err)
	}
	bizContent, err := json.Marshal(map[string]string{
		"out_trade_no":     order.OrderNo,
		"total_amount":     formatYuan(order.AmountCents),
		"subject":          truncateRunes("星芒创作积分-"+order.PackageName, 64),
		"timeout_express":  "30m",
		"product_code":     "FACE_TO_FACE_PAYMENT",
		"integration_type": "PCWEB",
	})
	if err != nil {
		return err
	}
	params := map[string]string{
		"app_id":      appID,
		"method":      "alipay.trade.precreate",
		"format":      "JSON",
		"charset":     "utf-8",
		"sign_type":   "RSA2",
		"timestamp":   time.Now().Format("2006-01-02 15:04:05"),
		"version":     "1.0",
		"notify_url":  s.paymentNotifyURL("alipay"),
		"biz_content": string(bizContent),
	}
	signed, err := signAlipayParams(params, privateKey)
	if err != nil {
		return err
	}
	form := url.Values{}
	for key, value := range signed {
		form.Set(key, value)
	}
	gateway := strings.TrimSpace(s.Setting("payment.alipay.gateway", alipayDefaultGateway))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, gateway, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded;charset=utf-8")
	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("连接支付宝开放平台失败：%w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return err
	}
	var envelope struct {
		Response struct {
			Code       string `json:"code"`
			Msg        string `json:"msg"`
			SubCode    string `json:"sub_code"`
			SubMsg     string `json:"sub_msg"`
			OutTradeNo string `json:"out_trade_no"`
			QRCode     string `json:"qr_code"`
		} `json:"alipay_trade_precreate_response"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return fmt.Errorf("支付宝返回数据无法解析（HTTP %d）", resp.StatusCode)
	}
	if envelope.Response.Code != "10000" || envelope.Response.QRCode == "" {
		detail := firstNonEmptyText(envelope.Response.SubMsg, envelope.Response.Msg, truncateRunes(string(raw), 200))
		return fmt.Errorf("支付宝下单失败：%s", detail)
	}
	order.PayMode = "qrcode"
	order.PayURL = envelope.Response.QRCode
	return nil
}

func (s *Server) createWechatPayment(ctx context.Context, order *models.PaymentOrder) error {
	appID := strings.TrimSpace(s.Setting("payment.wechat.appId", ""))
	mchID := strings.TrimSpace(s.Setting("payment.wechat.mchId", ""))
	serialNo := strings.TrimSpace(s.Setting("payment.wechat.serialNo", ""))
	privateKeyRaw := decryptSecret(s.Setting("payment.wechat.privateKey", ""))
	if appID == "" || mchID == "" || serialNo == "" || privateKeyRaw == "" {
		return errors.New("微信支付 AppID、商户号、证书序列号或商户私钥尚未配置")
	}
	privateKey, err := parseRSAPrivateKey(privateKeyRaw)
	if err != nil {
		return fmt.Errorf("微信商户私钥格式错误：%w", err)
	}
	bodyPayload := map[string]interface{}{
		"appid":        appID,
		"mchid":        mchID,
		"description":  truncateRunes("星芒创作积分-"+order.PackageName, 127),
		"out_trade_no": order.OrderNo,
		"notify_url":   s.paymentNotifyURL("wechat"),
		"amount": map[string]interface{}{
			"total":    order.AmountCents,
			"currency": "CNY",
		},
	}
	body, err := json.Marshal(bodyPayload)
	if err != nil {
		return err
	}
	path := "/v3/pay/transactions/native"
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	nonce, err := randomNonce()
	if err != nil {
		return err
	}
	message := http.MethodPost + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + string(body) + "\n"
	signature, err := rsaSignSHA256(privateKey, message)
	if err != nil {
		return err
	}
	authorization := fmt.Sprintf(
		`WECHATPAY2-SHA256-RSA2048 mchid="%s",nonce_str="%s",timestamp="%s",serial_no="%s",signature="%s"`,
		mchID, nonce, timestamp, serialNo, signature,
	)
	apiBase := strings.TrimRight(strings.TrimSpace(s.Setting("payment.wechat.apiBase", wechatDefaultAPIBase)), "/")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiBase+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", authorization)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "SparkStudio/1.0")
	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("连接微信支付接口失败：%w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return err
	}
	var result struct {
		CodeURL string `json:"code_url"`
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return fmt.Errorf("微信支付返回数据无法解析（HTTP %d）", resp.StatusCode)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || result.CodeURL == "" {
		detail := firstNonEmptyText(result.Message, result.Code, truncateRunes(string(raw), 200))
		return fmt.Errorf("微信支付下单失败：%s", detail)
	}
	order.PayMode = "qrcode"
	order.PayURL = result.CodeURL
	return nil
}

func (s *Server) settlePaidOrder(orderNo, channel, tradeNo string, amountCents int64, via string) (models.PaymentOrder, error) {
	var result models.PaymentOrder
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var order models.PaymentOrder
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("order_no = ?", orderNo).First(&order).Error; err != nil {
			return err
		}
		result = order
		if order.Status == "paid" {
			return nil
		}
		if order.Status != "pending" {
			return fmt.Errorf("订单状态不可入账：%s", order.Status)
		}
		if channel != "" && order.Channel != channel {
			return errors.New("支付渠道与订单不一致")
		}
		if amountCents > 0 && order.AmountCents != amountCents {
			return errors.New("支付金额与订单金额不一致")
		}
		var user models.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, order.UserID).Error; err != nil {
			return err
		}
		credits := order.Credits + order.BonusCredits
		user.Credits += credits
		user.TotalRecharged += credits
		if err := tx.Model(&user).Updates(map[string]interface{}{
			"credits": user.Credits, "total_recharged": user.TotalRecharged,
		}).Error; err != nil {
			return err
		}
		now := time.Now()
		order.Status = "paid"
		order.PaidAt = &now
		order.ExternalTradeNo = tradeNo
		if err := tx.Model(&order).Updates(map[string]interface{}{
			"status": order.Status, "paid_at": order.PaidAt, "external_trade_no": order.ExternalTradeNo,
		}).Error; err != nil {
			return err
		}
		detail, _ := json.Marshal(map[string]interface{}{
			"channel": order.Channel, "amountCents": order.AmountCents, "via": via,
			"tradeNo": tradeNo,
		})
		if err := tx.Create(&models.CreditTransaction{
			UserID: user.ID, Kind: "recharge", BizType: "payment_order", BizID: order.OrderNo,
			DeltaAvailable: credits, BalanceAfter: user.Credits,
			Note:       fmt.Sprintf("%s充值 %d 积分（%s）", paymentChannelLabel(order.Channel), credits, order.PackageName),
			DetailJSON: string(detail),
		}).Error; err != nil {
			return err
		}
		result = order
		return nil
	})
	return result, err
}

func paymentChannelLabel(channel string) string {
	if channel == "alipay" {
		return "支付宝"
	}
	if channel == "wechat" {
		return "微信"
	}
	return channel
}

func verifyAlipayNotify(values url.Values, publicKey *rsa.PublicKey) error {
	signature := strings.TrimSpace(values.Get("sign"))
	if signature == "" {
		return errors.New("回调缺少签名")
	}
	keys := make([]string, 0, len(values))
	for key, list := range values {
		if key == "sign" || key == "sign_type" || len(list) == 0 {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+values.Get(key))
	}
	rawSignature, err := base64.StdEncoding.DecodeString(signature)
	if err != nil {
		return errors.New("回调签名格式无效")
	}
	hashed := sha256.Sum256([]byte(strings.Join(parts, "&")))
	if err := rsa.VerifyPKCS1v15(publicKey, crypto.SHA256, hashed[:], rawSignature); err != nil {
		return errors.New("支付宝回调验签失败")
	}
	return nil
}

func (s *Server) verifyWechatNotify(timestamp, nonce, signature string, body []byte) error {
	if timestamp == "" || nonce == "" || signature == "" {
		return errors.New("微信回调签名头不完整")
	}
	unixTimestamp, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || absInt64(time.Now().Unix()-unixTimestamp) > 300 {
		return errors.New("微信回调时间戳已失效")
	}
	publicKeyRaw := decryptSecret(s.Setting("payment.wechat.platformPublicKey", ""))
	if publicKeyRaw == "" {
		return errors.New("尚未配置微信支付平台公钥")
	}
	publicKey, err := parseRSAPublicKey(publicKeyRaw)
	if err != nil {
		return fmt.Errorf("微信支付平台公钥格式错误：%w", err)
	}
	rawSignature, err := base64.StdEncoding.DecodeString(signature)
	if err != nil {
		return errors.New("微信回调签名格式无效")
	}
	message := timestamp + "\n" + nonce + "\n" + string(body) + "\n"
	hashed := sha256.Sum256([]byte(message))
	if err := rsa.VerifyPKCS1v15(publicKey, crypto.SHA256, hashed[:], rawSignature); err != nil {
		return errors.New("微信回调验签失败")
	}
	return nil
}

func (s *Server) decryptWechatResource(ciphertext, nonce, associatedData string) ([]byte, error) {
	apiV3Key := decryptSecret(s.Setting("payment.wechat.apiV3Key", ""))
	if len(apiV3Key) != 32 {
		return nil, errors.New("微信 APIv3 密钥必须为 32 字节")
	}
	sealed, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return nil, errors.New("微信回调解密数据格式无效")
	}
	block, err := aes.NewCipher([]byte(apiV3Key))
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	plain, err := gcm.Open(nil, []byte(nonce), sealed, []byte(associatedData))
	if err != nil {
		return nil, errors.New("微信回调数据解密失败")
	}
	return plain, nil
}

func signAlipayParams(params map[string]string, privateKey *rsa.PrivateKey) (map[string]string, error) {
	keys := make([]string, 0, len(params))
	for key, value := range params {
		if key == "sign" || strings.TrimSpace(value) == "" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+params[key])
	}
	signature, err := rsaSignSHA256(privateKey, strings.Join(parts, "&"))
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(params)+1)
	for key, value := range params {
		out[key] = value
	}
	out["sign"] = signature
	return out, nil
}

func rsaSignSHA256(privateKey *rsa.PrivateKey, message string) (string, error) {
	hashed := sha256.Sum256([]byte(message))
	signature, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, hashed[:])
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(signature), nil
}

func parseRSAPrivateKey(raw string) (*rsa.PrivateKey, error) {
	der, err := decodePEMOrBase64(raw, "RSA PRIVATE KEY", "PRIVATE KEY")
	if err != nil {
		return nil, err
	}
	if key, err := x509.ParsePKCS8PrivateKey(der); err == nil {
		if rsaKey, ok := key.(*rsa.PrivateKey); ok {
			return rsaKey, nil
		}
	}
	if key, err := x509.ParsePKCS1PrivateKey(der); err == nil {
		return key, nil
	}
	return nil, errors.New("不是有效的 RSA 私钥")
}

func parseRSAPublicKey(raw string) (*rsa.PublicKey, error) {
	der, err := decodePEMOrBase64(raw, "PUBLIC KEY", "RSA PUBLIC KEY", "CERTIFICATE")
	if err != nil {
		return nil, err
	}
	if key, err := x509.ParsePKIXPublicKey(der); err == nil {
		if rsaKey, ok := key.(*rsa.PublicKey); ok {
			return rsaKey, nil
		}
	}
	if key, err := x509.ParsePKCS1PublicKey(der); err == nil {
		return key, nil
	}
	if certificate, err := x509.ParseCertificate(der); err == nil {
		if rsaKey, ok := certificate.PublicKey.(*rsa.PublicKey); ok {
			return rsaKey, nil
		}
	}
	return nil, errors.New("不是有效的 RSA 公钥或证书")
}

func decodePEMOrBase64(raw string, blockTypes ...string) ([]byte, error) {
	value := strings.ReplaceAll(strings.TrimSpace(raw), `\n`, "\n")
	if strings.Contains(value, "BEGIN") {
		for {
			block, rest := pem.Decode([]byte(value))
			if block == nil {
				break
			}
			for _, blockType := range blockTypes {
				if block.Type == blockType {
					return block.Bytes, nil
				}
			}
			value = string(rest)
		}
		return nil, errors.New("PEM 中未找到可用的密钥数据")
	}
	value = strings.Join(strings.Fields(value), "")
	der, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		der, err = base64.RawStdEncoding.DecodeString(value)
	}
	if err != nil {
		return nil, errors.New("密钥不是有效的 Base64 / PEM")
	}
	return der, nil
}

func randomNonce() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", raw), nil
}

func formatYuan(cents int64) string {
	if cents < 0 {
		cents = 0
	}
	return fmt.Sprintf("%d.%02d", cents/100, cents%100)
}

func yuanToCents(value string) (int64, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, errors.New("金额为空")
	}
	parts := strings.SplitN(value, ".", 2)
	yuan, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || yuan < 0 {
		return 0, errors.New("金额格式无效")
	}
	var fraction int64
	if len(parts) == 2 {
		text := parts[1]
		if len(text) > 2 {
			text = text[:2]
		}
		for len(text) < 2 {
			text += "0"
		}
		fraction, err = strconv.ParseInt(text, 10, 64)
		if err != nil {
			return 0, errors.New("金额格式无效")
		}
	}
	total := new(big.Int).Add(
		new(big.Int).Mul(big.NewInt(yuan), big.NewInt(100)),
		big.NewInt(fraction),
	)
	if !total.IsInt64() {
		return 0, errors.New("金额超出范围")
	}
	return total.Int64(), nil
}

func absInt64(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}

func firstNonEmptyText(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
