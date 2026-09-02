import { describe, expect, it } from 'vitest'
import { defaultHomeworkModels, solveHomeworkWithReview } from './geometrySolutionEngine.ts'
import type { SolveHomeworkRequest } from '../src/lib/homeworkContract.ts'

/* Два независимых прохода идут разными семействами моделей, а у KIE
   у семейств разные протоколы: Gemini отвечает как OpenAI chat/completions,
   GPT-5.x — как Responses API. Здесь проверяется и развилка протоколов,
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

describe('два независимых прохода', () => {
  it('делает два прохода моделями из разных семейств пула', async () => {
    const { urls, fetchImpl } = stubProvider((url) => (
      url.includes('/codex/') ? responsesPayload(draft) : geminiPayload(draft)
    ))

    const solution = await solveHomeworkWithReview(request, { apiKey: 'test-key', fetchImpl })

    // 2 сентября путь /codex лежал целиком. Второе семейство в пуле — страховка
    // от такого дня: проходы расходятся по разным протоколам шлюза, и отказ
    // одного не уносит решение.
    expect(defaultHomeworkModels).toEqual(['gpt-5-6-luna', 'gemini-3-5-flash-openai'])
    expect(urls).toHaveLength(2)
    expect(urls).toContain('https://api.kie.ai/codex/v1/responses')
    expect(urls).toContain('https://api.kie.ai/gemini-3-5-flash-openai/v1/chat/completions')
    // Оба прохода чистые и сошлись в ответе — рецензент не нужен.
    expect(solution.quality?.reviewPassed).toBe(true)
  })

  it('ходит по протоколу того семейства, которое задано моделью', async () => {
    const { urls, fetchImpl } = stubProvider(() => geminiPayload(draft))

    await solveHomeworkWithReview(request, { apiKey: 'test-key', fetchImpl, model: 'gemini-2.5-flash' })

    // Маршрутизация по семействам остаётся рабочей: как только у шлюза
    // появится второе семейство со строгой схемой, его хватит добавить в пул.
    expect(urls.every((url) => url === 'https://api.kie.ai/gemini-2.5-flash/v1/chat/completions')).toBe(true)
  })

  it('выдаёт решение, когда один проход упал целиком', async () => {
    let draftCalls = 0
    const { urls, fetchImpl } = stubProvider((_url, stage) => {
      if (stage === 'review') return responsesPayload(reviewOf(draft))
      draftCalls += 1
      // Первый проход упирается в отказ шлюза, второй доходит.
      return draftCalls <= 2 ? { code: 524, msg: 'no user can use' } : responsesPayload(draft)
    })

    const solution = await solveHomeworkWithReview(request, { apiKey: 'test-key', fetchImpl })

    expect(solution.answer).toBe('Подлежащее — ветер, сказуемое — гонит.')
    // Упавший проход пробуется дважды — сбой провайдера транзиентный.
    expect(urls.length).toBeGreaterThanOrEqual(3)
  })

  it('уважает модель, заданную через KIE_MODEL, и берёт её на оба прохода', async () => {
    const { urls, fetchImpl } = stubProvider(() => geminiPayload(draft))

    await solveHomeworkWithReview(request, { apiKey: 'test-key', fetchImpl, model: 'gemini-3-pro' })

    expect(urls).toEqual([
      'https://api.kie.ai/gemini-3-pro/v1/chat/completions',
      'https://api.kie.ai/gemini-3-pro/v1/chat/completions',
    ])
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
