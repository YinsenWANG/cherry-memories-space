import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import {
  SettingDescription,
  SettingGroup,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useMcpRuntimeStatus } from '@renderer/hooks/useMcpRuntimeStatus'
import { useMcpServerMutations, useMcpServers } from '@renderer/hooks/useMcpServer'
import { ipcApi } from '@renderer/ipc'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

const localUrl = 'http://127.0.0.1:16807/mcp'
const statusKeys = {
  disabled: 'settings.mcp.runtimeStatus.disabled',
  connecting: 'settings.mcp.runtimeStatus.connecting',
  connected: 'settings.mcp.runtimeStatus.connected',
  error: 'settings.mcp.runtimeStatus.error'
} as const

export function SpaceSettings() {
  const { t } = useTranslation()
  const { mcpServers } = useMcpServers()
  const server = mcpServers.find((item) => item.name === BuiltinMcpServerNames.sharedMemories)
  const { updateMcpServer } = useMcpServerMutations(server?.id ?? '')
  const status = useMcpRuntimeStatus(server?.id, !!server?.isActive)
  const [mode, setMode] = useState<'local' | 'remote'>('local')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [currentSpace, setCurrentSpace] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!server) return
    const savedMode = Object.entries(server.headers ?? {}).find(
      ([key]) => key.toLowerCase() === 'x-cherry-space-mode'
    )?.[1]
    const isRemote = savedMode === 'remote' || (!savedMode && !!server.baseUrl && server.baseUrl !== localUrl)
    setMode(isRemote ? 'remote' : 'local')
    setUrl(isRemote ? server.baseUrl!.replace(/\/mcp\/?$/, '') : '')
    const authorization = Object.entries(server.headers ?? {}).find(
      ([key]) => key.toLowerCase() === 'authorization'
    )?.[1]
    setToken(isRemote ? (authorization?.replace(/^Bearer\s+/i, '') ?? '') : '')
  }, [server])

  useEffect(() => {
    if (!server?.baseUrl) return
    const authorization = Object.entries(server.headers ?? {}).find(
      ([key]) => key.toLowerCase() === 'authorization'
    )?.[1]
    if (!authorization) return
    let active = true
    fetch(`${server.baseUrl.replace(/\/mcp\/?$/, '')}/api/spaces/current`, {
      headers: { Authorization: authorization }
    })
      .then(async (response) => (response.ok ? response.json() : undefined))
      .then((space) => {
        if (active) setCurrentSpace(space?.name ?? '')
      })
      .catch(() => {
        if (active) setCurrentSpace('')
      })
    return () => {
      active = false
    }
  }, [server])

  const save = async () => {
    if (!server) return
    setBusy(true)
    setError('')
    try {
      let baseUrl = localUrl
      if (mode === 'remote') {
        if (!token.trim()) throw new Error('Missing token')
        const parsed = new URL(url)
        if (
          !['http:', 'https:'].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password ||
          parsed.search ||
          parsed.hash
        ) {
          throw new Error('Invalid URL')
        }
        parsed.pathname = `${parsed.pathname.replace(/\/+$/, '').replace(/\/mcp$/, '')}/mcp`
        baseUrl = parsed.toString()
      }
      const previousAuthorization = Object.entries(server.headers ?? {}).find(
        ([key]) => key.toLowerCase() === 'authorization'
      )?.[1]
      const authorization =
        mode === 'remote' ? `Bearer ${token.trim()}` : server.baseUrl === localUrl ? (previousAuthorization ?? '') : ''
      const headers = Object.fromEntries(
        Object.entries(server.headers ?? {}).filter(
          ([key]) => !['authorization', 'x-cherry-space-mode'].includes(key.toLowerCase())
        )
      )
      await updateMcpServer({
        body: { baseUrl, headers: { ...headers, Authorization: authorization, 'X-Cherry-Space-Mode': mode } }
      })
      setDirty(false)
      if (server.isActive) {
        try {
          await ipcApi.request('mcp.server.restart', { serverId: server.id })
        } catch {
          setError(t('settings.mcp.runtimeStatus.error'))
        }
      }
    } catch {
      setError(t('settings.space.saveError'))
    } finally {
      setBusy(false)
    }
  }

  const signIn = async () => {
    if (!server) return
    setBusy(true)
    setError('')
    try {
      const parsed = new URL(url)
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash
      )
        throw new Error('Invalid URL')
      const root = parsed
        .toString()
        .replace(/\/+$/, '')
        .replace(/\/mcp$/, '')
      const response = await fetch(`${root}/api/session/sign-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      if (!response.ok) throw new Error('Sign in failed')
      const result = (await response.json()) as { token: string }
      const headers = Object.fromEntries(
        Object.entries(server.headers ?? {}).filter(
          ([key]) => !['authorization', 'x-cherry-space-mode'].includes(key.toLowerCase())
        )
      )
      await updateMcpServer({
        body: {
          baseUrl: `${root}/mcp`,
          headers: { ...headers, Authorization: `Bearer ${result.token}`, 'X-Cherry-Space-Mode': 'remote' }
        }
      })
      setToken(result.token)
      setPassword('')
      setDirty(false)
      if (server.isActive) await ipcApi.request('mcp.server.restart', { serverId: server.id })
    } catch {
      setError(t('settings.provider.cherry_cloud.sign_in_failed'))
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    if (!server?.baseUrl) return
    setBusy(true)
    setError('')
    try {
      const authorization = Object.entries(server.headers ?? {}).find(
        ([key]) => key.toLowerCase() === 'authorization'
      )?.[1]
      const response = await fetch(`${server.baseUrl.replace(/\/mcp\/?$/, '')}/api/session/sign-out`, {
        method: 'POST',
        headers: { Authorization: authorization ?? '' }
      })
      if (!response.ok) throw new Error('Sign out failed')
      const headers = Object.fromEntries(
        Object.entries(server.headers ?? {}).filter(([key]) => key.toLowerCase() !== 'authorization')
      )
      await updateMcpServer({ body: { headers: { ...headers, Authorization: '' } } })
      setToken('')
      setCurrentSpace('')
    } catch {
      setError(t('settings.space.saveError'))
    } finally {
      setBusy(false)
    }
  }

  const testConnection = async () => {
    if (!server) return
    setBusy(true)
    setError('')
    try {
      await ipcApi.request('mcp.server.restart', { serverId: server.id })
      await ipcApi.request('mcp.server.get_version', { serverId: server.id })
    } catch {
      setError(t('settings.mcp.runtimeStatus.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsContentColumn>
      <SettingGroup className="space-y-4">
        <SettingTitle>{t('settings.space.title')}</SettingTitle>
        <SettingDescription>{t('settings.space.restart')}</SettingDescription>
        {!server ? (
          <SettingDescription>{t('settings.mcp.noServers')}</SettingDescription>
        ) : (
          <>
            <div className="space-y-2">
              <label htmlFor="space-mode">{t('settings.space.mode')}</label>
              <Select
                value={mode}
                onValueChange={(value) => {
                  setMode(value as 'local' | 'remote')
                  setToken('')
                  setDirty(true)
                }}>
                <SelectTrigger id="space-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">{t('settings.skills.source.local')}</SelectItem>
                  <SelectItem value="remote">{t('settings.space.remote')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {mode === 'remote' && (
              <>
                <div className="space-y-2">
                  <label htmlFor="space-url">{t('settings.mcp.url')}</label>
                  <Input
                    id="space-url"
                    value={url}
                    onChange={(event) => {
                      setUrl(event.target.value)
                      setDirty(true)
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="space-token">{t('apiGateway.authHeader.title')}</label>
                  <Input
                    id="space-token"
                    type="password"
                    value={token}
                    onChange={(event) => {
                      setToken(event.target.value)
                      setDirty(true)
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="space-email">{t('settings.provider.vertex_ai.service_account.client_email')}</label>
                  <Input
                    id="space-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="space-password">{t('settings.provider.basic_auth.password.label')}</label>
                  <Input
                    id="space-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={busy || !url || !email || !password}
                    onClick={() => void signIn()}>
                    {t('settings.subscription.sign_in')}
                  </Button>
                  <Button variant="outline" disabled={busy || !token} onClick={() => void signOut()}>
                    {t('settings.provider.cherry_cloud.logout')}
                  </Button>
                </div>
              </>
            )}
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => void save()}>
                {t('common.save')}
              </Button>
              <Button variant="outline" disabled={busy || dirty} onClick={() => void testConnection()}>
                {t('settings.proxy.test.action')}
              </Button>
            </div>
            <SettingDescription>
              {t('settings.voice.status.label')}: {t(statusKeys[status.state])}
            </SettingDescription>
            {currentSpace && (
              <SettingDescription>
                {t('settings.space.title')}: {currentSpace}
              </SettingDescription>
            )}
            {error && (
              <p role="alert" className="text-error">
                {error}
              </p>
            )}
          </>
        )}
      </SettingGroup>
    </SettingsContentColumn>
  )
}
