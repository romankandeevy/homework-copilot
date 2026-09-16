import { describe, expect, it } from 'vitest'
import { solveHomeworkWithReview } from './geometrySolutionEngine.ts'
import type { SolveHomeworkRequest } from '../src/lib/homeworkContract.ts'

/* Заявленное правило без следа в записи не отменяет решение.

   16 сентября физика с фотографии вернулась ученику как «решение не
   дошло»: счёт верный, единицы на месте, приём по классу - а замечание
   осталось одно, про след формулы в записи. Правило без проверки кодом
   зовёт починку, но последнего слова у него нет. */

const request: SolveHomeworkRequest = {
  textbookId: 'physics',
  task: '390',
  source: 'text',
  subject: 'Физика',
  grade: '8',
  textbookTitle: 'Физика. 8 класс',
  authors: 'Пёрышкин',
  edition: 'издание для проверки',
  condition: 'Какое количество теплоты нужно, чтобы нагреть 2 кг воды на 30 °C? Удельная теплоёмкость воды 4200 Дж/(кг·°C).',
  idempotencyKey: 'test-rule-claim',
}

// Записи буквами в решении нет - только подстановка чисел, а модель
// отметила правило выполненным.
const draft = {
  ruleChecks: [{ rule: 'formula-before-numbers', passed: true, evidence: 'Формула записана буквами' }],
  condition: request.condition,
  taskType: 'calculation',
  diagramRequired: false,
  decisions: {
    taskGoal: 'Найти количество теплоты',
    diagramRequired: false,
    diagramReason: 'Расчётная задача, чертёж не нужен',
    requiredElements: ['Дано', 'Решение', 'Ответ'],
    notebookFormat: 'Дано - Найти - Решение - Ответ',
    selfChecks: ['Единицы на месте', 'Подстановка сошлась', 'Порядок величины разумный'],
  },
  sourceVerified: true,
  given: ['m = 2 кг', 'Δt = 30 °C', 'c = 4200 Дж/(кг·°C)'],
  goal: { title: 'Найти', text: 'Q - ?' },
  explanation: [
    'Количество теплоты при нагревании зависит от вещества, массы и того, на сколько градусов нагрели.',
    'Признак задачи: даны масса, удельная теплоёмкость и изменение температуры, спрашивают теплоту.',
    'Частая ошибка - взять конечную температуру вместо её изменения.',
  ],
  steps: ['Q = 4200 · 2 · 30 = 252 000 Дж = 252 кДж'],
  answer: 'Q = 252 кДж',
  answerKey: '252 кДж',
  worksheet: [{ label: 'количество теплоты', expression: '4200 * 2 * 30', value: '252000' }],
  diagram: { kind: 'none', description: '', vertices: [], scene: { points: [], objects: [], marks: [], constraints: [] } },
}

const geminiPayload = (body: unknown) => ({
  choices: [{ message: { content: JSON.stringify(body) } }],
  credits_consumed: 0.01,
})

const responsesPayload = (body: unknown) => ({
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(body) }] }],
  credits_consumed: 0.01,
})

function stubProvider() {
  const stages: string[] = []
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const body = typeof init?.body === 'string' ? init.body : ''
    const stage = body.includes('homework_solution_patch')
      ? 'patch'
      : body.includes('homework_solution_review') ? 'review' : 'draft'
    stages.push(stage)
    // Модель настаивает на своей записи: правка возвращает те же строки.
    const answer = stage === 'patch'
      ? { patches: [{ field: 'steps', lines: draft.steps }] }
      : stage === 'review' ? { approved: true, issues: [], solution: draft } : draft
    return new Response(JSON.stringify(url.includes('/codex/') ? responsesPayload(answer) : geminiPayload(answer)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { stages, fetchImpl }
}

describe('заявка на правило без следа в записи', () => {
  it('зовёт починку, но решение ученику всё равно доходит', async () => {
    const { stages, fetchImpl } = stubProvider()

    const solution = await solveHomeworkWithReview(request, { apiKey: 'test-key', fetchImpl })

    // Починку позвали - замечание не проглочено молча.
    expect(stages).toContain('patch')
    expect(solution.answer).toContain('252')
    // И само замечание видно в панели проверки, а не потеряно.
    expect(solution.verification?.reviewerIssues.join(' ')).toContain('formula-before-numbers')
  })
})
