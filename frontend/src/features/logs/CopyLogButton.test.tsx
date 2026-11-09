import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CopyLogButton } from '@/features/logs/CopyLogButton'
import { formatLogForCopy } from '@/features/logs/copyLog'
import { makeLog } from '@/test/factories'

const log = makeLog({ title: 'Saturday session' })

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
}

async function clickCopy() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Copy “Saturday session”/ }))
    await vi.advanceTimersByTimeAsync(0)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CopyLogButton', () => {
  it('copies the formatted entry and confirms, then resets', async () => {
    const writeText = vi.fn(async () => undefined)
    stubClipboard(writeText)
    render(<CopyLogButton log={log} />)

    await clickCopy()
    expect(writeText).toHaveBeenCalledWith(formatLogForCopy(log))
    expect(screen.getByText('Copied')).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(screen.getByText('Copy')).toBeInTheDocument()
  })

  it('says so when the browser refuses', async () => {
    stubClipboard(vi.fn(async () => Promise.reject(new Error('denied'))))
    render(<CopyLogButton log={log} />)

    await clickCopy()
    expect(screen.getByText('Copy failed')).toBeInTheDocument()
  })
})
