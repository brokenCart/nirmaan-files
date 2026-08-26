/**
 * The single place that talks to the API.
 *
 * The access token is held in a module variable rather than localStorage, so a
 * cross-site script has nothing durable to steal. The cost is that a page
 * reload starts with no token — `restoreSession` trades the httpOnly refresh
 * cookie for a fresh one on boot.
 */
import type { Session } from './types'

let accessToken: string | null = null

/** Callbacks fired when the session ends, so the UI can react. */
const sessionEndedHandlers = new Set<() => void>()

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function onSessionEnded(handler: () => void): () => void {
  sessionEndedHandlers.add(handler)
  return () => sessionEndedHandlers.delete(handler)
}

function endSession(): void {
  accessToken = null
  sessionEndedHandlers.forEach((handler) => handler())
}

export class ApiError extends Error {
  // Declared as plain fields rather than constructor parameter properties,
  // which `erasableSyntaxOnly` disallows.
  readonly status: number
  readonly detail: string
  readonly fieldErrors: Record<string, string[]>

  constructor(status: number, detail: string, fieldErrors: Record<string, string[]> = {}) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.fieldErrors = fieldErrors
  }

  /** First message for `field`, if the server rejected it. */
  fieldError(field: string): string | undefined {
    return this.fieldErrors[field]?.[0]
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return new ApiError(response.status, response.statusText || 'Request failed.')
  }

  if (payload && typeof payload === 'object') {
    const body = payload as Record<string, unknown>
    const detail = typeof body.detail === 'string' ? body.detail : undefined

    const fieldErrors: Record<string, string[]> = {}
    for (const [key, value] of Object.entries(body)) {
      if (key === 'detail') continue
      if (Array.isArray(value)) fieldErrors[key] = value.map(String)
      else if (typeof value === 'string') fieldErrors[key] = [value]
    }

    const firstField = Object.values(fieldErrors)[0]?.[0]
    return new ApiError(
      response.status,
      detail ?? firstField ?? 'Request failed.',
      fieldErrors,
    )
  }

  return new ApiError(response.status, 'Request failed.')
}

/**
 * Refresh in flight, shared so that several 401s at once trigger one refresh
 * rather than a stampede — which would matter, since refresh tokens rotate and
 * a losing racer would present an already-blacklisted token.
 */
let refreshInFlight: Promise<Session | null> | null = null

async function refreshSession(): Promise<Session | null> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch('/api/auth/refresh/', {
        method: 'POST',
        credentials: 'include',
      })
      if (!response.ok) return null
      const session = (await response.json()) as Session
      accessToken = session.access
      return session
    } catch {
      return null
    } finally {
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

interface RequestOptions {
  method?: string
  body?: unknown
  query?: Record<string, string | number | undefined | null>
  /** Internal: prevents a refresh loop when the retry also fails. */
  retryOnUnauthorized?: boolean
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, retryOnUnauthorized = true } = options

  const url = new URL(path, window.location.origin)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }
  }

  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  const response = await fetch(url.toString(), {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (response.status === 401 && retryOnUnauthorized) {
    // The access token is short-lived; an expiry mid-session is routine, so
    // refresh once and replay the request before surfacing an error.
    const session = await refreshSession()
    if (session) {
      return request<T>(path, { ...options, retryOnUnauthorized: false })
    }
    endSession()
    throw await toApiError(response)
  }

  if (!response.ok) throw await toApiError(response)
  if (response.status === 204) return undefined as T

  return (await response.json()) as T
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

export async function loginWithGoogle(credential: string): Promise<Session> {
  const response = await fetch('/api/auth/google/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ credential }),
  })
  if (!response.ok) throw await toApiError(response)

  const session = (await response.json()) as Session
  accessToken = session.access
  return session
}

/** Recover a session on page load using the refresh cookie. */
export function restoreSession(): Promise<Session | null> {
  return refreshSession()
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout/', { method: 'POST', credentials: 'include' })
  } finally {
    endSession()
  }
}
