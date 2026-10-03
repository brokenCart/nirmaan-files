import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react'

import type { EffectiveRole } from '@/api/types'
import { ROLE_LABELS } from '@/api/types'
import { cn } from '@/lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50',
  secondary:
    'bg-surface text-ink ring-1 ring-line-strong ring-inset hover:bg-brand-50 hover:ring-brand-200',
  ghost: 'text-ink-soft hover:bg-brand-50 hover:text-brand-700',
  danger: 'bg-danger-600 text-white hover:bg-danger-700',
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm leading-5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        BUTTON_STYLES[variant],
        className,
      )}
      {...props}
    />
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-[10px] border border-line bg-surface p-5', className)}>
      {children}
    </div>
  )
}

const ROLE_STYLES: Record<EffectiveRole, string> = {
  EXEC: 'bg-ink text-white ring-ink',
  LEAD: 'bg-brand-50 text-brand-700 ring-brand-200',
  FINANCE_LEAD: 'bg-gold-50 text-gold-600 ring-gold-100',
  VOLUNTEER: 'bg-surface text-ink-soft ring-line-strong',
}

export function RoleBadge({ role, className }: { role: EffectiveRole; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex rounded px-2 py-0.5 text-sm font-medium whitespace-nowrap ring-1 ring-inset',
        ROLE_STYLES[role],
        className,
      )}
    >
      {ROLE_LABELS[role]}
    </span>
  )
}

export function KindBadge({ kind }: { kind: 'MOV' | 'MOM' }) {
  return (
    <span
      className={cn(
        'inline-flex rounded px-1.5 py-0.5 text-sm font-semibold tracking-wide ring-1 ring-inset',
        kind === 'MOV'
          ? 'bg-brand-600 text-white ring-brand-600'
          : 'bg-surface text-brand-700 ring-brand-200',
      )}
      title={kind === 'MOV' ? 'Moment of Visit' : 'Minutes of Meeting'}
    >
      {kind}
    </span>
  )
}

export function Field({
  label,
  error,
  children,
  hint,
}: {
  label: string
  error?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-sm text-ink-mute">{hint}</span>}
      {error && <span className="mt-1 block text-sm text-danger-600">{error}</span>}
    </label>
  )
}

/**
 * `Field` for a group of controls that carry labels of their own — a set of
 * checkboxes or radios. A `<label>` may not wrap other labels, so the group
 * gets a `<fieldset>` and its caption a `<legend>`.
 */
export function Fieldset({
  label,
  error,
  children,
  hint,
}: {
  label: string
  error?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <fieldset className="block">
      <legend className="mb-1.5 block text-sm font-medium text-ink">{label}</legend>
      {children}
      {hint && !error && <span className="mt-1 block text-sm text-ink-mute">{hint}</span>}
      {error && <span className="mt-1 block text-sm text-danger-600">{error}</span>}
    </fieldset>
  )
}

export function Checkbox({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn('size-4 shrink-0 rounded accent-brand-600', className)}
      {...props}
    />
  )
}

const CONTROL =
  'w-full rounded-md border-0 bg-surface px-3 py-2 text-sm text-ink ring-1 ring-line-strong ring-inset placeholder:text-ink-mute focus:ring-2 focus:ring-brand-600 focus:outline-none'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(CONTROL, 'min-h-32', className)} {...props} />
}

// Custom and searchable; same interface as a native `<select>`.
export { Select } from './Select'

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[10px] border border-dashed border-line-strong px-6 py-12 text-center">
      <p className="font-display text-xl font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-soft">{description}</p>
    </div>
  )
}

/**
 * Prev/next control over a DRF `PageNumberPagination` response.
 *
 * Renders nothing for a single page, so callers can mount it unconditionally.
 * `prevLabel`/`nextLabel` exist because a reverse-chronological feed reads
 * better as Newer/Older than as Previous/Next.
 */
export function Pagination({
  page,
  totalPages,
  onChange,
  label = 'Pagination',
  prevLabel = 'Previous',
  nextLabel = 'Next',
  className,
}: {
  page: number
  totalPages: number
  onChange: (page: number) => void
  label?: string
  prevLabel?: string
  nextLabel?: string
  className?: string
}) {
  if (totalPages <= 1) return null

  return (
    <nav
      aria-label={label}
      className={cn('flex items-center justify-between gap-3 pt-1', className)}
    >
      <Button variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft className="size-4" aria-hidden />
        {prevLabel}
      </Button>

      <span aria-live="polite" className="text-sm text-ink-mute tabular-nums">
        Page {page} of {totalPages}
      </span>

      <Button variant="secondary" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        {nextLabel}
        <ChevronRight className="size-4" aria-hidden />
      </Button>
    </nav>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 p-10 text-sm text-ink-soft">
      <span
        aria-hidden
        className="size-4 animate-spin rounded-full border-2 border-line-strong border-t-brand-600"
      />
      {label}
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md bg-danger-50 p-3 text-sm text-danger-700 ring-1 ring-danger-200 ring-inset"
    >
      {message}
    </div>
  )
}

/**
 * A standing note about what the reader can and cannot do here — an archived
 * term, no role this semester. Marigold rule on the left so it reads as a
 * margin note on the register rather than as an error.
 */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border-l-[3px] border-gold-500 bg-gold-50 px-4 py-3 text-sm text-ink-soft">
      {children}
    </div>
  )
}

/**
 * One-of-many choice as a row of buttons — the timeline's kind filter, the
 * chart's measure, the knowledge topics. `aria-pressed` carries the state.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  renderLabel,
  className,
}: {
  options: readonly T[]
  value: T
  onChange: (next: T) => void
  label: string
  renderLabel: (option: T) => ReactNode
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'flex w-full gap-0.5 overflow-x-auto rounded-lg bg-paper-deep p-0.5 sm:w-fit',
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            'flex-1 shrink-0 rounded-md px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors sm:flex-none',
            value === option
              ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(23,32,54,0.12)]'
              : 'text-ink-soft hover:text-ink',
          )}
        >
          {renderLabel(option)}
        </button>
      ))}
    </div>
  )
}

/**
 * The heading block at the top of a project section, under the tabs.
 * `actions` sits on the right on wide screens and wraps below on a phone.
 */
export function SectionIntro({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold text-ink">{title}</h2>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/**
 * A search box with a leading icon and a clear button. Controlled: callers own
 * the value, and usually defer it before it reaches a query.
 */
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  className,
}: {
  value: string
  onChange: (next: string) => void
  /** Screen-reader name; the placeholder is not a label. */
  label: string
  placeholder: string
  className?: string
}) {
  return (
    <label className={cn('relative block', className)}>
      <span className="sr-only">{label}</span>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-mute"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn(CONTROL, 'pr-9 pl-9 [&::-webkit-search-cancel-button]:appearance-none')}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-ink-mute transition-colors hover:bg-brand-50 hover:text-brand-700"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </label>
  )
}
