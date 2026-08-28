import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { ApiError } from '@/api/client'
import type { Project, Reimbursement } from '@/api/types'
import { Button, ErrorNote, Field, Input, Textarea } from '@/components/ui'
import {
  useCreateReimbursement,
  useUpdateReimbursement,
} from '@/features/projects/queries'

const schema = z.object({
  title: z.string().trim().min(1, 'Say what the money was for.').max(200),
  // Validated as text rather than coerced to a number, so the value posted is
  // the string the server's `DecimalField` wants — the same reason `amount`
  // arrives as a string in the first place. The rules mirror the column:
  // greater than zero, at most two decimal places, at most 10 digits.
  amount: z
    .string()
    .trim()
    .min(1, 'How much are you claiming?')
    .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount in rupees, like 480 or 480.50.')
    .refine((value) => Number(value) > 0, 'Claim an amount greater than zero.'),
  description: z
    .string()
    .trim()
    .min(1, 'Describe the expense — whoever reviews this has only what you write here.'),
})

type FormValues = z.infer<typeof schema>

/**
 * Files one reimbursement request, or edits `reimbursement` if given.
 *
 * Only ever the submitter's own work, unlike `ResourceForm` — nobody else may
 * edit a request at all, so there is no case where this form is opened over
 * somebody else's row. A finance lead who disagrees with a claim reviews it;
 * they do not reword it.
 *
 * There is no status control here and no term picker. The decision belongs to
 * the review endpoint, and the term is stamped from the clock when the request
 * is filed.
 *
 * Until proof documents land (see `apps.reimbursements.models.Reimbursement`),
 * the receipt itself is still described rather than attached — which is what
 * the details placeholder asks for, rather than leaving the submitter to guess
 * how much a reviewer needs.
 */
export function ReimbursementForm({
  project,
  reimbursement,
  onDone,
}: {
  project: Project
  reimbursement?: Reimbursement
  onDone: () => void
}) {
  const createReimbursement = useCreateReimbursement(project.slug)
  const updateReimbursement = useUpdateReimbursement(project.slug)
  const editing = reimbursement !== undefined

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: reimbursement
      ? {
          title: reimbursement.title,
          amount: reimbursement.amount,
          description: reimbursement.description,
        }
      : { title: '', amount: '', description: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    const fields = {
      title: values.title.trim(),
      amount: values.amount.trim(),
      description: values.description.trim(),
    }

    if (reimbursement) {
      // `project` is deliberately omitted: a request cannot move to another
      // project's queue, and the server refuses it anyway.
      await updateReimbursement.mutateAsync({ id: reimbursement.id, ...fields })
    } else {
      await createReimbursement.mutateAsync({ project: project.id, ...fields })
    }
    onDone()
  })

  const serverError = editing ? updateReimbursement.error : createReimbursement.error

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="What was it for" error={errors.title?.message}>
        <Input {...register('title')} placeholder="Bus fare for the Saturday visit" />
      </Field>

      <Field label="Amount" error={errors.amount?.message}>
        <div className="relative">
          <span
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-mute"
            aria-hidden
          >
            ₹
          </span>
          {/*
            `inputMode="decimal"` brings up a numeric keypad on a phone, which is
            where most of these get filed, while the input stays `type="text"` —
            a number input would let the browser hand back its own notion of the
            value, and this one has to reach the server as typed.
          */}
          <Input
            {...register('amount')}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            className="pl-7"
            placeholder="480.00"
          />
        </div>
      </Field>

      <Field
        label="Details"
        error={errors.description?.message}
        hint="Say what it was for and where the receipt is — this is all the reviewer sees."
      >
        <Textarea
          {...register('description')}
          className="min-h-24"
          placeholder="Four volunteers, return tickets to the centre and back. Receipts with me."
        />
      </Field>

      {serverError && (
        <ErrorNote
          message={serverError instanceof ApiError ? serverError.detail : serverError.message}
        />
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Submit request'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
