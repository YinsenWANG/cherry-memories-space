// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'

import { SpaceSettings } from '../SpaceSettings'

vi.unmock('@cherrystudio/ui')
vi.unmock('react-i18next')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn().mockResolvedValue(undefined) } }))

const i18n = createInstance()
const update = vi.fn().mockResolvedValue(undefined)

beforeAll(async () => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, keySeparator: false })
})

beforeEach(() => {
  MockCacheUtils.resetMocks()
  MockUseDataApiUtils.resetMocks()
  update.mockClear()
  MockUseDataApiUtils.mockQueryData('/mcp-servers', {
    items: [
      {
        id: 'server-1',
        name: '@cherry/shared-memories',
        type: 'streamableHttp',
        baseUrl: 'http://127.0.0.1:16807/mcp',
        headers: { Authorization: 'Bearer local-secret' },
        isActive: true
      }
    ],
    total: 1,
    page: 1
  })
  MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/mcp-servers/server-1', update)
})

afterEach(cleanup)

describe('Space settings', () => {
  it('does not send the local token to a newly selected remote backend', async () => {
    const user = userEvent.setup()
    render(
      <I18nextProvider i18n={i18n}>
        <SpaceSettings />
      </I18nextProvider>
    )

    await user.click(screen.getByRole('combobox', { name: 'Space backend' }))
    await user.click(screen.getByRole('option', { name: 'Remote' }))
    expect(screen.getByLabelText('Authorization Header')).toHaveValue('')
    await user.type(screen.getByLabelText('URL'), 'https://space.example')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(update).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Authorization Header'), 'remote-secret')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        body: {
          baseUrl: 'https://space.example/mcp',
          headers: { Authorization: 'Bearer remote-secret', 'X-Cherry-Space-Mode': 'remote' }
        }
      })
    )
  })
})
