import { describe, expect, it } from 'vitest'
import type { HomeworkSolution } from '../lib/homeworkContract'
import { givenWithSi, numberedSteps, sideBySideLayout, solutionCopyText, stepBlocks } from './notebookText'

/* Как строка решения ложится на лист и в копию.

   Аудит 15 сентября 2026: столбик алгебры шёл «по действиям», у сочинения
   в копии стояли «1)», «Решение:» и «Ответ:», у физики «Дано» не
   раскладывалось на СИ. */

function solution(overrides: Partial<HomeworkSolution>): HomeworkSolution {
  return {
    engineVersion: 3,
    textbookId: 'algebra',
    task: 'x',
    source: 'text',
    textbookEdition: 'по фото или тексту',
    sourceUrl: '',
    conditionNormalized: '',
    subject: 'Алгебра',
    textbookTitle: 'Любой учебник',
    condition: 'Реши уравнение.',
    given: [],
    goal: { title: 'Найти', text: 'x' },
    steps: ['(x² - 9)/(x - 3) = 0', 'ОДЗ: x ≠ 3', 'x = -3'],
    answer: 'x = -3',
    diagram: { kind: 'none', description: '', vertices: [] },
    sourceVerified: true,
    taskType: 'calculation',
    quality: { diagramRequired: false, reviewPassed: true, symbolicShare: 0.9 },
    createdAt: '2026-09-15T12:00:00.000Z',
    ...overrides,
  }
}

describe('нумерация строк', () => {
  it('нумерует запись по действиям', () => {
    expect(numberedSteps('Математика', 'calculation')).toBe(true)
    expect(numberedSteps('Физика', 'calculation')).toBe(true)
    expect(numberedSteps('Геометрия', 'proof')).toBe(true)
  })

  it('не нумерует столбик алгебры, таблицу информатики и развёрнутый ответ', () => {
    expect(numberedSteps('Алгебра', 'calculation')).toBe(false)
    expect(numberedSteps('Информатика', 'calculation')).toBe(false)
    expect(numberedSteps('Литература', 'mixed')).toBe(false)
  })
})

describe('таблица деления', () => {
  it('собирает соседние строки с клетками в таблицу', () => {
    expect(stepBlocks(['45 | 22 | 11 | 5 | 2 | 1', '1 | 0 | 1 | 1 | 0 | 1', '45₁₀ = 101101₂'])).toEqual([
      { kind: 'table', rows: [['45', '22', '11', '5', '2', '1'], ['1', '0', '1', '1', '0', '1']] },
      { kind: 'line', line: '45₁₀ = 101101₂' },
    ])
  })

  it('не принимает пометку неравенства за таблицу', () => {
    expect(stepBlocks(['-5x ≥ 15 |:(-5)', 'x ≤ -3'])).toEqual([
      { kind: 'line', line: '-5x ≥ 15 |:(-5)' },
      { kind: 'line', line: 'x ≤ -3' },
    ])
  })

  it('одну строку с клетками оставляет строкой', () => {
    expect(stepBlocks(['a | b | c'])).toEqual([{ kind: 'line', line: 'a | b | c' }])
  })
})

describe('раскладка физики', () => {
  it('раскладывает «Дано» на величину и СИ', () => {
    expect(givenWithSi('m = 1,5 т = 1500 кг')).toEqual({ given: 'm = 1,5 т', si: '1500 кг' })
    expect(givenWithSi('t = 10 с')).toEqual({ given: 't = 10 с', si: '' })
  })

  it('включается у физики, астрономии и химии с «Дано»', () => {
    expect(sideBySideLayout('Физика', ['m = 2 кг'])).toBe(true)
    expect(sideBySideLayout('Астрономия', ['c = 300 000 км/с'])).toBe(true)
    expect(sideBySideLayout('Физика', [])).toBe(false)
    expect(sideBySideLayout('Математика', ['S = 12 км'])).toBe(false)
  })
})

describe('копия решения', () => {
  it('столбик алгебры идёт без номеров и без «Найти»', () => {
    expect(solutionCopyText(solution({}))).toBe([
      'Условие: Реши уравнение.',
      'Решение:',
      '(x² - 9)/(x - 3) = 0',
      'ОДЗ: x ≠ 3',
      'x = -3',
      'Ответ: x = -3',
    ].join('\n'))
  })

  it('запись по действиям нумеруется, таблица - нет', () => {
    const text = solutionCopyText(solution({
      subject: 'Математика',
      given: ['S₁ = 12 км'],
      goal: { title: 'Найти', text: 'v' },
      steps: ['12 + 10 = 22 (км)', '22 : 5 = 4,4 (км/ч)'],
      answer: '4,4 км/ч',
    }))
    expect(text).toContain('Дано:\nS₁ = 12 км\nНайти: v\nРешение:\n1) 12 + 10 = 22 (км)\n2) 22 : 5 = 4,4 (км/ч)\nОтвет: 4,4 км/ч')
  })

  it('развёрнутый ответ - абзацы без «Решение» и «Ответ»', () => {
    const text = solutionCopyText(solution({
      subject: 'Литература',
      taskType: 'mixed',
      condition: 'Какова главная мысль басни?',
      steps: ['Главная мысль басни в том, что трудиться нужно вовремя.'],
      answer: 'трудиться нужно вовремя',
    }))
    expect(text).toBe('Условие: Какова главная мысль басни?\nГлавная мысль басни в том, что трудиться нужно вовремя.')
  })
})
