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
  createMediaModel,
  mediaControlQueryKeys,
  updateMediaModel,
} from '../api'
import { mediaModelFormSchema, type MediaModelFormValues } from '../lib/schemas'
import type { MediaModel, MediaModelInput } from '../types'

const formID = 'media-model-form'
const selectClassName =
  'border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3'

type MediaModelDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  current: MediaModel | null
}

export function MediaModelDialog(props: MediaModelDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isEdit = props.current !== null
  const current = props.current
  const open = props.open
  const form = useForm<MediaModelFormValues>({
    resolver: zodResolver(mediaModelFormSchema),
    defaultValues: {
      key: '',
      display_name: '',
      media_type: 'image',
      description: '',
      logo_url: '',
      metadata_json: '{}',
      enabled: true,
    },
  })
  const mutation = useMutation({
    mutationFn: (input: MediaModelInput) =>
      props.current
        ? updateMediaModel(props.current.id, input)
        : createMediaModel(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: mediaControlQueryKeys.models(),
      })
      toast.success(t(isEdit ? 'Model updated' : 'Model created'))
      props.onOpenChange(false)
    },
  })

  useEffect(() => {
    if (!open) return
    form.reset(
      current
        ? {
            key: current.key,
            display_name: current.display_name,
            media_type: current.media_type,
            description: current.description,
            logo_url: current.logo_url,
            metadata_json: JSON.stringify(current.metadata, null, 2),
            enabled: current.enabled,
          }
        : {
            key: '',
            display_name: '',
            media_type: 'image',
            description: '',
            logo_url: '',
            metadata_json: '{}',
            enabled: true,
          }
    )
  }, [current, form, open])

  const submit = (values: MediaModelFormValues) => {
    mutation.mutate({
      key: values.key,
      display_name: values.display_name,
      media_type: values.media_type,
      description: values.description,
      logo_url: values.logo_url,
      metadata: JSON.parse(values.metadata_json) as Record<string, unknown>,
      enabled: values.enabled,
    })
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t(
        isEdit ? 'Edit image / video model' : 'Create image / video model'
      )}
      description={t(
        'Model metadata is owned by the media control plane and is separate from New API LLM models.'
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
            name='key'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Model ID')}</FormLabel>
                <FormControl>
                  <Input placeholder='image-pro-v1' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='display_name'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Display name')}</FormLabel>
                <FormControl>
                  <Input placeholder={t('Image Pro')} {...field} />
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
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='logo_url'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Logo URL')}</FormLabel>
                <FormControl>
                  <Input
                    placeholder='https://cdn.example/model.png'
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='description'
            render={({ field }) => (
              <FormItem className='sm:col-span-2'>
                <FormLabel>{t('Description')}</FormLabel>
                <FormControl>
                  <Textarea rows={3} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='metadata_json'
            render={({ field }) => (
              <FormItem className='sm:col-span-2'>
                <FormLabel>{t('Model metadata')}</FormLabel>
                <FormControl>
                  <Textarea rows={6} className='font-mono text-xs' {...field} />
                </FormControl>
                <FormDescription>
                  {t(
                    'Store capabilities and display metadata as a JSON object.'
                  )}
                </FormDescription>
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
                        'Disabled models cannot be selected by runtime routing.'
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
