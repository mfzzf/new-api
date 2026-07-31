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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { createRouteNode, mediaControlQueryKeys, updateRouteNode } from '../api'
import {
  formatProviderAccountOption,
  isProviderCompatibleWithModel,
  MEDIA_PROVIDER_ADAPTER_LABELS,
} from '../lib/provider-display'
import { getRouteProtocolDefaults } from '../lib/route-protocol'
import { routeNodeFormSchema, type RouteNodeFormValues } from '../lib/schemas'
import {
  MEDIA_HTTP_METHODS,
  type MediaModel,
  type MediaProvider,
  type RouteNode,
  type RouteNodeInput,
} from '../types'

const formID = 'route-node-form'
const selectClassName =
  'border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3'
const numericFieldLabels = {
  weight: 'Weight',
  priority: 'Priority',
  rpm_limit: 'RPM limit',
  tpm_limit: 'TPM limit',
} as const
const protocolJSONFieldLabels = {
  param_mapping_json: 'Parameter mapping JSON',
  response_mapping_json: 'Response mapping JSON',
  static_body_json: 'Static request body JSON',
  public_protocol_json: 'Public protocol JSON',
} as const

type RouteNodeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  current: RouteNode | null
  models: MediaModel[]
  providers: MediaProvider[]
}

export function RouteNodeDialog(props: RouteNodeDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isEdit = props.current !== null
  const current = props.current
  const models = props.models
  const open = props.open
  const providers = props.providers
  const initialModel =
    models.find((model) =>
      providers.some((provider) =>
        isProviderCompatibleWithModel(provider, model)
      )
    ) ?? models[0]
  const initialProtocol = getRouteProtocolDefaults(initialModel?.media_type)
  const initialProvider = initialModel
    ? providers.find((provider) =>
        isProviderCompatibleWithModel(provider, initialModel)
      )
    : providers[0]
  const form = useForm<RouteNodeFormValues>({
    resolver: zodResolver(routeNodeFormSchema),
    defaultValues: {
      model_id: initialModel?.id ?? '',
      provider_id: initialProvider?.id ?? '',
      provider_model: '',
      submit_path: initialProtocol.submitPath,
      submit_method: initialProtocol.submitMethod,
      status_path: initialProtocol.statusPath,
      status_method: initialProtocol.statusMethod,
      param_mapping_json: '{}',
      response_mapping_json: '{}',
      static_body_json: '{}',
      public_protocol_json: '{}',
      passthrough_enabled: initialProtocol.passthroughEnabled,
      request_timeout_ms: 120000,
      weight: 5,
      priority: 5,
      rpm_limit: 0,
      tpm_limit: 0,
      enabled: true,
      disable_reason: '',
      change_reason: '',
    },
  })
  const enabled = form.watch('enabled')
  const selectedModelID = form.watch('model_id')
  const statusPath = form.watch('status_path')
  const selectedModel = models.find((model) => model.id === selectedModelID)
  const compatibleProviders = selectedModel
    ? providers.filter((provider) =>
        isProviderCompatibleWithModel(provider, selectedModel)
      )
    : providers
  const mutation = useMutation({
    mutationFn: (input: RouteNodeInput) =>
      props.current
        ? updateRouteNode(props.current.id, input)
        : createRouteNode(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: mediaControlQueryKeys.routeNodes(),
      })
      toast.success(t(isEdit ? 'Route node updated' : 'Route node created'))
      props.onOpenChange(false)
    },
  })

  useEffect(() => {
    if (!open) return
    const firstModel =
      models.find((model) =>
        providers.some((provider) =>
          isProviderCompatibleWithModel(provider, model)
        )
      ) ?? models[0]
    const protocol = getRouteProtocolDefaults(firstModel?.media_type)
    const firstProvider = firstModel
      ? providers.find((provider) =>
          isProviderCompatibleWithModel(provider, firstModel)
        )
      : providers[0]
    form.reset(
      current
        ? {
            model_id: current.model_id,
            provider_id: current.provider_id,
            provider_model: current.provider_model,
            submit_path: current.submit_path,
            submit_method: current.submit_method,
            status_path: current.status_path,
            status_method: current.status_method,
            param_mapping_json: JSON.stringify(current.param_mapping, null, 2),
            response_mapping_json: JSON.stringify(
              current.response_mapping,
              null,
              2
            ),
            static_body_json: JSON.stringify(current.static_body, null, 2),
            public_protocol_json: JSON.stringify(
              current.public_protocol,
              null,
              2
            ),
            passthrough_enabled: current.passthrough_enabled,
            request_timeout_ms: current.request_timeout_ms,
            weight: current.weight,
            priority: current.priority,
            rpm_limit: current.rpm_limit,
            tpm_limit: current.tpm_limit,
            enabled: current.enabled,
            disable_reason: current.disable_reason,
            change_reason: '',
          }
        : {
            model_id: firstModel?.id ?? '',
            provider_id: firstProvider?.id ?? '',
            provider_model: '',
            submit_path: protocol.submitPath,
            submit_method: protocol.submitMethod,
            status_path: protocol.statusPath,
            status_method: protocol.statusMethod,
            param_mapping_json: '{}',
            response_mapping_json: '{}',
            static_body_json: '{}',
            public_protocol_json: '{}',
            passthrough_enabled: protocol.passthroughEnabled,
            request_timeout_ms: 120000,
            weight: 5,
            priority: 5,
            rpm_limit: 0,
            tpm_limit: 0,
            enabled: true,
            disable_reason: '',
            change_reason: '',
          }
    )
  }, [current, form, models, open, providers])

  const submit = (values: RouteNodeFormValues) => {
    if (isEdit && !values.change_reason.trim()) {
      form.setError('change_reason', {
        message: t('Change reason is required when editing a route node'),
      })
      return
    }
    mutation.mutate({
      model_id: values.model_id,
      provider_id: values.provider_id,
      provider_model: values.provider_model,
      submit_path: values.submit_path,
      submit_method: values.submit_method,
      status_path: values.status_path,
      status_method: values.status_path ? values.status_method : '',
      param_mapping: JSON.parse(values.param_mapping_json) as Record<
        string,
        unknown
      >,
      response_mapping: JSON.parse(values.response_mapping_json) as Record<
        string,
        unknown
      >,
      static_body: JSON.parse(values.static_body_json) as Record<
        string,
        unknown
      >,
      public_protocol: JSON.parse(values.public_protocol_json) as Record<
        string,
        unknown
      >,
      passthrough_enabled: values.passthrough_enabled,
      request_timeout_ms: values.request_timeout_ms,
      weight: values.weight,
      priority: values.priority,
      rpm_limit: values.rpm_limit,
      tpm_limit: values.tpm_limit,
      enabled: values.enabled,
      disable_reason: values.disable_reason,
      change_reason: values.change_reason,
    })
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t(isEdit ? 'Edit route node' : 'Create route node')}
      description={t(
        'A provider account and a platform model form one independently weighted route node.'
      )}
      contentHeight='min(620px, calc(100vh - 14rem))'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={mutation.isPending}
          >
            {t('Cancel')}
          </Button>
          <Button type='submit' form={formID} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className='animate-spin' />}
            {t('Save')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id={formID}
          onSubmit={form.handleSubmit(submit)}
          className='grid gap-4 sm:grid-cols-2'
        >
          <FormField
            control={form.control}
            name='model_id'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Platform model')}</FormLabel>
                <FormControl>
                  <select
                    className={selectClassName}
                    {...field}
                    onChange={(event) => {
                      field.onChange(event)
                      const nextModel = models.find(
                        (model) => model.id === event.target.value
                      )
                      const nextProvider = nextModel
                        ? providers.find((provider) =>
                            isProviderCompatibleWithModel(provider, nextModel)
                          )
                        : providers[0]
                      const currentProvider = providers.find(
                        (provider) =>
                          provider.id === form.getValues('provider_id')
                      )
                      if (
                        nextModel &&
                        (!currentProvider ||
                          !isProviderCompatibleWithModel(
                            currentProvider,
                            nextModel
                          ))
                      ) {
                        form.setValue('provider_id', nextProvider?.id ?? '', {
                          shouldValidate: true,
                        })
                      }
                      if (!current) {
                        const defaults = getRouteProtocolDefaults(
                          nextModel?.media_type
                        )
                        form.setValue('submit_path', defaults.submitPath)
                        form.setValue('submit_method', defaults.submitMethod)
                        form.setValue('status_path', defaults.statusPath)
                        form.setValue('status_method', defaults.statusMethod)
                      }
                    }}
                  >
                    <option value=''>{t('Select a model')}</option>
                    {props.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.display_name} · {model.media_type}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='provider_id'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Provider account')}</FormLabel>
                <FormControl>
                  <select className={selectClassName} {...field}>
                    <option value=''>{t('Select a provider account')}</option>
                    {compatibleProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {formatProviderAccountOption(
                          provider,
                          t(
                            MEDIA_PROVIDER_ADAPTER_LABELS[provider.adapter_type]
                          )
                        )}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='provider_model'
            render={({ field }) => (
              <FormItem className='sm:col-span-2'>
                <FormLabel>{t('Provider model name')}</FormLabel>
                <FormControl>
                  <Input placeholder='provider/image-pro-v2' {...field} />
                </FormControl>
                <FormDescription>
                  {t(
                    'The actual model identifier sent through this provider account.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className='sm:col-span-2'>
            <div className='text-sm font-medium'>{t('Upstream protocol')}</div>
            <div className='text-muted-foreground text-xs'>
              {t(
                'These fields belong to this model and provider account route, not to the reusable Adapter.'
              )}
            </div>
          </div>
          <FormField
            control={form.control}
            name='submit_path'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Submit path')}</FormLabel>
                <FormControl>
                  <Input placeholder='/api/v1/jobs/createTask' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='submit_method'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Submit method')}</FormLabel>
                <FormControl>
                  <select className={selectClassName} {...field}>
                    {MEDIA_HTTP_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='status_path'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Status path')}</FormLabel>
                <FormControl>
                  <Input
                    placeholder='/api/v1/jobs/{task_id}'
                    {...field}
                    onChange={(event) => {
                      field.onChange(event)
                      if (!event.target.value.trim()) {
                        form.setValue('status_method', '', {
                          shouldValidate: true,
                        })
                      } else if (!form.getValues('status_method')) {
                        form.setValue('status_method', 'GET', {
                          shouldValidate: true,
                        })
                      }
                    }}
                  />
                </FormControl>
                <FormDescription>
                  {t('Leave blank for synchronous-only routes.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='status_method'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Status method')}</FormLabel>
                <FormControl>
                  <select
                    className={selectClassName}
                    disabled={!statusPath.trim()}
                    {...field}
                  >
                    <option value=''>{t('Not applicable')}</option>
                    {MEDIA_HTTP_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='request_timeout_ms'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Request timeout (ms)')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={1000}
                    max={600000}
                    value={field.value}
                    onChange={(event) =>
                      field.onChange(Number(event.target.value))
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='passthrough_enabled'
            render={({ field }) => (
              <FormItem>
                <div className='flex h-full items-center justify-between rounded-lg border p-3'>
                  <div>
                    <FormLabel>{t('Allow unmapped parameters')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Enabled by default. Disable only after configuring a complete parameter schema and mapping.'
                      )}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </div>
              </FormItem>
            )}
          />
          {(
            Object.keys(protocolJSONFieldLabels) as Array<
              keyof typeof protocolJSONFieldLabels
            >
          ).map((name) => (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <FormItem className='sm:col-span-2'>
                  <FormLabel>{t(protocolJSONFieldLabels[name])}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={4}
                      className='font-mono text-xs'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
          {(['weight', 'priority', 'rpm_limit', 'tpm_limit'] as const).map(
            (name) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t(numericFieldLabels[name])}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        value={field.value}
                        onChange={(event) =>
                          field.onChange(Number(event.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )
          )}
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <FormItem className='sm:col-span-2'>
                <div className='flex items-center justify-between rounded-lg border p-3'>
                  <div>
                    <FormLabel>{t('Enabled')}</FormLabel>
                    <FormDescription>
                      {t('Only enabled route nodes participate in routing.')}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </div>
              </FormItem>
            )}
          />
          {!enabled && (
            <FormField
              control={form.control}
              name='disable_reason'
              render={({ field }) => (
                <FormItem className='sm:col-span-2'>
                  <FormLabel>{t('Disable reason')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('Quota exhausted')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          <FormField
            control={form.control}
            name='change_reason'
            render={({ field }) => (
              <FormItem className='sm:col-span-2'>
                <FormLabel>
                  {t(isEdit ? 'Change reason' : 'Initial configuration note')}
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder={t(
                      'Adjust provider account weight after quota recovery'
                    )}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </Dialog>
  )
}
