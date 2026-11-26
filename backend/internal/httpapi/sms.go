package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"
)

func newSmsCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func sendSmsCode(ctx context.Context, phone, code, configuredSignName, configuredTemplateCode string) error {
	accessKey := strings.TrimSpace(os.Getenv("SMS_ACCESS_KEY_ID"))
	secretKey := strings.TrimSpace(os.Getenv("SMS_ACCESS_KEY_SECRET"))
	signName := strings.TrimSpace(configuredSignName)
	if signName == "" {
		signName = strings.TrimSpace(os.Getenv("SMS_SIGN_NAME"))
	}
	templateCode := strings.TrimSpace(configuredTemplateCode)
	if templateCode == "" {
		templateCode = strings.TrimSpace(os.Getenv("SMS_TEMPLATE_CODE"))
	}
	if accessKey == "" || secretKey == "" || signName == "" || templateCode == "" {
		return errors.New("尚未配置短信服务商参数，请联系管理员关闭短信验证码或配置 SMS_ACCESS_KEY_ID / SMS_ACCESS_KEY_SECRET / SMS_SIGN_NAME / SMS_TEMPLATE_CODE")
	}
	paramName := defaultStr(os.Getenv("SMS_TEMPLATE_PARAM_NAME"), "code")
	templateParam, _ := json.Marshal(map[string]string{paramName: code})
	params := map[string]string{
		"AccessKeyId":      accessKey,
		"Action":           "SendSms",
		"Format":           "JSON",
		"PhoneNumbers":     phone,
		"RegionId":         defaultStr(os.Getenv("SMS_REGION_ID"), "cn-hangzhou"),
		"SignName":         signName,
		"SignatureMethod":  "HMAC-SHA1",
		"SignatureNonce":   fmt.Sprintf("%d", time.Now().UnixNano()),
		"SignatureVersion": "1.0",
		"TemplateCode":     templateCode,
		"TemplateParam":    string(templateParam),
		"Timestamp":        time.Now().UTC().Format("2006-01-02T15:04:05Z"),
		"Version":          "2017-05-25",
	}
	keys := make([]string, 0, len(params))
	for key := range params {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, smsPercentEncode(key)+"="+smsPercentEncode(params[key]))
	}
	stringToSign := "GET&%2F&" + smsPercentEncode(strings.Join(parts, "&"))
	mac := hmac.New(sha1.New, []byte(secretKey+"&"))
	_, _ = mac.Write([]byte(stringToSign))
	params["Signature"] = base64.StdEncoding.EncodeToString(mac.Sum(nil))
	query := url.Values{}
	for key, value := range params {
		query.Set(key, value)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://dysmsapi.aliyuncs.com/?"+query.Encode(), nil)
	if err != nil {
		return err
	}
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("短信网关连接失败：%w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	var result struct {
		Code    string `json:"Code"`
		Message string `json:"Message"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return fmt.Errorf("短信网关返回无法解析（HTTP %d）", resp.StatusCode)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || result.Code != "OK" {
		return fmt.Errorf("短信发送失败：%s", firstNonEmptyText(result.Message, result.Code))
	}
	return nil
}

func smsPercentEncode(value string) string {
	encoded := url.QueryEscape(value)
	encoded = strings.ReplaceAll(encoded, "+", "%20")
	encoded = strings.ReplaceAll(encoded, "*", "%2A")
	encoded = strings.ReplaceAll(encoded, "%7E", "~")
	return encoded
}
