// Package mediapricing implements the restricted, deterministic pricing
// templates used by DreamTo image and video requests. It deliberately accepts
// only a small billing-dimension vocabulary; prompts and media payloads must
// never enter this package or the New API billing database.
package mediapricing

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
)

const (
	MediaTypeImage = "image"
	MediaTypeVideo = "video"
	UnitImage      = "image"
	UnitSecond     = "second"
	CurrencyUSD    = "USD"
	CurrencyCNY    = "CNY"

	maxDimensions          = 6
	maxDimensionValues     = 64
	maxGeneratedPriceKeys  = 256
	maxTemplateBytes       = 512
	maxDimensionValueBytes = 80
)

var (
	placeholderPattern = regexp.MustCompile(`\{([a-z][a-z0-9_]*)\}`)
	safeValuePattern   = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
	allowedFields      = map[string]map[string]bool{
		"input": {
			"has_image_input": true,
			"has_video_input": true,
		},
		"parameters": {
			"resolution":       true,
			"size":             true,
			"quality":          true,
			"tier":             true,
			"megapixels":       true,
			"duration":         true,
			"duration_seconds": true,
			"seconds":          true,
			"image_count":      true,
		},
	}
)

// NumericRange maps a numeric input to one template value. Boundaries are
// optional, but at least one must be present. The combination is useful for
// rules such as megapixels <= 2.36 and megapixels > 2.36.
type NumericRange struct {
	GT    *float64 `json:"gt,omitempty"`
	GTE   *float64 `json:"gte,omitempty"`
	LT    *float64 `json:"lt,omitempty"`
	LTE   *float64 `json:"lte,omitempty"`
	Value string   `json:"value"`
}

// Dimension resolves one bounded request field into a template placeholder.
// Exactly one of Mapping or Ranges must be configured.
type Dimension struct {
	Source      string            `json:"source"`
	Field       string            `json:"field"`
	Placeholder string            `json:"placeholder"`
	Mapping     map[string]string `json:"mapping,omitempty"`
	Ranges      []NumericRange    `json:"ranges,omitempty"`
}

// Rule is the administrator-owned pricing definition for one public model.
// Prices are decimal strings in Currency, keyed by the rendered Template.
type Rule struct {
	ModelID         string            `json:"model_id"`
	MediaType       string            `json:"media_type"`
	Enabled         bool              `json:"enabled"`
	Unit            string            `json:"unit"`
	Currency        string            `json:"currency"`
	AllowedDuration []int             `json:"allowed_duration,omitempty"`
	Dimensions      []Dimension       `json:"dimensions,omitempty"`
	Template        string            `json:"template"`
	Prices          map[string]string `json:"prices"`
}

// Input contains only compact, pre-derived accounting dimensions.
type Input struct {
	ModelID         string
	MediaType       string
	Count           int
	DurationSeconds int
	Input           map[string]string
	Parameters      map[string]string
}

// Quote is the immutable result snapshotted onto a billing reservation.
type Quote struct {
	PricingKey         string            `json:"pricing_key"`
	Unit               string            `json:"unit"`
	Currency           string            `json:"currency"`
	Quantity           int               `json:"quantity"`
	UnitPrice          decimal.Decimal   `json:"-"`
	Amount             decimal.Decimal   `json:"-"`
	ResolvedDimensions map[string]string `json:"resolved_dimensions"`
}

// AllowedField reports whether a runtime-projected accounting field may cross
// the media/New API boundary.
func AllowedField(source, field string) bool {
	return allowedFields[strings.TrimSpace(source)][strings.TrimSpace(field)]
}

