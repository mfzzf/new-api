package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

var (
	ErrMediaBillingReservationNotFound = errors.New("media billing reservation not found")
	ErrMediaBillingAlreadySettled      = errors.New("media billing reservation is already settled")
	ErrMediaBillingAlreadyRefunded     = errors.New("media billing reservation is already refunded")
	ErrMediaBillingTransition          = errors.New("media billing reservation transition is in progress")
)

func RecordMediaBillingConsumption(c *gin.Context, reservation *model.MediaBillingReservation) {
	if c == nil || reservation == nil {
		return
	}
	other := map[string]interface{}{
		"is_media":       true,
		"billing_id":     reservation.ID,
		"media_type":     reservation.MediaType,
		"model_price":    reservation.ModelPrice,
		"group_ratio":    reservation.GroupRatio,
		"billing_source": reservation.BillingSource,
	}
	if reservation.ModelRatio > 0 {
		other["model_ratio"] = reservation.ModelRatio
	}
	if reservation.MediaType == "image" {
		other["image_count"] = reservation.ImageCount
	}
	if reservation.ImageSize != "" {
		other["image_size"] = reservation.ImageSize
	}
	if reservation.ImageQuality != "" {
		other["image_quality"] = reservation.ImageQuality
	}
	if reservation.VideoDurationSeconds > 0 {
		other["video_duration_seconds"] = reservation.VideoDurationSeconds
	}
	if reservation.VideoSize != "" {
		other["video_size"] = reservation.VideoSize
	}
	addMediaPricingLogFields(other, reservation)
	model.RecordConsumeLog(c, reservation.UserId, model.RecordConsumeLogParams{
		ChannelId: 0,
		ModelName: reservation.ModelName,
		TokenName: c.GetString("token_name"),
		Quota:     reservation.Quota,
		Content:   fmt.Sprintf("图/视频数据面预扣并结算，额度 %s", logger.LogQuota(reservation.Quota)),
		TokenId:   reservation.TokenId,
		Group:     reservation.Group,
		Other:     other,
	})
	model.UpdateUserUsedQuotaAndRequestCount(reservation.UserId, reservation.Quota)
}

func SettleMediaBillingReservation(id string) (*model.MediaBillingReservation, error) {
	reservation, exists, err := model.GetMediaBillingReservationByID(strings.TrimSpace(id))
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrMediaBillingReservationNotFound
	}
	switch reservation.Status {
	case model.MediaBillingStatusSettled:
		return reservation, nil
	case model.MediaBillingStatusRefunded:
		return reservation, ErrMediaBillingAlreadyRefunded
	case model.MediaBillingStatusRefunding, model.MediaBillingStatusReserving:
		return reservation, ErrMediaBillingTransition
	case model.MediaBillingStatusReserved:
		won, claimErr := model.ClaimMediaBillingSettlement(reservation.ID)
		if claimErr != nil {
			return nil, claimErr
		}
		if won {
			reservation.Status = model.MediaBillingStatusSettled
			return reservation, nil
		}
	}
	return resolveMediaBillingSettlementRace(reservation.ID)
}

func resolveMediaBillingSettlementRace(id string) (*model.MediaBillingReservation, error) {
	fresh, exists, err := model.GetMediaBillingReservationByID(id)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrMediaBillingReservationNotFound
	}
	switch fresh.Status {
	case model.MediaBillingStatusSettled:
		return fresh, nil
	case model.MediaBillingStatusRefunded:
		return fresh, ErrMediaBillingAlreadyRefunded
	default:
		return fresh, ErrMediaBillingTransition
	}
}

func RefundMediaBillingReservation(
	ctx context.Context,
	id string,
	reason string,
) (*model.MediaBillingReservation, error) {
	reservation, exists, err := model.GetMediaBillingReservationByID(strings.TrimSpace(id))
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrMediaBillingReservationNotFound
	}
	switch reservation.Status {
	case model.MediaBillingStatusRefunded:
		return reservation, nil
	case model.MediaBillingStatusSettled:
		return reservation, ErrMediaBillingAlreadySettled
	case model.MediaBillingStatusRefunding, model.MediaBillingStatusReserving:
		return reservation, ErrMediaBillingTransition
	case model.MediaBillingStatusReserved:
	}

	reason = strings.TrimSpace(reason)
	if len(reason) > 1000 {
		reason = reason[:1000]
	}
	claimed, err := model.ClaimMediaBillingRefund(reservation.ID, reason)
	if err != nil {
		return nil, err
	}
	if !claimed {
		fresh, exists, lookupErr := model.GetMediaBillingReservationByID(reservation.ID)
		if lookupErr != nil {
			return nil, lookupErr
		}
		if !exists {
			return nil, ErrMediaBillingReservationNotFound
		}
		if fresh.Status == model.MediaBillingStatusRefunded {
			return fresh, nil
		}
		if fresh.Status == model.MediaBillingStatusSettled {
			return fresh, ErrMediaBillingAlreadySettled
		}
		return fresh, ErrMediaBillingTransition
	}
	reservation.Status = model.MediaBillingStatusRefunding
	reservation.FailureReason = reason

	if err := refundMediaBillingBalances(ctx, reservation); err != nil {
		_, _ = model.RestoreMediaBillingReservationAfterFailedRefund(reservation.ID)
		reservation.Status = model.MediaBillingStatusReserved
		return reservation, err
	}
	completed, err := model.CompleteMediaBillingRefund(reservation.ID)
	if err != nil {
		return reservation, err
	}
	if !completed {
		return reservation, ErrMediaBillingTransition
	}
	reservation.Status = model.MediaBillingStatusRefunded
	recordMediaBillingRefund(reservation)
	return reservation, nil
}

