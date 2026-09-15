import { describe, expect, it } from 'vitest'
import {
  batchCsv, draftProblem, duplicateOf, filterPromos, freeCode, normalizePrefix, pageSlice, parseBatchResult, parsePromo,
  parsePromoFilter, prefixProblem, promoCounts, promoLink, promoPayload, promoState, redemptionWho, sampleCode, sortPromos,
  type Promo, type PromoDraft,
} from './promoModel'

const now = Date.parse('2026-09-14T12:00:00Z')
const hour = 3_600_000
const at = (offset: number) => new Date(now + offset).toISOString()

function promo(patch: Partial<Promo> = {}): Promo {
  return {
    code: 'PLUS50', kind: 'balance', amountKopecks: 5000, planId: null, planDays: null, startsAt: null, expiresAt: null,
    maxUses: null, active: true, note: null, newUsersDays: null, createdAt: at(-48 * hour), uses: 0, lastUsedAt: null,
    creditedKopecks: 0, paidAfter: 0, recent: [], ...patch,
  }
}

const draft = (patch: Partial<PromoDraft> = {}): PromoDraft => ({
  kind: 'balance', amount: '50', planId: '', planDays: '30', startsAt: '', expiresAt: '', newUsersDays: '', ...patch,
})

describe('promoState', () => {
  it('одно состояние на код: выключен старше срока, срок старше лимита', () => {
    expect(promoState(promo(), now)).toBe('active')
    expect(promoState(promo({ active: false, expiresAt: at(-hour) }), now)).toBe('off')
    expect(promoState(promo({ expiresAt: at(-hour), maxUses: 1, uses: 1 }), now)).toBe('expired')
    expect(promoState(promo({ startsAt: at(hour) }), now)).toBe('scheduled')
    expect(promoState(promo({ maxUses: 2, uses: 2 }), now)).toBe('exhausted')
    expect(promoState(promo({ maxUses: 2, uses: 1 }), now)).toBe('active')
  })

  it('счётчики по состояниям складываются в общее число', () => {
    const list = [promo(), promo({ active: false }), promo({ expiresAt: at(-hour) }), promo({ startsAt: at(hour) }), promo({ maxUses: 1, uses: 1 }), promo()]
    const counts = promoCounts(list, now)
    expect(counts).toEqual({ all: 6, active: 2, off: 1, expired: 1, scheduled: 1, exhausted: 1 })
  })

  it('незнакомый фильтр из адреса - «все»', () => {
    expect(parsePromoFilter('expired')).toBe('expired')
    expect(parsePromoFilter('broken')).toBe('all')
  })
})

describe('filterPromos', () => {
  const list = [
    promo({ code: 'PLUS50', note: 'Рассылка в школе №57' }),
    promo({ code: 'SUMMER', expiresAt: at(-hour) }),
    promo({ code: 'XMAS', note: 'Ёлка 2026' }),
  ]

  it('ищет по коду и по заметке без учёта регистра и буквы ё', () => {
    expect(filterPromos(list, { q: 'школ', state: 'all' }, now).map((item) => item.code)).toEqual(['PLUS50'])
    expect(filterPromos(list, { q: ' summ ', state: 'all' }, now).map((item) => item.code)).toEqual(['SUMMER'])
    expect(filterPromos(list, { q: 'елка', state: 'all' }, now).map((item) => item.code)).toEqual(['XMAS'])
  })

  it('фильтрует по состоянию и сочетает его с поиском', () => {
    expect(filterPromos(list, { q: '', state: 'expired' }, now).map((item) => item.code)).toEqual(['SUMMER'])
    expect(filterPromos(list, { q: 'plus', state: 'expired' }, now)).toEqual([])
  })
})

describe('sortPromos', () => {
  const list = [
    promo({ code: 'OLD', createdAt: at(-72 * hour), uses: 3, creditedKopecks: 15000 }),
    promo({ code: 'NEW', createdAt: at(-hour), uses: 3, creditedKopecks: 100 }),
    promo({ code: 'MID', createdAt: at(-24 * hour), uses: 9, creditedKopecks: 0 }),
  ]

  it('по созданию, использованиям и начисленному в обе стороны', () => {
    expect(sortPromos(list, 'created', 'desc').map((item) => item.code)).toEqual(['NEW', 'MID', 'OLD'])
    expect(sortPromos(list, 'created', 'asc').map((item) => item.code)).toEqual(['OLD', 'MID', 'NEW'])
    expect(sortPromos(list, 'credited', 'desc').map((item) => item.code)).toEqual(['OLD', 'NEW', 'MID'])
    expect(sortPromos(list, 'uses', 'asc').map((item) => item.code)).toEqual(['NEW', 'OLD', 'MID'])
  })

  it('равные по полю идут от новых к старым и исходный массив не трогают', () => {
    expect(sortPromos(list, 'uses', 'desc').map((item) => item.code)).toEqual(['MID', 'NEW', 'OLD'])
    expect(list.map((item) => item.code)).toEqual(['OLD', 'NEW', 'MID'])
  })
})

describe('pageSlice', () => {
  it('держит страницу в границах списка', () => {
    const items = Array.from({ length: 120 }, (_, index) => index)
    expect(pageSlice(items, 3, 50)).toMatchObject({ page: 3, pages: 3, items: items.slice(100) })
    expect(pageSlice(items, 9, 50).page).toBe(3)
    expect(pageSlice([], 2, 50)).toEqual({ page: 1, pages: 1, items: [] })
  })
})

