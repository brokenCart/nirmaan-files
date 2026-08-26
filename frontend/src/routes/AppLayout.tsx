import { LogOut } from 'lucide-react'
import { Link, Outlet } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { NirmaanLogo } from '@/components/Logo'
import { Button } from '@/components/ui'

export function AppLayout() {
  const { user, signOut } = useAuth()

  return (
    <div className="min-h-dvh">
      {/*
        The ::before strip extends the bar upward off-screen, so a browser that
        rubber-bands regardless of `overscroll-behavior` reveals more header
        rather than the page background. It is solid rather than the bar's own
        translucent fill because there is nothing behind it to show through.
      */}
      <header className="sticky top-0 z-10 border-b border-line bg-surface/85 backdrop-blur before:absolute before:inset-x-0 before:bottom-full before:h-[50vh] before:bg-surface before:content-['']">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="rounded-lg">
            <NirmaanLogo subtitle="Files" imgClassName="h-11" />
          </Link>

          <div className="flex items-center gap-3">
            {user && (
              <span className="hidden text-sm text-ink-soft sm:inline">
                {user.full_name || user.email}
              </span>
            )}
            <Button variant="ghost" onClick={() => void signOut()}>
              <LogOut className="size-4" aria-hidden />
              Sign out
            </Button>
          </div>
        </div>
        {/* The logo's four verticals, carried across the page as a hairline. */}
        <div className="nirmaan-rule h-0.5" aria-hidden />
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
