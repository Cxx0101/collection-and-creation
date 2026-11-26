package httpapi

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"io"
	"os"
	"strings"
)

const encryptedPrefix = "enc:v1:"

func encryptionKey() []byte {
	raw := os.Getenv("DATA_ENCRYPTION_KEY")
	if raw == "" {
		raw = "sparkstudio-local-data-key-change-in-production:" + os.Getenv("JWT_SECRET")
	}
	sum := sha256.Sum256([]byte(raw))
	return sum[:]
}

func encryptSecret(plain string) (string, error) {
	if strings.TrimSpace(plain) == "" {
		return "", nil
	}
	block, err := aes.NewCipher(encryptionKey())
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, nonce, []byte(plain), nil)
	return encryptedPrefix + base64.RawStdEncoding.EncodeToString(nonce) + ":" + base64.RawStdEncoding.EncodeToString(sealed), nil
}

func decryptSecret(stored string) string {
	if stored == "" {
		return ""
	}
	if !strings.HasPrefix(stored, encryptedPrefix) {
		return stored
	}
	parts := strings.Split(strings.TrimPrefix(stored, encryptedPrefix), ":")
	if len(parts) != 2 {
		return ""
	}
	nonce, err := base64.RawStdEncoding.DecodeString(parts[0])
	if err != nil {
		return ""
	}
	data, err := base64.RawStdEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	block, err := aes.NewCipher(encryptionKey())
	if err != nil {
		return ""
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return ""
	}
	plain, err := gcm.Open(nil, nonce, data, nil)
	if err != nil {
		return ""
	}
	return string(plain)
}
