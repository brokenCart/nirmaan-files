import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { ApiError } from '@/api/client'
import type { Membership, Project } from '@/api/types'
import { Button, ErrorNote, Field, Input, Textarea } from '@/components/ui'
import { useCreateLog } from '@/features/projects/queries'

const schema = z
  .object({
    kind: z.enum(['MOV', 'MOM']),
    title: z.string().min(3, 'Give the entry a title.').max(200),
    body: z.string().min(1, 'Write what happened.'),
    occurred_on: z.string().min(1, 'Pick the date it happened.'),
    location: z.string().max(200).optional(),
    attendee_ids: z.array(z.number()).optional(),
    status: z.enum(['DRAFT', 'PUBLISHED']),
  })
  // Mirrors the server rule: each kind carries only its own fields.
  .refine((value) => value.kind === 'MOV' || !value.location, {
    path: ['location'],
    message: 'Location applies to a visit, not a meeting.',
  })

type FormValues = z.infer<typeof schema>

export function LogComposer({
  project,
  members,
  onDone,
}: {
  project: Project
  members: Membership[]
  onDone: () => void
}) {
  const createLog = useCreateLog(project.slug)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      kind: 'MOV',
      status: 'PUBLISHED',
      occurred_on: new Date().toISOString().slice(0, 10),
      title: '',
      body: '',
    },
  })

  const kind = watch('kind')

  const onSubmit = handleSubmit(async (values) => {
    const payload: Record<string, unknown> = {
      project: project.id,
      kind: values.kind,
      title: values.title,
      body: values.body,
      occurred_on: values.occurred_on,
      status: values.status,
    }
    if (values.kind === 'MOV' && values.location) payload.location = values.location
    if (values.kind === 'MOM' && values.attendee_ids?.length) {
      payload.attendee_ids = values.attendee_ids
    }

    await createLog.mutateAsync(payload)
    onDone()
  })

  const serverError = createLog.error

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Entry type">
        <select
          {...register('kind')}
          className="w-full rounded-md border-0 bg-white px-3 py-2 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-brand-600"
        >
          <option value="MOV">MOV — Moment of Visit</option>
          <option value="MOM">MOM — Minutes of Meeting</option>
        </select>
      </Field>

      <Field label="Title" error={errors.title?.message}>
        <Input {...register('title')} placeholder="Weekly session at the community centre" />
      </Field>

      <Field label="Date" error={errors.occurred_on?.message}>
        <Input type="date" {...register('occurred_on')} />
      </Field>

      {kind === 'MOV' && (
        <Field label="Location" error={errors.location?.message}>
          <Input {...register('location')} placeholder="Village school, Pilani" />
        </Field>
      )}

      {kind === 'MOM' && (
        <Field label="Attendees" hint="Hold Ctrl/Cmd to select more than one.">
          <select
            multiple
            {...register('attendee_ids', {
              setValueAs: (value: string[] | undefined) => value?.map(Number) ?? [],
            })}
            className="w-full rounded-md border-0 bg-white px-3 py-2 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-brand-600"
            size={Math.min(members.length || 1, 6)}
          >
            {members.map((member) => (
              <option key={member.id} value={member.user.id}>
                {member.user.full_name || member.user.email}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="What happened" error={errors.body?.message}>
        <Textarea {...register('body')} placeholder="Markdown is supported." />
      </Field>

      <Field label="Status">
        <select
          {...register('status')}
          className="w-full rounded-md border-0 bg-white px-3 py-2 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-brand-600"
        >
          <option value="PUBLISHED">Publish to the project timeline</option>
          <option value="DRAFT">Save as a private draft</option>
        </select>
      </Field>

      {serverError && (
        <ErrorNote
          message={serverError instanceof ApiError ? serverError.detail : serverError.message}
        />
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save entry'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
