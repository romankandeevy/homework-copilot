import { describe, expect, it } from 'vitest'
import { defaultHomeworkModels, solveHomeworkWithReview } from './geometrySolutionEngine.ts'
import type { SolveHomeworkRequest } from '../src/lib/homeworkContract.ts'

/* Проход один, но семейств моделей у шлюза по-прежнему два, и протоколы у
   них разные: Gemini отвечает как OpenAI chat/completions, GPT-5.x — как
   Responses API. Здесь проверяется и развилка протоколов на перебор пула,
   и то, что размеченный разбор доезжает до решения очищенным. */

const request: SolveHomeworkRequest = {
  textbookId: 'russian',
  task: '12',
  source: 'text',
  subject: 'Русский язык',
  grade: '7',
  textbookTitle: 'Русский язык. 7 класс',
  authors: 'Баранов',
  edition: 'издание для проверки',
  condition: 'Разберите предложение по членам: Ветер гонит сухие листья по дороге.',
  idempotencyKey: 'test-analysis',
}

const draft = {
  condition: 'Разберите предложение по членам: Ветер гонит сухие листья по дороге.',
  taskType: 'mixed',
  diagramRequired: false,
  decisions: {
    taskGoal: 'Подчеркнуть члены предложения',
    diagramRequired: false,
    diagramReason: 'Задание по русскому языку, чертёж не нужен',
    requiredElements: ['подлежащее', 'сказуемое'],
    notebookFormat: 'Предложение с подчёркиванием членов',
    selfChecks: ['Подлежащее найдено', 'Сказуемое найдено', 'Второстепенные члены подчёркнуты'],
  },
  sourceVerified: true,
  given: ['Ветер гонит сухие листья по дороге.'],
  goal: { title: 'Найти', text: 'члены предложения' },
  explanation: [
    'В предложении сначала находят грамматическую основу: кто действует и что делает.',
    'Остальные слова разбирают по вопросам от основы — так определяются второстепенные члены.',
  ],
  steps: ['Ветер — подлежащее, гонит — сказуемое.', 'Листья — дополнение, сухие — определение.'],
  answer: 'Подлежащее — ветер, сказуемое — гонит.',
  diagram: {
    kind: 'none',
    description: '',
    vertices: [],
    apexAngle: '',
    auxiliaryKind: '',
    auxiliaryLabel: '',
    rightAngleAt: '',
    parallelTo: '',
    exteriorAngle: '',
    scene: { points: [], objects: [], marks: [], constraints: [] },
  },
  analysis: {
    kind: 'sentence-parse',
    title: '',
    blocks: [{
      title: 'Разбор',
      lines: [{
        kind: 'sentence',
        lead: '',
        caption: '',
        tokens: [
          { text: 'Ветер', mark: 'single', label: '', note: 'подлежащее', tight: false },
          // Модель всё-таки подчеркнула символами — вёрстка рисует значок сама.
          { text: '_гонит_', mark: 'double', label: 'глагол', note: 'сказуемое', tight: false },
          { text: 'сухие', mark: 'wavy', label: '', note: 'определение', tight: false },
          // Пустой токен и значок вне школьного стандарта — обычный мусор.
          { text: '   ', mark: 'dashed', label: '', note: 'дополнение', tight: false },
          { text: 'листья', mark: 'звёздочка', label: '', note: '', tight: false },
        ],
      }],
    }],
  },
}

const geminiPayload = (body: unknown) => ({
  choices: [{ message: { content: JSON.stringify(body) } }],
  credits_consumed: 0.01,
})

const responsesPayload = (body: unknown) => ({
  output: [
    { type: 'reasoning', summary: [] },
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(body) }] },
  ],
  credits_consumed: 0.01,
})

// Рецензент ходит по тому же адресу, что и автор, и отличается только схемой
// ответа — поэтому заглушка смотрит в тело запроса, а не только в адрес.
type Stage = 'draft' | 'review'

function stageOf(init: RequestInit | undefined): Stage {
  const body = typeof init?.body === 'string' ? init.body : ''
  return body.includes('homework_solution_review') ? 'review' : 'draft'
}

// Ответ рецензента — тот же черновик в конверте проверки.
const reviewOf = (body: Record<string, unknown>) => ({ approved: true, issues: [], solution: body })

