/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import i18next from 'i18next'

import en from '../../../../i18n/locales/en.json'
import type { MediaPricingRule } from '../../types'
import { mediaPricingKeys, prepareMediaPricingRule } from '../media-pricing'

await i18next.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en },
})

function videoRule(): MediaPricingRule {
  return {
    model_id: 'video-pro',
    media_type: 'video',
    enabled: true,
    unit: 'second',
    currency: 'CNY',
    allowed_duration: [8, 4, 8],
    dimensions: [
      {
        source: 'input',
        field: 'has_video_input',
        placeholder: 'video_input',
        mapping: {
          default: 'no_video',
          false: 'no_video',
          true: 'with_video',
        },
      },
      {
        source: 'parameters',
        field: 'resolution',
        placeholder: 'resolution',
        mapping: { default: '720p', '1080P': '1080p' },
      },
    ],
    template: '{model_id}-{video_input}-{resolution}',
    prices: {
      'video-pro-no_video-720p': '0.25',
      'video-pro-no_video-1080p': '0.3125',
      'video-pro-with_video-720p': '0.9',
      'video-pro-with_video-1080p': '1.2',
    },
  }
}

describe('media pricing form projection', () => {
  test('generates the complete unique template matrix', () => {
    assert.deepEqual(mediaPricingKeys(videoRule()), [
      'video-pro-no_video-1080p',
      'video-pro-no_video-720p',
      'video-pro-with_video-1080p',
      'video-pro-with_video-720p',
    ])
  })

  test('normalizes durations and keeps only generated prices', () => {
    const prepared = prepareMediaPricingRule(videoRule(), 'video-pro', 'video')
    assert.deepEqual(prepared?.allowed_duration, [4, 8])
    assert.equal(Object.keys(prepared?.prices ?? {}).length, 4)
  })

  test('rejects a missing combination price before saving model metadata', () => {
    const rule = videoRule()
    delete rule.prices['video-pro-with_video-1080p']
    assert.throws(
      () => prepareMediaPricingRule(rule, 'video-pro', 'video'),
      /video-pro-with_video-1080p/
    )
  })

  test('rejects undeclared template placeholders before the cross-service save', () => {
    const rule = videoRule()
    rule.template = '{model_id}-{unknown}'
    assert.throws(
      () => prepareMediaPricingRule(rule, 'video-pro', 'video'),
      /missing \{video_input\}|undeclared/
    )
  })

  test('rejects prices with more than eight decimal places', () => {
    const rule = videoRule()
    rule.prices['video-pro-no_video-720p'] = '0.123456789'
    assert.throws(
      () => prepareMediaPricingRule(rule, 'video-pro', 'video'),
      /video-pro-no_video-720p/
    )
  })

  test('rejects overlapping numeric ranges before saving model metadata', () => {
    const rule: MediaPricingRule = {
      model_id: 'image-pro',
      media_type: 'image',
      enabled: true,
      unit: 'image',
      currency: 'CNY',
      dimensions: [
        {
          source: 'parameters',
          field: 'megapixels',
          placeholder: 'dimension',
          ranges: [
            { lte: 2.36, value: 'small' },
            { gte: 2.36, value: 'large' },
          ],
        },
      ],
      template: '{model_id}-{dimension}',
      prices: {
        'image-pro-small': '0.3',
        'image-pro-large': '0.6',
      },
    }

    assert.throws(
      () => prepareMediaPricingRule(rule, 'image-pro', 'image'),
      /overlapping ranges/
    )
  })
})
