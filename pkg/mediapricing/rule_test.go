package mediapricing

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func ptr(value float64) *float64 { return &value }

func TestResolveVideoTemplateByReferenceAndResolution(t *testing.T) {
	rule := Rule{
		ModelID: "video-pro", MediaType: MediaTypeVideo, Enabled: true,
		Unit: UnitSecond, Currency: CurrencyCNY,
		AllowedDuration: []int{4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15},
		Dimensions: []Dimension{
			{
				Source: "input", Field: "has_video_input", Placeholder: "video_input",
				Mapping: map[string]string{"default": "no_video", "false": "no_video", "true": "with_video"},
			},
			{
				Source: "parameters", Field: "resolution", Placeholder: "resolution",
				Mapping: map[string]string{
					"1080P": "1080p", "1080p": "1080p", "720P": "720p", "720p": "720p",
					"480P": "480p", "480p": "480p", "4K": "4k", "4k": "4k", "default": "720p",
				},
			},
		},
		Template: "{model_id}-{video_input}-{resolution}",
		Prices: map[string]string{
			"video-pro-no_video-1080p":   "0.3125",
			"video-pro-no_video-720p":    "0.25",
			"video-pro-no_video-480p":    "0.1875",
			"video-pro-no_video-4k":      "0.5",
			"video-pro-with_video-1080p": "0.45",
			"video-pro-with_video-720p":  "0.35",
			"video-pro-with_video-480p":  "0.28",
			"video-pro-with_video-4k":    "0.7",
		},
	}

	normalized, err := NormalizeAndValidate(rule)
	require.NoError(t, err)
	quote, err := Resolve(normalized, Input{
		ModelID: "video-pro", MediaType: MediaTypeVideo, DurationSeconds: 8,
		Input:      map[string]string{"has_video_input": "true"},
		Parameters: map[string]string{"resolution": "1080P"},
	})
	require.NoError(t, err)
	require.Equal(t, "video-pro-with_video-1080p", quote.PricingKey)
	require.Equal(t, 8, quote.Quantity)
	require.Equal(t, "3.6", quote.Amount.String())
}

func TestResolveImageMegapixelRangeAndCount(t *testing.T) {
	rule := Rule{
		ModelID: "image-pro", MediaType: MediaTypeImage, Enabled: true,
		Unit: UnitImage, Currency: CurrencyCNY,
		Dimensions: []Dimension{{
			Source: "parameters", Field: "megapixels", Placeholder: "dimension",
			Ranges: []NumericRange{
				{LTE: ptr(2.36), Value: "lte_2_36mp"},
				{GT: ptr(2.36), Value: "gt_2_36mp"},
			},
		}},
		Template: "{model_id}-{dimension}",
		Prices: map[string]string{
			"image-pro-lte_2_36mp": "0.3",
			"image-pro-gt_2_36mp":  "0.6",
		},
	}

	quote, err := Resolve(rule, Input{
		ModelID: "image-pro", MediaType: MediaTypeImage, Count: 2,
		Parameters: map[string]string{"megapixels": "3.145728"},
	})
	require.NoError(t, err)
	require.Equal(t, "image-pro-gt_2_36mp", quote.PricingKey)
	require.Equal(t, "1.2", quote.Amount.String())
}

func TestRejectsDurationOutsideAllowlist(t *testing.T) {
	rule := Rule{
		ModelID: "video", MediaType: MediaTypeVideo, Enabled: true,
		Unit: UnitSecond, Currency: CurrencyUSD,
		AllowedDuration: []int{4, 8}, Template: "{model_id}",
		Prices: map[string]string{"video": "0.1"},
	}
	_, err := Resolve(rule, Input{ModelID: "video", MediaType: MediaTypeVideo, DurationSeconds: 5, Count: 1})
	require.ErrorContains(t, err, "not allowed")
}

func TestRejectsMissingPriceMatrixCombination(t *testing.T) {
	rule := Rule{
		ModelID: "video", MediaType: MediaTypeVideo, Enabled: true,
		Unit: UnitSecond, Currency: CurrencyUSD,
		Dimensions: []Dimension{{
			Source: "parameters", Field: "tier", Placeholder: "tier",
			Mapping: map[string]string{"pro": "pro", "std": "std"},
		}},
		Template: "{model_id}-{tier}",
		Prices:   map[string]string{"video-pro": "0.8"},
	}
	_, err := NormalizeAndValidate(rule)
	require.ErrorContains(t, err, "exactly 2")
}

func TestRejectsUnboundedAccountingField(t *testing.T) {
	rule := Rule{
		ModelID: "image", MediaType: MediaTypeImage, Enabled: true,
		Unit: UnitImage, Currency: CurrencyUSD,
		Dimensions: []Dimension{{
			Source: "input", Field: "prompt", Placeholder: "prompt",
			Mapping: map[string]string{"default": "x"},
		}},
		Template: "{model_id}-{prompt}", Prices: map[string]string{"image-x": "1"},
	}
	_, err := NormalizeAndValidate(rule)
	require.ErrorContains(t, err, "not an allowed billing dimension")
}

func TestRejectsNonFiniteNumericBillingInput(t *testing.T) {
	rule := Rule{
		ModelID: "image", MediaType: MediaTypeImage, Enabled: true,
		Unit: UnitImage, Currency: CurrencyUSD,
		Dimensions: []Dimension{{
			Source: "parameters", Field: "megapixels", Placeholder: "dimension",
			Ranges: []NumericRange{{GT: ptr(0), Value: "positive"}},
		}},
		Template: "{model_id}-{dimension}",
		Prices:   map[string]string{"image-positive": "0.3"},
	}

	_, err := Resolve(rule, Input{
		ModelID: "image", MediaType: MediaTypeImage, Count: 1,
		Parameters: map[string]string{"megapixels": "NaN"},
	})
	require.ErrorContains(t, err, "must be numeric")
}
