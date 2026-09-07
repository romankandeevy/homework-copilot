import { describe, expect, it } from 'vitest'
import { notebookBlocks, taskAsksForSystem } from './systemOfEquations.ts'

describe('система уравнений на листе', () => {
  it('собирает соседние уравнения под одну скобку', () => {
    const condition = 'y = -0,1x + 0,5 и y = 0,3x + 0,1 решить в виде системы уравнений'

    expect(taskAsksForSystem(condition)).toBe(true)
    expect(notebookBlocks(['y = -0,1x + 0,5', 'y = 0,3x + 0,1'], condition)).toEqual([
      { kind: 'system', lines: ['y = -0,1x + 0,5', 'y = 0,3x + 0,1'] },
    ])
  })

  // «Дано» физики - это не система: там известные величины, а не уравнения.
  it('не ставит скобку там, где системы нет', () => {
    expect(notebookBlocks(['m = 5 кг', 'V = 2 л'], 'Найти плотность тела')).toEqual([
      { kind: 'line', line: 'm = 5 кг' },
      { kind: 'line', line: 'V = 2 л' },
    ])
  })

  it('одиночное уравнение остаётся строкой', () => {
    expect(notebookBlocks(['y = 2x + 1'], 'Решить систему уравнений')).toEqual([
      { kind: 'line', line: 'y = 2x + 1' },
    ])
  })
})
