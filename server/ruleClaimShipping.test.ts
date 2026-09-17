import { describe, expect, it } from 'vitest'
import { solveHomeworkWithReview, sourceUnreadableMessage } from './geometrySolutionEngine.ts'
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

function stubProvider(authorDraft: typeof draft = draft) {
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
      ? { patches: [{ field: 'steps', lines: authorDraft.steps }] }
      : stage === 'review' ? { approved: true, issues: [], solution: authorDraft } : authorDraft
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

/* Аудит 16 сентября: лишние вызовы по мелочи. */
describe('отказ и выдача без лишних вызовов', () => {
  const clean = {
    ...draft,
    ruleChecks: [{ rule: 'formula-before-numbers', passed: true, evidence: 'Q = cmΔt' }],
    steps: ['Q = cmΔt', 'Q = 4200 · 2 · 30 = 252 000 Дж'],
  }

  it('нечитаемое фото - отказ после первого же вызова и понятный текст', async () => {
    const { stages, fetchImpl } = stubProvider({ ...clean, sourceVerified: false })
    const photo: SolveHomeworkRequest = {
      ...request,
      source: 'photo',
      condition: undefined,
      imageDataUrl: 'data:image/png;base64,cGhvdG8=',
    }

    await expect(solveHomeworkWithReview(photo, { apiKey: 'test-key', fetchImpl }))
      .rejects.toThrow(sourceUnreadableMessage(photo))
    // Раньше: черновик, точечная починка, которая признак не меняет, и полный повтор.
    expect(stages).toEqual(['draft'])
    expect(sourceUnreadableMessage(photo)).toContain('фотографии')
  })

  it('признание по правилу без проверки кодом не зовёт починку', async () => {
    const { stages, fetchImpl } = stubProvider({
      ...clean,
      ruleChecks: [...clean.ruleChecks, { rule: 'answer-plausible', passed: false, evidence: 'Не уверена в порядке величины' }],
    })

    const solution = await solveHomeworkWithReview(request, { apiKey: 'test-key', fetchImpl })

    expect(stages).toEqual(['draft'])
    expect(solution.answer).toContain('252')
  })
})

/* Этап 1 разбора решателя, 17 сентября.

   Геометрия восьмого класса с фото: четыре вызова, 82 секунды и отказ за
   «Слишком много слов и слишком мало математических обозначений; Обозначение
   B(...) использовано, но нигде не введено». Замечания к виду записи больше
   не отменяют решение, а полный повтор идёт тем же промптом, что у автора. */
describe('замечания к записи не отменяют решение', () => {
  function scriptedProvider(answers: { draft: unknown; patch?: unknown; review?: unknown }) {
    const calls: { stage: string; body: string }[] = []
    const fetchImpl = (async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      const body = typeof init?.body === 'string' ? init.body : ''
      const stage = body.includes('homework_solution_patch')
        ? 'patch'
        : body.includes('homework_solution_review') ? 'review' : 'draft'
      calls.push({ stage, body })
      const answer = stage === 'patch' ? answers.patch ?? { patches: [] } : stage === 'review' ? answers.review : answers.draft
      return new Response(JSON.stringify(url.includes('/codex/') ? responsesPayload(answer) : geminiPayload(answer)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch
    return { calls, fetchImpl }
  }

  const geometryPhoto: SolveHomeworkRequest = {
    textbookId: 'geometry',
    task: 'photo-865',
    source: 'photo',
    subject: 'Геометрия',
    grade: '8 класс',
    textbookTitle: '',
    authors: '',
    edition: '',
    note: '865 решить',
    imageDataUrl: 'data:image/png;base64,cGhvdG8=',
    idempotencyKey: 'test-geometry-865',
  }
  const wordyGeometry = {
    ruleChecks: [],
    condition: 'Точки A(0; 0), B(4; 0) и C(0; 3) - вершины треугольника. Найдите площадь треугольника ABC.',
    taskType: 'calculation',
    diagramRequired: false,
    decisions: {
      taskGoal: 'Найти площадь треугольника',
      diagramRequired: false,
      diagramReason: 'Треугольник задан координатами',
      requiredElements: [],
      notebookFormat: 'Дано - Найти - Решение - Ответ',
      selfChecks: ['Катеты найдены по координатам', 'Площадь пересчитана'],
    },
    sourceVerified: true,
    given: ['A(0; 0), B(4; 0), C(0; 3)'],
    goal: { title: 'Найти', text: 'S△ABC' },
    explanation: [
      'Площадь прямоугольного треугольника равна половине произведения его катетов.',
      'Признак: две стороны лежат на осях координат, значит угол между ними прямой.',
      'Частая ошибка - взять гипотенузу вместо катета и получить неверную площадь.',
    ],
    steps: [
      'Стороны AB и AC лежат на осях координат, поэтому угол A прямой и треугольник прямоугольный с катетами AB и AC',
      'Точка B(4; 0) лежит на оси x, значит AB = 4, точка C(0; 3) лежит на оси y, значит AC = 3',
      'S = AB · AC / 2 = 4 · 3 / 2 = 6',
    ],
    answer: 'S = 6',
    answerKey: '6',
    worksheet: [{ label: 'площадь', expression: '4*3/2', value: '6' }],
    diagram: { kind: 'none', description: '', vertices: [] },
  }

  it('выдаёт многословную геометрию после первого вызова, с предупреждением', async () => {
    const { calls, fetchImpl } = scriptedProvider({ draft: wordyGeometry })

    const solution = await solveHomeworkWithReview(geometryPhoto, { apiKey: 'test-key', fetchImpl })

    // Полного повтора нет; точечная правка не больше одной.
    expect(calls.filter((call) => call.stage === 'review')).toHaveLength(0)
    expect(calls.filter((call) => call.stage === 'patch').length).toBeLessThanOrEqual(1)
    expect(solution.answer).toBe('S = 6')
    const warning = solution.verification?.checks.find((check) => check.label === 'Замечания к записи')
    expect(warning?.passed).toBe(false)
    expect(warning?.note).toContain('Есть словесный абзац')
    // Точка с координатами - не функция без определения.
    expect(solution.verification?.reviewerIssues.join(' ')).not.toContain('B(...)')
  })

  it('полный повтор идёт с правилами автора и не зависит от approved модели', async () => {
    const noUnit = { ...draft, steps: ['Q = cmΔt', 'Q = 4200 · 2 · 30 = 252 000 Дж'], answer: 'Q = 252000' }
    const fixed = { ...noUnit, answer: 'Q = 252 кДж' }
    const { calls, fetchImpl } = scriptedProvider({
      draft: noUnit,
      patch: { patches: [] },
      review: { approved: false, issues: ['Не уверена'], solution: fixed },
    })

    const solution = await solveHomeworkWithReview(request, { apiKey: 'test-key', fetchImpl })

    expect(calls.map((call) => call.stage)).toEqual(['draft', 'patch', 'review'])
    expect(solution.answer).toBe('Q = 252 кДж')
    const review = calls.find((call) => call.stage === 'review')?.body ?? ''
    expect(review).toContain('Перед решением заполни explanation')
    expect(review).not.toContain('Ты независимый учитель и редактор')
  })

  it('отказывает, если повтор так и не снял замечание по существу', async () => {
    const noUnit = { ...draft, steps: ['Q = cmΔt', 'Q = 4200 · 2 · 30 = 252 000 Дж'], answer: 'Q = 252000' }
    const { calls, fetchImpl } = scriptedProvider({
      draft: noUnit,
      review: { approved: true, issues: [], solution: noUnit },
    })

    await expect(solveHomeworkWithReview(request, { apiKey: 'test-key', fetchImpl }))
      .rejects.toThrow('В ответе нет единицы измерения')
    expect(calls.filter((call) => call.stage === 'review')).toHaveLength(2)
  })
})
