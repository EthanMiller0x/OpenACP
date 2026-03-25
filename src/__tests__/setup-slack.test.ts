import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateSlackManifest, validateSlackBotToken } from '../core/setup.js'

describe('generateSlackManifest', () => {
  it('returns v1 manifest with required bot scopes', () => {
    const manifest = generateSlackManifest()
    expect(manifest.version).toBe(1)
    const scopes = manifest.manifest.oauth_config.scopes.bot
    expect(scopes).toContain('channels:manage')
    expect(scopes).toContain('channels:history')
    expect(scopes).toContain('groups:history')
    expect(scopes).toContain('chat:write')
    expect(scopes).toContain('files:read')
    expect(scopes).toContain('files:write')
  })

  it('includes /openacp-archive slash command', () => {
    const manifest = generateSlackManifest()
    const cmds = manifest.manifest.features.slash_commands
    expect(cmds).toHaveLength(1)
    expect(cmds[0].command).toBe('/openacp-archive')
  })

  it('has socket_mode_enabled true', () => {
    const manifest = generateSlackManifest()
    expect(manifest.manifest.settings.socket_mode_enabled).toBe(true)
  })

  it('has interactivity enabled', () => {
    const manifest = generateSlackManifest()
    expect(manifest.manifest.settings.interactivity.is_enabled).toBe(true)
  })

  it('subscribes to message.channels and message.groups events', () => {
    const manifest = generateSlackManifest()
    const events = manifest.manifest.settings.event_subscriptions.bot_events
    expect(events).toContain('message.channels')
    expect(events).toContain('message.groups')
  })
})

describe('validateSlackBotToken', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('returns ok with username on valid token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, user: 'openacp-bot', user_id: 'U123' }),
    }))
    const result = await validateSlackBotToken('xoxb-valid')
    expect(result).toEqual({ ok: true, botUsername: 'openacp-bot' })
  })

  it('returns error when Slack responds ok: false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: false, error: 'invalid_auth' }),
    }))
    const result = await validateSlackBotToken('xoxb-bad')
    expect(result).toEqual({ ok: false, error: 'invalid_auth' })
  })

  it('returns error on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    const result = await validateSlackBotToken('xoxb-any')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Network error')
  })
})
