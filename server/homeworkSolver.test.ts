import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { createClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { homeworkSolutionEngineVersion } from '../src/lib/homeworkContract.ts'
import type { SolveHomeworkRequest } from '../src/lib/homeworkContract.ts'
import { findVerifiedTextbookTask, normalizeTaskCondition } from '../src/textbooks/taskCatalog.ts'
import { defaultHomeworkModels } from './geometrySolutionEngine.ts'
import { handleHomeworkSolverRequest, proxyAuthDigest, solveWithKie, trustedClientAddress } from './homeworkSolver.ts'

/* Адрес ученика из-за прокси на Supabase. Vercel переписывает
   x-forwarded-for адресом прокси, поэтому настоящий адрес приходит в
   x-client-ip - но только с подписью, иначе его подставит кто угодно. */
describe('адрес ученика через прокси', () => {
  const key = 'service-role-key-for-tests'

  it('верит x-client-ip только с верной подписью', () => {
    expect(trustedClientAddress({ 'x-client-ip': '203.0.113.7', 'x-proxy-auth': proxyAuthDigest(key) }, key)).toBe('203.0.113.7')
    expect(trustedClientAddress({ 'x-client-ip': '203.0.113.7', 'x-proxy-auth': 'forged' }, key)).toBeNull()
    expect(trustedClientAddress({ 'x-client-ip': '203.0.113.7' }, key)).toBeNull()
    expect(trustedClientAddress({ 'x-client-ip': '203.0.113.7', 'x-proxy-auth': proxyAuthDigest(key) }, undefined)).toBeNull()
  })

  it('принимает любую из нескольких подписей прокси', () => {
    const auth = proxyAuthDigest('other-key') + ',' + proxyAuthDigest(key)
    expect(trustedClientAddress({ 'x-client-ip': '198.51.100.2', 'x-proxy-auth': auth }, key)).toBe('198.51.100.2')
  })
})

vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>()
  return { ...actual, createClient: vi.fn(actual.createClient) }
})
const verifiedTask = findVerifiedTextbookTask('geometry', '14-е издание, Просвещение, 2023', '2')
if (!verifiedTask) throw new Error('Verified geometry task #2 is required for solver tests')

/* Книга кошелька в мокнутом клиенте: цепочка select-eq-gte-limit, которой
   решатель считает попытки и неудачи за сутки. */
function walletQuery(entries: { kind: string; idempotency_key: string }[]) {
  const query = {
    select: () => query,
    eq: () => query,
    gte: () => query,
    limit: () => Promise.resolve({ data: entries, error: null }),
  }
  return query
}

const task: SolveHomeworkRequest = {
  textbookId: 'geometry',
  task: '2',
  source: 'number',
  subject: 'Геометрия',
  grade: '8 класс',
  textbookTitle: 'Геометрия. 7-9 классы',
  authors: 'Л. С. Атанасян, В. Ф. Бутузов, С. Б. Кадомцев, Э. Г. Позняк, И. И. Юдина',
  edition: verifiedTask.edition,
  sourceUrl: verifiedTask.sourceUrl,
  sourcePage: verifiedTask.sourcePage,
  condition: verifiedTask.condition,
  imageDataUrl: 'data:image/jpeg;base64,c291cmNl',
  idempotencyKey: 'solution-test-geometry-2',
}

const taskThreeCondition = 'Проведите три прямые так, чтобы каждые две из них пересекались. Обозначьте все точки пересечения этих прямых. Сколько получилось точек? Рассмотрите все возможные случаи.'
const taskThree: SolveHomeworkRequest = {
  ...task,
  task: '3',
  condition: taskThreeCondition,
  sourcePage: 9,
  idempotencyKey: 'solution-test-geometry-3',
}

const photoTask: SolveHomeworkRequest = {
  ...task,
  task: 'photo-example',
  source: 'photo',
  condition: undefined,
  sourcePage: undefined,
  idempotencyKey: 'solution-test-photo-example',
  imageDataUrl: 'data:image/png;base64,cGhvdG8=',
}

const providerSolution = {
  condition: 'В треугольнике ABC ∠A = 40°, ∠B = 50°. Найдите ∠C.',
  given: ['△ABC', '∠A = 40°', '∠B = 50°'],
  goal: { title: 'Найти', text: '∠C.' },
  steps: ['∠A + ∠B + ∠C = 180°.', '∠C = 90°.'],
  answer: '90°.',
  diagram: {
    kind: 'right-triangle',
    description: 'Прямоугольный треугольник ABC.',
    vertices: ['A', 'B', 'C'],
    rightAngleAt: 'C',
  },
  sourceVerified: true,
}

