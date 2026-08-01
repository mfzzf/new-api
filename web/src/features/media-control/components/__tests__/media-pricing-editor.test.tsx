/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import assert from 'node:assert/strict'
import { after, afterEach, describe, test } from 'node:test'

import { Window } from 'happy-dom'

const domWindow = new Window()
const domGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLInputElement',
  'Node',
  'Element',
  'Event',
  'FocusEvent',
  'MouseEvent',
  'PointerEvent',
  'CustomEvent',
  'MutationObserver',
  'ResizeObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
] as const

for (const key of domGlobals) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}

const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const i18next = (await import('i18next')).default
const { initReactI18next } = await import('react-i18next')
const en = (await import('../../../../i18n/locales/en.json')).default
await i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en },
})
const { MediaPricingEditor } = await import('../media-pricing-editor')
const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

function Harness() {
  const [value, setValue] = useState<
    import('../../types').MediaPricingRule | null
  >(null)
  return (
    <MediaPricingEditor
      modelID='video-pro'
      mediaType='video'
      value={value}
      onChange={setValue}
    />
  )
}

async function renderEditor() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<Harness />))
  return { container, root }
}

describe('MediaPricingEditor', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  after(() => {
    domWindow.close()
  })

  test('enables structured pricing and exposes the video resolution preset', async () => {
    const rendered = await renderEditor()
    const toggle = rendered.container.querySelector<HTMLElement>(
      '[role="switch"][aria-label="Enable complex pricing"]'
    )
    assert.ok(toggle, rendered.container.innerHTML)
    assert.equal(toggle.getAttribute('aria-checked'), 'false')

    await act(async () => toggle.click())
    assert.equal(toggle.getAttribute('aria-checked'), 'true')
    assert.ok(
      rendered.container.querySelector<HTMLInputElement>(
        'input[placeholder="{model_id}-{video_input}-{resolution}"]'
      )
    )

    const preset = [...rendered.container.querySelectorAll('button')].find(
      (button) =>
        button.textContent?.includes('Resolution + reference video preset')
    )
    assert.ok(preset)
    await act(async () => preset.click())

    const renderedKeys = [...rendered.container.querySelectorAll('code')].map(
      (node) => node.textContent
    )
    assert.deepEqual(renderedKeys, [
      'video-pro-no_video-1080p',
      'video-pro-no_video-540p',
      'video-pro-no_video-720p',
      'video-pro-with_video-1080p',
      'video-pro-with_video-540p',
      'video-pro-with_video-720p',
    ])
    await act(async () => rendered.root.unmount())
    rendered.container.remove()
  })
})
