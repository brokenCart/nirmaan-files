import { type ChangeEvent, useState } from 'react'

import { ApiError } from '@/api/client'

// Mirrors `apps/drive/images.py`, so a bad pick is refused before anything saves.
export const MAX_PHOTOS = 10
export const MAX_PHOTO_MB = 10
const PHOTO_LIMITS = { maxCount: MAX_PHOTOS, maxMb: MAX_PHOTO_MB }

/** How the messages name what is attached, and what it is attached to. */
export interface PhotoWords {
  noun: 'photo' | 'receipt' | 'video'
  holder: 'entry' | 'request'
}

function messageFrom(error: unknown): string {
  if (error instanceof ApiError) return error.detail
  return error instanceof Error ? error.message : 'Something went wrong.'
}

/**
 * Images queued on a form, saved once the record they belong to exists.
 *
 * `save` keeps only what failed, so saving again retries those without
 * re-sending the rest. The caller must not create its record a second time.
 */
export function usePhotoDraft<T extends { id: number }>({
  saved,
  words,
  limits = PHOTO_LIMITS,
  add,
  remove,
}: {
  saved: T[]
  words: PhotoWords
  limits?: { maxCount: number; maxMb: number }
  add: (ownerId: number, file: File) => Promise<unknown>
  remove: (ownerId: number, imageId: number) => Promise<unknown>
}) {
  const [files, setFiles] = useState<File[]>([])
  const [removedIds, setRemovedIds] = useState<number[]>([])
  const [alreadyRemoved] = useState(() => new Set<number>())
  const [pickError, setPickError] = useState<string>()
  const [uploadError, setUploadError] = useState<string>()

  const existing = saved.filter((image) => !removedIds.includes(image.id))
  const { noun, holder } = words

  function pick(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? [])
    // Cleared so picking the same file again after removing it still fires.
    event.target.value = ''

    const fitting = picked.filter((file) => file.size <= limits.maxMb * 1024 * 1024)
    const room = Math.max(0, limits.maxCount - existing.length - files.length)
    setFiles([...files, ...fitting.slice(0, room)])

    if (fitting.length < picked.length) {
      const plural = `${noun.charAt(0).toUpperCase()}${noun.slice(1)}s`
      setPickError(`${plural} can be up to ${limits.maxMb} MB each.`)
    } else if (fitting.length > room) {
      const article = holder === 'entry' ? 'An' : 'A'
      setPickError(`${article} ${holder} can hold ${limits.maxCount} ${noun}s.`)
    } else {
      setPickError(undefined)
    }
  }

  async function save(ownerId: number): Promise<boolean> {
    setUploadError(undefined)
    try {
      for (const imageId of removedIds) {
        if (alreadyRemoved.has(imageId)) continue
        await remove(ownerId, imageId)
        alreadyRemoved.add(imageId)
      }
    } catch (error) {
      setUploadError(`Your ${holder} is saved, but a ${noun} wasn't removed: ${messageFrom(error)}`)
      return false
    }

    let remaining = files
    for (const file of files) {
      try {
        await add(ownerId, file)
      } catch (error) {
        // Only what has not gone up yet stays queued for the retry.
        setFiles(remaining)
        setUploadError(
          `Your ${holder} is saved, but ${remaining.length} of your ${noun}s didn't upload: ` +
            `${messageFrom(error)} Save again to retry, or cancel to leave them out.`,
        )
        return false
      }
      remaining = remaining.filter((other) => other !== file)
    }
    // Nothing left to send if a later step fails and the form is saved again.
    setFiles([])
    return true
  }

  return {
    existing,
    files,
    pick,
    pickError,
    uploadError,
    save,
    dropFile: (file: File) => setFiles(files.filter((other) => other !== file)),
    dropExisting: (id: number) => setRemovedIds([...removedIds, id]),
  }
}

export type PhotoDraft<T extends { id: number }> = ReturnType<typeof usePhotoDraft<T>>
