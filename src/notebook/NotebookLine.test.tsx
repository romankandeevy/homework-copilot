import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NotebookText } from './NotebookLine'
import { unbreakableUnits } from './notebookUnits'

/* Дробь столбиком там, где в тетради дробь, и строка там, где строка. */
function fractions(text: string) {
  const { container } = render(<NotebookText text={text} />)
  return [...container.querySelectorAll('.notebook-fraction')].map((node) => [
    node.querySelector('.notebook-fraction-top')?.textContent,
    node.querySelector('.notebook-fraction-bottom')?.textContent,
  ])
}

describe('дробь на листе', () => {
  it('ставит столбиком дробь из выражений', () => {
    expect(fractions('(x² - 9)/(x - 3) = 0')).toEqual([['x² - 9', 'x - 3']])
    expect(fractions('a = (v - v₀)/t')).toEqual([['v - v₀', 't']])
    expect(fractions('n(Al) = m(Al)/M(Al)')).toEqual([['m(Al)', 'M(Al)']])
  })

  it('оставляет строкой единицы, числовые дроби и аргументы функций', () => {
    expect(fractions('v = 72 км/ч = 20 м/с')).toEqual([])
    expect(fractions('S = 1/2 · AC · BH')).toEqual([])
    expect(fractions('n(Al) = 5,4 г / 27 г/моль')).toEqual([])
  })

  it('не теряет текст вокруг дроби', () => {
    const { container } = render(<NotebookText text="x = (a + b)/2 + 1" />)
    expect(container.textContent).toBe('x = a + b2 + 1')
  })
})

/* Аудит 16 сентября, Г7: физика и химия на записях аудита. */
describe('единицы на листе', () => {
  const nbsp = ' '

  it('держит единицу знаменателя в дроби', () => {
    expect(fractions('a = (20 м/с - 0)/10 с = 2 м/с²')).toEqual([[`20${nbsp}м/⁠с - 0`, `10${nbsp}с`]])
    const { container } = render(<NotebookText text="a = (20 м/с - 0)/10 с = 2 м/с²" />)
    // После дроби не остаётся «с», выпавшей из знаменателя.
    expect(container.querySelector('.notebook-fraction')?.nextSibling?.textContent).toBe(` = 2${nbsp}м/⁠с²`)
  })

  it('не забирает в знаменатель обычное слово после числа', () => {
    expect(fractions('x = (a + b)/2 и y = 1')).toEqual([['a + b', '2']])
  })

  it('не переносит строку внутри числа с единицей', () => {
    expect(unbreakableUnits('M(Al) = 27 г/моль, v = 72 км/ч')).toBe(`M(Al) = 27${nbsp}г/⁠моль, v = 72${nbsp}км/⁠ч`)
    expect(unbreakableUnits('m = 0,1 моль · 102 г/моль = 10,2 г')).toBe(`m = 0,1${nbsp}моль · 102${nbsp}г/⁠моль = 10,2${nbsp}г`)
    // Слово после числа - не единица: пробел остаётся обычным.
    expect(unbreakableUnits('2 способа и 3 шага')).toBe('2 способа и 3 шага')
  })
})
