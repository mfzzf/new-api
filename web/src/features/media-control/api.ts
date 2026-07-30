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
import axios, { type AxiosRequestConfig } from 'axios'
import { t } from 'i18next'
import { toast } from 'sonner'

import { refreshAuthentication } from '@/lib/auth-session'
import { useAuthStore } from '@/stores/auth-store'

import type {
  MediaModel,
  MediaModelInput,
  MediaOperationLogPage,
  MediaOperationLogQuery,
  MediaProvider,
  MediaProviderInput,
  RouteNode,
  RouteNodeInput,
} from './types'

type Envelope<T> = {
  success: boolean
  data: T
  message?: string
}

type RetriableRequest = AxiosRequestConfig & {
  mediaControlAuthRetry?: boolean
}

const configuredControlPlaneURL =
  import.meta.env.VITE_MEDIA_CONTROL_PLANE_URL?.trim()

function resolveControlPlaneBaseURL() {
  if (configuredControlPlaneURL && configuredControlPlaneURL !== 'auto') {
    return configuredControlPlaneURL
  }

  const controlPlaneURL = new URL(window.location.origin)
  controlPlaneURL.port = '3100'
  return controlPlaneURL.origin
}

const controlPlaneBaseURL = resolveControlPlaneBaseURL()

export const mediaControlApi = axios.create({
  baseURL: controlPlaneBaseURL,
  withCredentials: true,
})

mediaControlApi.interceptors.request.use((config) => {
  const accessToken = useAuthStore.getState().auth.accessToken
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

mediaControlApi.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error?.config as RetriableRequest | undefined
    if (
      error?.response?.status === 401 &&
      config &&
      !config.mediaControlAuthRetry
    ) {
      config.mediaControlAuthRetry = true
      const outcome = await refreshAuthentication()
      if (outcome.kind === 'authenticated') {
        const accessToken = useAuthStore.getState().auth.accessToken
        if (accessToken) {
          config.headers = {
            ...config.headers,
            Authorization: `Bearer ${accessToken}`,
          }
        }
        return mediaControlApi.request(config)
      }
    }
    const message =
      error?.response?.data?.message || error?.message || t('Request failed')
    toast.error(message)
    throw error
  }
)

async function getData<T>(request: Promise<{ data: Envelope<T> }>): Promise<T> {
  const response = await request
  return response.data.data
}

export const mediaControlQueryKeys = {
  all: ['media-control'] as const,
  models: () => [...mediaControlQueryKeys.all, 'models'] as const,
  providers: () => [...mediaControlQueryKeys.all, 'providers'] as const,
  routeNodes: () => [...mediaControlQueryKeys.all, 'route-nodes'] as const,
}

export function listMediaModels(): Promise<MediaModel[]> {
  return getData(mediaControlApi.get('/admin/v1/media/models'))
}

export function createMediaModel(input: MediaModelInput): Promise<MediaModel> {
  return getData(mediaControlApi.post('/admin/v1/media/models', input))
}

export function updateMediaModel(
  id: string,
  input: MediaModelInput
): Promise<MediaModel> {
  return getData(mediaControlApi.put(`/admin/v1/media/models/${id}`, input))
}

export function deleteMediaModel(id: string): Promise<{ id: string }> {
  return getData(mediaControlApi.delete(`/admin/v1/media/models/${id}`))
}

export function listMediaProviders(): Promise<MediaProvider[]> {
  return getData(mediaControlApi.get('/admin/v1/media/providers'))
}

export function createMediaProvider(
  input: MediaProviderInput
): Promise<MediaProvider> {
  return getData(mediaControlApi.post('/admin/v1/media/providers', input))
}

export function updateMediaProvider(
  id: string,
  input: MediaProviderInput
): Promise<MediaProvider> {
  return getData(mediaControlApi.put(`/admin/v1/media/providers/${id}`, input))
}

export function deleteMediaProvider(id: string): Promise<{ id: string }> {
  return getData(mediaControlApi.delete(`/admin/v1/media/providers/${id}`))
}

export function listRouteNodes(): Promise<RouteNode[]> {
  return getData(mediaControlApi.get('/admin/v1/media/route-nodes'))
}

export function createRouteNode(input: RouteNodeInput): Promise<RouteNode> {
  return getData(mediaControlApi.post('/admin/v1/media/route-nodes', input))
}

export function updateRouteNode(
  id: string,
  input: RouteNodeInput
): Promise<RouteNode> {
  return getData(
    mediaControlApi.put(`/admin/v1/media/route-nodes/${id}`, input)
  )
}

export function deleteRouteNode(id: string): Promise<{ id: string }> {
  return getData(mediaControlApi.delete(`/admin/v1/media/route-nodes/${id}`))
}

export function listMediaOperationLogs(
  query: MediaOperationLogQuery
): Promise<MediaOperationLogPage> {
  return getData(
    mediaControlApi.get('/admin/v1/media/operation-logs', {
      params: query,
    })
  )
}
