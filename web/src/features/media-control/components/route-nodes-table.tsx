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
import { Pencil, Trash2 } from 'lucide-react'
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
import type { MediaModel, MediaProvider, RouteNode } from '../types'

type RouteNodesTableProps = {
  items: RouteNode[]
  models: MediaModel[]
  providers: MediaProvider[]
  onEdit: (item: RouteNode) => void
  onDelete: (item: RouteNode) => void
}

export function RouteNodesTable(props: RouteNodesTableProps) {
  const { t } = useTranslation()
  const models = new Map(props.models.map((item) => [item.id, item]))
  const providers = new Map(props.providers.map((item) => [item.id, item]))
  if (props.items.length === 0) {
    return (
      <div className='text-muted-foreground flex h-52 items-center justify-center text-sm'>
        {t('No route nodes found')}
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('Provider account')}</TableHead>
          <TableHead>{t('Platform model')}</TableHead>
          <TableHead>{t('Provider model')}</TableHead>
          <TableHead>{t('Upstream endpoint')}</TableHead>
          <TableHead>{t('TPM / RPM')}</TableHead>
          <TableHead>{t('Weight')}</TableHead>
          <TableHead>{t('Priority')}</TableHead>
          <TableHead>{t('Status')}</TableHead>
          <TableHead className='text-right'>{t('Actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.items.map((item) => {
          const model = models.get(item.model_id)
          const provider = providers.get(item.provider_id)
          return (
            <TableRow key={item.id}>
              <TableCell>
                <div className='font-medium'>
                  {provider?.name ?? item.provider_id}
                </div>
                <div className='text-muted-foreground flex items-center gap-2 font-mono text-xs'>
                  <span>{provider?.code ?? item.provider_id}</span>
                  {provider && (
                    <Badge variant='secondary'>
                      {t(MEDIA_PROVIDER_ADAPTER_LABELS[provider.adapter_type])}
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div>{model?.display_name ?? item.model_id}</div>
                <div className='text-muted-foreground font-mono text-xs'>
                  {model?.key}
                </div>
              </TableCell>
              <TableCell className='font-mono text-xs'>
                {item.provider_model}
              </TableCell>
              <TableCell>
                <div className='flex min-w-56 items-center gap-2'>
                  <Badge variant='outline'>{item.submit_method}</Badge>
                  <code
                    className='text-muted-foreground max-w-64 truncate text-xs'
                    title={item.submit_path}
                  >
                    {item.submit_path}
                  </code>
                </div>
                {item.status_path && (
                  <div className='mt-1 flex items-center gap-2'>
                    <Badge variant='secondary'>{item.status_method}</Badge>
                    <code
                      className='text-muted-foreground max-w-64 truncate text-xs'
                      title={item.status_path}
                    >
                      {item.status_path}
                    </code>
                  </div>
                )}
                <div className='text-muted-foreground mt-1 text-xs'>
                  {t('{{seconds}}s timeout', {
                    seconds: item.request_timeout_ms / 1000,
                  })}
                  {' · '}
                  {item.passthrough_enabled
                    ? t('Passthrough enabled')
                    : t('Mapped parameters only')}
                </div>
              </TableCell>
              <TableCell className='text-muted-foreground'>
                {item.tpm_limit || '—'} / {item.rpm_limit || '—'}
              </TableCell>
              <TableCell>
                <span className='inline-flex min-w-14 justify-center rounded-lg border px-3 py-1.5'>
                  {item.weight}
                </span>
              </TableCell>
              <TableCell>
                <span className='inline-flex min-w-14 justify-center rounded-lg border px-3 py-1.5'>
                  {item.priority}
                </span>
              </TableCell>
              <TableCell>
                <Badge
                  variant='outline'
                  title={item.disable_reason}
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
                    aria-label={t('Edit route node')}
                    onClick={() => props.onEdit(item)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('Delete route node')}
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
