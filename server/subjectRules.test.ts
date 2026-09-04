import { describe, expect, it } from 'vitest'
import type { HomeworkSolution } from '../src/lib/homeworkContract.ts'
import { subjectRuleQuestions, verifySubjectRules } from './subjectRules.ts'

/* Правила предмета — это рецензент.

   Раньше проверять решение шёл третий вызов модели, и шёл он на каждой
   задаче. Школьные требования к записи мнения не требуют: единица измерения
   при ответе либо есть, либо нет. */

function solution(overrides: Partial<HomeworkSolution>): HomeworkSolution {
  return {
    engineVersion: 2,
    textbookId: 'mathematics',
    task: 'Задача',
    source: 'text',
    textbookEdition: 'по фото или тексту',
    sourceUrl: '',
    conditionNormalized: 'условие',
    subject: 'Математика',
    textbookTitle: 'Любой учебник',
    condition: 'Найдите длину маршрута, если турист прошёл 12 км.',
    given: ['12 км'],
    goal: { title: 'Найти', text: 'длину маршрута' },
    explanation: [
      'Задача на части: известна часть пути и её доля от целого маршрута.',
      'Целое находят делением известной части на её долю, а не умножением.',
    ],
    steps: ['12 : 1/4 = 48 км.'],
    answer: '48 км',
    diagram: { kind: 'none', description: '', vertices: [] },
    sourceVerified: true,
    taskType: 'calculation',
    quality: { diagramRequired: false, reviewPassed: true, symbolicShare: 0.9 },
    createdAt: '2026-08-31T12:00:00.000Z',
    ...overrides,
  }
}

describe('правила предмета', () => {
  it('пропускает решение, выполняющее правила', () => {
    expect(verifySubjectRules(solution({}))).toEqual([])
  })

  // Единицы теряются чаще всего, и работа за это снижается.
  it('ловит ответ без единицы измерения', () => {
    expect(verifySubjectRules(solution({ answer: '48' }))).toContain('В ответе нет единицы измерения')
  })

  it('ловит ответ-отговорку вместо числа', () => {
    const issues = verifySubjectRules(solution({ answer: 'смотри решение' }))
    expect(issues).toContain('В ответе нет найденного числа')
  })

  it('ловит решение без единого вычисления', () => {
    expect(verifySubjectRules(solution({ steps: ['Рассуждаем и получаем ответ.'] })))
      .toContain('В решении нет ни одного вычисления')
  })

  /* Правила зависят от предмета.

     У русского языка нет ни единиц измерения, ни вычислений, зато есть свои
     требования: разобрал по составу — покажи морфемы, спросили способ
     образования — назови его. */
  it('спрашивает с русского языка своё, а не арифметическое', () => {
    const morphology = solution({
      textbookId: 'russian',
      subject: 'Русский язык',
      condition: 'Разберите по составу слово «подоконник» и укажите способ его образования.',
      taskType: 'mixed',
      steps: ['Слово состоит из частей.'],
      answer: 'подоконник',
    })

    const issues = verifySubjectRules(morphology)
    expect(issues).toContain('Способ образования не назван')
    expect(issues).not.toContain('В ответе нет единицы измерения')
  })

  it('не спрашивает способ образования там, где о нём не спрашивали', () => {
    const spelling = solution({
      textbookId: 'russian',
      subject: 'Русский язык',
      condition: 'Спишите текст, вставляя пропущенные буквы.',
      taskType: 'mixed',
      steps: ['Вставляем буквы по правилу.'],
      answer: 'Текст списан.',
    })

    expect(verifySubjectRules(spelling)).toEqual([])
  })

  it('ловит чертёж с кириллическими подписями точек', () => {
    const geometry = solution({
      textbookId: 'geometry',
      subject: 'Геометрия',
      condition: 'В треугольнике ABC найдите AB, если AC = 6 см, BC = 8 см.',
      answer: 'AB = 10 см',
      diagram: { kind: 'three-point-lines', description: 'Треугольник', vertices: ['А', 'B', 'C'] },
    })

    expect(verifySubjectRules(geometry)).toContain('Точки чертежа подписаны кириллицей вместо латиницы')
  })

  // Вопросы уходят в промпт: модель отвечает на них до выдачи решения
  // и сама чинит нарушенное — это дешевле отдельного рецензента.
  it('отдаёт вопросы правил для промпта', () => {
    const questions = subjectRuleQuestions('Химия')
    expect(questions.map((rule) => rule.id)).toContain('equation-balanced')
    expect(questions.every((rule) => rule.question.endsWith('?'))).toBe(true)
  })

  it('у незнакомого предмета остаются только общие правила', () => {
    expect(subjectRuleQuestions('Танцы').map((rule) => rule.id)).toEqual(['explanation-explains', 'answer-answers-question'])
  })
})
