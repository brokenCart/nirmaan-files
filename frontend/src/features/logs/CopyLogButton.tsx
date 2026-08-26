import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { DailyLog } from '@/api/types'
import { Button } from '@/components/ui'

import { formatLogForCopy } from './copyLog'

type State = 'idle' | 'copied' | 'failed'

/**
 * Copies one entry to the clipboard as plain text.
 *
 * Available to every reader, not just whoever may edit the entry — copying is
 * what the timeline is for.
 */
export function CopyLogButton({ log }: { log: DailyLog }) {
  const [state, setState] = useState<State>('idle')
  const resetAt = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // A card can unmount while the confirmation is still showing — after a
  // delete, or when paging the feed.
  useEffect(() => () => clearTimeout(resetAt.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(formatLogForCopy(log))
      setState('copied')
    } catch {
      // Refused when the browser withholds clipboard permission. A non-secure
      // context cannot arise: Google Identity Services already requires one,
      // so sign-in would have failed first.
      setState('failed')
    }
    clearTimeout(resetAt.current)
    resetAt.current = setTimeout(() => setState('idle'), 2000)
  }

  return (
    <Button
      variant="ghost"
      onClick={() => void copy()}
      aria-label={`Copy “${log.title}” as text`}
    >
      {state === 'copied' ? (
        <Check className="size-4" aria-hidden />
      ) : (
        <Copy className="size-4" aria-hidden />
      )}
      {/* aria-live so the outcome reaches a screen reader, which cannot see
          the icon swap. */}
      <span aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
      </span>
    </Button>
  )
}
