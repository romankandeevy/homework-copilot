import { describe, expect, it } from 'vitest'
import { activeFilterCount, label, parseSolutionDetail, parseSolutionList, solutionTitle, statusLabels, walletTotals } from './solutionsModel'

describe('база решений: разбор ответа admin_solutions_v2', () => {
  it('пустой или битый ответ даёт нули и пустые списки, а не падение', () => {
    for (const value of [null, undefined, {}, [], 'oops']) {
      const list = parseSolutionList(value as never)
      expect(list.total).toBe(0)
      expect(list.page).toBe(1)
      expect(list.stats.total).toBe(0)
      expect(list.stats.firstAt).toBeNull()
      expect(list.facets.statuses).toEqual([])
      expect(list.items).toEqual([])
    }
  })

  it('читает цифры, варианты фильтров и строки; строки без id выбрасывает', () => {
    const list = parseSolutionList({
      total: 2,
      page: 1,
      pageSize: 50,
      stats: { total: 34, today: '2', week: 12, catalog: 0, personal: 31, guest: 3, verifiedTasks: 0, costsSince: '2026-09-06T11:47:10Z' },
      facets: {
        subjects: [{ value: 'Алгебра', count: 7 }, { value: '', count: 1 }],
        statuses: [{ value: 'passed', count: 31 }],
      },
      items: [
        { id: 'a', kind: 'personal', source: 'photo', subject: 'Алгебра', task: null, condition: 'x + 1 = 2', answer: 'x = 1', userId: 'u', email: 'u@example.test', accessCount: 1, status: 'passed', failedChecks: 0, priceKopecks: 500, costKopecks: null, createdAt: '2026-09-10T17:57:38Z' },
        { kind: 'guest' },
      ],
    })
    expect(list.stats.today).toBe(2)
    expect(list.stats.costsSince).toBe('2026-09-06T11:47:10Z')
    expect(list.facets.subjects).toEqual([{ value: 'Алгебра', count: 7 }])
    expect(list.facets.kinds).toEqual([])
    expect(list.items).toHaveLength(1)
    expect(list.items[0]).toMatchObject({ id: 'a', task: null, priceKopecks: 500, costKopecks: null })
  })

  it('считает только заполненные фильтры', () => {
    expect(activeFilterCount({ q: '  ', subject: '', source: '', status: '', kind: '', from: '', to: '' })).toBe(0)
    expect(activeFilterCount({ q: 'x', subject: 'Алгебра', source: '', status: 'passed', kind: '', from: '2026-09-01', to: '' })).toBe(4)
  })

  it('заголовок строки - условие, а служебная метка задачи не показывается', () => {
    expect(solutionTitle({ condition: '  862.  Решите\nнеравенство ', task: null })).toBe('862. Решите неравенство')
    expect(solutionTitle({ condition: '', task: '274' })).toBe('Задача № 274')
    expect(solutionTitle({ condition: '', task: null })).toBe('Условие не сохранено')
  })

  it('незнакомый статус показывается как есть, пустой - дефисом', () => {
    expect(label(statusLabels, 'passed')).toBe('Проверка пройдена')
    expect(label(statusLabels, 'review')).toBe('review')
    expect(label(statusLabels, '')).toBe('-')
  })
})

describe('база решений: полное решение', () => {
  it('разбирает запись, проверки, деньги и очередь', () => {
    const detail = parseSolutionDetail({
      id: 'a',
      kind: 'personal',
      source: 'text',
      subject: 'Алгебра',
      userId: 'u',
      email: 'u@example.test',
      guest: false,
      status: 'passed',
      engineVersion: 3,
      solution: {
        condition: 'Решите неравенство 0,7x - 7 > 0',
        explanation: ['Переносим свободный член вправо.', 42, ''],
        given: [],
        goal: { title: 'Найти', text: 'x' },
        steps: ['0,7x > 7', 'x > 10'],
        answer: 'x > 10',
        diagram: { kind: 'none', description: 'нет' },
        verification: { checks: [{ label: 'Источник', note: 'Условие совпадает', passed: true }, { label: '', passed: false }, { label: 'Чертёж', passed: false }] },
      },
      wallet: [{ amount: -500, kind: 'debit', description: 'Решение задачи', at: '2026-09-10T17:57:38Z' }],
      cost: { models: 'gpt-5-6-sol×1', calls: 1, credits: 0.9, costKopecks: 38, seconds: 41.2, outcome: 'solved' },
      job: { status: 'done', stage: 'done', grade: '8 класс' },
      ratings: { helpful: 1, unhelpful: 0, comments: [{ helpful: true, comment: '  ', at: 'x' }] },
    })
    expect(detail.body.explanation).toEqual(['Переносим свободный член вправо.'])
    expect(detail.body.steps).toEqual(['0,7x > 7', 'x > 10'])
    expect(detail.body.diagram).toBeNull()
    expect(detail.body.code).toBeNull()
    expect(detail.checks).toEqual([
      { label: 'Источник', note: 'Условие совпадает', passed: true },
      { label: 'Чертёж', note: '', passed: false },
    ])
    expect(detail.cost).toMatchObject({ costKopecks: 38, seconds: 41.2, priceKopecks: null })
    expect(detail.job).toMatchObject({ status: 'done', finishedAt: null })
    expect(detail.ratings.comments).toEqual([])
    expect(walletTotals(detail.wallet)).toEqual({ charged: 500, refunded: 0 })
  })

  it('решение гостя без денег, очереди и себестоимости не ломает разбор', () => {
    const detail = parseSolutionDetail({ id: 'guest:1', kind: 'guest', guest: true, solution: { code: { language: 'python', text: 'print(1)' }, diagram: { kind: 'triangle', description: 'Треугольник ABC' } } })
    expect(detail.guest).toBe(true)
    expect(detail.cost).toBeNull()
    expect(detail.job).toBeNull()
    expect(detail.wallet).toEqual([])
    expect(detail.body.code).toEqual({ language: 'python', text: 'print(1)' })
    expect(detail.body.diagram).toBe('Треугольник ABC')
    expect(detail.body.goal).toBeNull()
  })
})
