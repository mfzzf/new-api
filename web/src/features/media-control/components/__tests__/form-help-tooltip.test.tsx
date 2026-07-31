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

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { FormHelpTooltip } = await import('../form-help-tooltip')
const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

async function renderHelpTooltip() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <FormHelpTooltip ariaLabel='Adapter type: Learn more'>
        Adapter help text
      </FormHelpTooltip>
    )
  })

  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Adapter type: Learn more"]'
  )
  assert.ok(trigger)
  return { container, root, trigger }
}

async function unmountHelpTooltip(
  rendered: Awaited<ReturnType<typeof renderHelpTooltip>>
) {
  await act(async () => rendered.root.unmount())
  rendered.container.remove()
}

function visibleTooltip() {
  return document.body.querySelector<HTMLElement>('[role="tooltip"]')
}

async function settleDOM() {
  await act(async () => domWindow.happyDOM.waitUntilComplete())
}

describe('FormHelpTooltip', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  after(() => {
    domWindow.close()
  })

  test('shows help text when a pointer hovers the question mark', async () => {
    const rendered = await renderHelpTooltip()

    await act(async () => {
      rendered.trigger.dispatchEvent(
        new PointerEvent('pointerenter', {
          pointerType: 'mouse',
        })
      )
      rendered.trigger.dispatchEvent(new MouseEvent('mouseenter'))
    })
    await settleDOM()

    const tooltip = visibleTooltip()
    assert.ok(tooltip, document.body.innerHTML)
    assert.equal(tooltip.textContent?.includes('Adapter help text'), true)
    await unmountHelpTooltip(rendered)
  })

  test('shows the same help text on keyboard focus without submitting forms', async () => {
    const rendered = await renderHelpTooltip()

    assert.equal(rendered.trigger.type, 'button')
    await act(async () => {
      rendered.trigger.focus()
      rendered.trigger.dispatchEvent(
        new FocusEvent('focusin', { bubbles: true })
      )
    })
    await settleDOM()

    const tooltip = visibleTooltip()
    assert.ok(tooltip, document.body.innerHTML)
    assert.equal(tooltip.textContent?.includes('Adapter help text'), true)
    await unmountHelpTooltip(rendered)
  })
})
