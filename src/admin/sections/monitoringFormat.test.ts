import { describe, expect, it } from 'vitest'
import { describeAgent, formatAgo, formatBucket, formatExactMsk, formatMinutes, parseUserAgent, reproContext, reproSteps } from './monitoringFormat'
import type { ReproEvent } from './monitoringFormat'

describe('parseUserAgent', () => {
  it('отличает Edge и Яндекс.Браузер от Chrome', () => {
    expect(parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.2739.42'))
      .toEqual({ browser: 'Edge 128', os: 'Windows 10 или 11', device: 'компьютер' })
    expect(parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 YaBrowser/24.7.0.0 Safari/537.36')?.browser)
      .toBe('Яндекс.Браузер 24.7')
    expect(parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36')?.browser).toBe('Chrome 128')
  })

  it('узнаёт телефон на iOS и Android', () => {
    expect(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'))
      .toEqual({ browser: 'Safari 18.0', os: 'iOS 18.0', device: 'телефон' })
    expect(parseUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'))
      .toEqual({ browser: 'Chrome 128', os: 'Android 14', device: 'телефон' })
  })

  it('не выдумывает браузер из пустой или чужой строки', () => {
    expect(parseUserAgent(null)).toBeNull()
    expect(parseUserAgent('')).toBeNull()
    expect(parseUserAgent('something-strange')).toBeNull()
    expect(parseUserAgent('node')?.device).toBe('сервер')
    expect(describeAgent('Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0')).toBe('Firefox 129, Linux, компьютер')
  })
})

describe('время', () => {
  it('точное время события - по Москве', () => {
    expect(formatExactMsk('2026-09-12T11:03:27Z')).toBe('12.09.2026, 14:03:27 МСК')
    expect(formatExactMsk(null)).toBe('-')
  })

  it('подпись столбца зависит от шага', () => {
    expect(formatBucket('2026-09-12T11:00:00Z', '2026-09-12T12:00:00Z', 60, 'axis')).toBe('14:00')
    expect(formatBucket('2026-09-12T11:00:00Z', '2026-09-12T12:00:00Z', 60, 'full')).toBe('12.09, 14:00-15:00')
    expect(formatBucket('2026-09-12T09:00:00Z', '2026-09-12T15:00:00Z', 360, 'full')).toBe('12.09, 12:00-18:00')
    expect(formatBucket('2026-09-11T21:00:00Z', '2026-09-12T21:00:00Z', 1440, 'axis')).toBe('12.09')
  })

  it('«обновлено N назад» и длительность', () => {
    const now = Date.parse('2026-09-12T12:00:00Z')
    expect(formatAgo(now - 3_000, now)).toBe('только что')
    expect(formatAgo(now - 42_000, now)).toBe('42 с назад')
    expect(formatAgo(now - 5 * 60_000, now)).toBe('5 мин назад')
    expect(formatMinutes(12)).toBe('12 мин')
    expect(formatMinutes(125)).toBe('2 ч 5 мин')
    expect(formatMinutes(60 * 72)).toBe('3 дн')
  })
})

describe('контекст воспроизведения', () => {
  const event: ReproEvent = {
    title: 'Cannot read properties of undefined',
    fingerprint: 'fp-2',
    kind: 'frontend',
    severity: 'error',
    message: "Cannot read properties of undefined (reading 'steps')",
    route: '/app',
    createdAt: '2026-09-12T11:03:27Z',
    who: 'ученик alina@example.test',
    ip: '10.0.0.1',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    requestId: null,
    request: null,
    environment: { viewport: '390x844', language: 'ru-RU' },
    input: null,
    stack: 'TypeError: x\n    at Solution (app.js:10:5)',
  }

  it('берёт шаги только из записанного', () => {
    const steps = reproSteps(event)
    expect(steps[0]).toBe('Открыть страницу /app на сайте в браузере: Safari 18.0, iOS 18.0, телефон.')
    expect(steps[1]).toBe('Выставить размер окна 390x844, язык ru-RU.')
    expect(steps.some((step) => step.includes('Входные данные'))).toBe(false)
  })

  it('собирает всё одним блоком', () => {
    const text = reproContext(event)
    expect(text).toContain('Когда: 12.09.2026, 14:03:27 МСК')
    expect(text).toContain('Стек:\nTypeError: x')
    expect(text).not.toMatch(/[–—]/)
  })
})
