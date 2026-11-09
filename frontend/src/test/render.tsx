import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'

import { LocationProbe } from './LocationProbe'

export interface ApiCall {
  method: string
  path: string
  query: URLSearchParams
  body: unknown
  headers: Record<string, string>
}

export interface Reply {
  status?: number
  body?: unknown
  headers?: Record<string, string>
}

type Route_ = Reply | Reply[] | ((call: ApiCall) => Reply)

/**
 * Replaces `fetch` with canned replies, keyed `'POST /api/logs/'`.
 *
 * Stubbing at the network edge rather than mocking the query hooks means a test
 * exercises the real client, hooks and form together, and asserts on what would
 * actually reach the server. A list of replies is consumed in order and repeats
 * its last. A request with no route rejects, so a missing stub fails loudly.
 */
export function stubApi(routes: Record<string, Route_>): ApiCall[] {
  const calls: ApiCall[] = []
  const served = new Map<string, number>()

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, window.location.origin)
      const method = init.method ?? 'GET'
      const key = `${method} ${url.pathname}`
      const call: ApiCall = {
        method,
        path: url.pathname,
        query: url.searchParams,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
        headers: (init.headers ?? {}) as Record<string, string>,
      }
      calls.push(call)

      const route = routes[key]
      if (route === undefined) throw new Error(`No API stub for ${key}`)

      let reply: Reply
      if (typeof route === 'function') {
        reply = route(call)
      } else if (Array.isArray(route)) {
        const index = served.get(key) ?? 0
        served.set(key, index + 1)
        reply = route[Math.min(index, route.length - 1)] ?? {}
      } else {
        reply = route
      }

      const status = reply.status ?? 200
      return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), {
        status,
        headers: reply.headers,
      })
    }),
  )

  return calls
}

/** A DRF `PageNumberPagination` body. */
export function paginated<T>(results: T[], count = results.length) {
  return { count, next: null, previous: null, results }
}

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

/** Where the router is now, for asserting on navigation. */
export function currentLocation(): string | null {
  return screen.getByTestId('location').textContent
}

/** Renders `ui` with a query client and a router, optionally at a matched route. */
export function renderApp(
  ui: ReactElement,
  {
    route,
    path,
  }: { route?: string | { pathname: string; state: unknown }; path?: string } = {},
) {
  const client = makeQueryClient()

  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route ?? '/']}>
        {path ? (
          <Routes>
            <Route path={path} element={ui} />
            {/* Somewhere to land when the screen navigates away. */}
            <Route path="*" element={null} />
          </Routes>
        ) : (
          ui
        )}
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )

  return { ...view, client }
}
