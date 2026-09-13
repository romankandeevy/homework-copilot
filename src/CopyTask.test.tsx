import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import CopyTask from './CopyTask'

afterEach(cleanup)

function submitTask(onSubmit: () => Promise<boolean>) {
  render(<CopyTask onSubmit={onSubmit} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Условие задачи' }), {
    target: { value: '2x + 4 = 10, найти x' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'Предмет' }), { target: { value: 'Алгебра' } })
  fireEvent.click(screen.getByRole('button', { name: /Решить/ }))
}

describe('CopyTask', () => {
  // 12 сентября клик обратно в условие, пока ответ сервера ещё не пришёл,
  // дописывал новый ввод к несброшенному старому - задача уходила задвоенной.
  it('выключает поля, пока задача уходит на решение, и очищает их после', async () => {
    let finish: (submitted: boolean) => void = () => {}
    submitTask(() => new Promise<boolean>((resolve) => { finish = resolve }))

    expect(screen.getByRole('textbox', { name: 'Условие задачи' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Предмет' })).toBeDisabled()

    await act(async () => { finish(true) })

    const condition = screen.getByRole('textbox', { name: 'Условие задачи' })
    expect(condition).toBeEnabled()
    expect(condition).toHaveValue('')
  })

  it('возвращает поля с тем же условием, если отправка не удалась', async () => {
    let finish: (submitted: boolean) => void = () => {}
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve }))
    submitTask(onSubmit)

    await act(async () => { finish(false) })

    const condition = screen.getByRole('textbox', { name: 'Условие задачи' })
    expect(condition).toBeEnabled()
    expect(condition).toHaveValue('2x + 4 = 10, найти x')
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
