package httpapi

import (
	"strconv"

	"sparkstudio/backend/internal/models"
)

func (s *Server) Setting(key, def string) string {
	var v models.SystemSetting
	if err := s.DB.Where("`key` = ?", key).First(&v).Error; err != nil {
		return def
	}
	if v.Value == "" {
		return def
	}
	return v.Value
}

func (s *Server) SetSetting(key, value string) error {
	return s.DB.Save(&models.SystemSetting{Key: key, Value: value}).Error
}

func (s *Server) SettingBool(key string, def bool) bool {
	v := s.Setting(key, strconv.FormatBool(def))
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

func (s *Server) SettingInt(key string, def int64) int64 {
	v := s.Setting(key, strconv.FormatInt(def, 10))
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return def
	}
	return n
}
