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
