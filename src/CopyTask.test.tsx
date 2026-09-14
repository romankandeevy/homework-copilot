import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import CopyTask, { maxTaskEntries } from './CopyTask'
import type { TaskSubmission } from './CopyTask'

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

function submitTask(onSubmit: () => Promise<boolean>) {
  render(<CopyTask onSubmit={onSubmit} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Условие задачи' }), {
    target: { value: '2x + 4 = 10, найти x' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'Предмет' }), { target: { value: 'Алгебра' } })
  fireEvent.click(screen.getByRole('button', { name: /Решить/ }))
}

function fillFirstTask() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Условие задачи' }), {
    target: { value: '2x + 4 = 10, найти x' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'Предмет' }), { target: { value: 'Алгебра' } })
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

  // 14 сентября: строка «Цена зависит от задачи…» под формой убрана,
  // точная цена стоит на самой кнопке.
  it('показывает на кнопке точную цену задачи, а «от 4 ₽» - только с оговоркой', () => {
    render(<CopyTask onSubmit={vi.fn(async () => true)} signedIn />)

    expect(screen.getByRole('button', { name: 'Решить' })).toBeInTheDocument()
    expect(screen.getByText('Цена зависит от длины условия, фото и предмета')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Условие задачи' }), {
      target: { value: 'Назови причины Первой мировой войны' },
    })
    expect(screen.getByRole('button', { name: /^Решить за 4\s₽$/ })).toBeInTheDocument()
    expect(screen.queryByText('Цена зависит от длины условия, фото и предмета')).toBeNull()

    // Счётный предмет дороже на рубль: цена на кнопке меняется сразу.
    fireEvent.change(screen.getByRole('combobox', { name: 'Предмет' }), { target: { value: 'Алгебра' } })
    expect(screen.getByRole('button', { name: /^Решить за 5\s₽$/ })).toBeInTheDocument()
  })

  it('гостю с неизрасходованным бесплатным решением обещает бесплатное, без цены', () => {
    render(<CopyTask onSubmit={vi.fn(async () => true)} />)
    fillFirstTask()

    expect(screen.getByRole('button', { name: 'Решить бесплатно' })).toBeInTheDocument()
    expect(screen.queryByText(/₽/)).toBeNull()
  })

  it('отправляет несколько задач одной кнопкой, каждую со своим предметом', async () => {
    const onSubmit = vi.fn(async (_submissions: TaskSubmission[]) => true)
    render(<CopyTask onSubmit={onSubmit} signedIn />)
    fillFirstTask()

    fireEvent.click(screen.getByRole('button', { name: 'Добавить задачу' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Условие задачи 2' }), {
      target: { value: 'Назови причины Первой мировой войны' },
    })
    fireEvent.change(screen.getAllByRole('combobox', { name: 'Предмет' })[1], { target: { value: 'История' } })

    // Алгебра - 5 ₽, короткая история - 4 ₽.
    const submit = screen.getByRole('button', { name: /^Решить 2 задачи за 9\s₽$/ })
    await act(async () => { fireEvent.click(submit) })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const [submissions] = onSubmit.mock.calls[0]
    expect(submissions.map((submission) => submission.subject)).toEqual(['Алгебра', 'История'])
    expect(new Set(submissions.map((submission) => submission.idempotencyKey)).size).toBe(2)
    // После отправки форма снова одна пустая задача.
    expect(screen.getByRole('textbox', { name: 'Условие задачи' })).toHaveValue('')
  })

  it('проверяет каждую задачу отдельно и не отправляет, пока одна не готова', () => {
    const onSubmit = vi.fn(async () => true)
    render(<CopyTask onSubmit={onSubmit} signedIn />)
    fillFirstTask()
    fireEvent.click(screen.getByRole('button', { name: 'Добавить задачу' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Условие задачи 2' }), { target: { value: 'x+2=5' } })

    fireEvent.click(screen.getByRole('button', { name: /^Решить/ }))

    expect(onSubmit).not.toHaveBeenCalled()
    const [first, second] = screen.getAllByRole('listitem')
    expect(within(first).queryByRole('alert')).toBeNull()
    expect(within(second).getByRole('alert')).toHaveTextContent('Условие слишком короткое')
    expect(within(second).getByRole('textbox')).toHaveAttribute('aria-invalid', 'true')

    // Условие дописали - теперь карточка просит предмет, и снова только она.
    fireEvent.change(screen.getByRole('textbox', { name: 'Условие задачи 2' }), {
      target: { value: 'x + 2 = 5, найти x и сделать проверку' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Решить/ }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(within(second).getByRole('alert')).toHaveTextContent('Выбери предмет')
    expect(within(second).getByRole('combobox', { name: 'Предмет' })).toHaveAttribute('aria-invalid', 'true')
  })

  it('пустую добавленную задачу не считает и не отправляет', async () => {
    const onSubmit = vi.fn(async (_submissions: TaskSubmission[]) => true)
    render(<CopyTask onSubmit={onSubmit} signedIn />)
    fillFirstTask()
    fireEvent.click(screen.getByRole('button', { name: 'Добавить задачу' }))

    const submit = screen.getByRole('button', { name: /^Решить за 5\s₽$/ })
    await act(async () => { fireEvent.click(submit) })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toHaveLength(1)
  })

  it('убирает задачу, и форма снова выглядит как одна', () => {
    render(<CopyTask onSubmit={vi.fn(async () => true)} signedIn />)
    fireEvent.click(screen.getByRole('button', { name: 'Добавить задачу' }))
    expect(screen.getAllByRole('textbox')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Убрать задачу 2' }))

    expect(screen.getByRole('textbox', { name: 'Условие задачи' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Убрать задачу/ })).toBeNull()
  })

  it(`ставит не больше ${maxTaskEntries} задач за раз и говорит почему`, () => {
    render(<CopyTask onSubmit={vi.fn(async () => true)} signedIn />)
    const add = screen.getByRole('button', { name: 'Добавить задачу' })
    for (let count = 1; count < maxTaskEntries; count += 1) fireEvent.click(add)
    expect(screen.getAllByRole('textbox')).toHaveLength(maxTaskEntries)

    fireEvent.click(add)

    expect(screen.getAllByRole('textbox')).toHaveLength(maxTaskEntries)
    expect(screen.getByRole('status')).toHaveTextContent(`не больше ${maxTaskEntries} задач`)
  })

  // Бесплатное решение у гостя одно: вторая карточка ушла бы в очередь и
  // упала бы там отказом базы.
  it('гостю даёт одну задачу и объясняет, как решить несколько', () => {
    const onRequireAccount = vi.fn()
    render(<CopyTask onSubmit={vi.fn(async () => true)} onRequireAccount={onRequireAccount} />)

    fireEvent.click(screen.getByRole('button', { name: 'Добавить задачу' }))

    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    const note = screen.getByRole('status')
    expect(note).toHaveTextContent('Несколько задач сразу решаются в аккаунте')
    fireEvent.click(within(note).getByRole('button', { name: 'Войти' }))
    expect(onRequireAccount).toHaveBeenCalledTimes(1)
  })
})

/* Уговор с витриной: `/app?subject=<имя из subjects.ts>` открывает форму с
   уже выбранным предметом, а параметр после этого уходит из адреса. */
describe('CopyTask: предмет из адреса', () => {
  it('ставит предмет и убирает параметр, не трогая остальные', () => {
    window.history.replaceState({ keep: 1 }, '', `/app?subject=${encodeURIComponent('Физика')}&ref=abc#top`)

    render(<CopyTask onSubmit={vi.fn(async () => true)} />)

    expect(screen.getByRole('combobox', { name: 'Предмет' })).toHaveValue('Физика')
    expect(window.location.pathname).toBe('/app')
    expect(window.location.search).toBe('?ref=abc')
    expect(window.location.hash).toBe('#top')
    expect(window.history.state).toEqual({ keep: 1 })
  })

  it('незнакомый предмет пропускает, а параметр всё равно убирает', () => {
    window.history.replaceState(null, '', `/app?payment=success&subject=${encodeURIComponent('Алхимия')}`)

    render(<CopyTask onSubmit={vi.fn(async () => true)} />)

    expect(screen.getByRole('combobox', { name: 'Предмет' })).toHaveValue('')
    expect(window.location.search).toBe('?payment=success')
  })

  it('предмет, выключенный в админке, не подставляет', () => {
    window.history.replaceState(null, '', `/app?subject=${encodeURIComponent('Физика')}`)

    render(<CopyTask onSubmit={vi.fn(async () => true)} subjects={[{ id: 'algebra', name: 'Алгебра' }]} />)

    expect(screen.getByRole('combobox', { name: 'Предмет' })).toHaveValue('')
    expect(window.location.search).toBe('')
  })
})