// У KIE два протокола, и движок ходит в оба: Gemini отвечает как OpenAI
// chat/completions, GPT-5.x — как Responses API с блоками output.
function providerBody(content: unknown, url: string) {
  return url.includes('/codex/')
    ? { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(content) }] }] }
    : { choices: [{ message: { content: JSON.stringify(content) } }] }
}

function providerResponse(content: unknown = providerSolution, url = '') {
  return {
    ok: true,
    status: 200,
    json: async () => providerBody(content, url),
  } as Response
}

const emptyDiagramFields = {
  apexAngle: '',
  auxiliaryKind: '',
  auxiliaryLabel: '',
  rightAngleAt: '',
  parallelTo: '',
  exteriorAngle: '',
}

const taskThreeDecisions = {
  taskGoal: 'Показать все варианты числа точек пересечения трёх прямых.',
  diagramRequired: true,
  diagramReason: 'Нужно изобразить два возможных расположения прямых.',
  requiredElements: ['три попарно пересекающиеся прямые', 'три разные точки пересечения', 'одна общая точка'],
  notebookFormat: 'Два чертежа и две короткие символические строки.',
  selfChecks: ['Показаны оба случая.', 'Все прямые попарно пересекаются.', 'Ответ содержит 1 и 3 точки.'],
}

const photoDecisions = {
  taskGoal: 'Найти угол C.',
  diagramRequired: true,
  diagramReason: 'Условие относится к треугольнику ABC.',
  requiredElements: ['△ABC', '∠C = 90°'],
  notebookFormat: 'Краткая формула суммы углов и ответ.',
  selfChecks: ['Условие прочитано с изображения.', 'Сумма углов равна 180°.', 'Ответ содержит единицу измерения угла.'],
}

const taskThreeDraft = {
  condition: taskThreeCondition,
  taskType: 'mixed',
  diagramRequired: true,
  decisions: taskThreeDecisions,
  sourceVerified: true,
  given: ['a, b, c — прямые'],
  goal: { title: 'Найти', text: 'n(точек пересечения)' },
  explanation: [
    'Три прямые на плоскости пересекаются либо попарно, либо все в одной точке.',
    'Значит, разбираем оба случая и считаем точки пересечения в каждом из них.',
  ],
  steps: [
    'a ∩ b = A; b ∩ c = B; a ∩ c = C ⇒ n = 3.',
    'a ∩ b ∩ c = O ⇒ n = 1.',
  ],
  answer: '1 или 3 точки',
  diagram: {
    kind: 'construction',
    description: 'Три попарно пересекающиеся прямые.',
    vertices: ['A', 'B', 'C'],
    ...emptyDiagramFields,
    scene: {
      points: [
        { id: 'A', label: 'A', x: 20, y: 80, visible: true },
        { id: 'B', label: 'B', x: 50, y: 20, visible: true },
        { id: 'C', label: 'C', x: 80, y: 80, visible: true },
      ],
      objects: [
        { kind: 'line', points: ['A', 'B'], label: 'a', auxiliary: false },
        { kind: 'line', points: ['B', 'C'], label: 'b', auxiliary: false },
        { kind: 'line', points: ['C', 'A'], label: 'c', auxiliary: false },
      ],
      marks: [],
      constraints: [{ kind: 'not-collinear', points: ['A', 'B', 'C'] }],
    },
  },
}

const photoDraft = {
  condition: providerSolution.condition,
  taskType: 'calculation',
  diagramRequired: true,
  decisions: photoDecisions,
  sourceVerified: true,
  given: providerSolution.given,
  goal: { title: 'Найти', text: '∠C' },
  explanation: [
    'В треугольнике сумма углов равна 180°, поэтому третий угол находится вычитанием.',
    'Сначала выписываем известные углы, затем вычитаем их сумму из 180 градусов.',
  ],
  steps: providerSolution.steps,
  answer: providerSolution.answer,
  diagram: {
    kind: 'construction',
    description: 'Прямоугольный треугольник ABC.',
    vertices: ['A', 'B', 'C'],
    ...emptyDiagramFields,
    scene: {
      points: [
        { id: 'A', label: 'A', x: 15, y: 85, visible: true },
        { id: 'B', label: 'B', x: 85, y: 15, visible: true },
        { id: 'C', label: 'C', x: 85, y: 85, visible: true },
      ],
      objects: [{ kind: 'polygon', points: ['A', 'B', 'C'], label: '', auxiliary: false }],
      marks: [{ kind: 'right-angle', points: ['A', 'C', 'B'], label: '' }],
      constraints: [{ kind: 'perpendicular', points: ['A', 'C', 'B', 'C'] }],
    },
  },
}

/* Задача словесного предмета.

   У неё ответ — предложение, и два прохода никогда не напишут его
   одинаково. Сверяются они по короткому `answerKey`. */
