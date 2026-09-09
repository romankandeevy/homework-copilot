import { describe, expect, it } from 'vitest'
import { answersByPart, numberLineParts } from './numberLineParts'
import type { HomeworkSolution } from '../lib/homeworkContract'

const line = (label: string, answer: string, value: number) => ({
  label,
  variable: 'x',
  answer,
  marks: [{ value, label: String(value).replace('.', ','), filled: false }],
  regions: [{ from: value, to: null }],
})

const solution = (overrides: Partial<HomeworkSolution>) => ({
  textbookId: 'algebra',
  task: '862',
  source: 'text' as const,
  textbookEdition: 'по фото или тексту',
  sourceUrl: '',
  conditionNormalized: '',
  subject: 'Алгебра',
  textbookTitle: 'Любой учебник',
  condition: '862. Решите неравенство и изобразите на координатной прямой множество его решений.',
  given: [],
  goal: { title: 'Найти' as const, text: 'множества решений' },
  steps: [],
  answer: '',
  diagram: { kind: 'number-line' as const, description: 'Прямые', vertices: [], numberLine: { lines: [] } },
  sourceVerified: true,
  ...overrides,
}) as HomeworkSolution

describe('numberLineParts', () => {
  it('раскладывает столбик решения по пунктам и даёт каждому его прямую', () => {
    const parts = numberLineParts(solution({
      steps: ['а) 6 + 2x > 1', '2x > -5', 'x > -2,5', 'б) 2 - 7x < 0', '-7x < -2 |·(-1)', 'x > 2/7'],
      answer: 'а) x ∈ (-2,5; +∞); б) x ∈ (2/7; +∞)',
      diagram: {
        kind: 'number-line',
        description: 'Прямые',
        vertices: [],
        numberLine: { lines: [line('а)', 'x ∈ (-2,5; +∞)', -2.5), line('б)', 'x ∈ (2/7; +∞)', 0.2857)] },
      },
    }))

    expect(parts).toHaveLength(2)
    expect(parts[0].steps).toHaveLength(3)
    expect(parts[0].answer).toBe('x ∈ (-2,5; +∞)')
    expect(parts[1].line.label).toBe('б)')
  })

  /* Решения, сохранённые до появления ответа у прямой, читаются по общему
     ответу: пункты в нём перечислены теми же буквами. */
  it('берёт ответ пункта из общего ответа, если у прямой его нет', () => {
    const parts = numberLineParts(solution({
      steps: ['а) 6 + 2x > 1', 'x > -2,5'],
      answer: 'а) x ∈ (-2,5; +∞)',
      diagram: {
        kind: 'number-line',
        description: 'Прямая',
        vertices: [],
        numberLine: { lines: [{ ...line('а)', '', -2.5) }] },
      },
    }))

    expect(parts[0].answer).toBe('x ∈ (-2,5; +∞)')
  })

  it('молчит, когда пункты и прямые не сходятся', () => {
    const parts = numberLineParts(solution({
      steps: ['а) 6 + 2x > 1', 'x > -2,5', 'б) 2 - 7x < 0', 'x > 2/7'],
      answer: 'а) x ∈ (-2,5; +∞); б) x ∈ (2/7; +∞)',
      diagram: {
        kind: 'number-line',
        description: 'Прямая',
        vertices: [],
        numberLine: { lines: [line('а)', 'x ∈ (-2,5; +∞)', -2.5)] },
      },
    }))

    expect(parts).toEqual([])
  })

  it('разбирает общий ответ по буквам пунктов', () => {
    const answers = answersByPart('а) x ∈ (-2,5; +∞); б) x ∈ (2/7; +∞); в) x ∈ [0; +∞)')
    expect(answers.get('б')).toBe('x ∈ (2/7; +∞)')
    expect(answers.get('в')).toBe('x ∈ [0; +∞)')
  })
})
