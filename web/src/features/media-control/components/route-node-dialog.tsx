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

import { createRouteNode, mediaControlQueryKeys, updateRouteNode } from '../api'
import { routeNodeFormSchema, type RouteNodeFormValues } from '../lib/schemas'
import type {
  MediaModel,
  MediaProvider,
  RouteNode,
  RouteNodeInput,
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
  const form = useForm<RouteNodeFormValues>({
    resolver: zodResolver(routeNodeFormSchema),
    defaultValues: {
      model_id: '',
      provider_id: '',
      provider_model: '',
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
    form.reset(
      current
        ? {
            model_id: current.model_id,
            provider_id: current.provider_id,
            provider_model: current.provider_model,
            weight: current.weight,
            priority: current.priority,
            rpm_limit: current.rpm_limit,
            tpm_limit: current.tpm_limit,
            enabled: current.enabled,
            disable_reason: current.disable_reason,
            change_reason: '',
          }
        : {
            model_id: models[0]?.id ?? '',
            provider_id: providers[0]?.id ?? '',
            provider_model: '',
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
    mutation.mutate(values)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t(isEdit ? 'Edit route node' : 'Create route node')}
      description={t(
        'A provider and a platform model form one independently weighted route node.'
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
                  <select className={selectClassName} {...field}>
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
                <FormLabel>{t('Provider')}</FormLabel>
                <FormControl>
                  <select className={selectClassName} {...field}>
                    <option value=''>{t('Select a provider')}</option>
                    {props.providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name} · {provider.media_type}
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
                  {t('The actual model identifier sent to the provider.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
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
                      'Adjust provider weight after quota recovery'
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
