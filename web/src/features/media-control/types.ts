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
export type MediaType = 'image' | 'video'
export type ProviderMediaType = MediaType | 'image_and_video'
export type MediaProviderAdapterType = 'mock' | 'openai_images'

export type MediaModel = {
  id: string
  key: string
  display_name: string
  media_type: MediaType
  description: string
  logo_url: string
  metadata: Record<string, unknown>
  enabled: boolean
  created_at: string
  updated_at: string
}

export type MediaModelInput = Omit<
  MediaModel,
  'id' | 'created_at' | 'updated_at'
>

export type MediaProvider = {
  id: string
  code: string
  name: string
  adapter_type: MediaProviderAdapterType
  media_type: ProviderMediaType
  base_url: string
  has_api_key: boolean
  api_key_hint: string
  metadata: Record<string, unknown>
  enabled: boolean
  created_at: string
  updated_at: string
}

export type MediaProviderInput = {
  code: string
  name: string
  adapter_type: MediaProviderAdapterType
  media_type: ProviderMediaType
  base_url: string
  api_key: string
  metadata: Record<string, unknown>
  enabled: boolean
}

export type RouteNode = {
  id: string
  model_id: string
  provider_id: string
  provider_model: string
  weight: number
  priority: number
  rpm_limit: number
  tpm_limit: number
  enabled: boolean
  disable_reason: string
  last_change_reason: string
  created_at: string
  updated_at: string
}

export type RouteNodeInput = Omit<
  RouteNode,
  'id' | 'last_change_reason' | 'created_at' | 'updated_at'
> & {
  change_reason: string
}

export type MediaControlSection = 'models' | 'providers' | 'route-nodes'

export type MediaOperationAction = 'create' | 'update' | 'delete'
export type MediaOperationResourceType = 'model' | 'provider' | 'route_node'

export type MediaOperationActor = {
  id: string
  username: string
  display_name: string
  role: number
}

export type MediaOperationLog = {
  id: string
  actor: MediaOperationActor
  action: MediaOperationAction
  resource_type: MediaOperationResourceType
  resource_id: string
  resource_name: string
  details: Record<string, unknown>
  created_at: string
}

export type MediaOperationLogPage = {
  items: MediaOperationLog[]
  total: number
  page: number
  page_size: number
}

export type MediaOperationLogQuery = {
  page?: number
  page_size?: number
  action?: MediaOperationAction | ''
  resource_type?: MediaOperationResourceType | ''
  search?: string
}
