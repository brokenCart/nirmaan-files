import logoUrl from '@/assets/nirmaan-logo.png'
import { cn } from '@/lib/utils'

/**
 * The official nirmaan.org lockup, from the organisation's own asset — the four
 * verticals (education, livelihood, women's empowerment, agriculture) over the
 * arc, with the wordmark. Do not redraw it; replace the file if it is updated.
 *
 * `subtitle` sets the app name **beside** the wordmark, divider between, so the
 * header reads as "nirmaan.org | Files" — the usual brand-then-product lockup.
 * Stacking it underneath (which this used to do) left the word floating against
 * the wordmark's right edge with nothing to align to, and cost a line of header
 * height on every page.
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
    <span className={cn('inline-flex items-center gap-3', className)}>
      <img
        src={logoUrl}
        alt="Nirmaan"
        width={559}
        height={265}
        className={cn('h-10 w-auto', imgClassName)}
      />
      {subtitle && (
        <>
          <span className="h-7 w-px shrink-0 bg-line-strong" aria-hidden />
          {/*
            A real size rather than the old `0.62em` (~10px): this is a page
            title, and it was the smallest text in the app. Tracking is loosened
            only enough to read as a lockup — 0.3em pushed the letters far enough
            apart to scan as separate characters.
          */}
          <span className="font-display text-base font-semibold tracking-[0.14em] text-brand-700 uppercase">
            {subtitle}
          </span>
        </>
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