func refundMediaBillingBalances(ctx context.Context, reservation *model.MediaBillingReservation) error {
	if reservation == nil || reservation.Quota <= 0 {
		return nil
	}
	if err := adjustMediaBillingFunding(reservation, -reservation.Quota); err != nil {
		return fmt.Errorf("refund media billing source: %w", err)
	}
	if reservation.TokenUnlimited {
		return nil
	}
	token, err := model.GetTokenById(reservation.TokenId)
	if err == nil {
		err = model.IncreaseTokenQuota(reservation.TokenId, token.Key, reservation.Quota)
	}
	if err == nil {
		return nil
	}
	if rollbackErr := adjustMediaBillingFunding(reservation, reservation.Quota); rollbackErr != nil {
		common.SysLog(fmt.Sprintf(
			"media billing token refund failed and funding rollback failed (billing_id=%s, token_error=%s, funding_error=%s)",
			reservation.ID,
			err.Error(),
			rollbackErr.Error(),
		))
		return fmt.Errorf("refund token quota: %w (funding rollback also failed: %v)", err, rollbackErr)
	}
	common.SysLog(fmt.Sprintf("media billing token refund failed; funding refund rolled back (billing_id=%s): %s", reservation.ID, err.Error()))
	return fmt.Errorf("refund token quota: %w", err)
}

func adjustMediaBillingFunding(reservation *model.MediaBillingReservation, delta int) error {
	if reservation.BillingSource == BillingSourceSubscription && reservation.SubscriptionId > 0 {
		return model.PostConsumeUserSubscriptionDelta(reservation.SubscriptionId, int64(delta))
	}
	if delta > 0 {
		return model.DecreaseUserQuota(reservation.UserId, delta, false)
	}
	return model.IncreaseUserQuota(reservation.UserId, -delta, false)
}

func recordMediaBillingRefund(reservation *model.MediaBillingReservation) {
	if reservation == nil {
		return
	}
	other := map[string]interface{}{
		"is_media":       true,
		"billing_id":     reservation.ID,
		"media_type":     reservation.MediaType,
		"billing_source": reservation.BillingSource,
		"reason":         reservation.FailureReason,
	}
	if reservation.ImageSize != "" {
		other["image_size"] = reservation.ImageSize
	}
	if reservation.VideoDurationSeconds > 0 {
		other["video_duration_seconds"] = reservation.VideoDurationSeconds
	}
	if reservation.VideoSize != "" {
		other["video_size"] = reservation.VideoSize
	}
	addMediaPricingLogFields(other, reservation)
	model.RecordTaskBillingLog(model.RecordTaskBillingLogParams{
		UserId:    reservation.UserId,
		LogType:   model.LogTypeRefund,
		Content:   "图/视频数据面生成失败退款",
		ChannelId: 0,
		ModelName: reservation.ModelName,
		Quota:     reservation.Quota,
		TokenId:   reservation.TokenId,
		Group:     reservation.Group,
		Other:     other,
		NodeName:  common.NodeName,
	})
}

func addMediaPricingLogFields(other map[string]interface{}, reservation *model.MediaBillingReservation) {
	if other == nil || reservation == nil || reservation.PricingKey == "" {
		return
	}
	other["pricing_mode"] = "template"
	other["pricing_key"] = reservation.PricingKey
	other["pricing_version"] = reservation.PricingVersion
	other["pricing_unit"] = reservation.PricingUnit
	other["pricing_quantity"] = reservation.PricingQuantity
	other["pricing_unit_price"] = reservation.PricingUnitPrice
	other["pricing_currency"] = reservation.PricingCurrency
	other["pricing_amount"] = reservation.PricingAmount
	other["pricing_exchange_rate"] = reservation.PricingExchangeRate
	other["pricing_amount_usd"] = reservation.PricingAmountUSD
	if reservation.BillingDimensions != "" {
		var dimensions map[string]string
		if common.Unmarshal([]byte(reservation.BillingDimensions), &dimensions) == nil {
			other["billing_dimensions"] = dimensions
		}
	}
}
