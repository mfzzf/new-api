package controller

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayhelper "github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

const (
	maxMediaBillingIdempotencyBytes = 256
	mediaBillingFingerprintBytes    = 32
)

type mediaBillingReserveRequest struct {
	IdempotencyKey     string `json:"idempotency_key"`
	RequestFingerprint string `json:"request_fingerprint"`
	MediaType          string `json:"media_type"`
	Model              string `json:"model"`
	N                  int    `json:"n"`
	Size               string `json:"size"`
	Quality            string `json:"quality"`
	DurationSeconds    int    `json:"duration_seconds"`
}

type mediaBillingRefundRequest struct {
	Reason string `json:"reason"`
}

type mediaBillingResponse struct {
	BillingID string `json:"billing_id"`
	Status    string `json:"status"`
	Quota     int    `json:"quota"`
	UserID    int    `json:"user_id"`
	TokenID   int    `json:"token_id"`
}

type mediaBillingPrincipalResponse struct {
	UserID  int `json:"user_id"`
	TokenID int `json:"token_id"`
}

func ReserveMediaBilling(c *gin.Context) {
	var request mediaBillingReserveRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeMediaBillingError(c, http.StatusBadRequest, "invalid_media_billing_request", "media billing request must be valid JSON")
		return
	}
	request.IdempotencyKey = strings.TrimSpace(request.IdempotencyKey)
	request.RequestFingerprint = strings.ToLower(strings.TrimSpace(request.RequestFingerprint))
	request.MediaType = strings.ToLower(strings.TrimSpace(request.MediaType))
	request.Model = strings.TrimSpace(request.Model)
	request.Size = strings.TrimSpace(request.Size)
	request.Quality = strings.TrimSpace(request.Quality)
	if request.IdempotencyKey == "" || len(request.IdempotencyKey) > maxMediaBillingIdempotencyBytes {
		writeMediaBillingError(c, http.StatusBadRequest, "invalid_idempotency_key", "idempotency_key is required and must not exceed 256 bytes")
		return
	}
	if !validMediaBillingFingerprint(request.RequestFingerprint) {
		writeMediaBillingError(c, http.StatusBadRequest, "invalid_request_fingerprint", "request_fingerprint must be a lowercase SHA-256 digest")
		return
	}
	if request.MediaType != "image" && request.MediaType != "video" {
		writeMediaBillingError(c, http.StatusBadRequest, "unsupported_media_type", "media_type must be image or video")
		return
	}
	if request.Model == "" || len(request.Model) > 191 {
		writeMediaBillingError(c, http.StatusBadRequest, "invalid_model", "model is required and must not exceed 191 bytes")
		return
	}
	if request.N == 0 {
		request.N = 1
	}
	if request.N != 1 {
		writeMediaBillingError(c, http.StatusBadRequest, "invalid_media_count", "n must be 1")
		return
	}
	if len(request.Size) > 40 || len(request.Quality) > 40 {
		writeMediaBillingError(c, http.StatusBadRequest, "invalid_media_dimensions", "size and quality must not exceed 40 bytes")
		return
	}
	if request.MediaType == "image" && request.DurationSeconds != 0 {
		writeMediaBillingError(c, http.StatusBadRequest, "invalid_image_duration", "duration_seconds is not supported for image billing")
		return
	}
	if request.MediaType == "video" &&
		(request.DurationSeconds < 1 || request.DurationSeconds > relaycommon.MaxTaskDurationSeconds) {
		writeMediaBillingError(
			c,
			http.StatusBadRequest,
			"invalid_video_duration",
			fmt.Sprintf("duration_seconds must be between 1 and %d", relaycommon.MaxTaskDurationSeconds),
		)
		return
	}
	if !middleware.ValidateTokenModelAccess(c, request.Model) {
		return
	}

	tokenID := common.GetContextKeyInt(c, constant.ContextKeyTokenId)
	keyHash := sha256.Sum256([]byte(request.IdempotencyKey))
	keyHashString := hex.EncodeToString(keyHash[:])
	if replayed, handled := replayMediaBillingReservation(c, tokenID, keyHashString, request.RequestFingerprint); handled {
		if replayed != nil {
			writeMediaBillingReservation(c, replayed)
		}
		return
	}

	usingGroup := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	if usingGroup == "" || usingGroup == "auto" {
		usingGroup = userGroup
		common.SetContextKey(c, constant.ContextKeyUsingGroup, usingGroup)
	}
	common.SetContextKey(c, constant.ContextKeyOriginalModel, request.Model)
	common.SetContextKey(c, constant.ContextKeyRequestStartTime, time.Now())
	n := uint(request.N)
	imageRequest := &dto.ImageRequest{
		Model:   request.Model,
		Prompt:  "",
		N:       &n,
		Size:    request.Size,
		Quality: request.Quality,
	}
	relayInfo := relaycommon.GenRelayInfoImage(c, imageRequest)
	relayInfo.ForcePreConsume = true
	var priceData types.PriceData
	var err error
	if request.MediaType == "image" {
		priceData, err = relayhelper.ModelPriceHelper(c, relayInfo, 0, imageRequest.GetTokenCountMeta())
	} else {
		priceData, err = relayhelper.ModelPriceHelperPerCall(c, relayInfo)
		if err == nil {
			priceData.AddOtherRatio("seconds", float64(request.DurationSeconds))
			sizeRatio := 1.0
			if request.Size == "1792x1024" || request.Size == "1024x1792" {
				sizeRatio = 1.666667
			}
			priceData.AddOtherRatio("size", sizeRatio)
			priceData.Quota, err = common.QuotaFromFloatStrict(
				priceData.ApplyOtherRatiosToFloat(float64(priceData.Quota)),
			)
			priceData.QuotaToPreConsume = priceData.Quota
		}
	}
	if err != nil {
		writeMediaBillingError(c, http.StatusBadRequest, "media_model_price_error", err.Error())
		return
	}
	if !priceData.UsePrice {
		writeMediaBillingError(c, http.StatusBadRequest, "media_model_fixed_price_required", "media model must have a fixed ModelPrice in New API")
		return
	}

	imageSize := ""
	imageQuality := ""
	videoSize := ""
	if request.MediaType == "image" {
		imageSize = request.Size
		imageQuality = request.Quality
	} else {
		videoSize = request.Size
	}

	now := time.Now().Unix()
	reservation := &model.MediaBillingReservation{
		ID:                   "mb_" + common.GetUUID(),
		UserId:               relayInfo.UserId,
		TokenId:              relayInfo.TokenId,
		TokenUnlimited:       relayInfo.TokenUnlimited,
		IdempotencyKeyHash:   keyHashString,
		RequestFingerprint:   request.RequestFingerprint,
		ModelName:            request.Model,
		MediaType:            request.MediaType,
		ImageSize:            imageSize,
		ImageQuality:         imageQuality,
		ImageCount:           request.N,
		VideoDurationSeconds: request.DurationSeconds,
		VideoSize:            videoSize,
		Group:                relayInfo.UsingGroup,
		Status:               model.MediaBillingStatusReserving,
		CreatedAt:            now,
		UpdatedAt:            now,
	}
	if err := model.InsertMediaBillingReservation(reservation); err != nil {
		if replayed, handled := replayMediaBillingReservation(c, tokenID, keyHashString, request.RequestFingerprint); handled {
			if replayed != nil {
				writeMediaBillingReservation(c, replayed)
			}
			return
		}
		writeMediaBillingError(c, http.StatusInternalServerError, "media_billing_persist_failed", "failed to create media billing reservation")
		return
	}

	if !priceData.FreeModel {
		if apiErr := service.PreConsumeBilling(c, priceData.QuotaToPreConsume, relayInfo); apiErr != nil {
			_ = model.DeleteReservingMediaBillingReservation(reservation.ID)
			c.JSON(apiErr.StatusCode, gin.H{"error": apiErr.ToOpenAIError()})
			return
		}
		reservation.Quota = relayInfo.Billing.GetPreConsumedQuota()
		reservation.BillingSource = relayInfo.BillingSource
		reservation.SubscriptionId = relayInfo.SubscriptionId
	} else {
		reservation.Quota = 0
		reservation.BillingSource = "free"
	}
	reservation.ModelPrice = priceData.ModelPrice
	reservation.ModelRatio = priceData.ModelRatio
	reservation.GroupRatio = priceData.GroupRatioInfo.GroupRatio
	activated, activateErr := model.ActivateMediaBillingReservation(reservation)
	if activateErr != nil || !activated {
		if billingSession, ok := relayInfo.Billing.(*service.BillingSession); ok {
			_ = billingSession.RefundSync(c)
		}
		_ = model.DeleteReservingMediaBillingReservation(reservation.ID)
		writeMediaBillingError(c, http.StatusInternalServerError, "media_billing_persist_failed", "failed to activate media billing reservation")
		return
	}
	reservation.Status = model.MediaBillingStatusReserved
	if relayInfo.Billing != nil {
		if err := service.SettleBilling(c, relayInfo, reservation.Quota); err != nil {
			_, _ = service.RefundMediaBillingReservation(c.Request.Context(), reservation.ID, "failed to transfer media billing reservation")
			writeMediaBillingError(c, http.StatusInternalServerError, "media_billing_settle_failed", "failed to persist media billing charge")
			return
		}
	}
	service.RecordMediaBillingConsumption(c, reservation)
	writeMediaBillingReservation(c, reservation)
}

