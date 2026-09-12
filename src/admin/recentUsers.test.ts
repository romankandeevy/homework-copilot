import { beforeEach, describe, expect, it } from 'vitest'
import { readRecentUsers, rememberRecentUser } from './recentUsers'

describe('недавние карточки', () => {
  beforeEach(() => window.localStorage.clear())

  it('ставит последнюю открытую первой и не дублирует', () => {
    rememberRecentUser({ id: 'a', email: 'a@example.test', name: 'А' })
    rememberRecentUser({ id: 'b', email: 'b@example.test', name: '' })
    rememberRecentUser({ id: 'a', email: 'a@example.test', name: 'А' })
    expect(readRecentUsers().map((user) => user.id)).toEqual(['a', 'b'])
  })

  it('хранит не больше шести', () => {
    for (let index = 0; index < 9; index += 1) rememberRecentUser({ id: String(index), email: `${index}@example.test`, name: '' })
    expect(readRecentUsers()).toHaveLength(6)
    expect(readRecentUsers()[0].id).toBe('8')
  })

  it('битое значение в хранилище - пустой список', () => {
    window.localStorage.setItem('homework-copilot:admin-recent-users', '{oops')
    expect(readRecentUsers()).toEqual([])
    window.localStorage.setItem('homework-copilot:admin-recent-users', JSON.stringify([{ id: 1 }, { id: 'x', email: 'x@example.test', name: 'Икс' }]))
    expect(readRecentUsers()).toEqual([{ id: 'x', email: 'x@example.test', name: 'Икс' }])
  })
})
