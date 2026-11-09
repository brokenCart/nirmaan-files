import { useSyncExternalStore } from 'react'

import { api, ApiError } from '@/api/client'
import type { VideoUploadState } from '@/api/types'

/**
 * Videos going up in the background.
 *
 * A module-level queue rather than component state, so an upload carries on
 * after the form closes and while the user moves between screens. It lives as
 * long as the tab does: closing or reloading the tab stops it, which is why
 * `VideoUploadPanel` warns before that happens.
 */
export interface VideoUpload {
  key: number
  logId: number
  file: File
  sent: number
  state: 'queued' | 'uploading' | 'failed' | 'done'
  error?: string
  uploadId?: number
  onComplete: () => void
}

const MAX_RETRIES = 5

let uploads: VideoUpload[] = []
let nextKey = 1
let pumping = false
const listeners = new Set<() => void>()
const cancelled = new Set<number>()

function publish(next: VideoUpload[]) {
  uploads = next
  listeners.forEach((listener) => listener())
}

function patch(key: number, changes: Partial<VideoUpload>) {
  publish(uploads.map((upload) => (upload.key === key ? { ...upload, ...changes } : upload)))
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useVideoUploads(): VideoUpload[] {
  return useSyncExternalStore(subscribe, () => uploads)
}

function isTransient(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function send(upload: VideoUpload) {
  const { key, logId, file } = upload
  let uploadId = upload.uploadId
  let chunkSize = 0
  let sent = upload.sent
  let attempts = 0

  if (uploadId === undefined) {
    const started = await api.post<VideoUploadState>(`/api/logs/${logId}/videos/`, {
      name: file.name,
      size: file.size,
      content_type: file.type,
    })
    uploadId = started.id
    chunkSize = started.chunk_size
    patch(key, { uploadId })
  }

  // A retried upload has no reply to read this from. Anything the server
  // accepts is fine, and the server corrects the position either way.
  chunkSize ||= 8 * 1024 * 1024

  while (!cancelled.has(key)) {
    const form = new FormData()
    form.append('offset', String(sent))
    form.append('chunk', file.slice(sent, sent + chunkSize), 'chunk')

    let state: VideoUploadState
    try {
      state = await api.post<VideoUploadState>(`/api/logs/${logId}/videos/${uploadId}/chunk/`, form)
    } catch (error) {
      if (!isTransient(error) || attempts >= MAX_RETRIES) throw error
      attempts += 1
      await wait(1000 * 2 ** (attempts - 1))
      continue
    }

    if (state.is_complete) return
    if (state.bytes_received === sent) {
      if (attempts >= MAX_RETRIES) throw new Error('The upload stopped making progress.')
      attempts += 1
    } else {
      attempts = 0
    }
    sent = state.bytes_received
    patch(key, { sent })
  }
}

async function pump() {
  if (pumping) return
  pumping = true
  try {
    // One at a time, so several videos cannot saturate someone's connection.
    let upload: VideoUpload | undefined
    while ((upload = uploads.find((item) => item.state === 'queued'))) {
      const { key } = upload
      patch(key, { state: 'uploading', error: undefined })
      try {
        await send(upload)
        if (cancelled.has(key)) continue
        patch(key, { state: 'done', sent: upload.file.size })
        upload.onComplete()
      } catch (error) {
        patch(key, {
          state: 'failed',
          error: error instanceof Error ? error.message : 'The upload failed.',
        })
      }
    }
  } finally {
    pumping = false
  }
}

export function enqueueVideo({
  logId,
  file,
  onComplete,
}: Pick<VideoUpload, 'logId' | 'file' | 'onComplete'>) {
  publish([...uploads, { key: nextKey++, logId, file, onComplete, sent: 0, state: 'queued' }])
  void pump()
}

export function retryVideo(key: number) {
  patch(key, { state: 'queued' })
  void pump()
}

/** Stops an upload if it is running and takes it off the list. */
export function dismissVideo(key: number) {
  cancelled.add(key)
  publish(uploads.filter((upload) => upload.key !== key))
}

/** For tests: the queue outlives a render, so it has to be emptied by hand. */
export function resetVideoUploads() {
  uploads.forEach((upload) => cancelled.add(upload.key))
  pumping = false
  publish([])
}
