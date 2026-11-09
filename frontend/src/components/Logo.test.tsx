import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { NirmaanLogo } from '@/components/Logo'

describe('NirmaanLogo', () => {
  it('names the organisation for screen readers', () => {
    render(<NirmaanLogo />)
    expect(screen.getByRole('img', { name: 'Nirmaan' })).toBeInTheDocument()
  })

  it('sets the product name beside the wordmark when given one', () => {
    render(<NirmaanLogo subtitle="Files" />)
    expect(screen.getByText('Files')).toBeInTheDocument()
  })
})
