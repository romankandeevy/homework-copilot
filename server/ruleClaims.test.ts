import { describe, expect, it } from 'vitest'
import type { HomeworkSolution } from '../src/lib/homeworkContract.ts'
import { rankRepairIssues } from './geometrySolutionEngine.ts'
import { verifyRuleClaims } from './subjectRules.ts'

function solution(overrides: Partial<HomeworkSolution>): HomeworkSolution {
  return {
    engineVersion: 2,
    textbookId: 'algebra',
    task: 'Решите уравнение 3/x = 6',
    source: 'text',
    textbookEdition: '',
    sourceUrl: '',
    conditionNormalized: 'rule-claims-fixture',
    subject: 'Алгебра',
    textbookTitle: 'Алгебра',
    condition: 'Решите уравнение 3/x = 6.',
    given: [],
    goal: { title: 'Найти', text: 'x' },
    steps: ['3/x = 6', 'x = 3 : 6 = 0,5'],
    answer: 'x = 0,5',
    diagram: { kind: 'none', description: '', vertices: [] },
    sourceVerified: true,
    taskType: 'calculation',
    quality: { diagramRequired: false, reviewPassed: true, symbolicShare: 1 },
    createdAt: '2026-09-11T09:00:00.000Z',
    ...overrides,
  }
}

/* Модель отвечает на вопросы правил в ruleChecks. У правил без проверки
   кодом это был единственный след, и «ОДЗ выписана» проходило при записи,
   где об ОДЗ не сказано ни слова. */
describe('заявленное в ruleChecks сверяется с записью', () => {
  it('«ОДЗ выписана» без ОДЗ в записи - нарушение', () => {
    const issues = verifyRuleClaims(solution({}), [{ rule: 'domain-checked', passed: true }])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('domain-checked')
  })

  it('ОДЗ в записи есть - замечания нет', () => {
    const written = solution({ steps: ['ОДЗ: x ≠ 0', '3/x = 6', 'x = 3 : 6 = 0,5'] })
    expect(verifyRuleClaims(written, [{ rule: 'domain-checked', passed: true }])).toEqual([])
  })

  it('не заявлено - не сверяется; правило с проверкой кодом не дублируется', () => {
    expect(verifyRuleClaims(solution({}), [{ rule: 'domain-checked', passed: false }])).toEqual([])
    expect(verifyRuleClaims(solution({}), [{ rule: 'numeric-answer', passed: true }])).toEqual([])
  })

  it('неприменимое правило не сверяется', () => {
    const noFraction = solution({ condition: 'Решите уравнение 3x = 6.', steps: ['3x = 6', 'x = 2'], answer: 'x = 2' })
    expect(verifyRuleClaims(noFraction, [{ rule: 'domain-checked', passed: true }])).toEqual([])
  })

  it('геометрия: «теорема названа» при записи без единой теоремы', () => {
    const geometry = solution({
      subject: 'Геометрия',
      condition: 'Катеты прямоугольного треугольника равны 3 см и 4 см. Найдите гипотенузу.',
      steps: ['AB² = 3² + 4² = 25', 'AB = 5 см'],
      answer: 'AB = 5 см',
    })
    expect(verifyRuleClaims(geometry, [{ rule: 'theorem-named', passed: true }])).toHaveLength(1)
    const named = { ...geometry, steps: ['AB² = 3² + 4² = 25 (по теореме Пифагора)', 'AB = 5 см'] }
    expect(verifyRuleClaims(named, [{ rule: 'theorem-named', passed: true }])).toEqual([])
  })
})

describe('порядок замечаний в повторе', () => {
  it('приём не по классу идёт первым, остальные в прежнем порядке', () => {
    const ranked = rankRepairIssues([
      'В ответе нет единицы измерения',
      'Правило «theorem-named» отмечено выполненным, но в записи этого не видно',
      'В 9 класс производные не проходят: реши через свойства функции',
    ])
    expect(ranked[0]).toContain('не проходят')
    expect(ranked.slice(1)).toEqual([
      'В ответе нет единицы измерения',
      'Правило «theorem-named» отмечено выполненным, но в записи этого не видно',
    ])
  })
})
