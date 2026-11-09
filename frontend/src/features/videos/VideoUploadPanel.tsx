import { Film, X } from 'lucide-react'
import { useEffect } from 'react'

import { Button } from '@/components/ui'

import { dismissVideo, retryVideo, useVideoUploads, type VideoUpload } from './videoUploads'

function statusText(upload: VideoUpload, percent: number): string {
  switch (upload.state) {
    case 'queued':
      return 'Waiting to upload'
    case 'uploading':
      return `Uploading, ${percent}%`
    case 'done':
      return 'Uploaded'
    case 'failed':
      return upload.error ?? 'The upload failed.'
  }
}

function UploadRow({ upload }: { upload: VideoUpload }) {
  const percent = Math.floor((upload.sent / upload.file.size) * 100)
  const active = upload.state === 'queued' || upload.state === 'uploading'

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Film className="mt-0.5 size-4 shrink-0 text-ink-mute" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{upload.file.name}</p>
          <p
            className={
              upload.state === 'failed' ? 'text-sm text-danger-600' : 'text-sm text-ink-mute'
            }
          >
            {statusText(upload, percent)}
          </p>
        </div>
        <button
          type="button"
          aria-label={`${active ? 'Cancel' : 'Dismiss'} ${upload.file.name}`}
          onClick={() => dismissVideo(upload.key)}
          className="grid size-6 shrink-0 place-items-center rounded-full text-ink-mute hover:bg-brand-50 hover:text-ink"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      {upload.state === 'uploading' && (
        <div
          role="progressbar"
          aria-label={`Uploading ${upload.file.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-stripe"
        >
          <div className="h-full bg-ink" style={{ width: `${percent}%` }} />
        </div>
      )}

      {upload.state === 'failed' && (
        <div className="mt-1 -ml-2">
          <Button variant="ghost" onClick={() => retryVideo(upload.key)}>
            Retry
          </Button>
        </div>
      )}
    </li>
  )
}

/** Shows videos uploading in the background, on every screen. */
export function VideoUploadPanel() {
  const uploads = useVideoUploads()
  const active = uploads.some((upload) => upload.state === 'queued' || upload.state === 'uploading')

  // The queue lives in this tab, so leaving it would abandon the upload.
  useEffect(() => {
    if (!active) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [active])

  if (uploads.length === 0) return null

  return (
    <aside
      aria-label="Video uploads"
      className="fixed right-4 bottom-4 z-20 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-[10px] border border-line bg-surface shadow-lg"
    >
      {active && (
        <p className="border-b border-line bg-paper/70 px-3 py-2 text-sm text-ink-soft">
          You can keep working. Keep this tab open until uploads finish.
        </p>
      )}
      <ul aria-live="polite" className="max-h-72 divide-y divide-line overflow-y-auto">
        {uploads.map((upload) => (
          <UploadRow key={upload.key} upload={upload} />
        ))}
      </ul>
    </aside>
  )
}
