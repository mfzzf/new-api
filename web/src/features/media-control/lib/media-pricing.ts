import { t } from 'i18next'

/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type {
  MediaPricingDimension,
  MediaPricingRange,
  MediaPricingRule,
  MediaType,
} from '../types'

const ALLOWED_FIELDS = {
  input: new Set(['has_image_input', 'has_video_input']),
  parameters: new Set([
    'resolution',
    'size',
    'quality',
    'tier',
    'megapixels',
    'duration',
    'duration_seconds',
    'seconds',
    'image_count',
  ]),
}
const PLACEHOLDER_PATTERN = /^[a-z][a-z0-9_]*$/
const TEMPLATE_PLACEHOLDER_PATTERN = /\{([a-z][a-z0-9_]*)\}/g
const PRICE_PATTERN = /^\d+(?:\.\d{1,8})?$/
const RENDERED_VALUE_PATTERN = /^[A-Za-z0-9._-]+$/
const MAX_DIMENSIONS = 6
const MAX_DIMENSION_VALUES = 64
const MAX_DIMENSION_VALUE_LENGTH = 80
const MAX_PRICE_KEYS = 256
const MAX_TEMPLATE_LENGTH = 512

function rangeBounds(range: MediaPricingRange) {
  const lower = range.gt ?? range.gte
  const upper = range.lt ?? range.lte
  return {
    lower,
    lowerInclusive: range.gte !== undefined,
    upper,
    upperInclusive: range.lte !== undefined,
  }
}

function rangesOverlap(
  left: MediaPricingRange,
  right: MediaPricingRange
): boolean {
  const leftBounds = rangeBounds(left)
  const rightBounds = rangeBounds(right)
  if (
    leftBounds.upper !== undefined &&
    rightBounds.lower !== undefined &&
    (leftBounds.upper < rightBounds.lower ||
      (leftBounds.upper === rightBounds.lower &&
        !(leftBounds.upperInclusive && rightBounds.lowerInclusive)))
  ) {
    return false
  }
  if (
    rightBounds.upper !== undefined &&
    leftBounds.lower !== undefined &&
    (rightBounds.upper < leftBounds.lower ||
      (rightBounds.upper === leftBounds.lower &&
        !(rightBounds.upperInclusive && leftBounds.lowerInclusive)))
  ) {
    return false
  }
  return true
}

function dimensionValues(dimension: MediaPricingDimension): string[] {
  return [
    ...Object.values(dimension.mapping ?? {}),
    ...(dimension.ranges ?? []).map((range) => range.value),
  ].filter((value, index, all) => value && all.indexOf(value) === index)
}

export function mediaPricingKeys(
  rule: MediaPricingRule,
  modelID = rule.model_id
): string[] {
  let combinations: Record<string, string>[] = [{}]
  for (const dimension of rule.dimensions ?? []) {
    const values = dimensionValues(dimension)
    combinations = combinations.flatMap((combination) =>
      values.map((value) => ({
        ...combination,
        [dimension.placeholder]: value,
      }))
    )
    if (combinations.length > MAX_PRICE_KEYS) return []
  }
  return combinations
    .map((values) => {
      const resolved = { model_id: modelID, ...values }
      return rule.template.replaceAll(/\{([a-z][a-z0-9_]*)\}/g, (_, name) =>
        String(resolved[name as keyof typeof resolved] ?? '')
      )
    })
    .filter((key, index, all) => key && all.indexOf(key) === index)
    .sort()
}

