import { Component, Suspense } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

import { Button, ErrorNote, Spinner } from '@/components/ui'

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <div className="space-y-3">
        <ErrorNote message="This page couldn’t load. Reload to try again." />
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    )
  }
}

/**
 * What a route-level chunk needs around it: a loading state, and somewhere to
 * land when the download fails. A tab left open across a deploy asks for a file
 * that no longer exists, and without a boundary that blanks the whole app.
 *
 * Keyed on the path so that moving to another page clears a failure.
 */
export function PageBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()

  return (
    <ErrorBoundary key={pathname}>
      <Suspense fallback={<Spinner label="Loading page…" />}>{children}</Suspense>
    </ErrorBoundary>
  )
}
