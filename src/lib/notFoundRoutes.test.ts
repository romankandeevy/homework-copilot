import { describe, expect, it } from 'vitest'
import { closestDestination } from './notFoundRoutes'

describe('подсказка на странице 404', () => {
  it.each([
    ['/shedule', '/schedule'],
    ['/solution', '/solutions'],
    ['/contact', '/contacts'],
    ['/privaci', '/privacy'],
    ['/App', '/app'],
    // Раздел угадан верно, ошибка дальше по адресу.
    ['/solutions/abc', '/solutions'],
  ])('%s ведёт на %s', (typed, expected) => {
    expect(closestDestination(typed)?.path).toBe(expected)
  })

  // Допуск растёт с длиной адреса: «/a» - не опечатка в «/app», а мусор.
  it.each(['/opechatka-v-adrese', '/a', '/wp-admin', '/consen-t-form'])('%s остаётся без подсказки', (typed) => {
    expect(closestDestination(typed)).toBeNull()
  })
})
