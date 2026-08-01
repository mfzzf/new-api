package model

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/pkg/mediapricing"
	"gorm.io/gorm"
)

// MediaBillingPriceRule is the immediately effective administrator pricing
// rule for one public image/video model. Version is monotonic and is copied to
// each reservation so later edits cannot rewrite historical billing facts.
type MediaBillingPriceRule struct {
	ModelName  string `json:"model_name" gorm:"primaryKey;type:varchar(191)"`
	MediaType  string `json:"media_type" gorm:"type:varchar(20);index;not null"`
	Version    int    `json:"version" gorm:"not null;default:1"`
	ConfigJSON string `json:"-" gorm:"type:text;not null"`
	CreatedAt  int64  `json:"created_at" gorm:"index;not null"`
	UpdatedAt  int64  `json:"updated_at" gorm:"not null"`
}

func (record *MediaBillingPriceRule) Rule() (mediapricing.Rule, error) {
	if record == nil {
		return mediapricing.Rule{}, errors.New("media pricing rule is unavailable")
	}
	return mediapricing.Unmarshal([]byte(record.ConfigJSON))
}

func GetMediaBillingPriceRule(modelName string) (*MediaBillingPriceRule, bool, error) {
	var record MediaBillingPriceRule
	err := DB.Where("model_name = ?", modelName).First(&record).Error
	exists, err := RecordExist(err)
	if err != nil || !exists {
		return nil, exists, err
	}
	return &record, true, nil
}

func ListMediaBillingPriceRules() ([]MediaBillingPriceRule, error) {
	var records []MediaBillingPriceRule
	err := DB.Order("model_name ASC").Find(&records).Error
	return records, err
}

func UpsertMediaBillingPriceRule(rule mediapricing.Rule) (*MediaBillingPriceRule, error) {
	body, normalized, err := mediapricing.MarshalCanonical(rule)
	if err != nil {
		return nil, err
	}
	now := time.Now().Unix()
	var saved MediaBillingPriceRule
	err = DB.Transaction(func(tx *gorm.DB) error {
		var current MediaBillingPriceRule
		err := lockForUpdate(tx).
			Where("model_name = ?", normalized.ModelID).
			First(&current).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			saved = MediaBillingPriceRule{
				ModelName:  normalized.ModelID,
				MediaType:  normalized.MediaType,
				Version:    1,
				ConfigJSON: string(body),
				CreatedAt:  now,
				UpdatedAt:  now,
			}
			return tx.Create(&saved).Error
		}
		if err != nil {
			return err
		}
		current.MediaType = normalized.MediaType
		current.ConfigJSON = string(body)
		current.Version++
		current.UpdatedAt = now
		if err := tx.Save(&current).Error; err != nil {
			return err
		}
		saved = current
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &saved, nil
}

func DeleteMediaBillingPriceRule(modelName string) (bool, error) {
	result := DB.Where("model_name = ?", modelName).Delete(&MediaBillingPriceRule{})
	return result.RowsAffected == 1, result.Error
}
