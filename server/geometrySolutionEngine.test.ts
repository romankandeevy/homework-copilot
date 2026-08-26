import { describe, expect, it } from 'vitest'
import type { HomeworkSolution } from '../src/lib/homeworkContract.ts'
import { isCurrentReviewedSolution, normalizeNotebookNotation, validateSolutionQuality } from './geometrySolutionEngine.ts'

const taskFiveSolution: HomeworkSolution = {
  engineVersion: 2,
  textbookId: 'geometry',
  task: '5',
  source: 'number',
  textbookEdition: '14-е издание, Просвещение, 2023',
  sourceUrl: '/textbooks/geometry-7-9-atanasyan.pdf',
  sourcePage: 9,
  conditionNormalized: 'task-5-identity',
  subject: 'Геометрия',
  textbookTitle: 'Геометрия. 7-9 классы',
  condition: 'Проведите прямую a и отметьте на ней точки A и B. Отметьте точки M, N, P, Q, R и S согласно условию.',
  given: ['A, B ∈ a', 'M, N ∈ [AB]', 'P, Q ∈ a; R, S ∉ a'],
  goal: { title: 'Построить', text: 'P, A, M, N, B, Q; R, S' },
  steps: ['M, N ∈ [AB]; P, Q ∈ a ∖ [AB]; R, S ∉ a.'],
  answer: '',
  diagram: {
    kind: 'construction',
    description: 'Точки на прямой a и вне её.',
    vertices: ['P', 'A', 'M', 'N', 'B', 'Q', 'R', 'S'],
    scene: {
      points: [
        { id: 'P', label: 'P', x: 5, y: 55, visible: true },
        { id: 'A', label: 'A', x: 20, y: 55, visible: true },
        { id: 'M', label: 'M', x: 40, y: 55, visible: true },
        { id: 'N', label: 'N', x: 55, y: 55, visible: true },
        { id: 'B', label: 'B', x: 72, y: 55, visible: true },
        { id: 'Q', label: 'Q', x: 95, y: 55, visible: true },
        { id: 'R', label: 'R', x: 30, y: 18, visible: true },
        { id: 'S', label: 'S', x: 78, y: 18, visible: true },
      ],
      objects: [{ kind: 'line', points: ['P', 'Q'], label: 'a', auxiliary: false }],
      marks: [],
      constraints: [
        { kind: 'collinear', points: ['P', 'A', 'M', 'N', 'B', 'Q'] },
        { kind: 'between', points: ['M', 'A', 'B'] },
        { kind: 'between', points: ['N', 'A', 'B'] },
        { kind: 'not-on-line', points: ['R', 'A', 'B'] },
        { kind: 'not-on-line', points: ['S', 'A', 'B'] },
      ],
    },
  },
  sourceVerified: true,
  taskType: 'construction',
  quality: { diagramRequired: true, reviewPassed: true, symbolicShare: 1 },
  createdAt: '2026-08-26T18:00:00.000Z',
}

describe('geometry solution quality gate', () => {
  it('accepts a compact construction with a mathematically consistent drawing', () => {
    expect(validateSolutionQuality(taskFiveSolution)).toEqual([])
    expect(isCurrentReviewedSolution(taskFiveSolution)).toBe(true)
  })

  it('rejects a text wall even when it claims to be a construction', () => {
    const issues = validateSolutionQuality({
      ...taskFiveSolution,
      steps: ['Сначала проводим прямую, затем отмечаем на ней все нужные точки и после этого отдельно ставим остальные точки вне прямой.'],
    })
    expect(issues).toContain('Построительная задача перегружена текстом')
    expect(isCurrentReviewedSolution({ ...taskFiveSolution, steps: ['Длинный словесный пересказ решения без обозначений.'] })).toBe(false)
  })

  it('rejects a drawing whose coordinates contradict its constraints', () => {
    const scene = taskFiveSolution.diagram.scene!
    const issues = validateSolutionQuality({
      ...taskFiveSolution,
      diagram: {
        ...taskFiveSolution.diagram,
        scene: {
          ...scene,
          points: scene.points.map((point) => point.id === 'R' ? { ...point, y: 55 } : point),
        },
      },
    })
    expect(issues).toContain('not-on-line: точка изображена на указанной прямой')
  })

  it('does not let a construction omit its drawing or add a fake word answer', () => {
    expect(validateSolutionQuality({
      ...taskFiveSolution,
      diagram: { kind: 'none', description: '', vertices: [] },
      quality: { ...taskFiveSolution.quality!, diagramRequired: false },
    })).toEqual(expect.arrayContaining(['Условие требует обязательный чертёж', 'Обязательный чертёж отсутствует']))
    expect(validateSolutionQuality({ ...taskFiveSolution, answer: 'Чертёж' }))
      .toContain('У чистого построения не должно быть словесного ответа')
  })

  it('rejects malformed marks and degenerate objects', () => {
    const scene = taskFiveSolution.diagram.scene!
    const issues = validateSolutionQuality({
      ...taskFiveSolution,
      diagram: {
        ...taskFiveSolution.diagram,
        scene: {
          ...scene,
          objects: [{ kind: 'line', points: ['A', 'A'], label: 'a', auxiliary: false }],
          marks: [{ kind: 'parallel', points: ['A', 'B'], label: '' }],
        },
      },
    })
    expect(issues).toEqual(expect.arrayContaining(['line: объект вырожден', 'parallel: нужны четыре точки']))
  })

  it('does not trust a legacy answer without a completed review', () => {
    expect(isCurrentReviewedSolution({ ...taskFiveSolution, engineVersion: 1 })).toBe(false)
    expect(isCurrentReviewedSolution({
      ...taskFiveSolution,
      quality: { ...taskFiveSolution.quality!, reviewPassed: false },
    })).toBe(false)
  })

  it('converts provider notation to ordinary school symbols', () => {
    expect(normalizeNotebookNotation('$A \\in a$, $C \\notin a$, $a \\parallel b$, x^{2}$')).toBe('A ∈ a, C ∉ a, a ∥ b, x²')
  })
})
