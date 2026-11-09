import { X } from 'lucide-react'
import { useState } from 'react'

import type { StoredImage } from '@/api/types'
import { Field } from '@/components/ui'

import { MAX_PHOTO_MB, MAX_PHOTOS, type PhotoDraft } from './usePhotoDraft'

const PHOTO_TYPES = 'image/jpeg,image/png,image/webp'

/** A record's images. Each opens the full image in a new tab. */
export function PhotoGallery({
  images,
  title,
  noun = 'Photo',
}: {
  images: StoredImage[]
  title: string
  noun?: 'Photo' | 'Receipt'
}) {
  if (images.length === 0) return null

  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {images.map((image, index) => (
        <li key={image.id}>
          <a href={image.url} target="_blank" rel="noreferrer" className="block">
            <img
              src={image.thumbnail_url}
              alt={`${noun} ${index + 1} from ${title}`}
              loading="lazy"
              className="size-28 rounded-md object-cover ring-1 ring-line sm:size-32"
            />
          </a>
        </li>
      ))}
    </ul>
  )
}

function PhotoTile({
  src,
  name,
  onRemove,
  onLoad,
}: {
  src: string
  name: string
  onRemove: () => void
  onLoad?: () => void
}) {
  return (
    <li className="relative">
      <img
        src={src}
        alt={name}
        onLoad={onLoad}
        className="size-20 rounded-md object-cover ring-1 ring-line"
      />
      <button
        type="button"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
        className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-surface text-ink ring-1 ring-line-strong hover:bg-brand-50"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </li>
  )
}

/** A preview of a picked file that has not been uploaded yet. */
function PendingPhotoTile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [src] = useState(() => URL.createObjectURL(file))

  // An image keeps showing after its object URL is revoked, so it can go once loaded.
  return (
    <PhotoTile
      src={src}
      name={file.name}
      onRemove={onRemove}
      onLoad={() => URL.revokeObjectURL(src)}
    />
  )
}

/** The file picker and the previews of what is attached. */
export function PhotoField({
  draft,
  label,
  showPicker,
}: {
  draft: PhotoDraft
  label: string
  /** False until storage is set up. Anything already attached still shows. */
  showPicker: boolean
}) {
  const { existing, files } = draft

  return (
    <>
      {showPicker && (
        <Field
          label={label}
          error={draft.pickError}
          hint={`Optional. Up to ${MAX_PHOTOS}, as JPEG, PNG or WebP, ${MAX_PHOTO_MB} MB each.`}
        >
          <input
            type="file"
            multiple
            accept={PHOTO_TYPES}
            onChange={draft.pick}
            className="block w-full text-sm text-ink-soft file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink"
          />
        </Field>
      )}

      {/* Outside the `Field`, which is a <label>: a remove button inside one
          would also open the file picker. */}
      {(existing.length > 0 || files.length > 0) && (
        <ul className="flex flex-wrap gap-3 pt-1">
          {existing.map((image) => (
            <PhotoTile
              key={image.id}
              src={image.thumbnail_url}
              name={image.original_name}
              onRemove={() => draft.dropExisting(image.id)}
            />
          ))}
          {files.map((file, index) => (
            <PendingPhotoTile
              key={`${file.name}-${file.lastModified}-${index}`}
              file={file}
              onRemove={() => draft.dropFile(file)}
            />
          ))}
        </ul>
      )}
    </>
  )
}
