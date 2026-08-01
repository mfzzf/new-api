package model

import "time"

const (
	MediaBillingStatusReserving = "reserving"
	MediaBillingStatusReserved  = "reserved"
	MediaBillingStatusSettled   = "settled"
	MediaBillingStatusRefunding = "refunding"
	MediaBillingStatusRefunded  = "refunded"
)

// MediaBillingReservation is the durable accounting boundary between the
// DreamTo media data plane and New API. It intentionally stores billing
// dimensions only; prompts, source images, and provider responses must never be
// persisted here.
type MediaBillingReservation struct {
	ID                 string  `json:"id" gorm:"primaryKey;type:varchar(64)"`
	UserId             int     `json:"user_id" gorm:"index;not null"`
	TokenId            int     `json:"token_id" gorm:"index;not null;uniqueIndex:idx_media_billing_token_idempotency,priority:1"`
	TokenUnlimited     bool    `json:"token_unlimited" gorm:"not null;default:false"`
	IdempotencyKeyHash string  `json:"-" gorm:"type:char(64);not null;uniqueIndex:idx_media_billing_token_idempotency,priority:2"`
	RequestFingerprint string  `json:"-" gorm:"type:char(64);not null"`
	ModelName          string  `json:"model_name" gorm:"type:varchar(191);index;not null"`
	MediaType          string  `json:"media_type" gorm:"type:varchar(20);not null"`
	ImageSize          string  `json:"image_size" gorm:"type:varchar(40)"`
	ImageQuality       string  `json:"image_quality" gorm:"type:varchar(40)"`
	ImageCount         int     `json:"image_count" gorm:"not null;default:1"`
	Group              string  `json:"group" gorm:"type:varchar(50);not null"`
	Quota              int     `json:"quota" gorm:"not null;default:0"`
	BillingSource      string  `json:"billing_source" gorm:"type:varchar(20)"`
	SubscriptionId     int     `json:"subscription_id" gorm:"index"`
	ModelPrice         float64 `json:"model_price"`
	ModelRatio         float64 `json:"model_ratio"`
	GroupRatio         float64 `json:"group_ratio"`
	Status             string  `json:"status" gorm:"type:varchar(20);index;not null"`
	FailureReason      string  `json:"failure_reason" gorm:"type:text"`
	CreatedAt          int64   `json:"created_at" gorm:"index;not null"`
	UpdatedAt          int64   `json:"updated_at" gorm:"not null"`
}

func InsertMediaBillingReservation(reservation *MediaBillingReservation) error {
	return DB.Create(reservation).Error
}

func GetMediaBillingReservationByID(id string) (*MediaBillingReservation, bool, error) {
	if id == "" {
		return nil, false, nil
	}
	var reservation MediaBillingReservation
	err := DB.Where("id = ?", id).First(&reservation).Error
	exists, err := RecordExist(err)
	if err != nil || !exists {
		return nil, exists, err
	}
	return &reservation, true, nil
}

func GetMediaBillingReservationByIdempotency(tokenID int, keyHash string) (*MediaBillingReservation, bool, error) {
	if tokenID <= 0 || keyHash == "" {
		return nil, false, nil
	}
	var reservation MediaBillingReservation
	err := DB.Where("token_id = ? AND idempotency_key_hash = ?", tokenID, keyHash).
		First(&reservation).Error
	exists, err := RecordExist(err)
	if err != nil || !exists {
		return nil, exists, err
	}
	return &reservation, true, nil
}

func DeleteReservingMediaBillingReservation(id string) error {
	return DB.Where("id = ? AND status = ?", id, MediaBillingStatusReserving).
		Delete(&MediaBillingReservation{}).Error
}

func ActivateMediaBillingReservation(reservation *MediaBillingReservation) (bool, error) {
	if reservation == nil {
		return false, nil
	}
	result := DB.Model(&MediaBillingReservation{}).
		Where("id = ? AND status = ?", reservation.ID, MediaBillingStatusReserving).
		Updates(map[string]any{
			"quota":           reservation.Quota,
			"billing_source":  reservation.BillingSource,
			"subscription_id": reservation.SubscriptionId,
			"model_price":     reservation.ModelPrice,
			"model_ratio":     reservation.ModelRatio,
			"group_ratio":     reservation.GroupRatio,
			"status":          MediaBillingStatusReserved,
			"updated_at":      time.Now().Unix(),
		})
	return result.RowsAffected == 1, result.Error
}

func ClaimMediaBillingSettlement(id string) (bool, error) {
	result := DB.Model(&MediaBillingReservation{}).
		Where("id = ? AND status = ?", id, MediaBillingStatusReserved).
		Updates(map[string]any{
			"status":     MediaBillingStatusSettled,
			"updated_at": time.Now().Unix(),
		})
	return result.RowsAffected == 1, result.Error
}

func ClaimMediaBillingRefund(id string, reason string) (bool, error) {
	result := DB.Model(&MediaBillingReservation{}).
		Where("id = ? AND status = ?", id, MediaBillingStatusReserved).
		Updates(map[string]any{
			"status":         MediaBillingStatusRefunding,
			"failure_reason": reason,
			"updated_at":     time.Now().Unix(),
		})
	return result.RowsAffected == 1, result.Error
}

func CompleteMediaBillingRefund(id string) (bool, error) {
	result := DB.Model(&MediaBillingReservation{}).
		Where("id = ? AND status = ?", id, MediaBillingStatusRefunding).
		Updates(map[string]any{
			"status":     MediaBillingStatusRefunded,
			"updated_at": time.Now().Unix(),
		})
	return result.RowsAffected == 1, result.Error
}

func RestoreMediaBillingReservationAfterFailedRefund(id string) (bool, error) {
	result := DB.Model(&MediaBillingReservation{}).
		Where("id = ? AND status = ?", id, MediaBillingStatusRefunding).
		Updates(map[string]any{
			"status":     MediaBillingStatusReserved,
			"updated_at": time.Now().Unix(),
		})
	return result.RowsAffected == 1, result.Error
}
