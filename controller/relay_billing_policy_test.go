package controller

import (
	"errors"
	"net/http"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/require"
)

func TestApplyRelayPreConsumePolicy(t *testing.T) {
	tests := []struct {
		name string
		mode int
		want bool
	}{
		{
			name: "image generation forces full pre-consume",
			mode: relayconstant.RelayModeImagesGenerations,
			want: true,
		},
		{
			name: "chat completion keeps the default policy",
			mode: relayconstant.RelayModeChatCompletions,
			want: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{RelayMode: test.mode}

			applyRelayPreConsumePolicy(info)

			require.Equal(t, test.want, info.ForcePreConsume)
		})
	}
}

func TestShouldRetryRelayDisablesImageGenerationRetry(t *testing.T) {
	retryableChannelError := types.NewErrorWithStatusCode(
		errors.New("upstream channel failed"),
		types.ErrorCodeChannelInvalidKey,
		http.StatusBadGateway,
	)

	tests := []struct {
		name string
		mode int
		want bool
	}{
		{
			name: "image generation never retries",
			mode: relayconstant.RelayModeImagesGenerations,
			want: false,
		},
		{
			name: "chat completion keeps shared retry policy",
			mode: relayconstant.RelayModeChatCompletions,
			want: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{RelayMode: test.mode}

			got := shouldRetryRelay(nil, info, retryableChannelError, 3)

			require.Equal(t, test.want, got)
		})
	}
}
