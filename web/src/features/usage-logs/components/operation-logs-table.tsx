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
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { RefreshCw, Search } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { listMediaOperationLogs } from '@/features/media-control/api'
import type {
  MediaOperationAction,
  MediaOperationLog,
  MediaOperationResourceType,
} from '@/features/media-control/types'
import { toIntlLocale } from '@/i18n/languages'
import { cn } from '@/lib/utils'

const pageSize = 20
const selectClassName =
  'border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3'

const actionLabels: Record<MediaOperationAction, string> = {
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
}

const resourceLabels: Record<MediaOperationResourceType, string> = {
  model: 'Model',
  provider: 'Provider',
  route_node: 'Route node',
}

const detailLabels: Record<string, string> = {
  key: 'Model ID',
  code: 'Provider code',
  media_type: 'Media type',
  base_url: 'Base URL',
  enabled: 'Status',
  api_key_changed: 'API Key changed',
  model_id: 'Model ID',
  provider_id: 'Provider',
  provider_model: 'Provider model',
  weight: 'Weight',
  priority: 'Priority',
  rpm_limit: 'RPM limit',
  tpm_limit: 'TPM limit',
  disable_reason: 'Disable reason',
  last_change_reason: 'Change reason',
}

function formatDetailValue(value: unknown, t: (key: string) => string) {
  if (typeof value === 'boolean') return t(value ? 'Yes' : 'No')
  if (value == null || value === '') return '—'
  return String(value)
}

function OperationDetails({ item }: { item: MediaOperationLog }) {
  const { t } = useTranslation()
  return (
    <div className='flex max-w-xl min-w-72 flex-wrap gap-1.5'>
      {Object.entries(item.details).map(([key, value]) => (
        <span
          key={key}
          className='bg-muted/70 inline-flex max-w-full items-center gap-1 rounded px-1.5 py-1 text-xs'
        >
          <span className='text-muted-foreground'>
            {t(detailLabels[key] ?? key)}:
          </span>
          <span className='max-w-56 truncate font-mono'>
            {formatDetailValue(value, t)}
          </span>
        </span>
      ))}
    </div>
  )
}

function OperationTableRows({
  items,
  isLoading,
  isError,
}: {
  items: MediaOperationLog[]
  isLoading: boolean
  isError: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  if (isLoading) {
    return (
      <TableRow>
        <TableCell
          colSpan={5}
          className='text-muted-foreground h-40 text-center'
        >
          {t('Loading...')}
        </TableCell>
      </TableRow>
    )
  }
  if (isError) {
    return (
      <TableRow>
        <TableCell colSpan={5} className='text-destructive h-40 text-center'>
          {t('Unable to load operation logs.')}
        </TableCell>
      </TableRow>
    )
  }
  if (items.length === 0) {
    return (
      <TableRow>
        <TableCell
          colSpan={5}
          className='text-muted-foreground h-40 text-center'
        >
          {t('No operation logs found')}
        </TableCell>
      </TableRow>
    )
  }
  return items.map((item) => (
    <TableRow key={item.id}>
      <TableCell className='text-muted-foreground font-mono text-xs'>
        {new Date(item.created_at).toLocaleString(locale)}
      </TableCell>
      <TableCell>
        <div className='font-medium'>
          {item.actor.display_name || item.actor.username}
        </div>
        <div className='text-muted-foreground text-xs'>
          {item.actor.username} · #{item.actor.id}
        </div>
      </TableCell>
      <TableCell>
        <Badge
          variant={item.action === 'delete' ? 'destructive' : 'outline'}
          className={cn(
            item.action === 'create' &&
              'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
            item.action === 'update' &&
              'border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
          )}
        >
          {t(actionLabels[item.action])}
        </Badge>
      </TableCell>
      <TableCell>
        <div className='flex items-center gap-2'>
          <Badge variant='secondary'>
            {t(resourceLabels[item.resource_type])}
          </Badge>
          <span className='font-medium'>{item.resource_name}</span>
        </div>
        <div className='text-muted-foreground mt-1 font-mono text-xs'>
          {item.resource_id}
        </div>
      </TableCell>
      <TableCell>
        <OperationDetails item={item} />
      </TableCell>
    </TableRow>
  ))
}

export function OperationLogsTable() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [action, setAction] = useState<MediaOperationAction | ''>('')
  const [resourceType, setResourceType] = useState<
    MediaOperationResourceType | ''
  >('')
  const query = useQuery({
    queryKey: ['media-operation-logs', page, action, resourceType, search],
    queryFn: () =>
      listMediaOperationLogs({
        page,
        page_size: pageSize,
        action,
        resource_type: resourceType,
        search,
      }),
    placeholderData: keepPreviousData,
  })

  const total = query.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const items = query.data?.items ?? []

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    setPage(1)
    setSearch(searchInput.trim())
  }

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <form
        className='flex flex-wrap items-center gap-2'
        onSubmit={submitSearch}
      >
        <div className='relative min-w-56 flex-1 sm:max-w-sm'>
          <Search className='text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t('Search operators or resources...')}
            className='pl-8'
          />
        </div>
        <select
          className={selectClassName}
          value={action}
          onChange={(event) => {
            setPage(1)
            setAction(event.target.value as MediaOperationAction | '')
          }}
          aria-label={t('Operation')}
        >
          <option value=''>{t('All actions')}</option>
          <option value='create'>{t('Create')}</option>
          <option value='update'>{t('Update')}</option>
          <option value='delete'>{t('Delete')}</option>
        </select>
        <select
          className={selectClassName}
          value={resourceType}
          onChange={(event) => {
            setPage(1)
            setResourceType(
              event.target.value as MediaOperationResourceType | ''
            )
          }}
          aria-label={t('Resource')}
        >
          <option value=''>{t('All resources')}</option>
          <option value='model'>{t('Model')}</option>
          <option value='provider'>{t('Provider')}</option>
          <option value='route_node'>{t('Route node')}</option>
        </select>
        <Button type='submit' variant='outline'>
          {t('Search')}
        </Button>
        <Button
          type='button'
          variant='outline'
          size='icon'
          aria-label={t('Refresh')}
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={cn(query.isFetching && 'animate-spin')} />
        </Button>
      </form>

      <div className='min-h-0 flex-1 overflow-auto rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Time')}</TableHead>
              <TableHead>{t('Operator')}</TableHead>
              <TableHead>{t('Operation')}</TableHead>
              <TableHead>{t('Resource')}</TableHead>
              <TableHead>{t('Details')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <OperationTableRows
              items={items}
              isLoading={query.isLoading}
              isError={query.isError}
            />
          </TableBody>
        </Table>
      </div>

      <div className='flex items-center justify-between gap-3 text-sm'>
        <span className='text-muted-foreground'>
          {t('{{count}} operation logs', { count: total })}
        </span>
        <div className='flex items-center gap-2'>
          <span className='text-muted-foreground'>
            {page} / {totalPages}
          </span>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={page <= 1 || query.isFetching}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            {t('Previous')}
          </Button>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={page >= totalPages || query.isFetching}
            onClick={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
          >
            {t('Next')}
          </Button>
        </div>
      </div>
    </div>
  )
}
