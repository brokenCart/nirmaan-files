import logoUrl from '@/assets/nirmaan-logo.png'
import { cn } from '@/lib/utils'

/**
 * The official nirmaan.org lockup, from the organisation's own asset — the four
 * verticals (education, livelihood, women's empowerment, agriculture) over the
 * arc, with the wordmark. Do not redraw it; replace the file if it is updated.
 *
 * `subtitle` sets the app name beneath the wordmark, so the header reads as
 * "nirmaan.org / FILES" without a second lockup competing with the brand.
 */
export function NirmaanLogo({
  className,
  imgClassName,
  subtitle,
}: {
  className?: string
  imgClassName?: string
  subtitle?: string
}) {
  return (
    <span className={cn('inline-flex flex-col items-start', className)}>
      <img
        src={logoUrl}
        alt="Nirmaan"
        width={559}
        height={265}
        className={cn('h-10 w-auto', imgClassName)}
      />
      {subtitle && (
        <span className="mt-0.5 self-end font-display text-[0.62em] font-semibold tracking-[0.3em] text-brand-600 uppercase">
          {subtitle}
        </span>
      )}
    </span>
  )
}

/**
 * The poster's section divider — a gold diamond flanked by tapering rules.
 * Purely decorative, so it is hidden from assistive tech.
 */
export function Ornament({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2', className)} aria-hidden>
      <span className="h-px w-10 bg-gradient-to-r from-transparent to-line-strong" />
      <svg viewBox="0 0 12 12" className="size-2.5 text-gold-500" fill="currentColor">
        <path d="M6 0l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" />
      </svg>
      <span className="h-px w-10 bg-gradient-to-l from-transparent to-line-strong" />
    </div>
  )
}
