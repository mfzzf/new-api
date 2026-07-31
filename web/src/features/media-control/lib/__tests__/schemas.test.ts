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

import { MEDIA_PROVIDER_ADAPTER_TYPES } from '../../types'
import {
  mediaModelFormSchema,
  mediaProviderFormSchema,
  routeNodeFormSchema,
} from '../schemas'

const validProvider = {
  code: 'image-provider',
  name: 'Image Provider',
  adapter_type: 'openai',
  media_type: 'image',
  base_url: 'https://api.example/v1',
  auth_header: 'Authorization',
  auth_scheme: 'Bearer',
  api_key: 'provider-secret',
  metadata_json: '{}',
  enabled: true,
} as const

const validRoute = {
  model_id: 'mdl_1',
  provider_id: 'prv_1',
  provider_model: 'provider-image-v2',
  submit_path: '/v1/images/generations',
  submit_method: 'POST',
  status_path: '',
  status_method: '',
  param_mapping_json: '{}',
  response_mapping_json: '{}',
  static_body_json: '{}',
  public_protocol_json: '{}',
  passthrough_enabled: true,
  request_timeout_ms: 120000,
  weight: 5,
  priority: 5,
  rpm_limit: 0,
  tpm_limit: 0,
  enabled: true,
  disable_reason: '',
  change_reason: '',
} as const

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
      ...validRoute,
      enabled: false,
      disable_reason: '',
      change_reason: 'quota exhausted',
    })

    assert.equal(result.success, false)
  })

  test('accepts a write-only API key and permits blank values on edit', () => {
    assert.equal(mediaProviderFormSchema.safeParse(validProvider).success, true)
    assert.equal(
      mediaProviderFormSchema.safeParse({ ...validProvider, api_key: '' })
        .success,
      true
    )
  })

  test('accepts every registered provider Adapter type', () => {
    for (const adapter_type of MEDIA_PROVIDER_ADAPTER_TYPES) {
      const input = {
        ...validProvider,
        adapter_type,
        auth_header: adapter_type === 'tencentcloud' ? '' : 'Authorization',
        auth_scheme: adapter_type === 'tencentcloud' ? '' : 'Bearer',
      }
      assert.equal(
        mediaProviderFormSchema.safeParse(input).success,
        true,
        adapter_type
      )
    }
    assert.equal(
      mediaProviderFormSchema.safeParse({
        ...validProvider,
        adapter_type: 'unknown',
      }).success,
      false
    )
  })

  test('requires HTTP-token authentication fields except for Tencent signing', () => {
    assert.equal(
      mediaProviderFormSchema.safeParse({
        ...validProvider,
        auth_header: '',
      }).success,
      false
    )
    assert.equal(
      mediaProviderFormSchema.safeParse({
        ...validProvider,
        adapter_type: 'tencentcloud',
        auth_header: '',
        auth_scheme: '',
      }).success,
      true
    )
    assert.equal(
      mediaProviderFormSchema.safeParse({
        ...validProvider,
        auth_scheme: 'Bearer prefix',
      }).success,
      false
    )
    assert.equal(
      mediaProviderFormSchema.safeParse({
        ...validProvider,
        auth_header: 'x'.repeat(65),
      }).success,
      false
    )
    assert.equal(
      mediaProviderFormSchema.safeParse({
        ...validProvider,
        auth_scheme: 'x'.repeat(33),
      }).success,
      false
    )
  })

  test('requires HTTPS for remote non-mock providers but permits loopback HTTP', () => {
    assert.equal(
      mediaProviderFormSchema.safeParse({
        ...validProvider,
        base_url: 'http://api.example/v1',
      }).success,
      false
    )
    assert.equal(
      mediaProviderFormSchema.safeParse({
        ...validProvider,
        base_url: 'http://127.0.0.1:8080/v1',
      }).success,
      true
    )
    assert.equal(
      mediaProviderFormSchema.safeParse({
        ...validProvider,
        adapter_type: 'mock',
        base_url: 'http://mock.example/v1',
      }).success,
      true
    )
    assert.equal(
      mediaProviderFormSchema.safeParse({
        ...validProvider,
        base_url: 'ftp://api.example/v1',
      }).success,
      false
    )
  })

  test('preserves zero weight as a valid disabled-from-selection value', () => {
    const result = routeNodeFormSchema.safeParse({
      ...validRoute,
      weight: 0,
    })

    assert.equal(result.success, true)
  })

  test('matches backend route path, mapping, and timeout boundaries', () => {
    assert.equal(routeNodeFormSchema.safeParse(validRoute).success, true)
    for (const submit_path of [
      'https://provider.example/jobs',
      '//provider.example/jobs',
      '/jobs\\status',
      '/jobs\r\nX-Test: yes',
    ]) {
      assert.equal(
        routeNodeFormSchema.safeParse({ ...validRoute, submit_path }).success,
        false,
        submit_path
      )
    }
    assert.equal(
      routeNodeFormSchema.safeParse({
        ...validRoute,
        param_mapping_json: '[]',
      }).success,
      false
    )
    assert.equal(
      routeNodeFormSchema.safeParse({
        ...validRoute,
        request_timeout_ms: 600000,
      }).success,
      true
    )
    assert.equal(
      routeNodeFormSchema.safeParse({
        ...validRoute,
        request_timeout_ms: 600001,
      }).success,
      false
    )
    assert.equal(
      routeNodeFormSchema.safeParse({
        ...validRoute,
        submit_path: `/${'a'.repeat(2047)}`,
      }).success,
      true
    )
    assert.equal(
      routeNodeFormSchema.safeParse({
        ...validRoute,
        submit_path: `/${'a'.repeat(2048)}`,
      }).success,
      false
    )
  })

  test('keeps status method empty for synchronous routes and requires it for jobs', () => {
    assert.equal(routeNodeFormSchema.safeParse(validRoute).success, true)
    assert.equal(
      routeNodeFormSchema.safeParse({
        ...validRoute,
        status_method: 'GET',
      }).success,
      false
    )
    assert.equal(
      routeNodeFormSchema.safeParse({
        ...validRoute,
        status_path: '/v1/videos/{task_id}',
      }).success,
      false
    )
    assert.equal(
      routeNodeFormSchema.safeParse({
        ...validRoute,
        status_path: '/v1/videos/{task_id}',
        status_method: 'GET',
      }).success,
      true
    )
  })
})
