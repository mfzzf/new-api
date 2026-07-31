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
import type {
  MediaModel,
  MediaProvider,
  MediaProviderAdapterType,
} from '../types'

export const MEDIA_PROVIDER_ADAPTER_LABELS: Record<
  MediaProviderAdapterType,
  string
> = {
  mock: 'Mock',
  openai: 'OpenAI media protocol',
  openai_images: 'OpenAI-compatible Images',
  gemini: 'Google Gemini media',
  kie: 'KIE task protocol',
  qianfan: 'Baidu Qianfan video',
  tencentcloud: 'Tencent Cloud VOD AIGC',
  tuzi: 'Tuzi multipart video',
}

type ProviderAccountOption = Pick<MediaProvider, 'code' | 'name'>

export function formatProviderAccountOption(
  provider: ProviderAccountOption,
  adapterLabel: string
): string {
  return `${provider.name} · ${provider.code} · ${adapterLabel}`
}

export function isProviderCompatibleWithModel(
  provider: Pick<MediaProvider, 'media_type'>,
  model: Pick<MediaModel, 'media_type'>
): boolean {
  return (
    provider.media_type === 'image_and_video' ||
    provider.media_type === model.media_type
  )
}
