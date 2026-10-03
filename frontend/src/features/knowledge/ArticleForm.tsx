import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { ApiError } from '@/api/client'
import type { Article, ArticleCategory, Project } from '@/api/types'
import { ARTICLE_CATEGORIES, ARTICLE_CATEGORY_LABELS } from '@/api/types'
import { Button, ErrorNote, Field, Input, Select, Textarea } from '@/components/ui'
import { useCreateArticle, useUpdateArticle } from '@/features/projects/queries'

const schema = z.object({
  category: z.enum(['CONTEXT', 'PROCESS', 'PARTNER', 'LESSON', 'OTHER']),
  title: z.string().trim().min(1, 'Give the page a name.').max(200),
  body: z.string().trim().min(1, 'Write something before saving.'),
  note: z.string().max(200),
})

type FormValues = z.infer<typeof schema>

/**
 * Writes one knowledge page — a new one, or `article` if given.
 *
 * The form that most needs explaining is `note`. Unlike `LogComposer`, and
 * unlike `ResourceForm`, this editor is usually *not* being used by whoever
 * wrote what is in it: anyone on the roster may edit any page, so the common
 * case is somebody correcting a page they inherited. The note is what turns
 * that from an unexplained overwrite into a legible change, and it is why the
 * field only appears when editing — the first version of a page needs no
 * account of what changed.
 *
 * `initialBody` exists for restoring an old version, which is an ordinary edit
 * carrying older text rather than an operation of its own.
 */
export function ArticleForm({
  project,
  article,
  initialBody,
  onDone,
  onCancel,
}: {
  project: Project
  article?: Article
  initialBody?: string
  onDone: (id: number) => void
  onCancel?: () => void
}) {
  const createArticle = useCreateArticle(project.slug)
  const updateArticle = useUpdateArticle(project.slug)
  const editing = article !== undefined

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: article
      ? {
          category: (article.category ?? 'OTHER') as ArticleCategory,
          title: article.title,
          body: initialBody ?? article.body,
          note: '',
        }
      : { category: 'CONTEXT', title: '', body: '', note: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    const fields = {
      category: values.category,
      title: values.title.trim(),
      body: values.body.trim(),
      revision_note: values.note.trim(),
    }

    if (article) {
      // `project` is deliberately omitted: an edit must not move a page to
      // another project's knowledge base, and the server refuses it anyway.
      const saved = await updateArticle.mutateAsync({ id: article.id, ...fields })
      onDone(saved.id)
    } else {
      const saved = await createArticle.mutateAsync({ project: project.id, ...fields })
      onDone(saved.id)
    }
  })

  const serverError = editing ? updateArticle.error : createArticle.error
  // One live page per title per project, so a clash comes back on this field.
  // Shown on the input rather than in the note below, so the correction happens
  // where the mistake is.
  const titleError = serverError instanceof ApiError ? serverError.fieldError('title') : undefined

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Topic" error={errors.category?.message}>
        <Select {...register('category')}>
          {ARTICLE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {ARTICLE_CATEGORY_LABELS[category]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Name" error={errors.title?.message ?? titleError}>
        <Input {...register('title')} placeholder="How the Saturday session runs" />
      </Field>

      <Field label="Content" error={errors.body?.message} hint="Markdown is supported.">
        <Textarea {...register('body')} className="min-h-64" />
      </Field>

      {editing && (
        <Field
          label="What changed"
          error={errors.note?.message}
          hint="Optional. Shown next to your name in the history."
        >
          <Input {...register('note')} placeholder="Corrected the bus timing" />
        </Field>
      )}

      {serverError && (
        <ErrorNote
          message={serverError instanceof ApiError ? serverError.detail : serverError.message}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Create page'}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" disabled={isSubmitting} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
