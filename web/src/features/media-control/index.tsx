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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, RefreshCw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import {
  deleteMediaModel,
  deleteMediaProvider,
  deleteRouteNode,
  listMediaModels,
  listMediaProviders,
  listRouteNodes,
  mediaControlQueryKeys,
} from './api'
import { MediaModelDialog } from './components/media-model-dialog'
import { MediaModelsTable } from './components/media-models-table'
import { MediaProviderDialog } from './components/media-provider-dialog'
import { MediaProvidersTable } from './components/media-providers-table'
import { RouteNodeDialog } from './components/route-node-dialog'
import { RouteNodesTable } from './components/route-nodes-table'
import type {
  MediaControlSection,
  MediaModel,
  MediaProvider,
  RouteNode,
} from './types'

type DeleteTarget =
  | { kind: 'model'; item: MediaModel }
  | { kind: 'provider'; item: MediaProvider }
  | { kind: 'route-node'; item: RouteNode }

const sectionLabels: Record<MediaControlSection, string> = {
  models: 'Models',
  providers: 'Providers',
  'route-nodes': 'Route nodes',
}
const createLabels: Record<MediaControlSection, string> = {
  models: 'Create model',
  providers: 'Create provider',
  'route-nodes': 'Create route node',
}
const emptyModels: MediaModel[] = []
const emptyProviders: MediaProvider[] = []
const emptyRouteNodes: RouteNode[] = []

