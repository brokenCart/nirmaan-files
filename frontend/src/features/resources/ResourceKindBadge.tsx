import { ClipboardList, FileText, FolderOpen, Link2, Table2 } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'

import type { ResourceKind } from '@/api/types'
import { RESOURCE_KIND_LABELS } from '@/api/types'
import { cn } from '@/lib/utils'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

/**
 * The icon and colour each kind wears.
 *
 * Lives here rather than in `components/ui.tsx` next to `RoleBadge` and
 * `KindBadge`: those two are read on three screens each, this one on exactly
 * one. Colours are drawn from the same logo palette so the shelf reads as part
 * of the app rather than as a second scheme.
 */
const KIND_STYLES: Record<ResourceKind, { icon: IconComponent; className: string }> = {
  FOLDER: { icon: FolderOpen, className: 'bg-gold-50 text-gold-600 ring-gold-100' },
  DOCUMENT: { icon: FileText, className: 'bg-brand-50 text-brand-700 ring-brand-200' },
  SHEET: {
    icon: Table2,
    className: 'bg-nirmaan-green/10 text-nirmaan-green-ink ring-nirmaan-green/20',
  },
  FORM: { icon: ClipboardList, className: 'bg-paper-deep text-ink-soft ring-line-strong' },
  OTHER: { icon: Link2, className: 'bg-surface text-ink-mute ring-line-strong' },
}

export function ResourceKindBadge({ kind, className }: { kind: ResourceKind; className?: string }) {
  const { icon: Icon, className: styles } = KIND_STYLES[kind]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 text-sm font-medium whitespace-nowrap ring-1 ring-inset',
        styles,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {RESOURCE_KIND_LABELS[kind]}
    </span>
  )
}
