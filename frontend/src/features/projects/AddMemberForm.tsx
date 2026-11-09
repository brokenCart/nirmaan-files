import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { ApiError } from '@/api/client'
import type { Project, Semester } from '@/api/types'
import { assignableRoles, ROLE_LABELS } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { Button, ErrorNote, Field, Input, Select } from '@/components/ui'
import { useAddMember } from '@/features/projects/queries'

const schema = z.object({
  // Shape only. The domain rule is the server's — `is_allowed_email` is an exact
  // match on one campus domain, and a second copy here is a copy that can drift.
  user_email: z.string().min(1, 'Enter an email address.').email('Enter a valid email address.'),
  role: z.enum(['VOLUNTEER', 'FINANCE_LEAD', 'LEAD']),
})

type FormValues = z.infer<typeof schema>

/**
 * Adds one person to `project`'s roster for `semester`.
 *
 * Rendered only where `canManageRoster` allows it, so the term is always one
 * the caller may write to — the open one for a lead, any for exec. It is named
 * above the buttons rather than left implicit, because exec reaches this form
 * from an archived roster too and the form must say which year it lands in.
 *
 * A lead can only hand out `VOLUNTEER`, so for them the role picker is a
 * one-option list and is replaced by a line of text — a `<select>` that cannot
 * select anything reads as broken rather than as a rule.
 */
export function AddMemberForm({
  project,
  semester,
  onDone,
}: {
  project: Project
  semester: Semester
  onDone: () => void
}) {
  const addMember = useAddMember(project.slug)
  const { user } = useAuth()
  const roles = assignableRoles(user?.is_exec ?? false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { user_email: '', role: roles[0] },
  })

  const onSubmit = handleSubmit(async (values) => {
    try {
      await addMember.mutateAsync({
        project: project.id,
        semester: semester.id,
        user_email: values.user_email.trim(),
        role: values.role,
      })
    } catch {
      // Already on screen through the mutation's `error`, below. Left to
      // propagate, `handleSubmit` would rethrow it as an unhandled rejection.
      return
    }
    onDone()
  })

  const serverError = addMember.error
  // The domain rule and the one-row-per-term constraint both come back against
  // this field. Shown on the input rather than in the note below, so the
  // correction happens where the mistake is.
  const emailError =
    serverError instanceof ApiError ? serverError.fieldError('user_email') : undefined

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-3 border-t border-line pt-3">
      <Field
        label="Email"
        error={errors.user_email?.message ?? emailError}
        hint="They don’t need to have signed in yet."
      >
        <Input
          type="email"
          autoComplete="off"
          placeholder="f20230000@pilani.bits-pilani.ac.in"
          {...register('user_email')}
        />
      </Field>

      {roles.length > 1 ? (
        <Field label="Role">
          <Select {...register('role')}>
            {roles.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field label="Role" hint="Only the Executive Committee can appoint leads.">
          <p className="text-sm text-ink-soft">{ROLE_LABELS[roles[0]]}</p>
        </Field>
      )}

      {/* Anything not already shown on the email input: a 403 on a closed term,
          a role the server rejected, a request that never landed. */}
      {serverError && !emailError && (
        <ErrorNote
          message={serverError instanceof ApiError ? serverError.detail : serverError.message}
        />
      )}

      {/* The term is a caption rather than the button's label: it is the one
          piece of text here with no length bound — "2026-27 Sem 1" already
          wrapped the button inside the rail, and a longer name would be worse. */}
      <p className="text-sm text-ink-mute">
        Joining <span className="font-medium text-ink-soft">{semester.name}</span>
      </p>

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting} className="flex-1">
          {isSubmitting ? 'Adding…' : 'Add member'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
