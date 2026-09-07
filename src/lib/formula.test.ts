import { describe, expect, it } from 'vitest'
import { compileFormula, sampleFormula } from './formula.ts'

describe('формула графика', () => {
  it('считает школьные записи функций', () => {
    expect(compileFormula('y = -0,1x + 0,5')?.(1)).toBeCloseTo(0.4)
    expect(compileFormula('x² - 4x + 1')?.(2)).toBe(-3)
    expect(compileFormula('2x^2')?.(3)).toBe(18)
    expect(compileFormula('1/x')?.(4)).toBe(0.25)
    expect(compileFormula('√(x + 2)')?.(7)).toBe(3)
    expect(compileFormula('|x - 1|')?.(-2)).toBe(3)
    expect(compileFormula('(x+1)(x-1)')?.(3)).toBe(8)
    expect(compileFormula('-x')?.(2)).toBe(-2)
  })

  it('отвергает то, что формулой не является', () => {
    expect(compileFormula('')).toBeNull()
    expect(compileFormula('while(true){}')).toBeNull()
    expect(compileFormula('2 +')).toBeNull()
    expect(compileFormula('y = kx + b')).toBeNull()
  })

  it('рвёт кривую на разрыве', () => {
    const branches = sampleFormula(compileFormula('1/x')!, -3, 3, -5, 5)
    expect(branches.length).toBe(2)
    expect(branches.every((branch) => branch.every((point) => Math.abs(point.y) <= 40))).toBe(true)
  })
})
