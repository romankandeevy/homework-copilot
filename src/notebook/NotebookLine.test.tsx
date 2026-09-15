import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NotebookText } from './NotebookLine'

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
