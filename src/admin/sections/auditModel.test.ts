import { describe, expect, it } from 'vitest'
import {
  POLL_PER_MINUTE,
  POLL_SUSTAINED_MINUTES,
  changeSummary,
  eventGroups,
  eventLabels,
  fieldRows,
  groupedEventOptions,
  linkKind,
  periodRange,
  pollLevel,
} from './auditModel'

describe('события журнала', () => {
  it('каждое событие из словаря лежит ровно в одной группе', () => {
    const grouped = eventGroups.flatMap((group) => group.events)
    expect(new Set(grouped).size).toBe(grouped.length)
    expect([...grouped].sort()).toEqual(Object.keys(eventLabels).sort())
  })

  it('ищет по русскому названию, по ключу и по группе', () => {
    expect(groupedEventOptions({}, 'возврат').flatMap((group) => group.options.map((option) => option.key)))
      .toEqual(['payment_refunded', 'reservation_refunded'])
    expect(groupedEventOptions({}, 'jobs_exp').flatMap((group) => group.options.map((option) => option.key))).toEqual(['jobs_expired'])
    const fraud = groupedEventOptions({}, 'фрод')
    expect(fraud.map((group) => group.title)).toContain('Фрод')
    expect(fraud.find((group) => group.title === 'Фрод')?.options).toHaveLength(4)
  })

  it('незнакомое событие из базы попадает в «Другие» со счётчиком', () => {
    const groups = groupedEventOptions({ balance_adjusted: 3, brand_new_event: 2 })
    expect(groups.at(-1)).toEqual({ title: 'Другие', options: [{ key: 'brand_new_event', label: 'brand_new_event', count: 2 }] })
    expect(groups.find((group) => group.title === 'Финансы')?.options[0]).toEqual({ key: 'balance_adjusted', label: 'Изменён баланс', count: 3 })
  })
})

describe('было → стало', () => {
  it('ставит изменённые поля первыми и прячет служебные отметки', () => {
    const rows = fieldRows(
      { status: 'pending_owner', priority: 'high', updated_at: '1' },
      { status: 'resolved', priority: 'high', updated_at: '2' },
    )
    expect(rows).toEqual([
      { key: 'status', before: 'pending_owner', after: 'resolved', changed: true },
      { key: 'priority', before: 'high', after: 'high', changed: false },
    ])
  })

  it('понимает создание записи и скалярные значения', () => {
    expect(fieldRows(null, { role: 'admin' })).toEqual([{ key: 'role', before: null, after: 'admin', changed: true }])
    expect(fieldRows(5, 7)).toEqual([{ key: 'значение', before: 5, after: 7, changed: true }])
    expect(fieldRows(null, null)).toEqual([])
  })

  it('сводка берёт первое изменение или причину из подробностей', () => {
    expect(changeSummary({ a: 1, b: 1 }, { a: 2, b: 3 }, {})).toBe('a: 1 → 2 и ещё 1')
    expect(changeSummary(null, null, { amount: -500, reason: 'ошибка' })).toBe('reason: ошибка')
    expect(changeSummary(null, null, {})).toBe('')
  })
})

describe('ссылки из значений', () => {
  const id = '22222222-2222-4222-8222-222222222222'

  it('обращение - по имени поля, пользователь - по полю или известному id', () => {
    expect(linkKind('conversationId', 'conversation-1')).toBe('conversation')
    expect(linkKind('assignedTo', id)).toBe('user')
    expect(linkKind('solutionId', id)).toBeNull()
    expect(linkKind('solutionId', id, [id])).toBe('user')
    expect(linkKind('userId', 'не uuid')).toBeNull()
    expect(linkKind('userId', 42)).toBeNull()
  })
})

describe('частый опрос', () => {
  it('жёлтый - пик выше порога, красный - выше порога много минут', () => {
    expect(pollLevel(POLL_PER_MINUTE, 500)).toBe('ok')
    expect(pollLevel(POLL_PER_MINUTE + 1, 1)).toBe('warning')
    expect(pollLevel(POLL_PER_MINUTE + 1, POLL_SUSTAINED_MINUTES)).toBe('danger')
  })
})

describe('период', () => {
  it('считает границы по дням включительно', () => {
    const today = '2026-09-12'
    expect(periodRange('all', { from: '', to: '' }, today)).toEqual({ from: null, to: null })
    expect(periodRange('today', { from: '', to: '' }, today)).toEqual({ from: today, to: today })
    expect(periodRange('7d', { from: '', to: '' }, today)).toEqual({ from: '2026-09-06', to: today })
    expect(periodRange('30d', { from: '', to: '' }, today)).toEqual({ from: '2026-08-14', to: today })
    expect(periodRange('custom', { from: '2026-09-10', to: '2026-09-01' }, today)).toEqual({ from: '2026-09-01', to: '2026-09-10' })
    expect(periodRange('custom', { from: 'мусор', to: '2026-09-01' }, today)).toEqual({ from: null, to: '2026-09-01' })
  })
})
