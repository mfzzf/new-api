/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
/* oxlint-disable react/no-array-index-key -- Editable pricing rows have no stable persisted ID; index preserves input focus while keys and bounds change. */
import { Plus, Trash2 } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import { mediaPricingKeys } from '../lib/media-pricing'
import type {
  MediaPricingDimension,
  MediaPricingRange,
  MediaPricingRule,
  MediaType,
} from '../types'

const selectClassName =
  'border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3'

const INPUT_FIELDS = ['has_image_input', 'has_video_input']
const PARAMETER_FIELDS = [
  'resolution',
  'size',
  'quality',
  'tier',
  'megapixels',
  'duration',
  'duration_seconds',
  'seconds',
  'image_count',
]
const VIDEO_DURATIONS = Array.from({ length: 12 }, (_, index) => index + 4)

type Props = {
  modelID: string
  mediaType: MediaType
  value: MediaPricingRule | null
  loading?: boolean
  onChange: (value: MediaPricingRule | null) => void
}

type RangeOperator = 'gt' | 'gte' | 'lt' | 'lte'

function defaultRule(modelID: string, mediaType: MediaType): MediaPricingRule {
  return {
    model_id: modelID.trim(),
    media_type: mediaType,
    enabled: true,
    unit: mediaType === 'image' ? 'image' : 'second',
    currency: 'CNY',
    allowed_duration: mediaType === 'video' ? VIDEO_DURATIONS : undefined,
    dimensions: [],
    template: '{model_id}',
    prices: modelID.trim() ? { [modelID.trim()]: '' } : {},
  }
}

function imageMegapixelPreset(modelID: string): MediaPricingRule {
  return {
    ...defaultRule(modelID, 'image'),
    dimensions: [
      {
        source: 'parameters',
        field: 'megapixels',
        placeholder: 'dimension',
        ranges: [
          { lte: 2.36, value: 'lte_2_36mp' },
          { gt: 2.36, value: 'gt_2_36mp' },
        ],
      },
    ],
    template: '{model_id}-{dimension}',
    prices: {
      [`${modelID}-lte_2_36mp`]: '0.3',
      [`${modelID}-gt_2_36mp`]: '0.6',
    },
  }
}

function videoResolutionPreset(modelID: string): MediaPricingRule {
  return {
    ...defaultRule(modelID, 'video'),
    dimensions: [
      {
        source: 'input',
        field: 'has_video_input',
        placeholder: 'video_input',
        mapping: {
          default: 'no_video',
          false: 'no_video',
          true: 'with_video',
        },
      },
      {
        source: 'parameters',
        field: 'resolution',
        placeholder: 'resolution',
        mapping: {
          default: '720p',
          '1080P': '1080p',
          '1080p': '1080p',
          '720P': '720p',
          '720p': '720p',
          '540P': '540p',
          '540p': '540p',
        },
      },
    ],
    template: '{model_id}-{video_input}-{resolution}',
    prices: {
      [`${modelID}-no_video-1080p`]: '0.3125',
      [`${modelID}-no_video-720p`]: '0.25',
      [`${modelID}-no_video-540p`]: '0.1875',
      [`${modelID}-with_video-1080p`]: '0.3125',
      [`${modelID}-with_video-720p`]: '0.25',
      [`${modelID}-with_video-540p`]: '0.1875',
    },
  }
}

function videoTierReferencePreset(modelID: string): MediaPricingRule {
  return {
    ...defaultRule(modelID, 'video'),
    dimensions: [
      {
        source: 'parameters',
        field: 'tier',
        placeholder: 'tier',
        mapping: {
          default: 'std',
          Pro: 'pro',
          pro: 'pro',
          Std: 'std',
          std: 'std',
        },
      },
      {
        source: 'input',
        field: 'has_video_input',
        placeholder: 'video_input',
        mapping: {
          default: 'no_video',
          false: 'no_video',
          true: 'with_video',
        },
      },
    ],
    template: '{model_id}-{tier}-{video_input}',
    prices: {
      [`${modelID}-pro-no_video`]: '0.8',
      [`${modelID}-pro-with_video`]: '1.2',
      [`${modelID}-std-no_video`]: '0.6',
      [`${modelID}-std-with_video`]: '0.9',
    },
  }
}

