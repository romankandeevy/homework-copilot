import { describe, expect, it } from 'vitest'
import { describeSchedule, parseSummaryConfig } from './DailySummaryEditor'
import { defaultMoneyRates, effectiveTaxPercent, parseMoneyRates } from './MoneyRatesEditor'

/* Настройки сводки и ставок из ответа базы.

   Аудит 15 сентября 2026: сводка стала настраиваемой, налог и комиссия -
   ставками владельца. Пока миграция не применена, база отдаёт только
   прежний час - админка обязана показать рабочие настройки, а не пустоту. */

describe('настройки сводки', () => {
  it('без настроек берёт прежний час и прежний состав', () => {
    expect(parseSummaryConfig(undefined, 9)).toEqual({
      hours: [9],
      days: [1, 2, 3, 4, 5, 6, 7],
      period: 'yesterday',
      blocks: ['revenue', 'llm_cost', 'registrations', 'active', 'solved', 'errors', 'fraud', 'support'],
    })
  })

  it('отбрасывает неизвестные блоки и чужие часы', () => {
    const config = parseSummaryConfig({ hours: [21, 9, 9, 25, 7.5], days: [5, 1, 8], period: 'today', blocks: ['subjects', 'secret'] }, 9)
    expect(config).toEqual({ hours: [9, 21], days: [1, 5], period: 'today', blocks: ['subjects'] })
  })

  it('говорит расписание словами', () => {
    expect(describeSchedule({ hours: [9], days: [1, 2, 3, 4, 5, 6, 7], period: 'yesterday', blocks: ['revenue'] }))
      .toBe('каждый день в 09:00 МСК, итоги вчерашнего дня')
    expect(describeSchedule({ hours: [9, 14, 21], days: [1, 2, 3, 4, 5], period: 'today', blocks: ['revenue'] }))
      .toBe('по будням в 09:00, 14:00 и 21:00 МСК, итоги сегодняшнего дня к моменту отправки')
    expect(describeSchedule({ hours: [10], days: [2, 4], period: 'yesterday', blocks: ['revenue'] }))
      .toBe('вт, чт в 10:00 МСК, итоги вчерашнего дня')
  })
})

describe('ставки налога и комиссии', () => {
  it('по умолчанию НПД 4 % и комиссия 3,9 %', () => {
    expect(parseMoneyRates(undefined)).toEqual(defaultMoneyRates)
    expect(effectiveTaxPercent(defaultMoneyRates)).toBe(4)
  })

  it('вычет снижает ставку на пункт', () => {
    const rates = parseMoneyRates({ taxPercent: 4, feePercent: 3.5, deduction: true })
    expect(rates).toEqual({ taxPercent: 4, feePercent: 3.5, deduction: true })
    expect(effectiveTaxPercent(rates)).toBe(3)
  })

  it('не верит нечислам', () => {
    expect(parseMoneyRates({ taxPercent: '4', feePercent: null, deduction: 'yes' })).toEqual(defaultMoneyRates)
  })
})
