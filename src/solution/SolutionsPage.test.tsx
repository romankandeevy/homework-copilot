import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeworkSolution } from '../lib/homeworkContract'
import { MySolutions, SolutionsPage } from './SolutionsPage'
import type { SolutionListItem } from './SolutionsPage'

/* Разбор 14 сентября 2026: у владельца полсотни решений. Список идёт днями,
   показывает часть и догружает, у каждой задачи название, число решённых
   видно и в разделе, и на главной. */

const subjects = ['Геометрия', 'Алгебра', 'Физика', 'Литература'] as const

function item(index: number): SolutionListItem {
  const createdAt = new Date(2026, 8, 14, 11, 0)
  createdAt.setHours(createdAt.getHours() - index * 7)
  const condition = `№ ${100 + index}. Найдите значение выражения ${index} + ${index}.`
  const solution: HomeworkSolution = {
    engineVersion: 3,
    textbookId: 'custom',
    task: condition.slice(0, 60).trim(),
    source: 'text',
    textbookEdition: '',
    sourceUrl: '',
    conditionNormalized: condition.toLocaleLowerCase('ru-RU'),
    subject: subjects[index % subjects.length],
    textbookTitle: '',
    condition,
    given: [],
    goal: { title: 'Найти', text: 'значение выражения' },
    steps: [`${index} + ${index} = ${index * 2}`],
    answer: String(index * 2),
    diagram: { kind: 'none', description: '', vertices: [] },
    sourceVerified: true,
    taskType: 'calculation',
    quality: { diagramRequired: false, reviewPassed: true, symbolicShare: 1 },
    createdAt: createdAt.toISOString(),
  }
  return { textbookId: solution.textbookId, task: solution.task, source: solution.source, solution }
}

const items = Array.from({ length: 45 }, (_, index) => item(index))
const subjectOf = () => 'Математика'
const noop = () => {}

function renderPage(list: readonly SolutionListItem[] = items, signedIn = true) {
  return render(
    <SolutionsPage
      signedIn={signedIn}
      items={list}
      subjectOf={subjectOf}
      onOpenAccount={noop}
      onOpenSolution={noop}
      onStartTask={noop}
    />,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 14, 12, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

// Сорок пять карточек в jsdom на загруженной машине не укладываются в пять секунд.
describe('SolutionsPage', { timeout: 30_000 }, () => {
  it('показывает число решённых и первые двадцать по дням, новые сверху', () => {
    // Порядок на входе не важен: список сортирует сам.
    const { container } = renderPage([...items].reverse())

    expect(container.querySelector('.solutions-count')?.textContent).toBe('45')
    expect(container.querySelectorAll('.solution-card')).toHaveLength(20)
    const days = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(days.slice(0, 3)).toEqual(['Сегодня, 14 сентября', 'Вчера, 13 сентября', '12 сентября'])
    // Первая карточка - самое новое решение, с номером и названием.
    const first = container.querySelector('.solution-card')
    expect(first?.textContent).toContain('№ 100')
    expect(first?.textContent).toContain('Найдите значение выражения 0 + 0')
  })

  it('догружает, пока не кончатся, и ставит фокус на первую новую', () => {
    const { container } = renderPage(items.slice(0, 25))

    expect(screen.getByText('Показано 20 из 25')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё 5' }))
    const cards = container.querySelectorAll('.solution-card')
    expect(cards).toHaveLength(25)
    expect(screen.queryByRole('button', { name: /Показать ещё/u })).toBeNull()
    expect(document.activeElement).toBe(cards[20])
  })

  it('ищет по номеру задачи', () => {
    const { container } = renderPage()

    fireEvent.change(screen.getByRole('textbox', { name: 'Найти решение' }), { target: { value: '№ 107' } })

    expect(container.querySelectorAll('.solution-card')).toHaveLength(1)
    expect(screen.getByRole('status').textContent).toBe('Найдено: 1')
  })

  it('пустой поиск предлагает показать всё', () => {
    const { container } = renderPage()

    fireEvent.change(screen.getByRole('textbox', { name: 'Найти решение' }), { target: { value: 'нет такого' } })
    expect(screen.getByRole('heading', { name: 'По запросу «нет такого» ничего нет' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Показать все решения' }))
    expect(container.querySelectorAll('.solution-card')).toHaveLength(20)
  })

  it('от ста решений пишет «не меньше»: больше сервер не отдаёт', () => {
    const { container } = renderPage(Array.from({ length: 100 }, (_, index) => item(index)))

    expect(container.querySelector('.solutions-count')?.textContent).toBe('не меньше 100')
  })

  it('гостю показывает карточку со входом, а не пустой список', () => {
    const { container } = renderPage([], false)

    expect(screen.getByRole('heading', { name: 'Здесь будут твои решения' })).toBeTruthy()
    expect(container.querySelector('.solutions-count')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

describe('MySolutions', () => {
  it('на главной - три последних, число всех и ссылка на полный список', () => {
    const onOpenAll = vi.fn()
    const onOpenSolution = vi.fn()
    const { container } = render(<MySolutions items={items} subjectOf={subjectOf} onOpenAll={onOpenAll} onOpenSolution={onOpenSolution} />)

    const cards = container.querySelectorAll<HTMLButtonElement>('.solution-card')
    expect(cards).toHaveLength(3)
    expect(container.querySelector('.solutions-count')?.textContent).toBe('45')
    // Заголовков-дней нет, поэтому время с днём.
    expect(screen.getByText('сегодня, 11:00')).toBeTruthy()

    const link = screen.getByRole('link', { name: 'Все решения' })
    expect(link.getAttribute('href')).toBe('/solutions')
    fireEvent.click(link)
    expect(onOpenAll).toHaveBeenCalledTimes(1)

    cards[0].click()
    expect(onOpenSolution).toHaveBeenCalledWith({ mode: 'ready', textbookId: 'custom', task: items[0].task, source: 'text' })
  })

  it('без решений не ведёт в пустой список', () => {
    render(<MySolutions items={[]} subjectOf={subjectOf} onOpenAll={noop} onOpenSolution={noop} />)

    expect(screen.getByText('Пока здесь пусто. Первое решение появится после запроса.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Все решения' })).toBeNull()
  })
})