describe('копия и свободный код', () => {
  it('предлагает соседний свободный код и не растит хвост', () => {
    expect(freeCode('PLUS50', [])).toBe('PLUS50')
    expect(freeCode('PLUS50', ['PLUS50'])).toBe('PLUS50-2')
    expect(freeCode('PLUS50-2', ['PLUS50', 'PLUS50-2'])).toBe('PLUS50-3')
  })

  it('держит код в 32 знаках', () => {
    const long = 'A'.repeat(32)
    const next = freeCode(long, [long])
    expect(next).toHaveLength(32)
    expect(next.endsWith('-2')).toBe(true)
  })

  it('дубликат берёт все настройки, включая «только новым», но не счётчики', () => {
    const source = promo({ code: 'NEWBIE', newUsersDays: 7, maxUses: 100, note: 'Для новых', uses: 40, creditedKopecks: 120000 })
    expect(duplicateOf(source, ['NEWBIE'])).toEqual({
      code: 'NEWBIE-2', kind: 'balance', amountKopecks: 5000, planId: null, planDays: null, startsAt: null, expiresAt: null,
      maxUses: 100, active: true, note: 'Для новых', newUsersDays: 7,
    })
  })
})

describe('пакет кодов', () => {
  it('префикс как в базе: заглавные, без дефисов по краям', () => {
    expect(normalizePrefix(' school- ')).toBe('SCHOOL')
    expect(prefixProblem('SCHOOL_7')).toBe('')
    expect(prefixProblem('')).toBe('')
    expect(prefixProblem('ШКОЛА')).not.toBe('')
    expect(prefixProblem('A'.repeat(21))).not.toBe('')
  })

  it('образец с самым длинным префиксом укладывается в 32 знака', () => {
    expect(sampleCode('A'.repeat(20)).length).toBeLessThanOrEqual(32)
    expect(sampleCode('')).toBe('7F3K9Q')
    expect(sampleCode('SCHOOL')).toBe('SCHOOL-7F3K9Q')
  })

  it('берёт из ответа базы только строки', () => {
    expect(parseBatchResult({ codes: ['A-7F3K9Q', 2, null, 'A-H4M2PX'] })).toEqual(['A-7F3K9Q', 'A-H4M2PX'])
    expect(parseBatchResult(null)).toEqual([])
  })

  it('CSV пакета несёт ссылку с кодом на баланс', () => {
    const [code, link, what] = batchCsv([], 'https://www.homeworkcopilot.ru')
    const row = { ...duplicateOf(promo({ code: 'SCHOOL-7F3K9Q' }), []) }
    expect(code.value(row)).toBe('SCHOOL-7F3K9Q')
    expect(link.value(row)).toBe('https://www.homeworkcopilot.ru/balance?promo=SCHOOL-7F3K9Q')
    expect(String(what.value(row))).toMatch(/^\+50\s₽ на баланс$/u)
  })
})

describe('черновик формы', () => {
  it('принимает пустое «только новым» и отказывает вне 1-365', () => {
    expect(draftProblem(draft())).toBe('')
    expect(draftProblem(draft({ newUsersDays: '7' }))).toBe('')
    expect(draftProblem(draft({ newUsersDays: '0' }))).toMatch(/только новым/i)
    expect(draftProblem(draft({ newUsersDays: '366' }))).toMatch(/только новым/i)
  })

  it('проверяет сумму, тариф и порядок дат', () => {
    expect(draftProblem(draft({ amount: '0' }))).toMatch(/Сумма/)
    expect(draftProblem(draft({ kind: 'plan' }))).toBe('Выбери тариф.')
    expect(draftProblem(draft({ kind: 'plan', planId: 'pro', planDays: '0' }))).toMatch(/Срок тарифа/)
    expect(draftProblem(draft({ startsAt: '2026-09-20T10:00', expiresAt: '2026-09-19T10:00' }))).toMatch(/Окончание/)
  })
})

describe('поля базы', () => {
  it('до миграции поля newUsersDays нет - ограничения нет', () => {
    expect(parsePromo({ code: 'OLD', kind: 'balance', amountKopecks: 5000, active: true }).newUsersDays).toBeNull()
    expect(parsePromo({ code: 'NEW', kind: 'balance', newUsersDays: 14 }).newUsersDays).toBe(14)
  })

  it('отправляет ограничение и обнуляет чужие для типа поля', () => {
    expect(promoPayload(promo({ kind: 'plan', planId: 'pro', planDays: 7, amountKopecks: 5000, newUsersDays: 3 }))).toMatchObject({
      kind: 'plan', amountKopecks: null, planId: 'pro', planDays: 7, newUsersDays: 3, note: '',
    })
  })

  it('ссылка ведёт на баланс, кто погасил - почта, иначе телефон с плюсом', () => {
    expect(promoLink('SCHOOL-7F3K9Q', 'https://www.homeworkcopilot.ru')).toBe('https://www.homeworkcopilot.ru/balance?promo=SCHOOL-7F3K9Q')
    expect(redemptionWho({ email: 'a@example.test', phone: '79990001122', userId: 'u1' })).toBe('a@example.test')
    expect(redemptionWho({ email: null, phone: '79990001122', userId: 'u1' })).toBe('+79990001122')
    expect(redemptionWho({ email: null, phone: null, userId: 'u1' })).toBe('u1')
  })
})