const russianCondition = 'Разберите по составу слово «подоконник» и укажите способ его образования.'

const russianTask: SolveHomeworkRequest = {
  textbookId: 'russian',
  task: 'Разберите по составу слово «подоконник»',
  source: 'text',
  subject: 'Русский язык',
  grade: '8 класс',
  textbookTitle: 'Любой учебник',
  authors: 'Сфотографируй задачу или впиши условие',
  edition: 'по фото или тексту',
  condition: russianCondition,
  idempotencyKey: 'solution-test-russian-morphology',
}

const russianDraft = {
  condition: russianCondition,
  taskType: 'mixed',
  diagramRequired: false,
  decisions: {
    taskGoal: 'Разобрать слово по составу и назвать способ образования.',
    diagramRequired: false,
    diagramReason: 'Задание относится к разбору слова, чертёж не нужен.',
    requiredElements: ['приставка под-', 'корень -окон-', 'суффикс -ник-', 'способ образования'],
    notebookFormat: 'Разбор по морфемам и строка со способом образования.',
    selfChecks: ['Морфемы выделены.', 'Способ образования назван.', 'Ответ отвечает на вопрос задания.'],
  },
  sourceVerified: true,
  given: ['подоконник'],
  goal: { title: 'Найти', text: 'разбор по составу и способ образования' },
  explanation: [
    'Разбор по составу начинается с поиска корня: подбираем однокоренные слова.',
    'Способ образования виден по тому, что добавили к исходному слову «окно».',
  ],
  steps: ['под-окон-ник-∅.', 'окно → подоконник: приставочно-суффиксальный способ.'],
  answer: 'Слово подоконник образовано приставочно-суффиксальным способом от слова окно.',
  answerKey: 'приставочно-суффиксальный',
  diagram: { kind: 'none', description: '', vertices: [], ...emptyDiagramFields },
  analysis: null,
}

// Движок делает один проход и зовёт модель второй раз только на починку —
// когда проверка кодом нашла нарушение. Ответ починки заглушка всё равно
// готовит: он нужен тем тестам, где черновик заведомо грязный.
function reviewedResponses(draft: unknown) {
  return vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = String(input)
    const body = typeof init?.body === 'string' ? init.body : ''
    const reviewing = body.includes('homework_solution_review')
    return providerResponse(reviewing ? { approved: true, issues: [], solution: draft } : draft, url)
  })
}

// Запрос конкретного семейства среди вызовов заглушки.
function callTo(fetchMock: ReturnType<typeof reviewedResponses>, family: 'codex' | 'gemini') {
  const call = fetchMock.mock.calls.find((entry) => (family === 'codex'
    ? String(entry[0]).includes('/codex/')
    : !String(entry[0]).includes('/codex/')))
  return JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>
}

function createHttp(method: string, body?: unknown) {
  const request = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as IncomingMessage
  request.method = method
  request.headers = {}
  const responseBody: { value?: string } = {}
  const headers = new Map<string, string>()
  const response = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers.set(name, value)
      return this
    },
    end(value?: string) {
      responseBody.value = value
      return this
    },
  } as unknown as ServerResponse

  return {
    request,
    response,
    headers,
    body: () => JSON.parse(responseBody.value ?? '{}') as Record<string, unknown>,
  }
}

