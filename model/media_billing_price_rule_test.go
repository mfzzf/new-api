package model

import (
	"testing"

	"github.com/QuantumNous/new-api/pkg/mediapricing"
	"github.com/stretchr/testify/require"
)

func TestMediaBillingPriceRuleUpsertVersionsAndDelete(t *testing.T) {
	truncateTables(t)
	rule := mediapricing.Rule{
		ModelID: "image-priced", MediaType: mediapricing.MediaTypeImage, Enabled: true,
		Unit: mediapricing.UnitImage, Currency: mediapricing.CurrencyCNY,
		Template: "{model_id}", Prices: map[string]string{"image-priced": "0.3"},
	}
	created, err := UpsertMediaBillingPriceRule(rule)
	require.NoError(t, err)
	require.Equal(t, 1, created.Version)

	rule.Prices["image-priced"] = "0.6"
	updated, err := UpsertMediaBillingPriceRule(rule)
	require.NoError(t, err)
	require.Equal(t, 2, updated.Version)
	parsed, err := updated.Rule()
	require.NoError(t, err)
	require.Equal(t, "0.6", parsed.Prices["image-priced"])

	loaded, found, err := GetMediaBillingPriceRule("image-priced")
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, 2, loaded.Version)

	deleted, err := DeleteMediaBillingPriceRule("image-priced")
	require.NoError(t, err)
	require.True(t, deleted)
	_, found, err = GetMediaBillingPriceRule("image-priced")
	require.NoError(t, err)
	require.False(t, found)
}
