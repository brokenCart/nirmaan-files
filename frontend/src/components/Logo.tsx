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
          <span className="h-8 w-px shrink-0 bg-line-strong" aria-hidden />
          {/* Sentence case and bold — the same voice as every
              heading in the app, so the product name reads as part of it. */}
          <span className="font-display text-xl leading-none font-bold text-navy">{subtitle}</span>
        </>
      )}
    </span>
  )
}
