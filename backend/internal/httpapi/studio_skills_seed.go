package httpapi

import (
	"errors"

	"gorm.io/gorm"

	"sparkstudio/backend/internal/models"
	"sparkstudio/backend/internal/studioskills"
)

func (s *Server) seedBuiltinStudioSkills() error {
	for _, definition := range studioskills.All() {
		var existing models.Skill
		err := s.DB.Where("builtin = ? AND name = ?", true, definition.Name).First(&existing).Error
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			row := models.Skill{
				Name:        definition.Name,
				Description: definition.Description,
				Content:     definition.Content,
				Builtin:     true,
			}
			if err := s.DB.Create(&row).Error; err != nil {
				return err
			}
		case err != nil:
			return err
		default:
			if existing.Description == definition.Description && existing.Content == definition.Content {
				continue
			}
			if err := s.DB.Model(&existing).Updates(map[string]interface{}{
				"description": definition.Description,
				"content":     definition.Content,
			}).Error; err != nil {
				return err
			}
		}
	}
	return nil
}