func GetMediaBillingPrincipal(c *gin.Context) {
	userID := common.GetContextKeyInt(c, constant.ContextKeyUserId)
	tokenID := common.GetContextKeyInt(c, constant.ContextKeyTokenId)
	if userID <= 0 || tokenID <= 0 {
		writeMediaBillingError(
			c,
			http.StatusInternalServerError,
			"media_principal_unavailable",
			"authenticated media principal is unavailable",
		)
		return
	}
	c.JSON(http.StatusOK, mediaBillingPrincipalResponse{UserID: userID, TokenID: tokenID})
}

func SettleMediaBilling(c *gin.Context) {
	reservation, err := service.SettleMediaBillingReservation(c.Param("id"))
	if err != nil {
		writeMediaBillingServiceError(c, err)
		return
	}
	writeMediaBillingReservation(c, reservation)
}

func RefundMediaBilling(c *gin.Context) {
	var request mediaBillingRefundRequest
	if c.Request.ContentLength != 0 {
		if err := c.ShouldBindJSON(&request); err != nil {
			writeMediaBillingError(c, http.StatusBadRequest, "invalid_media_billing_refund", "refund request must be valid JSON")
			return
		}
	}
	reservation, err := service.RefundMediaBillingReservation(c.Request.Context(), c.Param("id"), request.Reason)
	if err != nil {
		writeMediaBillingServiceError(c, err)
		return
	}
	writeMediaBillingReservation(c, reservation)
}

