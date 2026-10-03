import { LogOut } from 'lucide-react'
import { Link, Outlet } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { NirmaanLogo } from '@/components/Logo'
import { Button } from '@/components/ui'

/** Up to two initials, for the avatar mark beside the user's name. */
function initialsOf(name: string): string {
  return name
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export function AppLayout() {
  const { user, signOut } = useAuth()
  const displayName = user ? user.full_name || user.email : ''

  return (
    <div className="min-h-dvh">
      {/*
        The ::before strip extends the bar upward off-screen, so a browser that
        rubber-bands regardless of `overscroll-behavior` reveals more header
        rather than the page background.
      */}
      <header className="sticky top-0 z-10 bg-surface/90 backdrop-blur before:absolute before:inset-x-0 before:bottom-full before:h-[50vh] before:bg-surface before:content-['']">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2 sm:px-6">
          <Link to="/" className="rounded-md">
            <NirmaanLogo subtitle="Files" imgClassName="h-12 sm:h-14" />
          </Link>

          <div className="flex items-center gap-2">
            {user && (
              <span className="hidden items-center gap-2.5 text-sm text-ink-soft sm:flex">
                <span
                  aria-hidden
                  className="grid size-7 place-items-center rounded-full bg-ink text-[0.7rem] font-semibold text-white"
                >
                  {initialsOf(displayName)}
                </span>
                {displayName}
              </span>
            )}
            <Button variant="ghost" onClick={() => void signOut()}>
              <LogOut className="size-4" aria-hidden />
              Sign out
            </Button>
          </div>
        </div>
        {/* The logo's four verticals, carried across the page as a rule. */}
        <div className="nirmaan-rule h-1" aria-hidden />
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <Outlet />
      </main>
    </div>
  )
}
