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
import { describe, test } from 'node:test'

import {
  formatProviderAccountOption,
  isProviderCompatibleWithModel,
} from '../provider-display'

describe('formatProviderAccountOption', () => {
  test('distinguishes accounts that share a name and Adapter', () => {
    const adapterLabel = 'OpenAI-compatible Images'

    const primary = formatProviderAccountOption(
      { name: 'OpenAI', code: 'openai-primary' },
      adapterLabel
    )
    const backup = formatProviderAccountOption(
      { name: 'OpenAI', code: 'openai-backup' },
      adapterLabel
    )

    assert.equal(primary, 'OpenAI · openai-primary · OpenAI-compatible Images')
    assert.equal(backup, 'OpenAI · openai-backup · OpenAI-compatible Images')
    assert.notEqual(primary, backup)
  })
})

describe('isProviderCompatibleWithModel', () => {
  test('accepts matching and dual-media accounts while rejecting mismatches', () => {
    assert.equal(
      isProviderCompatibleWithModel(
        { media_type: 'image' },
        { media_type: 'image' }
      ),
      true
    )
    assert.equal(
      isProviderCompatibleWithModel(
        { media_type: 'image_and_video' },
        { media_type: 'video' }
      ),
      true
    )
    assert.equal(
      isProviderCompatibleWithModel(
        { media_type: 'video' },
        { media_type: 'image' }
      ),
      false
    )
  })
})
