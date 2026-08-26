import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { ApiError } from '@/api/client'
import type { DailyLog, Membership, Project } from '@/api/types'
import { Button, ErrorNote, Field, Input, Select, Textarea } from '@/components/ui'
import { useCreateLog, useUpdateLog } from '@/features/projects/queries'

const schema = z.object({
  kind: z.enum(['MOV', 'MOM']),
  title: z.string().min(3, 'Give the entry a title.').max(200),
  body: z.string().min(1, 'Write what happened.'),
  occurred_on: z.string().min(1, 'Pick the date it happened.'),
  // Strings, because that is what a multi-select yields and compares against
  // its options; converted to ids on submit.
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
  onDone,
}: {
  project: Project
  members: Membership[]
  log?: DailyLog
  onDone: () => void
}) {
  const createLog = useCreateLog(project.slug)
  const updateLog = useUpdateLog(project.slug)
  const editing = log !== undefined

  const {
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
          title: log.title,
          body: log.body,
          attendee_ids: log.attendees.map((attendee) => String(attendee.id)),
        }
      : {
          kind: 'MOV',
          status: 'PUBLISHED',
          occurred_on: new Date().toISOString().slice(0, 10),
          title: '',
          body: '',
          attendee_ids: [],
        },
  })

  const onSubmit = handleSubmit(async (values) => {
    const fields = {
      kind: values.kind,
      title: values.title,
      body: values.body,
      occurred_on: values.occurred_on,
      status: values.status,
      // Always sent, so clearing the selection actually clears the attendees.
      attendee_ids: values.attendee_ids?.map(Number) ?? [],
    }

    if (log) {
      // `project` is deliberately omitted: an edit must not move an entry to
      // another project's timeline.
      await updateLog.mutateAsync({ id: log.id, ...fields })
    } else {
      await createLog.mutateAsync({ project: project.id, ...fields })
    }
    onDone()
  })

  const serverError = editing ? updateLog.error : createLog.error

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Entry type">
        <Select {...register('kind')}>
          <option value="MOV">MOV — Moment of Visit</option>
          <option value="MOM">MOM — Minutes of Meeting</option>
        </Select>
      </Field>

      <Field label="Title" error={errors.title?.message}>
        <Input {...register('title')} placeholder="Weekly session at the community centre" />
      </Field>

      <Field label="Date" error={errors.occurred_on?.message}>
        <Input type="date" {...register('occurred_on')} />
      </Field>

      <Field
        label="Who was there"
        hint="Hold Ctrl/Cmd to select more than one. Visit and meeting counts come from this."
      >
        <Select multiple {...register('attendee_ids')} size={Math.min(members.length || 1, 6)}>
          {members.map((member) => (
            <option key={member.id} value={member.user.id}>
              {member.user.full_name || member.user.email}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="What happened" error={errors.body?.message}>
        <Textarea {...register('body')} placeholder="Markdown is supported." />
      </Field>

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
