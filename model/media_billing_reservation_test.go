package model

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestMediaBillingReservationIdempotencyAndTerminalClaims(t *testing.T) {
	truncateTables(t)
	now := time.Now().Unix()
	first := &MediaBillingReservation{
		ID:                 "mb_first",
		UserId:             1,
		TokenId:            11,
		IdempotencyKeyHash: strings.Repeat("a", 64),
		RequestFingerprint: strings.Repeat("b", 64),
		ModelName:          "image-pro",
		MediaType:          "image",
		ImageCount:         1,
		Group:              "default",
		Status:             MediaBillingStatusReserving,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	require.NoError(t, InsertMediaBillingReservation(first))

	duplicate := *first
	duplicate.ID = "mb_duplicate"
	require.Error(t, InsertMediaBillingReservation(&duplicate))

	otherToken := *first
	otherToken.ID = "mb_other_token"
	otherToken.TokenId = 12
	require.NoError(t, InsertMediaBillingReservation(&otherToken))

	first.Quota = 250
	first.BillingSource = "wallet"
	first.ModelPrice = 0.05
	first.GroupRatio = 1
	activated, err := ActivateMediaBillingReservation(first)
	require.NoError(t, err)
	require.True(t, activated)

	settled, err := ClaimMediaBillingSettlement(first.ID)
	require.NoError(t, err)
	require.True(t, settled)
	refunded, err := ClaimMediaBillingRefund(first.ID, "must not win")
	require.NoError(t, err)
	require.False(t, refunded)

	otherToken.Quota = 100
	otherToken.BillingSource = "wallet"
	activated, err = ActivateMediaBillingReservation(&otherToken)
	require.NoError(t, err)
	require.True(t, activated)
	refunded, err = ClaimMediaBillingRefund(otherToken.ID, "provider failed")
	require.NoError(t, err)
	require.True(t, refunded)
	completed, err := CompleteMediaBillingRefund(otherToken.ID)
	require.NoError(t, err)
	require.True(t, completed)
	settled, err = ClaimMediaBillingSettlement(otherToken.ID)
	require.NoError(t, err)
	require.False(t, settled)
}
