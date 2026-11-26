package httpapi

import (
	"strings"
	"testing"
)

func TestFyepaySignMatchesSortedNonEmptyPayload(t *testing.T) {
	t.Parallel()

	payload := map[string]string{
		"sign":         "ignored",
		"service":      "unified",
		"mchId":        "2007031234",
		"thirdOrderNo": "1602662736629",
		"payType":      "1",
		"money":        "0.01",
		"tradeType":    "2",
		"tradeIp":      "125.77.85.189",
		"storeId":      "1",
		"nonceStr":     "abc",
		"expireIn":     "5",
		"attach":       "just test",
		"emptyField":   "",
	}

	const expected = "73a69e63ccb9329dfce2982987b6cede"
	if sign := fyepaySign(payload, "test-secret"); sign != expected {
		t.Fatalf("unexpected signature: got %s want %s", sign, expected)
	}
}

func TestVerifyFyepaySignature(t *testing.T) {
	t.Parallel()

	payload := map[string]string{
		"mchId":        "2007031234",
		"thirdOrderNo": "1602662736629",
		"service":      "query",
		"nonceStr":     "nonce",
	}
	payload["sign"] = fyepaySign(payload, "test-secret")

	if err := verifyFyepaySignature(payload, "test-secret"); err != nil {
		t.Fatalf("valid signature rejected: %v", err)
	}
	payload["thirdOrderNo"] = "tampered"
	if err := verifyFyepaySignature(payload, "test-secret"); err == nil {
		t.Fatal("tampered payload accepted")
	}
}

func TestFyepayParamsNormalizesProviderJSON(t *testing.T) {
	t.Parallel()

	params, err := fyepayParams([]byte(`{
		"code": "00000",
		"thirdOrderNo": 1602662736629,
		"money": 0.01,
		"payTime": null,
		"jspayInfo": {"appId": "wx-demo", "timeStamp": 1602759420}
	}`))
	if err != nil {
		t.Fatalf("parse payload: %v", err)
	}
	if params["code"] != "00000" || params["thirdOrderNo"] != "1602662736629" || params["money"] != "0.01" {
		t.Fatalf("unexpected scalar values: %#v", params)
	}
	if _, exists := params["payTime"]; exists {
		t.Fatal("null field should be omitted")
	}
	if !strings.Contains(params["jspayInfo"], `"appId":"wx-demo"`) {
		t.Fatalf("nested JSON was not compacted: %s", params["jspayInfo"])
	}
}

func TestFyepayChannelMapping(t *testing.T) {
	t.Parallel()

	for channel, payType := range map[string]string{"alipay": "1", "wechat": "2"} {
		got, err := fyepayPayType(channel)
		if err != nil || got != payType {
			t.Fatalf("pay type for %s: got %s err %v", channel, got, err)
		}
		if mapped := fyepayChannel(payType); mapped != channel {
			t.Fatalf("channel for %s: got %s want %s", payType, mapped, channel)
		}
	}
	if _, err := fyepayPayType("unionpay"); err == nil {
		t.Fatal("unsupported channel should be rejected")
	}
}