export function MediaControl() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [section, setSection] = useState<MediaControlSection>('route-nodes')
  const [search, setSearch] = useState('')
  const [selectedModelID, setSelectedModelID] = useState('all')
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const [routeDialogOpen, setRouteDialogOpen] = useState(false)
  const [currentModel, setCurrentModel] = useState<MediaModel | null>(null)
  const [currentProvider, setCurrentProvider] = useState<MediaProvider | null>(
    null
  )
  const [currentRouteNode, setCurrentRouteNode] = useState<RouteNode | null>(
    null
  )

  const modelsQuery = useQuery({
    queryKey: mediaControlQueryKeys.models(),
    queryFn: listMediaModels,
  })
  const providersQuery = useQuery({
    queryKey: mediaControlQueryKeys.providers(),
    queryFn: listMediaProviders,
  })
  const routeNodesQuery = useQuery({
    queryKey: mediaControlQueryKeys.routeNodes(),
    queryFn: listRouteNodes,
  })
  const models = modelsQuery.data ?? emptyModels
  const providers = providersQuery.data ?? emptyProviders
  const routeNodes = routeNodesQuery.data ?? emptyRouteNodes
  const normalizedSearch = search.trim().toLowerCase()

  const filteredModels = useMemo(
    () =>
      models.filter((item) =>
        `${item.display_name} ${item.key} ${item.description}`
          .toLowerCase()
          .includes(normalizedSearch)
      ),
    [models, normalizedSearch]
  )
  const filteredProviders = useMemo(
    () =>
      providers.filter((item) =>
        `${item.name} ${item.code} ${item.base_url}`
          .toLowerCase()
          .includes(normalizedSearch)
      ),
    [normalizedSearch, providers]
  )
  const filteredRouteNodes = useMemo(
    () =>
      routeNodes.filter((item) => {
        if (selectedModelID !== 'all' && item.model_id !== selectedModelID) {
          return false
        }
        const model = models.find((candidate) => candidate.id === item.model_id)
        const provider = providers.find(
          (candidate) => candidate.id === item.provider_id
        )
        return `${model?.display_name ?? ''} ${model?.key ?? ''} ${
          provider?.name ?? ''
        } ${provider?.code ?? ''} ${item.provider_model}`
          .toLowerCase()
          .includes(normalizedSearch)
      }),
    [models, normalizedSearch, providers, routeNodes, selectedModelID]
  )

  const deleteMutation = useMutation({
    mutationFn: (target: DeleteTarget) => {
      if (target.kind === 'model') return deleteMediaModel(target.item.id)
      if (target.kind === 'provider') {
        return deleteMediaProvider(target.item.id)
      }
      return deleteRouteNode(target.item.id)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: mediaControlQueryKeys.all,
      })
      toast.success(t('Resource deleted'))
    },
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: mediaControlQueryKeys.all })
  }
  const openCreateDialog = () => {
    if (section === 'models') {
      setCurrentModel(null)
      setModelDialogOpen(true)
      return
    }
    if (section === 'providers') {
      setCurrentProvider(null)
      setProviderDialogOpen(true)
      return
    }
    setCurrentRouteNode(null)
    setRouteDialogOpen(true)
  }
  const confirmDelete = (target: DeleteTarget) => {
    if (
      !window.confirm(t('Delete this resource? This action cannot be undone.'))
    ) {
      return
    }
    deleteMutation.mutate(target)
  }

  const isLoading =
    modelsQuery.isPending ||
    providersQuery.isPending ||
    routeNodesQuery.isPending
  const hasError =
    modelsQuery.isError || providersQuery.isError || routeNodesQuery.isError
  const routeCreateBlocked =
    section === 'route-nodes' && (models.length === 0 || providers.length === 0)

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>{t('Image / Video')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button variant='outline' size='sm' onClick={refresh}>
            <RefreshCw />
            {t('Refresh')}
          </Button>
          <Button
            size='sm'
            onClick={openCreateDialog}
            disabled={routeCreateBlocked}
            title={
              routeCreateBlocked
                ? t('Create at least one model and provider first')
                : undefined
            }
          >
            <Plus />
            {t(createLabels[section])}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='bg-card flex h-full min-h-0 flex-col overflow-hidden rounded-xl border'>
            <div className='flex flex-col gap-3 border-b p-3 lg:flex-row lg:items-center lg:justify-between'>
              <Tabs
                value={section}
                onValueChange={(value) =>
                  setSection(value as MediaControlSection)
                }
              >
                <TabsList>
                  {(Object.keys(sectionLabels) as MediaControlSection[]).map(
                    (item) => (
                      <TabsTrigger key={item} value={item}>
                        {t(sectionLabels[item])}
                      </TabsTrigger>
                    )
                  )}
                </TabsList>
              </Tabs>
              <div className='relative w-full lg:w-80'>
                <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('Search models, providers, or routes...')}
                  className='pl-8'
                />
              </div>
            </div>

            <div className='min-h-0 flex-1 overflow-auto'>
              {isLoading && (
                <div className='text-muted-foreground flex h-52 items-center justify-center gap-2 text-sm'>
                  <Loader2 className='size-4 animate-spin' />
                  {t('Loading...')}
                </div>
              )}
              {!isLoading && hasError && (
                <div className='text-destructive flex h-52 items-center justify-center text-sm'>
                  {t('Unable to load the media control plane.')}
                </div>
              )}
              {!isLoading && !hasError && section === 'models' && (
                <MediaModelsTable
                  items={filteredModels}
                  onEdit={(item) => {
                    setCurrentModel(item)
                    setModelDialogOpen(true)
                  }}
                  onDelete={(item) => confirmDelete({ kind: 'model', item })}
                />
              )}
              {!isLoading && !hasError && section === 'providers' && (
                <MediaProvidersTable
                  items={filteredProviders}
                  onEdit={(item) => {
                    setCurrentProvider(item)
                    setProviderDialogOpen(true)
                  }}
                  onDelete={(item) => confirmDelete({ kind: 'provider', item })}
                />
              )}
              {!isLoading && !hasError && section === 'route-nodes' && (
                <div className='flex min-h-full flex-col lg:flex-row'>
                  <aside className='bg-muted/20 w-full shrink-0 border-b p-2 lg:w-64 lg:border-r lg:border-b-0'>
                    <div className='text-muted-foreground px-2 py-2 text-xs font-medium uppercase'>
                      {t('Platform models')}
                    </div>
                    <button
                      type='button'
                      onClick={() => setSelectedModelID('all')}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                        selectedModelID === 'all'
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-accent/60'
                      }`}
                    >
                      <span>{t('All models')}</span>
                      <span className='text-muted-foreground'>
                        {routeNodes.length}
                      </span>
                    </button>
                    {models.map((model) => (
                      <button
                        key={model.id}
                        type='button'
                        onClick={() => setSelectedModelID(model.id)}
                        className={`mt-1 flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                          selectedModelID === model.id
                            ? 'bg-accent text-accent-foreground'
                            : 'hover:bg-accent/60'
                        }`}
                      >
                        <span className='truncate'>{model.display_name}</span>
                        <span className='text-muted-foreground'>
                          {
                            routeNodes.filter(
                              (node) => node.model_id === model.id
                            ).length
                          }
                        </span>
                      </button>
                    ))}
                  </aside>
                  <div className='min-w-0 flex-1'>
                    <RouteNodesTable
                      items={filteredRouteNodes}
                      models={models}
                      providers={providers}
                      onEdit={(item) => {
                        setCurrentRouteNode(item)
                        setRouteDialogOpen(true)
                      }}
                      onDelete={(item) =>
                        confirmDelete({ kind: 'route-node', item })
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <MediaModelDialog
        open={modelDialogOpen}
        onOpenChange={setModelDialogOpen}
        current={currentModel}
      />
      <MediaProviderDialog
        open={providerDialogOpen}
        onOpenChange={setProviderDialogOpen}
        current={currentProvider}
      />
      <RouteNodeDialog
        open={routeDialogOpen}
        onOpenChange={setRouteDialogOpen}
        current={currentRouteNode}
        models={models}
        providers={providers}
      />
    </>
  )
}
