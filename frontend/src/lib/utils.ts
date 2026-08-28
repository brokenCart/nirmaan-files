import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * A timestamp, to the minute.
 *
 * Separate from `formatDate`, which takes a date-only string and pins it to
 * local midnight so a `DateField` cannot drift a day either side of the
 * timezone. This one takes a real instant — `created_at` and its kin — and
 * keeps the time on it, because a knowledge page edited twice in an afternoon
 * has to read as two edits rather than one repeated line.
 */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * An amount of money, as rupees.
 *
 * Takes the string the API sends, because `amount` is a `DecimalField`
 * serialized as a string precisely so no total round-trips through a binary
 * fraction. It is converted to a `number` here and only here: `Intl` needs one,
 * and this is the last step before pixels — nothing is computed from the result.
 * A double carries ~15 significant digits and the column allows 10, so display
 * is exact. Arithmetic on these values belongs on the server, which is where
 * the summary totals are added up.
 *
 * Nirmaan is one campus spending rupees, so the currency is baked in — see
 * `apps.reimbursements.models.Reimbursement` for why there is no currency
 * column to read it from.
 *
 * Falls back to the raw string if the value is not something `Intl` can format,
 * so a row written straight into the database renders as itself rather than as
 * `NaN`.
 */
export function formatRupees(amount: string): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).format(Number(amount))
  } catch {
    return amount
  }
}