describe('homework solver', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the confirmed textbook task without asking a provider to invent it', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const result = await solveWithKie(task, { fetchImpl: fetchMock })
    expect(result).toMatchObject({
      task: '2',
      condition: verifiedTask.condition,
      conditionNormalized: 'отметьте три точки a,b и c,не лежащие на одной прямой,и через каждую пару точек проведите прямую.сколько прямых получилось?',
      answer: '3 прямые',
      diagram: { kind: 'three-point-extended-lines', vertices: ['A', 'B', 'C'] },
      sourceVerified: true,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('solves a database-indexed number from its confirmed condition without web search', async () => {
    const fetchMock = reviewedResponses(taskThreeDraft)
    const http = createHttp('POST', taskThree)
    await handleHomeworkSolverRequest(http.request, http.response, {
      apiKey: 'test-key',
      fetchImpl: fetchMock,
      taskLookup: async () => ({
        condition: taskThreeCondition,
        conditionNormalized: normalizeTaskCondition(taskThreeCondition),
        sourceUrl: verifiedTask.sourceUrl,
        sourcePage: 9,
        hasDiagram: false,
      }),
    })

    expect(http.response.statusCode).toBe(200)
    expect(http.body().solution).toMatchObject({
      task: '3',
      condition: taskThreeCondition,
      answer: '1 или 3 точки',
      diagram: { kind: 'construction', vertices: ['A', 'B', 'C'] },
      verification: {
        author: taskThreeDecisions,
        reviewer: taskThreeDecisions,
        reviewerApproved: true,
        checks: expect.arrayContaining([
          expect.objectContaining({ label: 'Источник', passed: true }),
          expect.objectContaining({ label: 'Проверка правилами', passed: true }),
        ]),
      },
    })
    // Строгая схема нужна обоим семействам, но называется в них по-разному.
    // Проход идёт одной моделью, поэтому каждое семейство адресуется явно —
    // маршрутизация должна остаться рабочей для всего пула.
    const geminiMock = reviewedResponses(taskThreeDraft)
    const geminiHttp = createHttp('POST', taskThree)
    await handleHomeworkSolverRequest(geminiHttp.request, geminiHttp.response, {
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
      fetchImpl: geminiMock,
      taskLookup: async () => ({
        condition: taskThreeCondition,
        conditionNormalized: normalizeTaskCondition(taskThreeCondition),
        sourceUrl: verifiedTask.sourceUrl,
        sourcePage: 9,
        hasDiagram: false,
      }),
    })

    const codexMock = reviewedResponses(taskThreeDraft)
    const codexHttp = createHttp('POST', taskThree)
    await handleHomeworkSolverRequest(codexHttp.request, codexHttp.response, {
      apiKey: 'test-key',
      model: 'gpt-5-6-luna',
      fetchImpl: codexMock,
      taskLookup: async () => ({
        condition: taskThreeCondition,
        conditionNormalized: normalizeTaskCondition(taskThreeCondition),
        sourceUrl: verifiedTask.sourceUrl,
        sourcePage: 9,
        hasDiagram: false,
      }),
    })

    const gemini = callTo(geminiMock, 'gemini') as { tools?: unknown; response_format?: { type: string } }
    const codex = callTo(codexMock, 'codex') as { tools?: unknown; text?: { format?: { type: string } } }
    expect(gemini.tools).toBeUndefined()
    expect(gemini.response_format?.type).toBe('json_schema')
    expect(codex.tools).toBeUndefined()
    expect(codex.text?.format?.type).toBe('json_schema')
  })

  it('requires the indexed source drawing when the task references a figure', async () => {
    const condition = 'На рисунке 43 изображены лучи с общим началом O.'
    const http = createHttp('POST', { ...task, task: '50', condition, sourcePage: 23, imageDataUrl: undefined })
    const fetchMock = vi.fn<typeof fetch>()
    await handleHomeworkSolverRequest(http.request, http.response, {
      apiKey: 'test-key',
      fetchImpl: fetchMock,
      taskLookup: async () => ({
        condition,
        conditionNormalized: normalizeTaskCondition(condition),
        sourceUrl: verifiedTask.sourceUrl,
        sourcePage: 23,
        hasDiagram: true,
      }),
    })

    expect(http.response.statusCode).toBe(400)
    expect(http.body().error).toContain('чертёж в учебнике')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the photo itself to the multimodal provider without an OCR condition', async () => {
    // Оба семейства адресуются явно: проход идёт одной моделью, а кодировка
    // картинки у семейств разная, и сломать её незаметно нельзя.
    const fetchMock = reviewedResponses(photoDraft)
    await solveWithKie(photoTask, { apiKey: 'secret-test-key', model: 'gpt-5-6-luna', fetchImpl: fetchMock })
    const geminiMock = reviewedResponses(photoDraft)
    await solveWithKie(photoTask, { apiKey: 'secret-test-key', model: 'gemini-2.5-flash', fetchImpl: geminiMock })

    const gemini = callTo(geminiMock, 'gemini') as {
      messages: { content: unknown }[]
      response_format?: { type: string }
      tools?: unknown
    }
    const codex = callTo(fetchMock, 'codex') as { input: { content: unknown }[] }
    const geminiParts = gemini.messages[1].content as { type: string; text?: string; image_url?: { url: string } }[]
    expect(geminiParts.at(-1)).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,cGhvdG8=' } })
    // Responses API называет ту же картинку иначе — иначе фото до модели не дойдёт.
    const codexParts = codex.input[0].content as { type: string; text?: string; image_url?: string }[]
    expect(codexParts.at(-1)).toEqual({ type: 'input_image', image_url: 'data:image/png;base64,cGhvdG8=' })

    /* Текстом идут только предмет, класс и правила предмета.

       Условия в промпте нет и быть не должно: по фото источник — сама
       фотография, и подсунутый текст условия увёл бы решение от неё.
       А предмет и класс до этого не доходили вовсе — на фото-пути промпт
       состоял из одной картинки, и правила проверять было нечем. */
    const geminiText = geminiParts.filter((part) => part.type === 'text').map((part) => part.text ?? '').join(' ')
    expect(geminiText).toContain('Предмет: Геометрия')
    expect(geminiText).toContain('Правила предмета')
    expect(geminiText).not.toContain(photoTask.condition ?? 'условие задачи из текста')
    expect(gemini.response_format?.type).toBe('json_schema')
    expect(gemini.tools).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  /* Один проход вместо двух и рецензента.

     Прежде движок делал два независимых прохода, сверял их ответы и на
     расхождении звал третий вызов - рецензента. Замер 4 сентября: геометрия
     2,5 минуты, алгебра не уложилась и в три, а платили мы за три-четыре
     вызова. Теперь проход один, а проверяет решение код: правила предмета
     и разбор записи. */
  it('делает один вызов модели, когда проверка ничего не нашла', async () => {
    const fetchMock = reviewedResponses(photoDraft)

    const solution = await solveWithKie(photoTask, { apiKey: 'secret-test-key', fetchImpl: fetchMock })

    expect(fetchMock.mock.calls).toHaveLength(1)
    expect(solution.answer).toBe(providerSolution.answer)
  })

  /* Нарушенное правило чинится повтором, а не разговором со второй моделью.

     Черновик без единицы измерения при ответе не проходит правило предмета
     `answer-units`. Это механический огрех: модель забыла подпись, а не
     решила не ту задачу, - поэтому даём ровно один адресный повтор. */
  it('чинит нарушенное правило одним повтором', async () => {
    const dirtyDraft = { ...photoDraft, answer: '90' }
    let drafts = 0

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input)
      const body = typeof init?.body === 'string' ? init.body : ''
      if (body.includes('homework_solution_review')) {
        return providerResponse({ approved: true, issues: [], solution: photoDraft }, url)
      }
      drafts += 1
      return providerResponse(dirtyDraft, url)
    })

    const solution = await solveWithKie(photoTask, { apiKey: 'secret-test-key', fetchImpl: fetchMock })

    expect(drafts).toBe(1)
    const repairCalls = fetchMock.mock.calls.filter(([, init]) => String(init?.body).includes('homework_solution_review'))
    expect(repairCalls).toHaveLength(1)
    expect(solution.answer).toBe(providerSolution.answer)
  })

  /* Объяснение обязательно.

     Без него на странице остаётся голая запись для тетради, то есть готовое
     списывание. Продукт продаётся как «сфоткал и понял», и проверка держит
     это обещание: черновик без разбора не проходит и уходит на починку. */
  it('не выпускает решение без объяснения', async () => {
    const withoutExplanation = { ...russianDraft, explanation: [] }
    let drafts = 0

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input)
      const body = typeof init?.body === 'string' ? init.body : ''
      if (body.includes('homework_solution_review')) {
        return providerResponse({ approved: true, issues: [], solution: russianDraft }, url)
      }
      drafts += 1
      return providerResponse(withoutExplanation, url)
    })

    const solution = await solveWithKie(russianTask, { apiKey: 'secret-test-key', fetchImpl: fetchMock })

    expect(drafts).toBe(1)
    expect(solution.explanation?.length).toBeGreaterThanOrEqual(2)
  })

  it('rejects a reviewed answer for a different condition', async () => {
    const unrelated = {
      ...photoDraft,
      condition: 'Вычислите площадь круга радиуса 10 см.',
    }
    await expect(solveWithKie({ ...photoTask, condition: providerSolution.condition }, {
      apiKey: 'secret-test-key',
      fetchImpl: reviewedResponses(unrelated),
    })).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('не совпадает с приложенным заданием'),
    })
  })

  it('does not abort a model stage with an application timeout', async () => {
    const signals: Array<AbortSignal | null | undefined> = []
    // Проход один, починка не нужна: черновик проходит проверку.
    const fetchMock: typeof fetch = async (input, init) => {
      signals.push(init?.signal)
      const body = typeof init?.body === 'string' ? init.body : ''
      const content = body.includes('homework_solution_review')
        ? { approved: true, issues: [], solution: photoDraft }
        : photoDraft
      return new Response(JSON.stringify(providerBody(content, String(input))), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    await solveWithKie(photoTask, { apiKey: 'secret-test-key', fetchImpl: fetchMock })

    expect(signals.every((signal) => signal === undefined)).toBe(true)
  })

  /* 2 сентября шлюз отвечал 500 «Server exception» на весь путь /codex,
     и при пуле из одного семейства проход падал за три секунды. Отсюда
     перебор пула: упавшая модель уводит вызов к следующей, а не роняет
     решение. */
  it('переживает отказ шлюза: лежащая модель не уносит решение', async () => {
    const failing = `https://api.kie.ai/${defaultHomeworkModels[0]}/`
    let failingCalls = 0
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.startsWith(failing)) {
        failingCalls += 1
        return { ok: false, status: 500, json: async () => ({ error: { type: 'server_error' } }) } as Response
      }
      const body = typeof init?.body === 'string' ? init.body : ''
      return providerResponse(body.includes('homework_solution_review')
        ? { approved: true, issues: [], solution: photoDraft }
        : photoDraft, url)
    })

    const solution = await solveWithKie(photoTask, { apiKey: 'secret-test-key', fetchImpl: fetchMock })

    expect(solution.answer).toBe(providerSolution.answer)
    // Отказ шлюза повторять той же моделью бесполезно: проход сразу уходит
    // к следующей модели пула, поэтому вызов к упавшей ровно один.
    expect(failingCalls).toBe(1)
    expect(fetchMock.mock.calls.some(([input]) => !String(input).startsWith(failing))).toBe(true)
  })

  it('отдаёт 503 и понятный текст, когда лежат все семейства', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) } as Response)

    await expect(solveWithKie(photoTask, { apiKey: 'secret-test-key', fetchImpl: fetchMock }))
      .rejects.toMatchObject({ status: 503, message: expect.stringContaining('временно недоступен') })
  })

  it('normalizes provider point identifiers together with every reference', async () => {
    const scene = photoDraft.diagram.scene
    const lowercase = {
      ...photoDraft,
      diagram: {
        ...photoDraft.diagram,
        scene: {
          ...scene,
          /* Копии: scene — общая фикстура, правка на месте протекла бы в соседние тесты. */
          /* eslint-disable no-map-spread */
          points: scene.points.map((point) => ({ ...point, id: point.id.toLocaleLowerCase('ru-RU') })),
          objects: scene.objects.map((object) => ({ ...object, points: object.points.map((id) => id.toLocaleLowerCase('ru-RU')) })),
          marks: scene.marks.map((mark) => ({ ...mark, points: mark.points.map((id) => id.toLocaleLowerCase('ru-RU')) })),
          constraints: scene.constraints.map((constraint) => ({ ...constraint, points: constraint.points.map((id) => id.toLocaleLowerCase('ru-RU')) })),
          /* eslint-enable no-map-spread */
        },
      },
    }
    const result = await solveWithKie(photoTask, {
      apiKey: 'secret-test-key',
      fetchImpl: reviewedResponses(lowercase),
    })
    expect(result.diagram.scene?.points.map((point) => point.id)).toEqual(['A', 'B', 'C'])
    expect(result.diagram.scene?.constraints).toContainEqual({ kind: 'perpendicular', points: ['A', 'C', 'B', 'C'] })
  })

  it('reports unavailable and rejected provider keys without exposing a key', async () => {
    await expect(solveWithKie(photoTask, {})).rejects.toMatchObject({ status: 503, message: expect.stringContaining('KIE_API_KEY') })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({ ok: false, status: 401 } as Response)
    await expect(solveWithKie(photoTask, { apiKey: 'private-value', fetchImpl: fetchMock }))
      .rejects.toMatchObject({ status: 502, message: 'Провайдер отклонил ключ API' })
  })

  it('publishes safe configuration status and CORS only for approved origins', async () => {
    const http = createHttp('GET')
    await handleHomeworkSolverRequest(http.request, http.response, { apiKey: 'private-value' })
    expect(http.response.statusCode).toBe(200)
    expect(http.body()).toEqual({ provider: 'kie.ai', model: 'gemini-3-6-flash-openai', configured: true, engineVersion: homeworkSolutionEngineVersion })
    expect(JSON.stringify(http.body())).not.toContain('private-value')

    const preflight = createHttp('OPTIONS')
    preflight.request.headers.origin = 'https://www.homeworkcopilot.ru'
    await handleHomeworkSolverRequest(preflight.request, preflight.response, { apiKey: 'private-value' })
    expect(preflight.response.statusCode).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://www.homeworkcopilot.ru')

    const untrusted = createHttp('OPTIONS')
    untrusted.request.headers.origin = 'https://untrusted.example'
    await handleHomeworkSolverRequest(untrusted.request, untrusted.response, { apiKey: 'private-value' })
    expect(untrusted.response.statusCode).toBe(403)
  })

  it('rejects malformed or unconfirmed numbered tasks before a provider or payment', async () => {
    const invalid = createHttp('POST', { ...task, task: '10000' })
    await handleHomeworkSolverRequest(invalid.request, invalid.response, { apiKey: 'test-key' })
    expect(invalid.response.statusCode).toBe(400)
    expect(invalid.body().error).toContain('номер задачи или её адрес')

    const unconfirmed = createHttp('POST', { ...task, condition: 'Придуманное условие.' })
    const fetchMock = vi.fn<typeof fetch>()
    await handleHomeworkSolverRequest(unconfirmed.request, unconfirmed.response, { apiKey: 'test-key', fetchImpl: fetchMock })
    expect(unconfirmed.response.statusCode).toBe(422)
    expect(unconfirmed.body().error).toContain('не найдено')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /* Пределы суток. Неудача возвращает деньги ученику, но провайдеру за неё
     уже уплачено, поэтому считаем свои вызовы, а не чужие рубли. */
  it('отказывает, когда за сутки накопилось слишком много неудач', async () => {
    // Восстановление решения спрашивает базу до всякой оплаты: пусто.
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const walletEntries = Array.from({ length: 12 }, (_, index) => ({
      kind: 'credit',
      idempotency_key: `solution-${index}:refund`,
    }))
    vi.mocked(createClient).mockReturnValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
      from: vi.fn().mockReturnValue(walletQuery(walletEntries)),
      rpc,
    } as never)

    const http = createHttp('POST', {
      ...task,
      source: 'text',
      task: 'own-condition',
      condition: 'Ромб ABCD, AC = 10 см, BD = 24 см. Найти AB.',
      idempotencyKey: 'solution-limit-failed',
    })
    http.request.headers.authorization = 'Bearer test-session'
    const fetchMock = vi.fn<typeof fetch>()
    await handleHomeworkSolverRequest(http.request, http.response, {
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'publishable-test-key',
      fetchImpl: fetchMock,
    })

    expect(http.response.statusCode).toBe(429)
    expect(http.body().error).toContain('не решилось')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(rpc.mock.calls.some((call) => call[0] === 'reserve_solution_credit')).toBe(false)
  })

  it('отказывает после шестидесяти решений за сутки', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const walletEntries = Array.from({ length: 60 }, (_, index) => ({
      kind: 'debit',
      idempotency_key: `solution-${index}`,
    }))
    vi.mocked(createClient).mockReturnValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
      from: vi.fn().mockReturnValue(walletQuery(walletEntries)),
      rpc,
    } as never)

    const http = createHttp('POST', {
      ...task,
      source: 'text',
      task: 'own-condition',
      condition: 'Ромб ABCD, AC = 10 см, BD = 24 см. Найти AB.',
      idempotencyKey: 'solution-limit-attempts',
    })
    http.request.headers.authorization = 'Bearer test-session'
    const fetchMock = vi.fn<typeof fetch>()
    await handleHomeworkSolverRequest(http.request, http.response, {
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'publishable-test-key',
      fetchImpl: fetchMock,
    })

    expect(http.response.statusCode).toBe(429)
    expect(http.body().error).toContain('дневной предел')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /* Простыня из сотен примеров - не задача. Раньше она резалась молча, и
     ученик получал разбор обрезанного задания, а мы платили за вызовы. */
  it('не берёт в работу условие длиннее полутора тысяч знаков', async () => {
    const http = createHttp('POST', {
      ...task,
      source: 'text',
      task: 'own-condition',
      condition: Array.from({ length: 200 }, (_, index) => `${index + 1}) 12 · 47 = ?`).join(' '),
      idempotencyKey: 'solution-limit-condition',
    })
    const fetchMock = vi.fn<typeof fetch>()
    await handleHomeworkSolverRequest(http.request, http.response, { apiKey: 'test-key', fetchImpl: fetchMock })

    expect(http.response.statusCode).toBe(400)
    expect(http.body().error).toContain('это уже не одна задача')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('serves task 2 with its exact condition when no provider key is configured', async () => {
    const http = createHttp('POST', task)
    await handleHomeworkSolverRequest(http.request, http.response, {})
    expect(http.response.statusCode).toBe(200)
    expect(http.body().solution).toMatchObject({
      task: '2',
      condition: verifiedTask.condition,
      answer: '3 прямые',
    })
  })

  it('stores a confirmed answer and payment atomically after balance validation', async () => {
    const saved = await solveWithKie(task, {}, 'student-1')
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { reserved: true, balance: 15, price: 5 }, error: null })
      .mockResolvedValueOnce({ data: saved, error: null })
    vi.mocked(createClient).mockReturnValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
      from: vi.fn(),
      rpc,
    } as never)

    const http = createHttp('POST', task)
    http.request.headers.authorization = 'Bearer test-session'
    const fetchMock = vi.fn<typeof fetch>()
    await handleHomeworkSolverRequest(http.request, http.response, {
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'publishable-test-key',
      fetchImpl: fetchMock,
    })

    expect(http.response.statusCode).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(3)
    // Резерв уходит ДО вызова модели, а не после него.
    expect(rpc.mock.calls[1]).toEqual(['reserve_solution_credit', expect.objectContaining({
      p_idempotency_key: task.idempotencyKey,
      p_task_number: 2,
      p_textbook_id: 'geometry',
      p_source: 'number',
    })])
    expect(rpc.mock.calls[0]).toEqual(['complete_homework_solution', expect.objectContaining({
      p_idempotency_key: task.idempotencyKey,
      p_source: 'number',
      p_task: '2',
      p_textbook_id: 'geometry',
      p_edition: verifiedTask.edition,
      p_source_url: verifiedTask.sourceUrl,
      p_condition: verifiedTask.condition,
    })])
    expect(rpc.mock.calls[2][1]).toMatchObject({
      p_idempotency_key: task.idempotencyKey,
      p_solution: { ownerId: 'student-1', answer: '3 прямые' },
    })
  })

  it('returns an existing paid answer without calling the provider again', async () => {
    const saved = await solveWithKie(task, {}, 'student-1')
    const rpc = vi.fn().mockResolvedValue({ data: saved, error: null })
    const from = vi.fn()
    vi.mocked(createClient).mockReturnValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
      from,
      rpc,
    } as never)

    const http = createHttp('POST', task)
    http.request.headers.authorization = 'Bearer test-session'
    await handleHomeworkSolverRequest(http.request, http.response, {
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'publishable-test-key',
    })
    expect(http.response.statusCode).toBe(200)
    expect(http.body().solution).toMatchObject({
      task: '2',
      answer: '3 прямые',
      diagram: { kind: 'three-point-extended-lines', vertices: ['A', 'B', 'C'] },
    })
    expect(rpc).toHaveBeenCalledOnce()
    expect(from).not.toHaveBeenCalled()
  })

  it('refuses to call the model when the reservation cannot be paid', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'insufficient balance' } })
    vi.mocked(createClient).mockReturnValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
      from: vi.fn(),
      rpc,
    } as never)

    const http = createHttp('POST', task)
    http.request.headers.authorization = 'Bearer test-session'
    const fetchMock = vi.fn<typeof fetch>()
    await handleHomeworkSolverRequest(http.request, http.response, {
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'publishable-test-key',
      fetchImpl: fetchMock,
    })
    expect(http.response.statusCode).toBe(402)
    expect(http.body().error).toBe('На балансе меньше 5 ₽')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[1][0]).toBe('reserve_solution_credit')
  })

  it('returns the reservation to the account when the model fails', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { reserved: true, balance: 15, price: 5 }, error: null })
      .mockResolvedValue({ data: { refunded: true, balance: 20 }, error: null })
    vi.mocked(createClient).mockReturnValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
      from: vi.fn(),
      rpc,
    } as never)

    // Провайдер не настроен: solveWithKie падает сразу после резерва.
    const http = createHttp('POST', photoTask)
    http.request.headers.authorization = 'Bearer test-session'
    await handleHomeworkSolverRequest(http.request, http.response, {
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'publishable-test-key',
    })

    expect(http.response.statusCode).toBe(503)
    const refundCall = rpc.mock.calls.find((call) => call[0] === 'refund_solution_credit')
    expect(refundCall).toBeDefined()
    expect(refundCall?.[1]).toMatchObject({ p_idempotency_key: photoTask.idempotencyKey })
  })

  it('returns an actionable 503 for a photo when the provider is not configured', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const http = createHttp('POST', photoTask)
    await handleHomeworkSolverRequest(http.request, http.response, {})
    expect(http.response.statusCode).toBe(503)
    expect(http.body().error).toContain('KIE_API_KEY')

    const event = errorLog.mock.calls
      .map(([entry]) => JSON.parse(String(entry)) as Record<string, unknown>)
      .find((entry) => entry.event === 'homework_solve_failed')
    expect(event).toMatchObject({
      task: photoTask.task,
      source: 'photo',
      stage: 'generate',
      status: 503,
    })
    expect(JSON.stringify(event)).not.toContain(photoTask.condition)
    errorLog.mockRestore()
  })

  // Потолок функции на Vercel — 300 секунд. Если решение перевалит за него,
  // процесс умирает вместе с возвратом резерва: у ученика списано, решения
  // нет и денег нет. Собственный срок обязан сработать раньше и ответить,
  // пока функция жива.
  it('сдаётся по своему сроку раньше потолка функции, а не зависает', async () => {
    vi.useFakeTimers()
    try {
      const http = createHttp('POST', photoTask)
      // Провайдер, который не отвечает никогда.
      const solving = handleHomeworkSolverRequest(http.request, http.response, {
        apiKey: 'secret-test-key',
        fetchImpl: (() => new Promise(() => {})) as unknown as typeof fetch,
      })

      await vi.advanceTimersByTimeAsync(240_000)
      await solving

      expect(http.response.statusCode).toBe(504)
      expect(http.body().error).toContain('Деньги вернулись на баланс')
    } finally {
      vi.useRealTimers()
    }
  })

})
