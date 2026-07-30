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

import {
  createMediaProvider,
  mediaControlQueryKeys,
  updateMediaProvider,
} from '../api'
import {
  mediaProviderFormSchema,
  type MediaProviderFormValues,
} from '../lib/schemas'
import type { MediaProvider, MediaProviderInput } from '../types'

const formID = 'media-provider-form'
const selectClassName =
  'border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3'

type MediaProviderDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  current: MediaProvider | null
}

export function MediaProviderDialog(props: MediaProviderDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isEdit = props.current !== null
  const current = props.current
  const open = props.open
  const form = useForm<MediaProviderFormValues>({
    resolver: zodResolver(mediaProviderFormSchema),
    defaultValues: {
      code: '',
      name: '',
      media_type: 'image_and_video',
      base_url: '',
      api_key: '',
      metadata_json: '{}',
      enabled: true,
    },
  })
  const mutation = useMutation({
    mutationFn: (input: MediaProviderInput) =>
      props.current
        ? updateMediaProvider(props.current.id, input)
        : createMediaProvider(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: mediaControlQueryKeys.providers(),
      })
      toast.success(t(isEdit ? 'Provider updated' : 'Provider created'))
      props.onOpenChange(false)
    },
  })

  useEffect(() => {
    if (!open) return
    form.reset(
      current
        ? {
            code: current.code,
            name: current.name,
            media_type: current.media_type,
            base_url: current.base_url,
            api_key: '',
            metadata_json: JSON.stringify(current.metadata, null, 2),
            enabled: current.enabled,
          }
        : {
            code: '',
            name: '',
            media_type: 'image_and_video',
            base_url: '',
            api_key: '',
            metadata_json: '{}',
            enabled: true,
          }
    )
  }, [current, form, open])

  const submit = (values: MediaProviderFormValues) => {
    if ((!isEdit || !current?.has_api_key) && !values.api_key) {
      form.setError('api_key', {
        type: 'required',
        message: t('API Key is required'),
      })
      return
    }
    mutation.mutate({
      code: values.code,
      name: values.name,
      media_type: values.media_type,
      base_url: values.base_url,
      api_key: values.api_key,
      metadata: JSON.parse(values.metadata_json) as Record<string, unknown>,
      enabled: values.enabled,
    })
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t(isEdit ? 'Edit media provider' : 'Create media provider')}
      description={t('Configure the provider endpoint and API Key.')}
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
            name='code'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Provider code')}</FormLabel>
                <FormControl>
                  <Input placeholder='fal-ai' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='name'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Provider name')}</FormLabel>
                <FormControl>
                  <Input placeholder='FAL AI' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='media_type'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Media type')}</FormLabel>
                <FormControl>
                  <select className={selectClassName} {...field}>
                    <option value='image'>{t('Image')}</option>
                    <option value='video'>{t('Video')}</option>
                    <option value='image_and_video'>
                      {t('Image and video')}
                    </option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='base_url'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Base URL')}</FormLabel>
                <FormControl>
                  <Input
                    placeholder='https://api.provider.example/v1'
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='api_key'
            render={({ field }) => (
              <FormItem className='sm:col-span-2'>
                <FormLabel>{t('API Key')}</FormLabel>
                <FormControl>
                  <Input
                    type='password'
                    autoComplete='new-password'
                    placeholder='sk-...'
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {isEdit && current?.has_api_key
                    ? t(
                        'API Key configured as {{hint}}. Leave blank to keep it.',
                        {
                          hint: current.api_key_hint || '••••',
                        }
                      )
                    : t(
                        'The API Key is encrypted at rest and is never returned after saving.'
                      )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='metadata_json'
            render={({ field }) => (
              <FormItem className='sm:col-span-2'>
                <FormLabel>{t('Provider metadata')}</FormLabel>
                <FormControl>
                  <Textarea rows={5} className='font-mono text-xs' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <FormItem className='sm:col-span-2'>
                <div className='flex items-center justify-between rounded-lg border p-3'>
                  <div>
                    <FormLabel>{t('Enabled')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Disabled providers are excluded from all route nodes.'
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
        </form>
      </Form>
    </Dialog>
  )
}
