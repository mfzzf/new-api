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
import type { MediaHTTPMethod, MediaType } from '../types'

export type RouteProtocolDefaults = {
  submitPath: string
  submitMethod: MediaHTTPMethod
  statusPath: string
  statusMethod: MediaHTTPMethod | ''
  passthroughEnabled: boolean
}

export function getRouteProtocolDefaults(
  mediaType: MediaType | undefined
): RouteProtocolDefaults {
  if (mediaType === 'video') {
    return {
      submitPath: '/v1/videos',
      submitMethod: 'POST',
      statusPath: '/v1/videos/{task_id}',
      statusMethod: 'GET',
      passthroughEnabled: true,
    }
  }
  return {
    submitPath: '/v1/images/generations',
    submitMethod: 'POST',
    statusPath: '',
    statusMethod: '',
    passthroughEnabled: true,
  }
}
