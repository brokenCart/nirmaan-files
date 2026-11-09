import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MarkdownBody } from '@/features/knowledge/MarkdownBody'

describe('MarkdownBody', () => {
  it('renders Markdown', () => {
    render(<MarkdownBody body={'## Timings\n\nStart at **ten**.'} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Timings' })).toBeInTheDocument()
    expect(screen.getByText('ten').tagName).toBe('STRONG')
  })

  it('opens links in a new tab without handing over the opener', () => {
    render(<MarkdownBody body="[Drive](https://drive.google.com/x)" />)
    const link = screen.getByRole('link', { name: 'Drive' })
    expect(link).toHaveAttribute('href', 'https://drive.google.com/x')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('does not turn pasted HTML into elements', () => {
    const { container } = render(
      <MarkdownBody body={'<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">'} />,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('strips a javascript: link', () => {
    const { container } = render(<MarkdownBody body="[click](javascript:alert(1))" />)
    expect(container.querySelector('a')?.getAttribute('href') ?? '').not.toContain('javascript')
  })
})
