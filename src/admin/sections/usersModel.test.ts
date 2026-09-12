import { describe, expect, it } from 'vitest'
import { USERS_QUERY_DEFAULTS, balanceScale, buildUsersFilters, countPanelFilters, hasUsersFilters, isOnline, sinceText } from './usersModel'
import type { UsersQuery } from './usersModel'

const query = (patch: Partial<UsersQuery> = {}): UsersQuery => ({ ...USERS_QUERY_DEFAULTS, ...patch })

describe('buildUsersFilters', () => {
  it('без фильтров в адресе ничего не отправляет', () => {
    expect(buildUsersFilters(query())).toEqual({})
    expect(hasUsersFilters(query())).toBe(false)
  })

  it('переводит рубли в копейки, а ноль слева не считает фильтром', () => {
    expect(buildUsersFilters(query({ u_bmin: '0', u_bmax: '150,5' }))).toEqual({ balanceMax: 15050 })
  })

  it('передаёт активность, статус и класс, дублируя старые ключи для бана', () => {
    expect(buildUsersFilters(query({ u_seen: '7d', u_status: 'banned', u_grade: '8', u_paid: 'yes' }))).toEqual({
      seen: '7d', status: 'banned', banned: 'true', grade: '8', paid: 'yes',
    })
  })

  it('отбрасывает значения, которых база не знает', () => {
    expect(buildUsersFilters(query({ u_seen: 'week', u_status: 'x', u_grade: '12', u_bmin: 'abc' }))).toEqual({})
  })
})

describe('countPanelFilters', () => {
  it('считает даты и баланс за один фильтр каждый', () => {
    expect(countPanelFilters(query({ u_plan: 'base', u_from: '2026-09-01', u_to: '2026-09-10', u_bmax: '100', u_bmin: '5' }))).toBe(3)
    expect(countPanelFilters(query({ u_seen: 'today', u_q: 'alina' }))).toBe(0)
  })
})

describe('активность', () => {
  const now = Date.parse('2026-09-12T12:00:00Z')
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString()

  it('онлайн - последние 10 минут', () => {
    expect(isOnline(ago(9), now)).toBe(true)
    expect(isOnline(ago(11), now)).toBe(false)
    expect(isOnline(null, now)).toBe(false)
  })

  it('пишет «был N назад» с правильными окончаниями', () => {
    expect(sinceText(ago(0), now)).toBe('только что')
    expect(sinceText(ago(5), now)).toBe('5 мин назад')
    expect(sinceText(ago(180), now)).toBe('3 ч назад')
    expect(sinceText(ago(1440), now)).toBe('1 день назад')
    expect(sinceText(ago(2 * 1440), now)).toBe('2 дня назад')
    expect(sinceText(ago(11 * 1440), now)).toBe('11 дней назад')
    expect(sinceText(null, now)).toBeNull()
  })
})

describe('balanceScale', () => {
  it('округляет правый край вверх до 1-2-5 и берёт сотую часть шагом', () => {
    expect(balanceScale(0)).toEqual({ max: 100, step: 1 })
    expect(balanceScale(1_234_500)).toEqual({ max: 20000, step: 200 })
  })

  it('растягивает шкалу под значение из адреса', () => {
    expect(balanceScale(5000, 700)).toEqual({ max: 1000, step: 10 })
  })
})
