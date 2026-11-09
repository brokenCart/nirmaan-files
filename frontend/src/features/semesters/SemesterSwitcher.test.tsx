import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SemesterSwitcher } from '@/features/semesters/SemesterSwitcher'
import { ALL_TERMS } from '@/features/semesters/terms'
import { makeSemester } from '@/test/factories'
import { renderApp } from '@/test/render'

const open = makeSemester({ id: 10, slug: 'open', name: 'First Semester' })
const old = makeSemester({ id: 9, slug: 'old', name: 'Old Semester', is_current: false })

function show(props: Partial<Parameters<typeof SemesterSwitcher>[0]> = {}) {
  const onChange = vi.fn()
  renderApp(
    <SemesterSwitcher
      semesters={[open, old]}
      value={undefined}
      current={open}
      onChange={onChange}
      {...props}
    />,
  )
  return onChange
}

const trigger = () => screen.getByRole('button', { name: /semester/i })

async function choose(name: string) {
  const user = userEvent.setup()
  await user.click(trigger())
  await user.click(screen.getByRole('option', { name }))
}

describe('SemesterSwitcher', () => {
  it('defaults to the open term and marks it current', () => {
    show()
    expect(trigger()).toHaveTextContent('First Semester (current)')
  })

  it('reports another term by slug', async () => {
    const onChange = show()
    await choose('Old Semester')
    expect(onChange).toHaveBeenCalledWith('old')
  })

  it('drops the parameter when going back to the open term', async () => {
    const onChange = show({ value: 'old' })
    await choose('First Semester (current)')
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it('flags a closed term read-only', () => {
    show({ value: 'old' })
    expect(screen.getByText('Read only')).toBeInTheDocument()
  })

  it('does not flag the open term', () => {
    show({ value: 'open' })
    expect(screen.queryByText('Read only')).not.toBeInTheDocument()
  })

  it('offers every term at once only when asked', async () => {
    show()
    await userEvent.click(trigger())
    expect(screen.queryByRole('option', { name: 'All semesters' })).not.toBeInTheDocument()
  })

  it('can read across all terms', async () => {
    const onChange = show({ includeAll: true })
    await choose('All semesters')
    expect(onChange).toHaveBeenCalledWith(ALL_TERMS)
  })

  it('links the archive when given one', () => {
    show({ archiveHref: '/projects/shiksha/archive' })
    expect(screen.getByRole('link', { name: 'View archive' })).toHaveAttribute(
      'href',
      '/projects/shiksha/archive',
    )
  })
})
