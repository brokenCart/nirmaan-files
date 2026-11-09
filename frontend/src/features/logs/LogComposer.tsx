import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useController, useForm } from 'react-hook-form'
import { z } from 'zod'

import { ApiError } from '@/api/client'
import type { DailyLog, Membership, Project, Semester } from '@/api/types'
import {
  Button,
  Checkbox,
  ErrorNote,
  Field,
  Fieldset,
  Input,
  Select,
  Textarea,
} from '@/components/ui'
import {
  useAddLogImage,
  useCreateLog,
  useRemoveLogImage,
  useUpdateLog,
} from '@/features/projects/queries'
import { PhotoField } from '@/features/photos/PhotoAttachments'
import { usePhotoDraft } from '@/features/photos/usePhotoDraft'

const PHOTO_WORDS = { noun: 'photo', holder: 'entry' } as const

const schema = z.object({
  kind: z.enum(['MOV', 'MOM']),
  title: z.string().min(3, 'Give the entry a title.').max(200),
  body: z.string().min(1, 'Write what happened.'),
  occurred_on: z.string().min(1, 'Pick a date.'),
  // A string, because that is what a number `input` yields; converted on submit.
  hours: z.string().refine((value) => {
    const hours = Number(value)
    return hours >= 0.5 && hours <= 24 && Number.isInteger(hours * 2)
  }, 'Enter hours in half-hour steps, from 0.5 to 24.'),
  // Strings, because that is what a checkbox `value` yields; converted to ids
  // on submit.
  attendee_ids: z.array(z.string()).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED']),
})

type FormValues = z.infer<typeof schema>

/**
 * Writes one timeline entry — a new one, or `log` if given.
 *
 * Only an author reaches the edit path, so this form always belongs to the
 * person whose account the entry is. Publishing a draft is an edit like any
 * other: it flips `status`.
 */
export function LogComposer({
  project,
  members,
  log,
  semester,
  onDone,
}: {
  project: Project
  members: Membership[]
  log?: DailyLog
  /** The open term. Bounds the date picker to the semester being written to. */
  semester?: Semester | null
  onDone: () => void
}) {
  const createLog = useCreateLog(project.slug)
  const updateLog = useUpdateLog(project.slug)
  const addImage = useAddLogImage()
  const removeImage = useRemoveLogImage()

  // Set once a new entry exists but a photo failed, so saving again retries the
  // photos instead of filing a second copy of the entry.
  const [created, setCreated] = useState<DailyLog>()
  const target = log ?? created
  const editing = target !== undefined

  const photos = usePhotoDraft({
    saved: log?.images ?? [],
    words: PHOTO_WORDS,
    add: (logId, file) => addImage.mutateAsync({ logId, file }),
    remove: (logId, imageId) => removeImage.mutateAsync({ logId, imageId }),
  })

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: log
      ? {
          kind: log.kind,
          status: log.status ?? 'PUBLISHED',
          occurred_on: log.occurred_on,
          hours: String(log.hours ?? 1),
          title: log.title,
          body: log.body,
          attendee_ids: log.attendees.map((attendee) => String(attendee.id)),
        }
      : {
          kind: 'MOV',
          status: 'PUBLISHED',
          occurred_on: new Date().toISOString().slice(0, 10),
          hours: '1',
          title: '',
          body: '',
          attendee_ids: [],
        },
  })

  // Controlled rather than `register`ed: react-hook-form reads a lone
  // registered checkbox as a boolean, so a one-member roster would submit
  // `true` instead of an array.
  const { field: attendees } = useController({ control, name: 'attendee_ids' })
  const selected = attendees.value ?? []

  const toggleAttendee = (id: string, checked: boolean) =>
    attendees.onChange(checked ? [...selected, id] : selected.filter((value) => value !== id))

  const onSubmit = handleSubmit(async (values) => {
    const fields = {
      kind: values.kind,
      title: values.title,
      body: values.body,
      occurred_on: values.occurred_on,
      hours: Number(values.hours),
      status: values.status,
      // Always sent, so clearing the selection actually clears the attendees.
      attendee_ids: values.attendee_ids?.map(Number) ?? [],
    }

    let saved: DailyLog
    try {
      if (target) {
        // `project` is deliberately omitted: an edit must not move an entry to
        // another project's timeline.
        saved = await updateLog.mutateAsync({ id: target.id, ...fields })
      } else {
        saved = await createLog.mutateAsync({ project: project.id, ...fields })
        setCreated(saved)
      }
    } catch {
      // Already on screen through the mutation's `error`, below. Left to
      // propagate, `handleSubmit` would rethrow it as an unhandled rejection.
      return
    }
    if (await photos.save(saved.id)) onDone()
  })

  const serverError = editing ? updateLog.error : createLog.error

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Entry type">
        <Select {...register('kind')}>
          <option value="MOV">MOV (Moment of Visit)</option>
          <option value="MOM">MOM (Minutes of Meeting)</option>
        </Select>
      </Field>

      <Field label="Title" error={errors.title?.message}>
        <Input {...register('title')} placeholder="Weekly session at the community centre" />
      </Field>

      <Field
        label="Date"
        error={errors.occurred_on?.message}
        hint={semester ? `Must fall within ${semester.name}.` : undefined}
      >
        {/* Bounded to the open term: a date outside it lands the entry in a
            closed semester, which the server refuses. Better to make the
            invalid day unpickable than to explain the 403 afterwards. */}
        <Input
          type="date"
          min={semester?.starts_on}
          max={semester?.ends_on}
          {...register('occurred_on')}
        />
      </Field>

      <Field
        label="Hours"
        error={errors.hours?.message}
        hint="How long it lasted. Everyone marked present below gets these hours."
      >
        <Input
          type="number"
          inputMode="decimal"
          min={0.5}
          max={24}
          step={0.5}
          {...register('hours')}
        />
      </Field>

      <Fieldset
        label="Who was there"
        hint={`Used for attendance counts. ${selected.length} selected.`}
      >
        <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md bg-surface p-1.5 ring-1 ring-line-strong ring-inset">
          {members.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-ink-mute">No members this semester yet.</p>
          ) : (
            members.map((member) => {
              const id = String(member.user.id)
              return (
                <label
                  key={member.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-brand-50"
                >
                  <Checkbox
                    value={id}
                    checked={selected.includes(id)}
                    onChange={(event) => toggleAttendee(id, event.target.checked)}
                    onBlur={attendees.onBlur}
                  />
                  {member.user.full_name || member.user.email}
                </label>
              )
            })
          )}
        </div>
      </Fieldset>

      <Field label="What happened" error={errors.body?.message}>
        <Textarea {...register('body')} placeholder="Markdown is supported." />
      </Field>

      <PhotoField draft={photos} label="Photos" showPicker={project.image_uploads_enabled} />

      <Field label="Status">
        <Select {...register('status')}>
          <option value="PUBLISHED">Publish to the project timeline</option>
          <option value="DRAFT">Save as a private draft</option>
        </Select>
      </Field>

      {serverError && (
        <ErrorNote
          message={serverError instanceof ApiError ? serverError.detail : serverError.message}
        />
      )}
      {photos.uploadError && <ErrorNote message={photos.uploadError} />}

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Save entry'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