function stubProvider(handler: (url: string, stage: Stage) => unknown) {
  const urls: string[] = []
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    urls.push(url)
    return new Response(JSON.stringify(handler(url, stageOf(init))), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { urls, fetchImpl }
}

describe('один проход умной моделью', () => {
  it('делает ровно один вызов модели и берёт первую модель пула', async () => {
    const { urls, fetchImpl } = stubProvider((url) => (
      url.includes('/codex/') ? responsesPayload(draft) : geminiPayload(draft)
    ))

    const solution = await solveHomeworkWithReview(request, { apiKey: 'test-key', fetchImpl })

    // Пул отсортирован от умной модели к запасной, и проход берёт первую.
    // Прежде проходов было два, а на расхождении звался ещё и рецензент:
    // три-четыре вызова на задачу и 2,5 минуты ожидания.
    expect(defaultHomeworkModels[0]).toBe('gemini-3-6-flash-openai')
    expect(urls).toEqual(['https://api.kie.ai/gemini-3-6-flash-openai/v1/chat/completions'])
    // Проверка прошла кодом — второй модели «на всякий случай» не зовём.
    expect(solution.quality?.reviewPassed).toBe(true)
  })

  it('ходит по протоколу того семейства, которое задано моделью', async () => {
    const { urls, fetchImpl } = stubProvider(() => geminiPayload(draft))

    await solveHomeworkWithReview(request, { apiKey: 'test-key', fetchImpl, model: 'gemini-2.5-flash' })

    // Маршрутизация по семействам остаётся рабочей: пул перебирается по ней
    // же, когда шлюз отвечает отказом.
    expect(urls.every((url) => url === 'https://api.kie.ai/gemini-2.5-flash/v1/chat/completions')).toBe(true)
  })

  it('выдаёт решение, когда семейство модели лежит целиком', async () => {
    let draftCalls = 0
    // Форма ответа зависит от семейства: перебор уводит вызов на другой
    // протокол, и заглушка обязана отвечать по адресу, а не одинаково.
    const payloadFor = (url: string, body: unknown) => (
      url.includes('/codex/') ? responsesPayload(body) : geminiPayload(body)
    )
    const { urls, fetchImpl } = stubProvider((url, stage) => {
      if (stage === 'review') return payloadFor(url, reviewOf(draft))
      draftCalls += 1
      // Первые вызовы упираются в отказ шлюза, следующая модель доходит.
      return draftCalls <= 2 ? { code: 524, msg: 'no user can use' } : payloadFor(url, draft)
    })

    const solution = await solveHomeworkWithReview(request, { apiKey: 'test-key', fetchImpl })

    expect(solution.answer).toBe('Подлежащее — ветер, сказуемое — гонит.')
    // Упавшая модель уводит вызов дальше по пулу, а не роняет решение.
    expect(urls.length).toBeGreaterThanOrEqual(3)
  })

  it('уважает модель, заданную через KIE_MODEL', async () => {
    const { urls, fetchImpl } = stubProvider(() => geminiPayload(draft))

    await solveHomeworkWithReview(request, { apiKey: 'test-key', fetchImpl, model: 'gemini-3-pro' })

    expect(urls).toEqual(['https://api.kie.ai/gemini-3-pro/v1/chat/completions'])
  })
})

describe('размеченный разбор', () => {
  it('доезжает до решения очищенным от мусора', async () => {
    const { fetchImpl } = stubProvider((url) => (url.includes('/codex/')
      ? responsesPayload(draft)
      : geminiPayload(draft)))

    const solution = await solveHomeworkWithReview(request, { apiKey: 'test-key', fetchImpl })
    const tokens = solution.analysis?.blocks[0].lines[0].tokens ?? []

    expect(solution.analysis?.kind).toBe('sentence-parse')
    expect(tokens.map((token) => token.text)).toEqual(['Ветер', 'гонит', 'сухие', 'листья'])
    expect(tokens[0].mark).toBe('single')
    expect(tokens[1].mark).toBe('double')
    expect(tokens[1].label).toBe('глагол')
    // Значка вне школьного стандарта не существует: токен остаётся без него.
    expect(tokens[3].mark).toBeUndefined()
    expect(tokens[3].note).toBeUndefined()
  })

  it('не создаёт пустой раздел, когда разбора нет', async () => {
    const withoutAnalysis = { ...draft, analysis: { kind: 'none', title: '', blocks: [] } }
    const { fetchImpl } = stubProvider((url) => (url.includes('/codex/')
      ? responsesPayload(withoutAnalysis)
      : geminiPayload(withoutAnalysis)))

    const solution = await solveHomeworkWithReview(request, { apiKey: 'test-key', fetchImpl })

    expect(solution.analysis).toBeUndefined()
    expect(solution.steps.length).toBeGreaterThan(0)
  })
})
