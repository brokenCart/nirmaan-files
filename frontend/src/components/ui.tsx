import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

import type { EffectiveRole } from '@/api/types'
import { ROLE_LABELS } from '@/api/types'
import { cn } from '@/lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-paper shadow-sm hover:bg-brand-700 disabled:bg-brand-600/50',
  secondary: 'bg-surface text-ink-soft ring-1 ring-line-strong hover:bg-gold-50 hover:text-ink',
  ghost: 'text-ink-soft hover:bg-gold-50 hover:text-brand-700',
  danger: 'bg-nirmaan-red text-white hover:bg-brand-700',
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        BUTTON_STYLES[variant],
        className,
      )}
      {...props}
    />
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(47,29,22,0.05),0_8px_24px_-16px_rgba(47,29,22,0.35)]',
        className,
      )}
    >
      {children}
    </div>
  )
}

const ROLE_STYLES: Record<EffectiveRole, string> = {
  EXEC: 'bg-nirmaan-blue/10 text-nirmaan-blue ring-nirmaan-blue/20',
  LEAD: 'bg-brand-50 text-brand-700 ring-brand-200',
  FINANCE_LEAD: 'bg-gold-50 text-gold-600 ring-gold-100',
  VOLUNTEER: 'bg-nirmaan-green/10 text-nirmaan-green ring-nirmaan-green/20',
}

export function RoleBadge({ role, className }: { role: EffectiveRole; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
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
        'inline-flex rounded px-1.5 py-0.5 text-xs font-bold tracking-widest ring-1 ring-inset',
        kind === 'MOV'
          ? 'bg-nirmaan-sky/10 text-nirmaan-blue ring-nirmaan-sky/25'
          : 'bg-brand-50 text-brand-600 ring-brand-200',
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
      <span className="mb-1.5 block text-xs font-semibold tracking-wide text-ink-soft uppercase">
        {label}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-mute">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-nirmaan-red">{error}</span>}
    </label>
  )
}

const CONTROL =
  'w-full rounded-lg border-0 bg-paper/60 px-3 py-2 text-sm text-ink ring-1 ring-line-strong placeholder:text-ink-mute focus:bg-surface focus:ring-2 focus:ring-brand-600'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(CONTROL, 'min-h-32', className)} {...props} />
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(CONTROL, className)} {...props} />
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-line-strong bg-surface/60 p-10 text-center">
      <p className="font-display text-lg font-semibold text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink-soft">{description}</p>
    </div>
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
      className="rounded-lg bg-brand-50 p-3 text-sm text-brand-700 ring-1 ring-brand-200"
    >
      {message}
    </div>
  )
}
