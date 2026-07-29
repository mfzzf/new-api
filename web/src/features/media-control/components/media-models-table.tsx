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
import { ImageIcon, Pencil, Trash2, Video } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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

import type { MediaModel } from '../types'

type MediaModelsTableProps = {
  items: MediaModel[]
  onEdit: (item: MediaModel) => void
  onDelete: (item: MediaModel) => void
}

export function MediaModelsTable(props: MediaModelsTableProps) {
  const { t } = useTranslation()
  if (props.items.length === 0) {
    return (
      <div className='text-muted-foreground flex h-52 items-center justify-center text-sm'>
        {t('No image / video models found')}
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('Model')}</TableHead>
          <TableHead>{t('Media type')}</TableHead>
          <TableHead>{t('Metadata')}</TableHead>
          <TableHead>{t('Status')}</TableHead>
          <TableHead className='text-right'>{t('Actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.items.map((item) => {
          const MediaIcon = item.media_type === 'image' ? ImageIcon : Video
          return (
            <TableRow key={item.id}>
              <TableCell>
                <div className='flex min-w-56 items-center gap-3'>
                  <Avatar>
                    {item.logo_url && (
                      <AvatarImage
                        src={item.logo_url}
                        alt={item.display_name}
                      />
                    )}
                    <AvatarFallback>
                      <MediaIcon className='size-4' aria-hidden='true' />
                    </AvatarFallback>
                  </Avatar>
                  <div className='min-w-0'>
                    <div className='truncate font-medium'>
                      {item.display_name}
                    </div>
                    <div className='text-muted-foreground truncate font-mono text-xs'>
                      {item.key}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant='outline'>
                  {t(item.media_type === 'image' ? 'Image' : 'Video')}
                </Badge>
              </TableCell>
              <TableCell>
                <span
                  className='text-muted-foreground block max-w-80 truncate text-xs'
                  title={item.description}
                >
                  {item.description || JSON.stringify(item.metadata)}
                </span>
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
                    aria-label={t('Edit model')}
                    onClick={() => props.onEdit(item)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('Delete model')}
                    onClick={() => props.onDelete(item)}
                  >
                    <Trash2 className='text-destructive' />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
