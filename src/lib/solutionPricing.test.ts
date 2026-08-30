import { describe, expect, it } from 'vitest'
import { getSolutionPrice, solutionPriceKopecks } from './solutionPricing'

/* Цена решения раньше зависела от номера задачи, а номер стал
   необязательным. Расчёт по номеру отказывался считать цену без него —
   и резерв падал, то есть решение по условию текстом нельзя было
   оплатить вовсе. Здесь проверяется, что цена от номера не зависит. */

describe('цена решения', () => {
  it('одна и та же независимо от способа ввода и предмета', () => {
    expect(getSolutionPrice()).toBe(solutionPriceKopecks)
    expect(getSolutionPrice()).toBe(500)
  })

  it('задана целым числом копеек: баланс дробных не хранит', () => {
    expect(Number.isInteger(solutionPriceKopecks)).toBe(true)
  })

  // Замер 30 августа 2026: самая дорогая задача из шестнадцати — химия,
  // 0,51 кредита; кредит стоит 42,8 коп по курсу ЦБ. Цена обязана
  // покрывать и её, и задачи, не прошедшие проверку: за них заплачено
  // провайдеру, но с ученика не списано.
  it('покрывает себестоимость самой дорогой задачи с запасом', () => {
    const worstMeasuredCredits = 0.51
    const kopecksPerCredit = 42.8
    const worstCost = worstMeasuredCredits * kopecksPerCredit

    expect(worstCost).toBeLessThan(25)
    expect(solutionPriceKopecks).toBeGreaterThan(worstCost * 10)
  })
})