// NormalizeAndValidate returns a canonical rule suitable for persistence.
func NormalizeAndValidate(input Rule) (Rule, error) {
	rule := input
	rule.ModelID = strings.TrimSpace(rule.ModelID)
	rule.MediaType = strings.ToLower(strings.TrimSpace(rule.MediaType))
	rule.Unit = strings.ToLower(strings.TrimSpace(rule.Unit))
	rule.Currency = strings.ToUpper(strings.TrimSpace(rule.Currency))
	rule.Template = strings.TrimSpace(rule.Template)
	if rule.ModelID == "" || len(rule.ModelID) > 191 {
		return Rule{}, errors.New("model_id is required and must not exceed 191 bytes")
	}
	if rule.MediaType != MediaTypeImage && rule.MediaType != MediaTypeVideo {
		return Rule{}, errors.New("media_type must be image or video")
	}
	wantUnit := UnitImage
	if rule.MediaType == MediaTypeVideo {
		wantUnit = UnitSecond
	}
	if rule.Unit != wantUnit {
		return Rule{}, fmt.Errorf("unit must be %s for %s pricing", wantUnit, rule.MediaType)
	}
	if rule.Currency != CurrencyUSD && rule.Currency != CurrencyCNY {
		return Rule{}, errors.New("currency must be USD or CNY")
	}
	if rule.Template == "" || len(rule.Template) > maxTemplateBytes {
		return Rule{}, fmt.Errorf("template is required and must not exceed %d bytes", maxTemplateBytes)
	}
	if len(rule.Dimensions) > maxDimensions {
		return Rule{}, fmt.Errorf("at most %d dimensions are allowed", maxDimensions)
	}

	durations, err := normalizeDurations(rule.MediaType, rule.AllowedDuration)
	if err != nil {
		return Rule{}, err
	}
	rule.AllowedDuration = durations

	placeholders := map[string]bool{"model_id": true}
	for index := range rule.Dimensions {
		dimension, err := normalizeDimension(rule.Dimensions[index])
		if err != nil {
			return Rule{}, fmt.Errorf("dimension %d: %w", index+1, err)
		}
		if placeholders[dimension.Placeholder] {
			return Rule{}, fmt.Errorf("dimension placeholder %q is duplicated", dimension.Placeholder)
		}
		placeholders[dimension.Placeholder] = true
		rule.Dimensions[index] = dimension
	}

	seenTemplatePlaceholders := map[string]bool{}
	for _, match := range placeholderPattern.FindAllStringSubmatch(rule.Template, -1) {
		seenTemplatePlaceholders[match[1]] = true
		if !placeholders[match[1]] {
			return Rule{}, fmt.Errorf("template uses undeclared placeholder %q", match[1])
		}
	}
	if !seenTemplatePlaceholders["model_id"] {
		return Rule{}, errors.New("template must contain {model_id}")
	}
	for placeholder := range placeholders {
		if !seenTemplatePlaceholders[placeholder] {
			return Rule{}, fmt.Errorf("template must contain {%s}", placeholder)
		}
	}
	if stripped := placeholderPattern.ReplaceAllString(rule.Template, ""); strings.ContainsAny(stripped, "{}") {
		return Rule{}, errors.New("template contains an invalid placeholder")
	}

	keys, err := ExpectedPriceKeys(rule)
	if err != nil {
		return Rule{}, err
	}
	if len(rule.Prices) != len(keys) {
		return Rule{}, fmt.Errorf("prices must contain exactly %d generated keys", len(keys))
	}
	normalizedPrices := make(map[string]string, len(keys))
	for _, key := range keys {
		raw, ok := rule.Prices[key]
		if !ok {
			return Rule{}, fmt.Errorf("price is missing for %q", key)
		}
		price, err := parsePrice(raw)
		if err != nil {
			return Rule{}, fmt.Errorf("price for %q: %w", key, err)
		}
		normalizedPrices[key] = price.String()
	}
	for key := range rule.Prices {
		if _, ok := normalizedPrices[key]; !ok {
			return Rule{}, fmt.Errorf("price key %q is not generated by template", key)
		}
	}
	rule.Prices = normalizedPrices
	return rule, nil
}

