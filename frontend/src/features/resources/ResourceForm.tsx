import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { ApiError } from '@/api/client'
import type { Project, Resource } from '@/api/types'
import { RESOURCE_KIND_LABELS, RESOURCE_KINDS } from '@/api/types'
import { Button, ErrorNote, Field, Input, Select, Textarea } from '@/components/ui'
import { useCreateResource, useUpdateResource } from '@/features/projects/queries'

const schema = z.object({
  kind: z.enum(['FOLDER', 'DOCUMENT', 'SHEET', 'FORM', 'OTHER']),
  title: z.string().trim().min(1, 'Give the link a name.').max(200),
  // Shape only, and deliberately loose about the scheme — `web_url_validator`
  // on the server is the rule, and a second copy of it here is a copy that can
  // drift. What this catches is the empty field and the obvious typo.
  url: z.string().trim().min(1, 'Paste the link.').url('That is not a link.'),
  description: z.string(),
})

type FormValues = z.infer<typeof schema>

/**
 * Writes one resource — a new one, or `resource` if given.
 *
 * Unlike `LogComposer` this form is not necessarily the work of the person who
 * created the row: a lead fixing a moved Drive URL edits a link a volunteer
 * pasted, which is the point of the wider edit rule. There is no date and no
 * term picker, because a resource belongs to no semester.
 */
export function ResourceForm({
  project,
  resource,
  onDone,
}: {
  project: Project
  resource?: Resource
  onDone: () => void
}) {
  const createResource = useCreateResource(project.slug)
  const updateResource = useUpdateResource(project.slug)
  const editing = resource !== undefined

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: resource
      ? {
          kind: resource.kind ?? 'OTHER',
          title: resource.title,
          url: resource.url,
          description: resource.description ?? '',
        }
      : { kind: 'FOLDER', title: '', url: '', description: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    const fields = {
      kind: values.kind,
      title: values.title.trim(),
      url: values.url.trim(),
      description: values.description.trim(),
    }

    if (resource) {
      // `project` is deliberately omitted: an edit must not move a link to
      // another project's shelf, and the server refuses it anyway.
      await updateResource.mutateAsync({ id: resource.id, ...fields })
    } else {
      await createResource.mutateAsync({ project: project.id, ...fields })
    }
    onDone()
  })

  const serverError = editing ? updateResource.error : createResource.error
  // The scheme rule and the one-link-per-project constraint both come back
  // against this field. Shown on the input rather than in the note below, so
  // the correction happens where the mistake is.
  const urlError = serverError instanceof ApiError ? serverError.fieldError('url') : undefined

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="What is it" error={errors.kind?.message}>
        <Select {...register('kind')}>
          {RESOURCE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {RESOURCE_KIND_LABELS[kind]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Name" error={errors.title?.message}>
        <Input {...register('title')} placeholder="Project Drive folder" />
      </Field>

      <Field
        label="Link"
        error={errors.url?.message ?? urlError}
        hint="Anyone opening it needs access in Drive — this stores the address, not the file."
      >
        <Input
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://drive.google.com/drive/folders/…"
          {...register('url')}
        />
      </Field>

      <Field label="What it is for" error={errors.description?.message}>
        <Textarea
          {...register('description')}
          className="min-h-20"
          placeholder="Optional — a line so the next batch knows what they are opening."
        />
      </Field>

      {/* Anything not already shown on the link input: a 403 from a stale
          affordance, a request that never landed. */}
      {serverError && !urlError && (
        <ErrorNote
          message={serverError instanceof ApiError ? serverError.detail : serverError.message}
        />
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Add link'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
