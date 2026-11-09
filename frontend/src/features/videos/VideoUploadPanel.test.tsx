import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderApp, stubApi } from '@/test/render'

import { VideoUploadPanel } from './VideoUploadPanel'
import { enqueueVideo, resetVideoUploads } from './videoUploads'

const START = 'POST /api/logs/7/videos/'
const CHUNK = 'POST /api/logs/7/videos/9/chunk/'
const started = { id: 9, bytes_received: 0, chunk_size: 4, is_complete: false }
const progress = (bytes_received: number, is_complete = false) => ({
  body: { id: 9, bytes_received, chunk_size: 4, is_complete },
})

function enqueue(onComplete = vi.fn()) {
  enqueueVideo({ logId: 7, file: new File(['abcdefghij'], 'visit.mp4'), onComplete })
  return onComplete
}

afterEach(() => {
  resetVideoUploads()
  vi.useRealTimers()
})

describe('background video uploads', () => {
  it('sends the file in order and reports when it is done', async () => {
    const calls = stubApi({
      [START]: { status: 201, body: started },
      [CHUNK]: [progress(4), progress(8), progress(10, true)],
    })
    renderApp(<VideoUploadPanel />)

    const onComplete = enqueue()

    expect(await screen.findByText('Uploaded')).toBeInTheDocument()
    expect(onComplete).toHaveBeenCalledOnce()
    const chunks = calls.filter((call) => call.path.endsWith('/chunk/'))
    expect(chunks.map((call) => (call.body as FormData).get('offset'))).toEqual(['0', '4', '8'])
    expect(calls[0]?.body).toMatchObject({ name: 'visit.mp4', size: 10 })
  })

  it('carries on from where the server says it got to', async () => {
    const calls = stubApi({
      [START]: { status: 201, body: started },
      [CHUNK]: [progress(8), progress(10, true)],
    })
    renderApp(<VideoUploadPanel />)

    enqueue()

    await screen.findByText('Uploaded')
    const chunks = calls.filter((call) => call.path.endsWith('/chunk/'))
    expect(chunks.map((call) => (call.body as FormData).get('offset'))).toEqual(['0', '8'])
  })

  it('retries a passing server failure by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    stubApi({
      [START]: { status: 201, body: started },
      [CHUNK]: [{ status: 503, body: { detail: 'Busy.' } }, progress(10, true)],
    })
    renderApp(<VideoUploadPanel />)

    enqueue()
    await vi.advanceTimersByTimeAsync(1500)

    await waitFor(() => expect(screen.getByText('Uploaded')).toBeInTheDocument())
  })

  it('stops on a refusal and can be retried from the same upload', async () => {
    const calls = stubApi({
      [START]: { status: 201, body: started },
      [CHUNK]: [{ status: 403, body: { detail: 'Not allowed.' } }, progress(10, true)],
    })
    renderApp(<VideoUploadPanel />)

    const onComplete = enqueue()

    expect(await screen.findByText('Not allowed.')).toBeInTheDocument()
    expect(onComplete).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await screen.findByText('Uploaded')
    expect(calls.filter((call) => call.path.endsWith('/videos/'))).toHaveLength(1)
  })

  it('warns before the tab closes while an upload is running', async () => {
    // Never answers, so the upload stays in progress.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    renderApp(<VideoUploadPanel />)

    enqueue()
    await screen.findByText(/Keep this tab open/)

    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('shows nothing when no uploads are running', () => {
    renderApp(<VideoUploadPanel />)
    expect(screen.queryByRole('complementary', { name: 'Video uploads' })).not.toBeInTheDocument()
  })
})