func normalizeDurations(mediaType string, values []int) ([]int, error) {
	if mediaType == MediaTypeImage && len(values) != 0 {
		return nil, errors.New("allowed_duration is only valid for video pricing")
	}
	if len(values) > 3600 {
		return nil, errors.New("allowed_duration contains too many values")
	}
	seen := make(map[int]bool, len(values))
	result := make([]int, 0, len(values))
	for _, value := range values {
		if value < 1 || value > 3600 {
			return nil, errors.New("allowed_duration values must be between 1 and 3600 seconds")
		}
		if !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	sort.Ints(result)
	return result, nil
}

func normalizeDimension(input Dimension) (Dimension, error) {
	dimension := input
	dimension.Source = strings.ToLower(strings.TrimSpace(dimension.Source))
	dimension.Field = strings.ToLower(strings.TrimSpace(dimension.Field))
	dimension.Placeholder = strings.ToLower(strings.TrimSpace(dimension.Placeholder))
	if !AllowedField(dimension.Source, dimension.Field) {
		return Dimension{}, fmt.Errorf("field %s.%s is not an allowed billing dimension", dimension.Source, dimension.Field)
	}
	if !regexp.MustCompile(`^[a-z][a-z0-9_]*$`).MatchString(dimension.Placeholder) || dimension.Placeholder == "model_id" {
		return Dimension{}, errors.New("placeholder must be a lowercase identifier other than model_id")
	}
	if (len(dimension.Mapping) == 0) == (len(dimension.Ranges) == 0) {
		return Dimension{}, errors.New("configure exactly one of mapping or ranges")
	}
	if len(dimension.Mapping) > maxDimensionValues || len(dimension.Ranges) > maxDimensionValues {
		return Dimension{}, fmt.Errorf("at most %d values are allowed", maxDimensionValues)
	}
	if len(dimension.Mapping) > 0 {
		normalized := make(map[string]string, len(dimension.Mapping))
		for rawKey, rawValue := range dimension.Mapping {
			key := strings.TrimSpace(rawKey)
			value := strings.TrimSpace(rawValue)
			if key == "" || len(key) > maxDimensionValueBytes {
				return Dimension{}, errors.New("mapping keys must be non-empty and bounded")
			}
			if err := validateRenderedValue(value); err != nil {
				return Dimension{}, fmt.Errorf("mapping %q: %w", key, err)
			}
			normalized[key] = value
		}
		dimension.Mapping = normalized
	} else {
		for index := range dimension.Ranges {
			rangeValue := &dimension.Ranges[index]
			rangeValue.Value = strings.TrimSpace(rangeValue.Value)
			if err := validateRenderedValue(rangeValue.Value); err != nil {
				return Dimension{}, fmt.Errorf("range %d: %w", index+1, err)
			}
			if err := validateRange(*rangeValue); err != nil {
				return Dimension{}, fmt.Errorf("range %d: %w", index+1, err)
			}
		}
		for left := 0; left < len(dimension.Ranges); left++ {
			for right := left + 1; right < len(dimension.Ranges); right++ {
				if rangesOverlap(dimension.Ranges[left], dimension.Ranges[right]) {
					return Dimension{}, fmt.Errorf("ranges %d and %d overlap", left+1, right+1)
				}
			}
		}
	}
	return dimension, nil
}

func validateRenderedValue(value string) error {
	if value == "" || len(value) > maxDimensionValueBytes || !safeValuePattern.MatchString(value) {
		return errors.New("rendered value must use only letters, digits, dot, underscore, or hyphen")
	}
	return nil
}

func validateRange(value NumericRange) error {
	for _, boundary := range []*float64{value.GT, value.GTE, value.LT, value.LTE} {
		if boundary != nil && (math.IsNaN(*boundary) || math.IsInf(*boundary, 0)) {
			return errors.New("range boundaries must be finite")
		}
	}
	if value.GT != nil && value.GTE != nil || value.LT != nil && value.LTE != nil {
		return errors.New("use only one lower and one upper boundary")
	}
	if value.GT == nil && value.GTE == nil && value.LT == nil && value.LTE == nil {
		return errors.New("at least one boundary is required")
	}
	lower, hasLower, _ := lowerBound(value)
	upper, hasUpper, _ := upperBound(value)
	if hasLower && hasUpper && lower >= upper {
		return errors.New("lower boundary must be less than upper boundary")
	}
	return nil
}

func rangesOverlap(left, right NumericRange) bool {
	leftLow, leftHasLow, leftLowInclusive := lowerBound(left)
	leftHigh, leftHasHigh, leftHighInclusive := upperBound(left)
	rightLow, rightHasLow, rightLowInclusive := lowerBound(right)
	rightHigh, rightHasHigh, rightHighInclusive := upperBound(right)
	if leftHasHigh && rightHasLow {
		if leftHigh < rightLow || leftHigh == rightLow && !(leftHighInclusive && rightLowInclusive) {
			return false
		}
	}
	if rightHasHigh && leftHasLow {
		if rightHigh < leftLow || rightHigh == leftLow && !(rightHighInclusive && leftLowInclusive) {
			return false
		}
	}
	return true
}

func lowerBound(value NumericRange) (float64, bool, bool) {
	if value.GT != nil {
		return *value.GT, true, false
	}
	if value.GTE != nil {
		return *value.GTE, true, true
	}
	return 0, false, false
}

func upperBound(value NumericRange) (float64, bool, bool) {
	if value.LT != nil {
		return *value.LT, true, false
	}
	if value.LTE != nil {
		return *value.LTE, true, true
	}
	return 0, false, false
}

func parsePrice(raw string) (decimal.Decimal, error) {
	value := strings.TrimSpace(raw)
	price, err := decimal.NewFromString(value)
	if err != nil || price.IsNegative() {
		return decimal.Zero, errors.New("must be a non-negative decimal")
	}
	if price.GreaterThan(decimal.NewFromInt(1_000_000)) {
		return decimal.Zero, errors.New("must not exceed 1000000")
	}
	if price.Exponent() < -8 {
		return decimal.Zero, errors.New("must not have more than 8 decimal places")
	}
	return price, nil
}

// ExpectedPriceKeys returns the complete deterministic price matrix generated
// by the rule's dimension output values.
func ExpectedPriceKeys(rule Rule) ([]string, error) {
	combinations := []map[string]string{{}}
	for _, dimension := range rule.Dimensions {
		values := possibleDimensionValues(dimension)
		if len(values) == 0 {
			return nil, fmt.Errorf("dimension %q has no output values", dimension.Placeholder)
		}
		next := make([]map[string]string, 0, len(combinations)*len(values))
		for _, combination := range combinations {
			for _, value := range values {
				copyValue := make(map[string]string, len(combination)+1)
				for key, existing := range combination {
					copyValue[key] = existing
				}
				copyValue[dimension.Placeholder] = value
				next = append(next, copyValue)
				if len(next) > maxGeneratedPriceKeys {
					return nil, fmt.Errorf("pricing matrix exceeds %d keys", maxGeneratedPriceKeys)
				}
			}
		}
		combinations = next
	}
	keys := make([]string, 0, len(combinations))
	for _, values := range combinations {
		values["model_id"] = rule.ModelID
		key := render(rule.Template, values)
		if key == "" || len(key) > maxTemplateBytes {
			return nil, errors.New("rendered price key is empty or too long")
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for index := 1; index < len(keys); index++ {
		if keys[index] == keys[index-1] {
			return nil, fmt.Errorf("multiple dimension combinations render duplicate key %q", keys[index])
		}
	}
	return keys, nil
}

func possibleDimensionValues(dimension Dimension) []string {
	seen := map[string]bool{}
	values := make([]string, 0, len(dimension.Mapping)+len(dimension.Ranges))
	for _, value := range dimension.Mapping {
		if !seen[value] {
			seen[value] = true
			values = append(values, value)
		}
	}
	for _, item := range dimension.Ranges {
		if !seen[item.Value] {
			seen[item.Value] = true
			values = append(values, item.Value)
		}
	}
	sort.Strings(values)
	return values
}

// Resolve validates the request dimensions and returns the configured price.
func Resolve(rule Rule, input Input) (Quote, error) {
	rule, err := NormalizeAndValidate(rule)
	if err != nil {
		return Quote{}, err
	}
	if !rule.Enabled {
		return Quote{}, errors.New("media pricing rule is disabled")
	}
	if strings.TrimSpace(input.ModelID) != rule.ModelID || strings.ToLower(strings.TrimSpace(input.MediaType)) != rule.MediaType {
		return Quote{}, errors.New("request model or media type does not match pricing rule")
	}
	quantity := input.Count
	if rule.Unit == UnitImage {
		if quantity < 1 || quantity > 10 {
			return Quote{}, errors.New("image count must be between 1 and 10")
		}
	} else {
		quantity = input.DurationSeconds
		if quantity < 1 || quantity > 3600 {
			return Quote{}, errors.New("video duration must be between 1 and 3600 seconds")
		}
		if len(rule.AllowedDuration) > 0 && !containsInt(rule.AllowedDuration, quantity) {
			return Quote{}, fmt.Errorf("video duration %d is not allowed", quantity)
		}
	}

	resolved := make(map[string]string, len(rule.Dimensions))
	renderValues := map[string]string{"model_id": rule.ModelID}
	for _, dimension := range rule.Dimensions {
		raw := inputValue(input, dimension.Source, dimension.Field)
		value, err := resolveDimension(dimension, raw)
		if err != nil {
			return Quote{}, fmt.Errorf("dimension %s: %w", dimension.Placeholder, err)
		}
		resolved[dimension.Placeholder] = value
		renderValues[dimension.Placeholder] = value
	}
	key := render(rule.Template, renderValues)
	rawPrice, ok := rule.Prices[key]
	if !ok {
		return Quote{}, fmt.Errorf("no price configured for %q", key)
	}
	unitPrice, err := parsePrice(rawPrice)
	if err != nil {
		return Quote{}, err
	}
	return Quote{
		PricingKey:         key,
		Unit:               rule.Unit,
		Currency:           rule.Currency,
		Quantity:           quantity,
		UnitPrice:          unitPrice,
		Amount:             unitPrice.Mul(decimal.NewFromInt(int64(quantity))),
		ResolvedDimensions: resolved,
	}, nil
}

func inputValue(input Input, source, field string) string {
	if source == "input" {
		return strings.TrimSpace(input.Input[field])
	}
	return strings.TrimSpace(input.Parameters[field])
}

func resolveDimension(dimension Dimension, raw string) (string, error) {
	if len(dimension.Mapping) > 0 {
		if value, ok := dimension.Mapping[raw]; ok {
			return value, nil
		}
		if value, ok := dimension.Mapping["default"]; ok {
			return value, nil
		}
		return "", fmt.Errorf("value %q is not mapped", raw)
	}
	numeric, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(numeric) || math.IsInf(numeric, 0) {
		return "", fmt.Errorf("value %q must be numeric", raw)
	}
	matched := ""
	for _, candidate := range dimension.Ranges {
		if rangeContains(candidate, numeric) {
			if matched != "" {
				return "", errors.New("value matches multiple ranges")
			}
			matched = candidate.Value
		}
	}
	if matched == "" {
		return "", fmt.Errorf("value %q does not match a configured range", raw)
	}
	return matched, nil
}

func rangeContains(item NumericRange, value float64) bool {
	if item.GT != nil && value <= *item.GT || item.GTE != nil && value < *item.GTE ||
		item.LT != nil && value >= *item.LT || item.LTE != nil && value > *item.LTE {
		return false
	}
	return true
}

func containsInt(values []int, wanted int) bool {
	index := sort.SearchInts(values, wanted)
	return index < len(values) && values[index] == wanted
}

func render(template string, values map[string]string) string {
	return placeholderPattern.ReplaceAllStringFunc(template, func(token string) string {
		matches := placeholderPattern.FindStringSubmatch(token)
		return values[matches[1]]
	})
}

// MarshalCanonical validates and serializes a stable persistence document.
func MarshalCanonical(rule Rule) ([]byte, Rule, error) {
	normalized, err := NormalizeAndValidate(rule)
	if err != nil {
		return nil, Rule{}, err
	}
	body, err := common.Marshal(normalized)
	return body, normalized, err
}

// Unmarshal validates a persisted rule document before it is used for money.
func Unmarshal(body []byte) (Rule, error) {
	var rule Rule
	if err := common.Unmarshal(body, &rule); err != nil {
		return Rule{}, fmt.Errorf("decode media pricing rule: %w", err)
	}
	return NormalizeAndValidate(rule)
}
