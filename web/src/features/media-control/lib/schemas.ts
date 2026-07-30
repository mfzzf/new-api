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

const resourceKey = z
  .string()
  .trim()
  .min(2, 'Use at least 2 characters')
  .max(128, 'Use at most 128 characters')
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._:/-]+$/,
    'Use letters, numbers, dots, underscores, colons, slashes, or dashes'
  )

const metadataJSON = z.string().superRefine((value, context) => {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      context.addIssue({
        code: 'custom',
        message: 'Metadata must be a JSON object',
      })
    }
  } catch {
    context.addIssue({ code: 'custom', message: 'Enter valid JSON' })
  }
})

export const mediaModelFormSchema = z.object({
  key: resourceKey,
  display_name: z.string().trim().min(1, 'Display name is required'),
  media_type: z.enum(['image', 'video']),
  description: z.string().trim(),
  logo_url: z.union([z.literal(''), z.url('Enter a valid logo URL')]),
  metadata_json: metadataJSON,
  enabled: z.boolean(),
})

export const mediaProviderFormSchema = z.object({
  code: resourceKey,
  name: z.string().trim().min(1, 'Provider name is required'),
  media_type: z.enum(['image', 'video', 'image_and_video']),
  base_url: z.url('Enter a valid provider Base URL'),
  api_key: z.string().trim().max(8192, 'Use at most 8192 characters'),
  metadata_json: metadataJSON,
  enabled: z.boolean(),
})

export const routeNodeFormSchema = z
  .object({
    model_id: z.string().trim().min(1, 'Model is required'),
    provider_id: z.string().trim().min(1, 'Provider is required'),
    provider_model: z.string().trim().min(1, 'Provider model is required'),
    weight: z.number().int().min(0).max(10000),
    priority: z.number().int().min(0).max(10000),
    rpm_limit: z.number().int().min(0),
    tpm_limit: z.number().int().min(0),
    enabled: z.boolean(),
    disable_reason: z.string().trim(),
    change_reason: z.string().trim(),
  })
  .superRefine((value, context) => {
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
