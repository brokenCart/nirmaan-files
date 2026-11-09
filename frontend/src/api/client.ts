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

/**
 * One authenticated round-trip, with the refresh-and-replay dance.
 *
 * Returns the raw `Response` so both JSON callers and file downloads share the
 * token handling rather than each reimplementing the 401 retry.
 */
async function fetchWithAuth(path: string, options: RequestOptions = {}): Promise<Response> {
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
  // A FormData body sets its own multipart Content-Type, boundary included.
  const isForm = body instanceof FormData
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  const response = await fetch(url.toString(), {
    method,
    headers,
    credentials: 'include',
    body: body === undefined || isForm ? (body as FormData | undefined) : JSON.stringify(body),
  })

  if (response.status === 401 && retryOnUnauthorized) {
    // The access token is short-lived; an expiry mid-session is routine, so
    // refresh once and replay the request before surfacing an error.
    const session = await refreshSession()
    if (session) {
      return fetchWithAuth(path, { ...options, retryOnUnauthorized: false })
    }
    endSession()
    throw await toApiError(response)
  }

  if (!response.ok) throw await toApiError(response)
  return response
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetchWithAuth(path, options)
  if (response.status === 204) return undefined as T

  return (await response.json()) as T
}

/** Filename the server asked for, if it sent a `filename="…"`. */
function filenameFrom(disposition: string | null): string | undefined {
  return disposition?.match(/filename="([^"]+)"/)?.[1]
}

/**
 * Download a file endpoint and hand it to the browser's save flow.
 *
 * This cannot be a plain `<a href>`: the access token lives in a module
 * variable rather than a cookie, so a browser-initiated navigation would reach
 * the API unauthenticated. Fetching it ourselves attaches the header, and the
 * bytes are handed on as an object URL.
 */
export async function downloadFile(
  path: string,
  fallbackFilename: string,
  query?: RequestOptions['query'],
): Promise<void> {
  const response = await fetchWithAuth(path, { query })
  const blob = await response.blob()

  const href = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = filenameFrom(response.headers.get('Content-Disposition')) ?? fallbackFilename
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    // Revoking immediately can race the save in some browsers; one frame is
    // enough for the click to have been taken up.
    requestAnimationFrame(() => URL.revokeObjectURL(href))
  }
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
