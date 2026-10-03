import { Check, X } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import { useState } from 'react'

import { ApiError } from '@/api/client'
import type { Reimbursement, ReviewDecision } from '@/api/types'
import { availableDecisions } from '@/api/types'
import { Button, ErrorNote, Field, Textarea } from '@/components/ui'
import { useReviewReimbursement } from '@/features/projects/queries'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

/**
 * How each decision presents itself.
 *
 * `make` is the wording on an undecided request, `change` on one that has
 * already been settled the other way — "Approve" and "Change to approved" are
 * the same call, and saying which it is stops a reviewer wondering whether they
 * are about to reverse something.
 */
const DECISIONS: Record<
  ReviewDecision,
  { make: string; change: string; icon: IconComponent; variant: 'primary' | 'secondary' }
> = {
  APPROVED: { make: 'Approve', change: 'Change to approved', icon: Check, variant: 'primary' },
  REJECTED: { make: 'Reject', change: 'Change to rejected', icon: X, variant: 'secondary' },
}

/**
 * The finance lead's approve/reject control for one request.
 *
 * Approving is one click; rejecting opens a note field first, because the
 * server requires a reason and a 400 arriving after the click would be a rule
 * the UI knew about and chose not to mention. The note is optional on an
 * approval and offered anyway — "paid in cash on the 3rd" is worth recording,
 * and the volunteer reads it either way.
 *
 * Rendered for an already-decided request too, where it offers **only the
 * opposite decision** — see {@link availableDecisions}. A reviewer can still
 * correct themselves while the term is open, which is why the control does not
 * simply disappear once a claim is settled: the alternative to reversing a
 * decision would be deleting the claim, and that would lose the record of the
 * decision ever having been made.
 */
export function ReviewControls({
  reimbursement,
  projectSlug,
}: {
  reimbursement: Reimbursement
  projectSlug: string
}) {
  const review = useReviewReimbursement(projectSlug)
  // Which decision the reviewer is composing a note for, if any. `null` is the
  // resting state — just the buttons.
  const [composing, setComposing] = useState<ReviewDecision | null>(null)
  const [note, setNote] = useState('')

  const decided = reimbursement.status !== 'PENDING'
  const rejecting = composing === 'REJECTED'
  // Mirrors `ReimbursementReviewSerializer.validate`, so the button is disabled
  // rather than the request refused.
  const noteMissing = rejecting && !note.trim()

  function submit(status: ReviewDecision) {
    review.mutate(
      { id: reimbursement.id, status, note: note.trim() },
      {
        onSuccess: () => {
          setComposing(null)
          setNote('')
        },
      },
    )
  }

  if (composing === null) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {/*
          Driven by `availableDecisions` rather than hard-coding both buttons, so
          a settled request offers only the way out of where it is: no Approve on
          an approved claim, no Reject on a rejected one. A pending claim still
          gets both.
        */}
        {availableDecisions(reimbursement).map((decision) => {
          const { make, change, icon: Icon, variant } = DECISIONS[decision]
          return (
            <Button
              key={decision}
              variant={variant}
              onClick={() => setComposing(decision)}
              disabled={review.isPending}
            >
              <Icon className="size-4" aria-hidden />
              {decided ? change : make}
            </Button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-md bg-paper p-4 ring-1 ring-line ring-inset">
      <Field
        label={rejecting ? 'Reason for rejecting' : 'Note (optional)'}
        hint={
          rejecting
            ? 'The member will see this. Say what they need to fix.'
            : 'For example, when it will be paid.'
        }
      >
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="min-h-20"
          autoFocus
          placeholder={
            rejecting
              ? 'No receipt attached. Please resubmit with a photo.'
              : 'Paid in cash on the 3rd.'
          }
        />
      </Field>

      {review.error && (
        <ErrorNote
          message={review.error instanceof ApiError ? review.error.detail : review.error.message}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant={rejecting ? 'danger' : 'primary'}
          disabled={review.isPending || noteMissing}
          onClick={() => submit(composing)}
        >
          {review.isPending ? 'Saving…' : rejecting ? 'Reject request' : 'Approve request'}
        </Button>
        <Button
          variant="secondary"
          disabled={review.isPending}
          onClick={() => {
            setComposing(null)
            setNote('')
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
