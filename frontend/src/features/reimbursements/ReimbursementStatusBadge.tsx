import { CheckCircle2, Clock, XCircle } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'

import type { ReimbursementStatus } from '@/api/types'
import { REIMBURSEMENT_STATUS_LABELS } from '@/api/types'
import { cn } from '@/lib/utils'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

/**
 * The icon and colour each state wears.
 *
 * Lives beside its screen rather than in `components/ui.tsx`, the same call
 * `ResourceKindBadge` makes: `RoleBadge` and `KindBadge` are read across three
 * screens each, this one on exactly one.
 *
 * Colours come from the logo palette so the queue reads as part of the app, and
 * carry an icon as well as a hue — approved and rejected are the two states a
 * reader most needs to tell apart at a glance, and green-versus-red alone would
 * be the only thing distinguishing them for a colourblind reader.
 */
const STATUS_STYLES: Record<ReimbursementStatus, { icon: IconComponent; className: string }> = {
  PENDING: { icon: Clock, className: 'bg-gold-50 text-gold-600 ring-gold-100' },
  APPROVED: {
    icon: CheckCircle2,
    className: 'bg-nirmaan-green/10 text-nirmaan-green-ink ring-nirmaan-green/20',
  },
  REJECTED: { icon: XCircle, className: 'bg-danger-50 text-danger-700 ring-danger-200' },
}

export function ReimbursementStatusBadge({
  status,
  className,
}: {
  status: ReimbursementStatus
  className?: string
}) {
  const { icon: Icon, className: styles } = STATUS_STYLES[status]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 text-sm font-medium whitespace-nowrap ring-1 ring-inset',
        styles,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {REIMBURSEMENT_STATUS_LABELS[status]}
    </span>
  )
}
