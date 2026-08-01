package service

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRecordMediaBillingConsumptionWritesVideoUsageLog(t *testing.T) {
	truncate(t)
	seedUser(t, 201, 100000)
	seedToken(t, 202, 201, "media-consume-token", 100000)

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("username", "media-user")
	ctx.Set("token_name", "media-token")
	reservation := &model.MediaBillingReservation{
		ID:                   "mb_video_consume",
		UserId:               201,
		TokenId:              202,
		ModelName:            "video-pro",
		MediaType:            "video",
		VideoDurationSeconds: 5,
		VideoSize:            "1280x720",
		Group:                "default",
		Quota:                25000,
		BillingSource:        BillingSourceWallet,
		ModelPrice:           0.025,
		GroupRatio:           1,
	}

	RecordMediaBillingConsumption(ctx, reservation)

	log := getLastLog(t)
	require.NotNil(t, log)
	assert.Equal(t, model.LogTypeConsume, log.Type)
	assert.Equal(t, reservation.UserId, log.UserId)
	assert.Equal(t, reservation.TokenId, log.TokenId)
	assert.Equal(t, reservation.ModelName, log.ModelName)
	assert.Equal(t, reservation.Quota, log.Quota)
	var other map[string]any
	require.NoError(t, json.Unmarshal([]byte(log.Other), &other))
	assert.Equal(t, true, other["is_media"])
	assert.Equal(t, reservation.ID, other["billing_id"])
	assert.Equal(t, "video", other["media_type"])
	assert.Equal(t, float64(5), other["video_duration_seconds"])
	assert.Equal(t, "1280x720", other["video_size"])
	assert.NotContains(t, other, "prompt")
}

func TestRecordMediaBillingRefundWritesMatchingUsageLog(t *testing.T) {
	truncate(t)
	seedUser(t, 211, 100000)
	seedToken(t, 212, 211, "media-refund-token", 100000)
	reservation := &model.MediaBillingReservation{
		ID:                   "mb_video_refund",
		UserId:               211,
		TokenId:              212,
		ModelName:            "video-pro",
		MediaType:            "video",
		VideoDurationSeconds: 8,
		VideoSize:            "1920x1080",
		Group:                "default",
		Quota:                40000,
		BillingSource:        BillingSourceWallet,
		FailureReason:        "provider_failed",
	}

	recordMediaBillingRefund(reservation)

	log := getLastLog(t)
	require.NotNil(t, log)
	assert.Equal(t, model.LogTypeRefund, log.Type)
	assert.Equal(t, reservation.UserId, log.UserId)
	assert.Equal(t, reservation.TokenId, log.TokenId)
	assert.Equal(t, reservation.ModelName, log.ModelName)
	assert.Equal(t, reservation.Quota, log.Quota)
	var other map[string]any
	require.NoError(t, json.Unmarshal([]byte(log.Other), &other))
	assert.Equal(t, true, other["is_media"])
	assert.Equal(t, reservation.ID, other["billing_id"])
	assert.Equal(t, "provider_failed", other["reason"])
	assert.Equal(t, float64(8), other["video_duration_seconds"])
	assert.NotContains(t, other, "prompt")
}
