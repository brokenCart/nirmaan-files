import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  api,
  ApiError,
  downloadFile,
  loginWithGoogle,
  logout,
  onSessionEnded,
  restoreSession,
  setAccessToken,
} from '@/api/client'
import { makeUser } from '@/test/factories'
import type { ApiCall } from '@/test/render'
import { stubApi } from '@/test/render'

const FRESH_SESSION = { access: 'fresh', user: makeUser(), memberships: [] }

/** Answers 401 until the request carries the token a refresh hands out. */
const needsFreshToken = (call: ApiCall) =>
  call.headers.Authorization === 'Bearer fresh'
    ? { body: { ok: true } }
    : { status: 401, body: { detail: 'Token expired.' } }

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const error: unknown = await promise.catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

beforeEach(() => setAccessToken(null))

describe('requests', () => {
  it('attaches the access token', async () => {
    setAccessToken('abc')
    const calls = stubApi({ 'GET /api/projects/': { body: [] } })
    await api.get('/api/projects/')
    expect(calls[0]?.headers.Authorization).toBe('Bearer abc')
  })

  it('leaves out empty query values and keeps zero', async () => {
    const calls = stubApi({ 'GET /api/logs/': { body: [] } })
    await api.get('/api/logs/', { project: 'shiksha', kind: undefined, q: '', term: null, page: 0 })
    expect(calls[0]?.query.toString()).toBe('project=shiksha&page=0')
  })

  it('sends a body as JSON', async () => {
    const calls = stubApi({ 'POST /api/logs/': { status: 201, body: { id: 1 } } })
    await expect(api.post('/api/logs/', { hours: 1.5 })).resolves.toEqual({ id: 1 })
    expect(calls[0]?.headers['Content-Type']).toBe('application/json')
    expect(calls[0]?.body).toEqual({ hours: 1.5 })
  })

  it('resolves a 204 to undefined', async () => {
    stubApi({ 'DELETE /api/logs/1/': { status: 204 } })
    await expect(api.delete('/api/logs/1/')).resolves.toBeUndefined()
  })
})

describe('error parsing', () => {
  it('prefers the detail message', async () => {
    stubApi({ 'GET /api/x/': { status: 403, body: { detail: 'Not yours.' } } })
    const error = await failure(api.get('/api/x/'))
    expect(error.status).toBe(403)
    expect(error.detail).toBe('Not yours.')
  })

  it('falls back to the first field error and indexes them all', async () => {
    stubApi({
      'POST /api/x/': { status: 400, body: { url: ['Bad scheme.', 'Too long.'], title: 'Blank.' } },
    })
    const error = await failure(api.post('/api/x/', {}))
    expect(error.detail).toBe('Bad scheme.')
    expect(error.fieldError('url')).toBe('Bad scheme.')
    expect(error.fieldError('title')).toBe('Blank.')
    expect(error.fieldError('missing')).toBeUndefined()
  })

  it('survives a body that is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<h1>Bad gateway</h1>', { status: 502, statusText: 'Bad Gateway' })),
    )
    const error = await failure(api.get('/api/x/'))
    expect(error.status).toBe(502)
    expect(error.detail).toBe('Bad Gateway')
  })
})

