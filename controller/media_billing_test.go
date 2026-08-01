package controller

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNormalizeMediaBillingDimensionsAddsCanonicalVideoFacts(t *testing.T) {
	request := mediaBillingReserveRequest{
		MediaType: "video", N: 1, Size: "1920x1080", DurationSeconds: 8,
		Input:      map[string]string{"has_video_input": "true"},
		Parameters: map[string]string{"tier": "Pro", "megapixels": "2.073600"},
	}
	require.NoError(t, normalizeMediaBillingDimensions(&request))
	require.Equal(t, "1920x1080", request.Parameters["resolution"])
	require.Equal(t, "8", request.Parameters["duration_seconds"])
	require.Equal(t, "8", request.Parameters["seconds"])
	require.Equal(t, "1", request.Parameters["image_count"])
	require.Equal(t, "true", request.Input["has_video_input"])
}

func TestNormalizeMediaBillingDimensionsRejectsPayloadFields(t *testing.T) {
	request := mediaBillingReserveRequest{
		MediaType: "image", N: 1,
		Input: map[string]string{"prompt": "must remain in the media IDC"},
	}
	err := normalizeMediaBillingDimensions(&request)
	require.ErrorContains(t, err, "not an allowed billing dimension")
}