export function MediaPricingEditor({
  modelID,
  mediaType,
  value,
  loading,
  onChange,
}: Props) {
  const { t } = useTranslation()
  const [durationText, setDurationText] = useState('')
  const priceKeys = useMemo(
    () => (value ? mediaPricingKeys(value, modelID.trim()) : []),
    [modelID, value]
  )

  useEffect(() => {
    setDurationText((value?.allowed_duration ?? []).join(','))
  }, [value?.allowed_duration])

  const update = (patch: Partial<MediaPricingRule>) => {
    if (!value) return
    onChange({
      ...value,
      model_id: modelID.trim(),
      media_type: mediaType,
      unit: mediaType === 'image' ? 'image' : 'second',
      ...patch,
    })
  }

  const updateDimension = (
    index: number,
    patch: Partial<MediaPricingDimension>
  ) => {
    if (!value) return
    const dimensions = [...(value.dimensions ?? [])]
    dimensions[index] = { ...dimensions[index], ...patch }
    update({ dimensions })
  }

  const setPreset = (
    preset: 'simple' | 'megapixels' | 'resolution' | 'tier'
  ) => {
    if (preset === 'megapixels') return onChange(imageMegapixelPreset(modelID))
    if (preset === 'resolution') return onChange(videoResolutionPreset(modelID))
    if (preset === 'tier') return onChange(videoTierReferencePreset(modelID))
    onChange(defaultRule(modelID, mediaType))
  }

  return (
    <section className='space-y-4 rounded-xl border p-4 sm:col-span-2'>
      <div className='flex items-start justify-between gap-4'>
        <div>
          <h3 className='text-sm font-semibold'>
            {t('Image / video pricing')}
          </h3>
          <p className='text-muted-foreground mt-1 text-xs'>
            {t(
              'Combine resolution, megapixels, tier, and reference input dimensions; images are billed per image and videos per second.'
            )}
          </p>
        </div>
        <Switch
          aria-label={t('Enable complex pricing')}
          checked={value !== null}
          disabled={loading}
          onCheckedChange={(checked) =>
            onChange(checked ? defaultRule(modelID, mediaType) : null)
          }
        />
      </div>

      {loading ? (
        <div className='text-muted-foreground text-sm'>
          {t('Loading pricing...')}
        </div>
      ) : null}
      {!loading && value ? (
        <>
          <div className='flex flex-wrap gap-2'>
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={() => setPreset('simple')}
            >
              {mediaType === 'image'
                ? t('Per-image price')
                : t('Flat per-second price')}
            </Button>
            {mediaType === 'image' ? (
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={() => setPreset('megapixels')}
              >
                {t('Megapixel threshold preset')}
              </Button>
            ) : (
              <>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  onClick={() => setPreset('resolution')}
                >
                  {t('Resolution + reference video preset')}
                </Button>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  onClick={() => setPreset('tier')}
                >
                  {t('Tier + reference video preset')}
                </Button>
              </>
            )}
          </div>

          <div className='grid gap-3 sm:grid-cols-3'>
            <Field label={t('Billing unit')}>
              <Input
                value={
                  mediaType === 'image'
                    ? t('Price / image')
                    : t('Price / second')
                }
                disabled
              />
            </Field>
            <Field label={t('Currency')}>
              <select
                className={selectClassName}
                value={value.currency}
                onChange={(event) =>
                  update({ currency: event.target.value as 'CNY' | 'USD' })
                }
              >
                <option value='CNY'>CNY ({t('Chinese yuan')})</option>
                <option value='USD'>USD ({t('US dollar')})</option>
              </select>
            </Field>
            {mediaType === 'video' ? (
              <Field label={t('Allowed durations (seconds, comma-separated)')}>
                <Input
                  value={durationText}
                  placeholder='4,5,6,7,8,9,10,11,12,13,14,15'
                  onChange={(event) => setDurationText(event.target.value)}
                  onBlur={() => {
                    const durations = durationText
                      .split(',')
                      .map((item) => Number(item.trim()))
                      .filter((item) => Number.isInteger(item) && item > 0)
                    update({ allowed_duration: durations })
                  }}
                />
              </Field>
            ) : null}
          </div>

          <Field label={t('Pricing key template')}>
            <Input
              className='font-mono'
              value={value.template}
              placeholder='{model_id}-{video_input}-{resolution}'
              onChange={(event) => update({ template: event.target.value })}
            />
          </Field>

          <div className='space-y-3'>
            <div className='flex items-center justify-between'>
              <div>
                <div className='text-sm font-medium'>
                  {t('Pricing dimensions')}
                </div>
                <div className='text-muted-foreground text-xs'>
                  {t(
                    'Mappings are for enum values; numeric ranges are for megapixel, duration, and similar thresholds.'
                  )}
                </div>
              </div>
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={() =>
                  update({
                    dimensions: [
                      ...(value.dimensions ?? []),
                      {
                        source: 'parameters',
                        field: 'resolution',
                        placeholder: `dimension_${(value.dimensions ?? []).length + 1}`,
                        mapping: { default: 'default' },
                      },
                    ],
                  })
                }
              >
                <Plus /> {t('Add dimension')}
              </Button>
            </div>

            {(value.dimensions ?? []).map((dimension, index) => (
              <DimensionEditor
                key={index}
                dimension={dimension}
                onChange={(patch) => updateDimension(index, patch)}
                onDelete={() =>
                  update({
                    dimensions: (value.dimensions ?? []).filter(
                      (_, itemIndex) => itemIndex !== index
                    ),
                  })
                }
              />
            ))}
          </div>

          <div className='space-y-2'>
            <div>
              <div className='text-sm font-medium'>
                {t('Combination prices')}
              </div>
              <div className='text-muted-foreground text-xs'>
                {t(
                  'Every generated template key requires a unit price and takes effect immediately when saved.'
                )}
              </div>
            </div>
            {priceKeys.length ? (
              <div className='grid gap-2'>
                {priceKeys.map((key) => (
                  <div
                    key={key}
                    className='grid items-center gap-2 sm:grid-cols-[1fr_180px]'
                  >
                    <code
                      className='bg-muted min-w-0 truncate rounded-md px-2 py-2 text-xs'
                      title={key}
                    >
                      {key}
                    </code>
                    <div className='relative'>
                      <Input
                        type='number'
                        min='0'
                        step='0.00000001'
                        value={value.prices[key] ?? ''}
                        placeholder='0.00'
                        onChange={(event) =>
                          update({
                            prices: {
                              ...value.prices,
                              [key]: event.target.value,
                            },
                          })
                        }
                      />
                      <span className='text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs'>
                        {value.currency}/
                        {mediaType === 'image' ? t('image') : t('second')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className='text-destructive rounded-lg border border-dashed p-3 text-xs'>
                {t(
                  'The current template or dimensions do not generate a valid price key.'
                )}
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className='grid gap-1.5 text-sm font-medium'>
      <span>{label}</span>
      {children}
    </label>
  )
}

function DimensionEditor({
  dimension,
  onChange,
  onDelete,
}: {
  dimension: MediaPricingDimension
  onChange: (patch: Partial<MediaPricingDimension>) => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const mappingMode = Boolean(dimension.mapping)
  const fields = dimension.source === 'input' ? INPUT_FIELDS : PARAMETER_FIELDS
  const mappings = Object.entries(dimension.mapping ?? {})
  const ranges = dimension.ranges ?? []

  return (
    <div className='space-y-3 rounded-lg border p-3'>
      <div className='grid gap-2 sm:grid-cols-[150px_1fr_1fr_140px_36px]'>
        <select
          className={selectClassName}
          value={dimension.source}
          onChange={(event) => {
            const source = event.target.value as 'input' | 'parameters'
            onChange({
              source,
              field: source === 'input' ? INPUT_FIELDS[0] : PARAMETER_FIELDS[0],
            })
          }}
        >
          <option value='input'>input</option>
          <option value='parameters'>parameters</option>
        </select>
        <select
          className={selectClassName}
          value={dimension.field}
          onChange={(event) => onChange({ field: event.target.value })}
        >
          {fields.map((field) => (
            <option key={field} value={field}>
              {field}
            </option>
          ))}
        </select>
        <Input
          value={dimension.placeholder}
          placeholder='placeholder'
          onChange={(event) => onChange({ placeholder: event.target.value })}
        />
        <select
          className={selectClassName}
          value={mappingMode ? 'mapping' : 'ranges'}
          onChange={(event) =>
            onChange(
              event.target.value === 'mapping'
                ? { mapping: { default: 'default' }, ranges: undefined }
                : { mapping: undefined, ranges: [{ gt: 0, value: 'gt_0' }] }
            )
          }
        >
          <option value='mapping'>{t('Enum mapping')}</option>
          <option value='ranges'>{t('Numeric range')}</option>
        </select>
        <Button
          type='button'
          size='icon'
          variant='ghost'
          onClick={onDelete}
          aria-label={t('Delete dimension')}
        >
          <Trash2 />
        </Button>
      </div>

      {mappingMode ? (
        <div className='space-y-2'>
          {mappings.map(([sourceValue, renderedValue], index) => (
            <div
              key={index}
              className='grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr_36px]'
            >
              <Input
                value={sourceValue}
                placeholder='1080P / default'
                onChange={(event) => {
                  const next = [...mappings]
                  next[index] = [event.target.value, renderedValue]
                  onChange({ mapping: Object.fromEntries(next) })
                }}
              />
              <span className='text-muted-foreground text-xs'>→</span>
              <Input
                value={renderedValue}
                placeholder='1080p'
                onChange={(event) => {
                  const next = [...mappings]
                  next[index] = [sourceValue, event.target.value]
                  onChange({ mapping: Object.fromEntries(next) })
                }}
              />
              <Button
                type='button'
                size='icon'
                variant='ghost'
                onClick={() =>
                  onChange({
                    mapping: Object.fromEntries(
                      mappings.filter((_, item) => item !== index)
                    ),
                  })
                }
                aria-label={t('Delete mapping')}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            type='button'
            size='sm'
            variant='ghost'
            onClick={() =>
              onChange({
                mapping: {
                  ...dimension.mapping,
                  [`value_${mappings.length + 1}`]: `value_${mappings.length + 1}`,
                },
              })
            }
          >
            <Plus /> {t('Add mapping')}
          </Button>
        </div>
      ) : (
        <div className='space-y-2'>
          {ranges.map((range, index) => (
            <RangeEditor
              key={index}
              range={range}
              onChange={(nextRange) => {
                const next = [...ranges]
                next[index] = nextRange
                onChange({ ranges: next })
              }}
              onDelete={() =>
                onChange({ ranges: ranges.filter((_, item) => item !== index) })
              }
            />
          ))}
          <Button
            type='button'
            size='sm'
            variant='ghost'
            onClick={() =>
              onChange({
                ranges: [
                  ...ranges,
                  { gt: 0, value: `range_${ranges.length + 1}` },
                ],
              })
            }
          >
            <Plus /> {t('Add range')}
          </Button>
        </div>
      )}
    </div>
  )
}

function RangeEditor({
  range,
  onChange,
  onDelete,
}: {
  range: MediaPricingRange
  onChange: (range: MediaPricingRange) => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const operator =
    (['gt', 'gte', 'lt', 'lte'] as RangeOperator[]).find(
      (candidate) => range[candidate] !== undefined
    ) ?? 'gt'
  const threshold = range[operator] ?? 0
  return (
    <div className='grid items-center gap-2 sm:grid-cols-[140px_1fr_auto_1fr_36px]'>
      <select
        className={selectClassName}
        value={operator}
        onChange={(event) =>
          onChange({ [event.target.value]: threshold, value: range.value })
        }
      >
        <option value='lt'>{`<  ${t('Less than')}`}</option>
        <option value='lte'>≤ {t('Less than or equal to')}</option>
        <option value='gt'>{`>  ${t('Greater than')}`}</option>
        <option value='gte'>≥ {t('Greater than or equal to')}</option>
      </select>
      <Input
        type='number'
        step='0.000001'
        value={threshold}
        onChange={(event) =>
          onChange({
            [operator]: Number(event.target.value),
            value: range.value,
          })
        }
      />
      <span className='text-muted-foreground text-xs'>→</span>
      <Input
        value={range.value}
        placeholder='gt_2_36mp'
        onChange={(event) => onChange({ ...range, value: event.target.value })}
      />
      <Button
        type='button'
        size='icon'
        variant='ghost'
        onClick={onDelete}
        aria-label={t('Delete range')}
      >
        <Trash2 />
      </Button>
    </div>
  )
}
