import { describe, expect, it } from 'vitest'
import type { HomeworkSolution } from '../src/lib/homeworkContract.ts'
import { stageFromGrade, verifyGradeLevel } from './gradeRules.ts'

/* Верный ответ не значит сдаваемое решение.

   7 сентября на проде стереометрия за 11 класс - расстояние между
   скрещивающимися прямыми в кубе - решилась через векторное и смешанное
   произведение. Ответ совпал с эталоном до последней цифры, а в школе
   такого приёма нет: учитель решение не примет. */

function solution(steps: string[]): HomeworkSolution {
  return {
    engineVersion: 3,
    textbookId: 'geometry',
    task: 'Задача',
    source: 'text',
    textbookEdition: '',
    sourceUrl: '',
    conditionNormalized: '',
    subject: 'Геометрия',
    textbookTitle: '',
    condition: 'Куб ABCDA₁B₁C₁D₁ с ребром 6. Найти расстояние между DM и A₁N.',
    given: ['AB = 6'],
    goal: { title: 'Найти', text: 'd(DM, A₁N)' },
    steps,
    answer: 'd = 12√53/53',
    diagram: { kind: 'none', description: '', vertices: [] },
    sourceVerified: true,
    taskType: 'calculation',
    createdAt: '2026-09-08T00:00:00.000Z',
  }
}

const vectorProduct = [
  'vec(DM) = {6; 6; 3}, vec(A₁N) = {0; -6; -4}',
  'Векторное произведение [vec(DM) × vec(A₁N)] = (-6; 24; -36)',
  'd = |vec(DA₁) · [vec(DM) × vec(A₁N)]| / |[vec(DM) × vec(A₁N)]| = 12√53/53',
]

describe('ступень обучения', () => {
  it('читает класс из строки формы', () => {
    expect(stageFromGrade('8 класс')).toBe('middle')
    expect(stageFromGrade('11 класс')).toBe('senior')
    expect(stageFromGrade('6 класс')).toBe('junior')
    expect(stageFromGrade('Университет')).toBe('university')
    expect(stageFromGrade('')).toBe('unknown')
  })
})

describe('приём по классу', () => {
  it('не пускает векторное произведение в одиннадцатый класс', () => {
    const issues = verifyGradeLevel(solution(vectorProduct), '11 класс')
    expect(issues.some((issue) => issue.includes('векторное и смешанное произведение'))).toBe(true)
  })

  it('пускает его же в университете', () => {
    expect(verifyGradeLevel(solution(vectorProduct), 'Университет')).toEqual([])
  })

  it('молчит, когда класс не выбран', () => {
    // «Класс: любой» - это отказ ученика от ограничения, а не повод его выдумывать.
    expect(verifyGradeLevel(solution(vectorProduct), '')).toEqual([])
  })

  it('не пускает производную в девятый класс', () => {
    const issues = verifyGradeLevel(
      solution(['f(x) = x² - 4x', 'Производная f′(x) = 2x - 4 обращается в ноль при x = 2']),
      '9 класс',
    )
    expect(issues.some((issue) => issue.includes('производные'))).toBe(true)
  })

  it('пускает производную в одиннадцатый', () => {
    const issues = verifyGradeLevel(
      solution(['f(x) = x² - 4x', 'Производная f′(x) = 2x - 4 обращается в ноль при x = 2']),
      '11 класс',
    )
    expect(issues).toEqual([])
  })

  it('пропускает школьное решение того же куба', () => {
    const issues = verifyGradeLevel(solution([
      'Оси: D - начало, DA вдоль x, DC вдоль y, DD₁ вдоль z',
      'Плоскость через A₁N параллельно DM: 2x - 3y + 6z = 12',
      'd = |2 · 0 - 3 · 0 + 6 · 0 - 12| / √(4 + 9 + 36) = 12√53/53',
    ]), '11 класс')
    expect(issues).toEqual([])
  })
})
