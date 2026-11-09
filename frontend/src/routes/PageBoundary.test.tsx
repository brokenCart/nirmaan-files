import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { lazy } from 'react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { PageBoundary } from '@/routes/PageBoundary'

function show(page: React.ReactElement) {
  render(
    <MemoryRouter initialEntries={['/broken']}>
      <Link to="/fine">Go elsewhere</Link>
      <PageBoundary>
        <Routes>
          <Route path="/broken" element={page} />
          <Route path="/fine" element={<p>working page</p>} />
        </Routes>
      </PageBoundary>
    </MemoryRouter>,
  )
}

describe('PageBoundary', () => {
  it('shows a loading state while the chunk downloads', () => {
    const Pending = lazy(() => new Promise<{ default: () => null }>(() => undefined))
    show(<Pending />)
    expect(screen.getByText('Loading page…')).toBeInTheDocument()
  })

  it('shows the page once it has loaded', async () => {
    const Loaded = lazy(async () => ({ default: () => <p>loaded page</p> }))
    show(<Loaded />)
    expect(await screen.findByText('loaded page')).toBeInTheDocument()
  })

  it('offers a reload when the chunk cannot be fetched', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const Missing = lazy(async (): Promise<{ default: () => null }> => {
      throw new TypeError('Failed to fetch dynamically imported module')
    })
    show(<Missing />)

    expect(await screen.findByRole('alert')).toHaveTextContent('This page couldn’t load.')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('recovers when the reader moves to another page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const Missing = lazy(async (): Promise<{ default: () => null }> => {
      throw new TypeError('Failed to fetch dynamically imported module')
    })
    show(<Missing />)
    await screen.findByRole('alert')

    await userEvent.click(screen.getByRole('link', { name: 'Go elsewhere' }))

    expect(await screen.findByText('working page')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
