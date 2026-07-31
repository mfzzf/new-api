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
import { Building2, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { MEDIA_PROVIDER_ADAPTER_LABELS } from '../lib/provider-display'
import type { MediaProvider } from '../types'

const mediaTypeLabels = {
  image: 'Image',
  video: 'Video',
  image_and_video: 'Image and video',
} as const

type MediaProvidersTableProps = {
  items: MediaProvider[]
  onEdit: (item: MediaProvider) => void
  onDelete: (item: MediaProvider) => void
}

export function MediaProvidersTable(props: MediaProvidersTableProps) {
  const { t } = useTranslation()
  if (props.items.length === 0) {
    return (
      <div className='text-muted-foreground flex h-52 items-center justify-center text-sm'>
        {t('No provider accounts found')}
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('Provider account')}</TableHead>
          <TableHead>{t('Adapter type')}</TableHead>
          <TableHead>{t('Media type')}</TableHead>
          <TableHead>{t('Base URL')}</TableHead>
          <TableHead>{t('API Key')}</TableHead>
          <TableHead>{t('Status')}</TableHead>
          <TableHead className='text-right'>{t('Actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.items.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              <div className='flex min-w-48 items-center gap-3'>
                <div className='bg-muted flex size-8 items-center justify-center rounded-full'>
                  <Building2 className='text-muted-foreground size-4' />
                </div>
                <div>
                  <div className='font-medium'>{item.name}</div>
                  <div className='text-muted-foreground font-mono text-xs'>
                    {item.code}
                  </div>
                </div>
              </div>
            </TableCell>
            <TableCell>
              <Badge variant='secondary'>
                {t(MEDIA_PROVIDER_ADAPTER_LABELS[item.adapter_type])}
              </Badge>
            </TableCell>
            <TableCell>
              <Badge variant='outline'>
                {t(mediaTypeLabels[item.media_type])}
              </Badge>
            </TableCell>
            <TableCell>
              <span className='block max-w-72 truncate font-mono text-xs'>
                {item.base_url}
              </span>
            </TableCell>
            <TableCell>
              {item.has_api_key ? (
                <code className='bg-muted rounded px-2 py-1 text-xs'>
                  {t('Configured')} · {item.api_key_hint || '••••'}
                </code>
              ) : (
                <span className='text-muted-foreground text-xs'>
                  {t('Not configured')}
                </span>
              )}
            </TableCell>
            <TableCell>
              <Badge
                variant='outline'
                className={
                  item.enabled
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                    : 'text-muted-foreground'
                }
              >
                {t(item.enabled ? 'Enabled' : 'Disabled')}
              </Badge>
            </TableCell>
            <TableCell>
              <div className='flex justify-end gap-1'>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-label={t('Edit provider account')}
                  onClick={() => props.onEdit(item)}
                >
                  <Pencil />
                </Button>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-label={t('Delete provider account')}
                  onClick={() => props.onDelete(item)}
                >
                  <Trash2 className='text-destructive' />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
