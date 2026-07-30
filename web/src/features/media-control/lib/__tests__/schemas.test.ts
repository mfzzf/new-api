/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  mediaModelFormSchema,
  mediaProviderFormSchema,
  routeNodeFormSchema,
} from '../schemas'

describe('media control form validation', () => {
  test('accepts model metadata only when it is a JSON object', () => {
    const valid = mediaModelFormSchema.safeParse({
      key: 'image-pro',
      display_name: 'Image Pro',
      media_type: 'image',
      description: '',
      logo_url: '',
      metadata_json: '{"sizes":["1024x1024"]}',
      enabled: true,
    })
    const invalid = mediaModelFormSchema.safeParse({
      key: 'image-pro',
      display_name: 'Image Pro',
      media_type: 'image',
      description: '',
      logo_url: '',
      metadata_json: '["not-an-object"]',
      enabled: true,
    })

    assert.equal(valid.success, true)
    assert.equal(invalid.success, false)
  })

  test('requires a reason when a route node is disabled', () => {
    const result = routeNodeFormSchema.safeParse({
      model_id: 'mdl_1',
      provider_id: 'prv_1',
      provider_model: 'provider-image-v2',
      weight: 5,
      priority: 5,
      rpm_limit: 0,
      tpm_limit: 0,
      enabled: false,
      disable_reason: '',
      change_reason: 'quota exhausted',
    })

    assert.equal(result.success, false)
  })

  test('accepts a write-only API key and permits blank values on edit', () => {
    const input = {
      code: 'fal-ai',
      name: 'FAL AI',
      media_type: 'image_and_video',
      base_url: 'https://api.example/v1',
      metadata_json: '{}',
      enabled: true,
    } as const

    assert.equal(
      mediaProviderFormSchema.safeParse({
        ...input,
        api_key: 'provider-secret',
      }).success,
      true
    )
    assert.equal(
      mediaProviderFormSchema.safeParse({ ...input, api_key: '' }).success,
      true
    )
  })

  test('preserves zero weight as a valid disabled-from-selection value', () => {
    const result = routeNodeFormSchema.safeParse({
      model_id: 'mdl_1',
      provider_id: 'prv_1',
      provider_model: 'provider-image-v2',
      weight: 0,
      priority: 5,
      rpm_limit: 0,
      tpm_limit: 0,
      enabled: true,
      disable_reason: '',
      change_reason: '',
    })

    assert.equal(result.success, true)
  })
})
