import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ROLE_LABELS } from '@/api/types'
import type { EffectiveRole } from '@/api/types'
import {
  ErrorNote,
  Field,
  Fieldset,
  KindBadge,
  Pagination,
  RoleBadge,
  SearchField,
  Segmented,
} from '@/components/ui'

describe('Pagination', () => {
  it('renders nothing for a single page', () => {
    const { container } = render(<Pagination page={1} totalPages={1} onChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('cannot go before the first page', () => {
    render(<Pagination page={1} totalPages={3} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
  })

  it('cannot go past the last page', () => {
    render(<Pagination page={3} totalPages={3} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('reports the neighbouring page under custom labels', async () => {
    const onChange = vi.fn()
    render(
      <Pagination page={2} totalPages={3} onChange={onChange} prevLabel="Newer" nextLabel="Older" />,
    )

    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Newer' }))
    await userEvent.click(screen.getByRole('button', { name: 'Older' }))
    expect(onChange.mock.calls).toEqual([[1], [3]])
  })
})

describe('SearchField', () => {
  function Harness() {
    const [value, setValue] = useState('')
    return <SearchField value={value} onChange={setValue} label="Search" placeholder="Find" />
  }

  it('offers a clear button only once there is text', async () => {
    render(<Harness />)
    const box = screen.getByRole('searchbox', { name: 'Search' })
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()

    await userEvent.type(box, 'bus')
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(box).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
  })
})

describe('Segmented', () => {
  it('marks the chosen option and reports a new one', async () => {
    const onChange = vi.fn()
    render(
      <Segmented
        options={['a', 'b'] as const}
        value="a"
        onChange={onChange}
        label="Pick"
        renderLabel={(option) => option.toUpperCase()}
      />,
    )

    expect(screen.getByRole('group', { name: 'Pick' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(screen.getByRole('button', { name: 'B' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })
})

describe('Field', () => {
  it('names the control it wraps', () => {
    render(
      <Field label="Title">
        <input />
      </Field>,
    )
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeInTheDocument()
  })

  it('shows the hint until there is an error', () => {
    const { rerender } = render(
      <Field label="Title" hint="Keep it short">
        <input />
      </Field>,
    )
    expect(screen.getByText('Keep it short')).toBeInTheDocument()

    rerender(
      <Field label="Title" hint="Keep it short" error="Too long">
        <input />
      </Field>,
    )
    expect(screen.queryByText('Keep it short')).not.toBeInTheDocument()
    expect(screen.getByText('Too long')).toBeInTheDocument()
  })
})

describe('Fieldset', () => {
  it('groups its controls under the label', () => {
    render(
      <Fieldset label="Who was there" hint="Tick everyone">
        <input type="checkbox" />
      </Fieldset>,
    )
    expect(screen.getByRole('group', { name: 'Who was there' })).toBeInTheDocument()
    expect(screen.getByText('Tick everyone')).toBeInTheDocument()
  })
})

describe('badges and notes', () => {
  it.each(Object.keys(ROLE_LABELS) as EffectiveRole[])('labels the %s role', (role) => {
    render(<RoleBadge role={role} />)
    expect(screen.getByText(ROLE_LABELS[role])).toBeInTheDocument()
  })

  it.each([
    ['MOV', 'Moment of Visit'],
    ['MOM', 'Minutes of Meeting'],
  ] as const)('spells out %s on hover', (kind, title) => {
    render(<KindBadge kind={kind} />)
    expect(screen.getByText(kind)).toHaveAttribute('title', title)
  })

  it('announces an error', () => {
    render(<ErrorNote message="Something broke." />)
    expect(screen.getByRole('alert')).toHaveTextContent('Something broke.')
  })
})
