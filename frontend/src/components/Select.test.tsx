import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { describe, expect, it, vi } from 'vitest'

import { Select } from '@/components/Select'

function Controlled({ onPick, disabled }: { onPick?: (value: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState('b')
  return (
    <Select
      aria-label="Fruit"
      value={value}
      disabled={disabled}
      onChange={(event) => {
        setValue(event.target.value)
        onPick?.(event.target.value)
      }}
    >
      <option value="a">Apple</option>
      <option value="b">Banana</option>
      <option value="c">Cherry</option>
    </Select>
  )
}

const trigger = () => screen.getByRole('button', { name: 'Fruit' })
const optionLabels = () => screen.getAllByRole('option').map((option) => option.textContent)

async function open() {
  const user = userEvent.setup()
  await user.click(trigger())
  return user
}

describe('Select', () => {
  it('shows the selected label and stays closed', () => {
    render(<Controlled />)
    expect(trigger()).toHaveTextContent('Banana')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('opens with every option and marks the current one', async () => {
    render(<Controlled />)
    await open()

    expect(optionLabels()).toEqual(['Apple', 'Banana', 'Cherry'])
    expect(screen.getByRole('option', { name: 'Banana' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: 'Apple' })).toHaveAttribute('aria-selected', 'false')
  })

  it('fires a real change event when an option is clicked', async () => {
    const onPick = vi.fn()
    render(<Controlled onPick={onPick} />)
    const user = await open()

    await user.click(screen.getByRole('option', { name: 'Cherry' }))

    expect(onPick).toHaveBeenCalledWith('c')
    expect(trigger()).toHaveTextContent('Cherry')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('filters as you type, ignoring case', async () => {
    render(<Controlled />)
    const user = await open()

    await user.type(screen.getByRole('combobox', { name: 'Search options' }), 'AN')

    expect(optionLabels()).toEqual(['Banana'])
  })

  it('says when nothing matches', async () => {
    render(<Controlled />)
    const user = await open()

    await user.type(screen.getByRole('combobox', { name: 'Search options' }), 'zzz')

    expect(screen.getByText('No matches')).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('picks with the arrows and Enter, starting from the current value', async () => {
    const onPick = vi.fn()
    render(<Controlled onPick={onPick} />)
    const user = await open()

    await user.keyboard('{ArrowDown}{Enter}')

    expect(onPick).toHaveBeenCalledWith('c')
  })

  it('stops the arrows at both ends', async () => {
    const onPick = vi.fn()
    render(<Controlled onPick={onPick} />)
    const user = await open()

    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}{Enter}')

    expect(onPick).toHaveBeenCalledWith('a')
  })

  it('jumps with Home and End', async () => {
    const onPick = vi.fn()
    render(<Controlled onPick={onPick} />)
    const user = await open()

    await user.keyboard('{Home}{End}{Enter}')

    expect(onPick).toHaveBeenCalledWith('c')
  })

  it('points the search box at the highlighted option', async () => {
    render(<Controlled />)
    await open()

    const search = screen.getByRole('combobox', { name: 'Search options' })
    const banana = screen.getByRole('option', { name: 'Banana' })
    expect(search).toHaveAttribute('aria-activedescendant', banana.id)
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const onPick = vi.fn()
    render(<Controlled onPick={onPick} />)
    const user = await open()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('closes on a press outside', async () => {
    render(<Controlled />)
    await open()

    fireEvent.pointerDown(document.body)

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  })

  it('opens from the keyboard', async () => {
    render(<Controlled />)
    const user = userEvent.setup()
    trigger().focus()

    await user.keyboard('{ArrowDown}')

    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('opens pre-filtered when you start typing on the trigger', async () => {
    render(<Controlled />)
    const user = userEvent.setup()
    trigger().focus()

    await user.keyboard('c')

    expect(screen.getByRole('combobox', { name: 'Search options' })).toHaveValue('c')
    expect(optionLabels()).toEqual(['Cherry'])
  })

  it('does not open when disabled', () => {
    render(<Controlled disabled />)
    fireEvent.click(trigger())
    expect(trigger()).toBeDisabled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('works through react-hook-form register', async () => {
    const onSubmit = vi.fn()

    function Form() {
      const { register, handleSubmit } = useForm({ defaultValues: { fruit: 'b' } })
      return (
        <form onSubmit={handleSubmit((values) => onSubmit(values))}>
          <Select aria-label="Fruit" {...register('fruit')}>
            <option value="a">Apple</option>
            <option value="b">Banana</option>
          </Select>
          <button type="submit">Save</button>
        </form>
      )
    }

    render(<Form />)
    expect(trigger()).toHaveTextContent('Banana')

    const user = await open()
    await user.click(screen.getByRole('option', { name: 'Apple' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ fruit: 'a' })
    expect(trigger()).toHaveTextContent('Apple')
  })
})