describe('session refresh', () => {
  it('refreshes once and replays with the new token', async () => {
    setAccessToken('stale')
    const calls = stubApi({
      'GET /api/x/': needsFreshToken,
      'POST /api/auth/refresh/': { body: FRESH_SESSION },
    })

    await expect(api.get('/api/x/')).resolves.toEqual({ ok: true })
    expect(calls.map((call) => call.path)).toEqual(['/api/x/', '/api/auth/refresh/', '/api/x/'])
  })

  it('shares one refresh between concurrent 401s', async () => {
    setAccessToken('stale')
    const calls = stubApi({
      'GET /api/a/': needsFreshToken,
      'GET /api/b/': needsFreshToken,
      'POST /api/auth/refresh/': { body: FRESH_SESSION },
    })

    await Promise.all([api.get('/api/a/'), api.get('/api/b/')])
    expect(calls.filter((call) => call.path === '/api/auth/refresh/')).toHaveLength(1)
  })

  it('ends the session when the refresh is refused', async () => {
    setAccessToken('stale')
    stubApi({
      'GET /api/x/': { status: 401, body: { detail: 'Token expired.' } },
      'POST /api/auth/refresh/': { status: 401, body: {} },
    })
    const ended = vi.fn()
    const unsubscribe = onSessionEnded(ended)

    const error = await failure(api.get('/api/x/'))
    unsubscribe()

    expect(error.status).toBe(401)
    expect(ended).toHaveBeenCalledOnce()
  })

  it('does not loop when the replay is also refused', async () => {
    setAccessToken('stale')
    const calls = stubApi({
      'GET /api/x/': { status: 401, body: { detail: 'Still no.' } },
      'POST /api/auth/refresh/': { body: FRESH_SESSION },
    })

    await failure(api.get('/api/x/'))
    expect(calls).toHaveLength(3)
  })
})

describe('signing in and out', () => {
  it('posts the credential and keeps the token for later requests', async () => {
    const calls = stubApi({
      'POST /api/auth/google/': { body: FRESH_SESSION },
      'GET /api/x/': { body: {} },
    })

    await expect(loginWithGoogle('google-token')).resolves.toEqual(FRESH_SESSION)
    expect(calls[0]?.body).toEqual({ credential: 'google-token' })

    await api.get('/api/x/')
    expect(calls[1]?.headers.Authorization).toBe('Bearer fresh')
  })

  it('reports a refused sign-in', async () => {
    stubApi({ 'POST /api/auth/google/': { status: 403, body: { detail: 'Campus accounts only.' } } })
    const error = await failure(loginWithGoogle('google-token'))
    expect(error.detail).toBe('Campus accounts only.')
  })

  it('restores nothing when the refresh cookie is refused', async () => {
    stubApi({ 'POST /api/auth/refresh/': { status: 401, body: {} } })
    await expect(restoreSession()).resolves.toBeNull()
  })

  it('restores nothing when the network is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
    await expect(restoreSession()).resolves.toBeNull()
  })

  it('forgets the token on logout', async () => {
    setAccessToken('abc')
    const calls = stubApi({
      'POST /api/auth/logout/': { status: 204 },
      'GET /api/x/': { body: {} },
    })

    await logout()
    await api.get('/api/x/')

    expect(calls[1]?.headers.Authorization).toBeUndefined()
  })

  it('ends the session locally even if the logout call fails', async () => {
    setAccessToken('abc')
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
    const ended = vi.fn()
    const unsubscribe = onSessionEnded(ended)

    await expect(logout()).rejects.toThrow('offline')
    unsubscribe()

    expect(ended).toHaveBeenCalledOnce()
  })

  it('stops notifying after unsubscribing', async () => {
    stubApi({ 'POST /api/auth/logout/': { status: 204 } })
    const ended = vi.fn()
    onSessionEnded(ended)()

    await logout()

    expect(ended).not.toHaveBeenCalled()
  })
})

describe('downloadFile', () => {
  function captureDownload() {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
    const names: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download)
    })
    return names
  }

  it('uses the filename the server asked for', async () => {
    const names = captureDownload()
    stubApi({
      'GET /api/export/': {
        headers: { 'Content-Disposition': 'attachment; filename="nirmaan-shiksha.xlsx"' },
      },
    })
    await downloadFile('/api/export/', 'fallback.xlsx')
    expect(names).toEqual(['nirmaan-shiksha.xlsx'])
  })

  it('falls back when the server names nothing', async () => {
    const names = captureDownload()
    stubApi({ 'GET /api/export/': {} })
    await downloadFile('/api/export/', 'fallback.xlsx')
    expect(names).toEqual(['fallback.xlsx'])
  })
})
