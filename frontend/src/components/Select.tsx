import { Check, ChevronDown, Search } from 'lucide-react'
import type { KeyboardEvent, ReactNode, Ref, SelectHTMLAttributes } from 'react'
import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

import { cn } from '@/lib/utils'

type Option = { value: string; label: string }

/** `<option>` children, flattened to value/label pairs. */
function optionsFrom(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode }>(child)) return []
    if (child.type !== 'option') return []
    const label = Children.toArray(child.props.children).join('')
    return [{ value: String(child.props.value ?? label), label }]
  })
}

// Setting `.value` on the element directly, then dispatching `change`, is the
// one way to make React's own `onChange` fire for a value set from outside.
const setNativeValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set

const POPOVER_GAP = 4
const POPOVER_MAX_HEIGHT = 300

/**
 * A searchable dropdown with the same interface as a native `<select>`.
 *
 * Callers write it exactly as they would a `<select>`: `<option>` children,
 * `value`/`onChange`, or react-hook-form's `register()` spread. A hidden native
 * select carries the real value underneath — `register` reads and writes it
 * through the ref, and a pick dispatches a genuine `change` event on it, so
 * every existing handler keeps working unchanged.
 *
 * The list is portalled to `<body>` and positioned against the trigger. Two
 * reasons: several forms render inside `overflow-hidden` sheets, which would
 * clip an absolutely positioned list; and most selects sit inside a `<label>`,
 * where a click anywhere in the list would otherwise be forwarded to the
 * trigger and toggle it shut.
 *
 * Keyboard follows the WAI-ARIA combobox pattern: arrows, Home/End, Enter to
 * pick, Escape to close. Typing on the closed trigger opens it pre-filtered.
 */
export function Select({
  className,
  children,
  value,
  onChange,
  disabled,
  ref,
  'aria-label': ariaLabel,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> }) {
  const options = useMemo(() => optionsFrom(children), [children])
  const nativeRef = useRef<HTMLSelectElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState<{
    top?: number
    bottom?: number
    left: number
    width: number
  } | null>(null)

  // `register()` leaves the select uncontrolled and writes its default value
  // through the ref, so the shown label is read back from the element once the
  // ref is attached (see `setRefs`) and kept in step by `choose`. No form here
  // calls `reset()` or `setValue()`; one that does would need to re-sync this.
  const controlled = value !== undefined
  const [domValue, setDomValue] = useState('')
  const current = controlled ? String(value) : domValue
  const selected = options.find((option) => option.value === current)

  const needle = query.trim().toLowerCase()
  const matches = needle
    ? options.filter((option) => option.label.toLowerCase().includes(needle))
    : options

  const setRefs = useCallback(
    (element: HTMLSelectElement | null) => {
      nativeRef.current = element
      if (typeof ref === 'function') ref(element)
      else if (ref) ref.current = element
      // After the caller's ref, which is where `register()` sets the default.
      if (element) setDomValue(element.value)
    },
    [ref],
  )

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.max(rect.width, 224)
    const left = Math.min(rect.left, window.innerWidth - width - 8)
    // Open upward when the list would run off the bottom of the viewport.
    const below = window.innerHeight - rect.bottom
    if (below < POPOVER_MAX_HEIGHT && rect.top > below) {
      setPosition({ bottom: window.innerHeight - rect.top + POPOVER_GAP, left, width })
    } else {
      setPosition({ top: rect.bottom + POPOVER_GAP, left, width })
    }
  }, [])

  function openList(initialQuery = '') {
    if (disabled) return
    setQuery(initialQuery)
    const index = options.findIndex((option) => option.value === current)
    setActive(initialQuery ? 0 : Math.max(0, index))
    place()
    setOpen(true)
  }

  function close(refocus = true) {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  function choose(option: Option) {
    const element = nativeRef.current
    if (element && setNativeValue) {
      setNativeValue.call(element, option.value)
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (!controlled) setDomValue(option.value)
    close()
  }

  // Follow the trigger while open, and close on any press outside it.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, place])

  // Keep the highlighted option in view as the arrows move it.
  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      openList()
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Start typing to search, the way a native select jumps to a letter.
      event.preventDefault()
      openList(event.key)
    }
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const last = matches.length - 1
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActive((index) => Math.min(last, index + 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActive((index) => Math.max(0, index - 1))
        break
      case 'Home':
        event.preventDefault()
        setActive(0)
        break
      case 'End':
        event.preventDefault()
        setActive(Math.max(0, last))
        break
      case 'Enter':
        event.preventDefault()
        if (matches[active]) choose(matches[active])
        break
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        close()
        break
      case 'Tab':
        close(false)
        break
    }
  }

  const activeId = matches[active] ? `${listId}-${active}` : undefined

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md bg-surface px-3 py-2 text-left text-sm text-ink ring-1 ring-line-strong ring-inset transition-shadow hover:ring-brand-200 focus:ring-2 focus:ring-brand-600 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60',
          open && 'ring-2 ring-brand-600',
          className,
        )}
      >
        <span className={cn('truncate', !selected && 'text-ink-mute')}>
          {selected?.label ?? 'Choose…'}
        </span>
        <ChevronDown
          className={cn('size-4 shrink-0 text-ink-mute transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {/* The real control, for forms and change handlers. Hidden rather than
          visually-hidden so it is neither tabbable nor the label's target. */}
      <select
        ref={setRefs}
        value={value}
        onChange={onChange}
        disabled={disabled}
        hidden
        tabIndex={-1}
        aria-hidden
        {...rest}
      >
        {children}
      </select>

      {open &&
        position &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: 'fixed',
              top: position.top,
              bottom: position.bottom,
              left: position.left,
              width: position.width,
            }}
            className="z-50 flex max-h-[300px] flex-col overflow-hidden rounded-lg bg-surface shadow-[0_12px_32px_-8px_rgba(19,37,77,0.28)] ring-1 ring-line-strong"
          >
            <div className="relative border-b border-line p-1.5">
              <Search
                className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink-mute"
                aria-hidden
              />
              <input
                autoFocus
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-activedescendant={activeId}
                aria-autocomplete="list"
                aria-label="Search options"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setActive(0)
                }}
                onKeyDown={onSearchKeyDown}
                placeholder="Search"
                className="w-full rounded-md border-0 bg-paper py-1.5 pr-2 pl-8 text-sm text-ink placeholder:text-ink-mute focus:ring-2 focus:ring-brand-600 focus:outline-none"
              />
            </div>

            <ul ref={listRef} id={listId} role="listbox" className="overflow-y-auto p-1">
              {matches.length === 0 ? (
                <li className="px-3 py-2 text-sm text-ink-mute">No matches</li>
              ) : (
                matches.map((option, index) => {
                  const isSelected = option.value === current
                  return (
                    <li
                      key={option.value}
                      id={`${listId}-${index}`}
                      data-index={index}
                      role="option"
                      aria-selected={isSelected}
                      // Keep focus in the search box; the pick is the click.
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => choose(option)}
                      onPointerMove={() => setActive(index)}
                      className={cn(
                        'flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-sm text-ink',
                        index === active && 'bg-brand-50',
                        isSelected && 'font-semibold text-brand-700',
                      )}
                    >
                      <span>{option.label}</span>
                      {isSelected && <Check className="size-4 shrink-0" aria-hidden />}
                    </li>
                  )
                })
              )}
            </ul>
          </div>,
          document.body,
        )}
    </>
  )
}
