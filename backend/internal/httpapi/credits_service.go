package httpapi

import (
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"sparkstudio/backend/internal/models"
)

var errInsufficientCredits = errors.New("积分余额不足")

// reserveCredits moves credits from the available balance to the frozen balance.
// It must be called inside a transaction so the balance and ledger stay consistent.
func (s *Server) reserveCredits(tx *gorm.DB, userID uint, amount int64, bizType, bizID, note string) error {
	if amount < 0 {
		return errors.New("积分金额无效")
	}
	var user models.User
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, userID).Error; err != nil {
		return err
	}
	if amount == 0 {
		return nil
	}
	if user.Credits < amount {
		return errInsufficientCredits
	}
	user.Credits -= amount
	user.FrozenCredits += amount
	if err := tx.Model(&user).Updates(map[string]interface{}{
		"credits": user.Credits, "frozen_credits": user.FrozenCredits,
	}).Error; err != nil {
		return err
	}
	return tx.Create(&models.CreditTransaction{
		UserID: userID, Kind: "reserve", BizType: bizType, BizID: bizID,
		DeltaAvailable: -amount, DeltaFrozen: amount, BalanceAfter: user.Credits,
		Note: note,
	}).Error
}

// settleCredits deducts the actual amount from frozen credits and returns the rest.
func (s *Server) settleCredits(tx *gorm.DB, userID uint, reserved, actual int64, bizType, bizID, note, detailJSON string) error {
	if actual < 0 {
		actual = 0
	}
	if actual > reserved {
		actual = reserved
	}
	var user models.User
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, userID).Error; err != nil {
		return err
	}
	if user.FrozenCredits < reserved {
		reserved = user.FrozenCredits
		if actual > reserved {
			actual = reserved
		}
	}
	refund := reserved - actual
	user.FrozenCredits -= reserved
	user.Credits += refund
	user.TotalConsumed += actual
	if err := tx.Model(&user).Updates(map[string]interface{}{
		"credits": user.Credits, "frozen_credits": user.FrozenCredits,
		"total_consumed": user.TotalConsumed,
	}).Error; err != nil {
		return err
	}
	return tx.Create(&models.CreditTransaction{
		UserID: userID, Kind: "settle", BizType: bizType, BizID: bizID,
		DeltaAvailable: refund, DeltaFrozen: -reserved, BalanceAfter: user.Credits,
		DeltaConsumed: actual,
		Note:          fmt.Sprintf("%s（实扣 %d，退回 %d）", note, actual, refund), DetailJSON: detailJSON,
	}).Error
}

func (s *Server) refundReserved(tx *gorm.DB, userID uint, reserved int64, bizType, bizID, note string) error {
	return s.settleCredits(tx, userID, reserved, 0, bizType, bizID, note, "")
}