export function prepareMediaPricingRule(
  draft: MediaPricingRule | null,
  modelID: string,
  mediaType: MediaType
): MediaPricingRule | null {
  if (!draft) return null
  const normalized: MediaPricingRule = {
    ...draft,
    model_id: modelID.trim(),
    media_type: mediaType,
    enabled: true,
    unit: mediaType === 'image' ? 'image' : 'second',
    allowed_duration:
      mediaType === 'video'
        ? [...new Set(draft.allowed_duration ?? [])].sort((a, b) => a - b)
        : undefined,
    dimensions: draft.dimensions ?? [],
  }
  if (!normalized.model_id || normalized.model_id.length > 191) {
    throw new Error(t('Enter a model ID no longer than 191 characters.'))
  }
  if (
    !normalized.template ||
    normalized.template.length > MAX_TEMPLATE_LENGTH
  ) {
    throw new Error(t('Pricing template must be between 1 and 512 characters.'))
  }
  if (!normalized.template.includes('{model_id}')) {
    throw new Error(t('Pricing template must include {model_id}.'))
  }
  if ((normalized.dimensions ?? []).length > MAX_DIMENSIONS) {
    throw new Error(t('Pricing supports at most 6 dimensions.'))
  }
  if (mediaType === 'video') {
    if ((normalized.allowed_duration ?? []).length > 3600) {
      throw new Error(t('Too many allowed durations.'))
    }
    for (const duration of normalized.allowed_duration ?? []) {
      if (!Number.isInteger(duration) || duration < 1 || duration > 3600) {
        throw new Error(
          t('Allowed durations must be integer seconds between 1 and 3600.')
        )
      }
    }
  }
  const placeholders = new Set(['model_id'])
  for (const dimension of normalized.dimensions ?? []) {
    if (!dimension.source || !dimension.field || !dimension.placeholder) {
      throw new Error(
        t('Every pricing dimension requires a source, field, and placeholder.')
      )
    }
    if (!ALLOWED_FIELDS[dimension.source].has(dimension.field)) {
      throw new Error(
        t('Unsupported billing field: {{field}}.', {
          field: `${dimension.source}.${dimension.field}`,
        })
      )
    }
    if (
      !PLACEHOLDER_PATTERN.test(dimension.placeholder) ||
      dimension.placeholder === 'model_id' ||
      placeholders.has(dimension.placeholder)
    ) {
      throw new Error(
        t('Dimension placeholder {{placeholder}} is invalid or duplicated.', {
          placeholder: dimension.placeholder,
        })
      )
    }
    placeholders.add(dimension.placeholder)
    const hasMapping = Object.keys(dimension.mapping ?? {}).length > 0
    const hasRanges = (dimension.ranges ?? []).length > 0
    if (hasMapping === hasRanges) {
      throw new Error(
        t(
          'Dimension {{placeholder}} must configure exactly one mapping or numeric range.',
          { placeholder: dimension.placeholder }
        )
      )
    }
    if (
      Object.keys(dimension.mapping ?? {}).length > MAX_DIMENSION_VALUES ||
      (dimension.ranges ?? []).length > MAX_DIMENSION_VALUES
    ) {
      throw new Error(t('A pricing dimension supports at most 64 values.'))
    }
    for (const [source, output] of Object.entries(dimension.mapping ?? {})) {
      if (
        !source.trim() ||
        source.trim().length > MAX_DIMENSION_VALUE_LENGTH ||
        !output.trim() ||
        output.trim().length > MAX_DIMENSION_VALUE_LENGTH ||
        !RENDERED_VALUE_PATTERN.test(output.trim())
      ) {
        throw new Error(
          t('Dimension {{placeholder}} contains an invalid mapping.', {
            placeholder: dimension.placeholder,
          })
        )
      }
    }
    const ranges = dimension.ranges ?? []
    for (const range of ranges) {
      const boundaries = [range.gt, range.gte, range.lt, range.lte].filter(
        (boundary) => boundary !== undefined
      )
      const bounds = rangeBounds(range)
      if (
        boundaries.length === 0 ||
        boundaries.some((boundary) => !Number.isFinite(boundary)) ||
        (range.gt !== undefined && range.gte !== undefined) ||
        (range.lt !== undefined && range.lte !== undefined) ||
        (bounds.lower !== undefined &&
          bounds.upper !== undefined &&
          bounds.lower >= bounds.upper) ||
        range.value.trim().length > MAX_DIMENSION_VALUE_LENGTH ||
        !RENDERED_VALUE_PATTERN.test(range.value.trim())
      ) {
        throw new Error(
          t('Dimension {{placeholder}} contains an invalid numeric range.', {
            placeholder: dimension.placeholder,
          })
        )
      }
    }
    for (let left = 0; left < ranges.length; left += 1) {
      for (let right = left + 1; right < ranges.length; right += 1) {
        if (rangesOverlap(ranges[left], ranges[right])) {
          throw new Error(
            t('Dimension {{placeholder}} contains overlapping ranges.', {
              placeholder: dimension.placeholder,
            })
          )
        }
      }
    }
    if (!dimensionValues(dimension).length) {
      throw new Error(
        t('Dimension {{placeholder}} requires at least one mapping or range.', {
          placeholder: dimension.placeholder,
        })
      )
    }
  }
  const templatePlaceholders = [
    ...normalized.template.matchAll(TEMPLATE_PLACEHOLDER_PATTERN),
  ].map((match) => match[1])
  for (const placeholder of placeholders) {
    if (!templatePlaceholders.includes(placeholder)) {
      throw new Error(
        t('Pricing template is missing {{placeholder}}.', {
          placeholder: `{${placeholder}}`,
        })
      )
    }
  }
  for (const placeholder of templatePlaceholders) {
    if (!placeholders.has(placeholder)) {
      throw new Error(
        t('Pricing template contains undeclared {{placeholder}}.', {
          placeholder: `{${placeholder}}`,
        })
      )
    }
  }
  if (
    /[{}]/.test(
      normalized.template.replaceAll(TEMPLATE_PLACEHOLDER_PATTERN, '')
    )
  ) {
    throw new Error(t('Pricing template contains an invalid placeholder.'))
  }
  const keys = mediaPricingKeys(normalized)
  const combinationCount = (normalized.dimensions ?? []).reduce(
    (count, dimension) => count * dimensionValues(dimension).length,
    1
  )
  if (!keys.length || keys.length !== combinationCount) {
    throw new Error(
      t('Pricing template did not generate unique valid price keys.')
    )
  }
  if (keys.some((key) => key.length > MAX_TEMPLATE_LENGTH)) {
    throw new Error(t('A generated pricing key exceeds 512 characters.'))
  }
  const prices: Record<string, string> = {}
  for (const key of keys) {
    const price = String(draft.prices[key] ?? '').trim()
    if (
      !PRICE_PATTERN.test(price) ||
      !Number.isFinite(Number(price)) ||
      Number(price) < 0 ||
      Number(price) > 1_000_000
    ) {
      throw new Error(
        t('Enter a valid non-negative unit price for {{key}}.', { key })
      )
    }
    prices[key] = price
  }
  normalized.prices = prices
  return normalized
}
