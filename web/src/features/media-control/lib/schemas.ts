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
import z from 'zod'

import { MEDIA_HTTP_METHODS, MEDIA_PROVIDER_ADAPTER_TYPES } from '../types'

const resourceKey = z
  .string()
  .trim()
  .min(2, 'Use at least 2 characters')
  .max(128, 'Use at most 128 characters')
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._:/-]+$/,
    'Use letters, numbers, dots, underscores, colons, slashes, or dashes'
  )

const jsonObjectString = (label: string) =>
  z.string().superRefine((value, context) => {
    try {
      const parsed: unknown = JSON.parse(value)
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        context.addIssue({
          code: 'custom',
          message: `${label} must be a JSON object`,
        })
      }
    } catch {
      context.addIssue({ code: 'custom', message: 'Enter valid JSON' })
    }
  })

const metadataJSON = jsonObjectString('Metadata')
const httpTokenPattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

const authHeader = z
  .string()
  .trim()
  .max(64, 'Use at most 64 characters')
  .refine((value) => !value || httpTokenPattern.test(value), {
    message: 'Enter a valid HTTP header name',
  })

const authScheme = z
  .string()
  .trim()
  .max(32, 'Use at most 32 characters')
  .refine((value) => !value || httpTokenPattern.test(value), {
    message: 'Enter a valid HTTP authentication scheme',
  })

const providerBaseURL = z
  .string()
  .trim()
  .url('Enter a valid provider account Base URL')

const routePath = z
  .string()
  .trim()
  .superRefine((value, context) => {
    if (new TextEncoder().encode(value).length > 2048) {
      context.addIssue({
        code: 'custom',
        message: 'Use at most 2048 bytes',
      })
    }
    if (!value) return
    if (!value.startsWith('/') || value.startsWith('//')) {
      context.addIssue({
        code: 'custom',
        message: 'Use an absolute path beginning with one slash',
      })
    }
    for (const character of value) {
      const codePoint = character.codePointAt(0) ?? 0
      if (codePoint < 0x20 || codePoint === 0x7f || character === '\\') {
        context.addIssue({
          code: 'custom',
          message: 'Path contains an invalid character',
        })
        break
      }
    }
  })

const httpMethod = z.enum(MEDIA_HTTP_METHODS)
const optionalHTTPMethod = z.union([z.literal(''), httpMethod])

export const mediaModelFormSchema = z.object({
  key: resourceKey,
  display_name: z.string().trim().min(1, 'Display name is required'),
  media_type: z.enum(['image', 'video']),
  description: z.string().trim(),
  logo_url: z.union([z.literal(''), z.url('Enter a valid logo URL')]),
  metadata_json: metadataJSON,
  enabled: z.boolean(),
})

export const mediaProviderFormSchema = z
  .object({
    code: resourceKey,
    name: z.string().trim().min(1, 'Provider account name is required'),
    adapter_type: z.enum(MEDIA_PROVIDER_ADAPTER_TYPES),
    media_type: z.enum(['image', 'video', 'image_and_video']),
    base_url: providerBaseURL,
    auth_header: authHeader,
    auth_scheme: authScheme,
    api_key: z.string().trim().max(8192, 'Use at most 8192 characters'),
    metadata_json: metadataJSON,
    enabled: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.adapter_type !== 'tencentcloud' && !value.auth_header) {
      context.addIssue({
        code: 'custom',
        path: ['auth_header'],
        message: 'Authentication header is required',
      })
    }

    let url: URL
    try {
      url = new URL(value.base_url)
    } catch {
      return
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      context.addIssue({
        code: 'custom',
        path: ['base_url'],
        message: 'Use an absolute HTTP(S) URL',
      })
      return
    }
    const loopbackHosts = ['localhost', '127.0.0.1', '::1', '[::1]']
    if (
      value.adapter_type !== 'mock' &&
      url.protocol !== 'https:' &&
      !loopbackHosts.includes(url.hostname)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['base_url'],
        message:
          'Use HTTPS except for localhost loopback development addresses',
      })
    }
  })

export const routeNodeFormSchema = z
  .object({
    model_id: z.string().trim().min(1, 'Model is required'),
    provider_id: z.string().trim().min(1, 'Provider account is required'),
    provider_model: z.string().trim().min(1, 'Provider model is required'),
    submit_path: routePath.refine(Boolean, 'Submit path is required'),
    submit_method: httpMethod,
    status_path: routePath,
    status_method: optionalHTTPMethod,
    param_mapping_json: jsonObjectString('Parameter mapping'),
    response_mapping_json: jsonObjectString('Response mapping'),
    static_body_json: jsonObjectString('Static request body'),
    public_protocol_json: jsonObjectString('Public protocol'),
    passthrough_enabled: z.boolean(),
    request_timeout_ms: z.number().int().min(1000).max(600000),
    weight: z.number().int().min(0).max(10000),
    priority: z.number().int().min(0).max(10000),
    rpm_limit: z.number().int().min(0),
    tpm_limit: z.number().int().min(0),
    enabled: z.boolean(),
    disable_reason: z.string().trim(),
    change_reason: z.string().trim(),
  })
  .superRefine((value, context) => {
    if (value.status_path && !value.status_method) {
      context.addIssue({
        code: 'custom',
        path: ['status_method'],
        message: 'Status method is required when a status path is configured',
      })
    }
    if (!value.status_path && value.status_method) {
      context.addIssue({
        code: 'custom',
        path: ['status_method'],
        message: 'Status method requires a status path',
      })
    }
    if (!value.enabled && !value.disable_reason) {
      context.addIssue({
        code: 'custom',
        path: ['disable_reason'],
        message: 'Disable reason is required when the route is disabled',
      })
    }
  })

export type MediaModelFormValues = z.infer<typeof mediaModelFormSchema>
export type MediaProviderFormValues = z.infer<typeof mediaProviderFormSchema>
export type RouteNodeFormValues = z.infer<typeof routeNodeFormSchema>