func replayMediaBillingReservation(
	c *gin.Context,
	tokenID int,
	keyHash string,
	fingerprint string,
) (*model.MediaBillingReservation, bool) {
	reservation, exists, err := model.GetMediaBillingReservationByIdempotency(tokenID, keyHash)
	if err != nil {
		writeMediaBillingError(c, http.StatusInternalServerError, "media_billing_lookup_failed", "failed to look up media billing reservation")
		return nil, true
	}
	if !exists {
		return nil, false
	}
	if reservation.RequestFingerprint != fingerprint {
		writeMediaBillingError(c, http.StatusConflict, "idempotency_conflict", "idempotency key was already used with a different request")
		return nil, true
	}
	switch reservation.Status {
	case model.MediaBillingStatusReserved, model.MediaBillingStatusSettled:
		return reservation, true
	case model.MediaBillingStatusRefunded:
		writeMediaBillingError(c, http.StatusConflict, "billing_reservation_refunded", "idempotency key belongs to a refunded media request")
	case model.MediaBillingStatusReserving, model.MediaBillingStatusRefunding:
		writeMediaBillingError(c, http.StatusConflict, "billing_reservation_in_progress", "media billing reservation transition is still in progress")
	default:
		writeMediaBillingError(c, http.StatusConflict, "billing_reservation_invalid_state", "media billing reservation has an invalid state")
	}
	return nil, true
}

func validMediaBillingFingerprint(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == mediaBillingFingerprintBytes && value == strings.ToLower(value)
}

func writeMediaBillingReservation(c *gin.Context, reservation *model.MediaBillingReservation) {
	if reservation == nil {
		writeMediaBillingError(c, http.StatusInternalServerError, "media_billing_missing", "media billing reservation is unavailable")
		return
	}
	c.JSON(http.StatusOK, mediaBillingResponse{
		BillingID: reservation.ID,
		Status:    reservation.Status,
		Quota:     reservation.Quota,
		UserID:    reservation.UserId,
		TokenID:   reservation.TokenId,
	})
}

func writeMediaBillingServiceError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrMediaBillingReservationNotFound):
		writeMediaBillingError(c, http.StatusNotFound, "media_billing_not_found", err.Error())
	case errors.Is(err, service.ErrMediaBillingAlreadySettled),
		errors.Is(err, service.ErrMediaBillingAlreadyRefunded),
		errors.Is(err, service.ErrMediaBillingTransition):
		writeMediaBillingError(c, http.StatusConflict, "media_billing_conflict", err.Error())
	default:
		writeMediaBillingError(c, http.StatusInternalServerError, "media_billing_internal_error", "media billing operation failed")
	}
}

func writeMediaBillingError(c *gin.Context, status int, code string, message string) {
	c.JSON(status, gin.H{"error": types.OpenAIError{
		Message: message,
		Type:    "invalid_request_error",
		Code:    code,
	}})
}
