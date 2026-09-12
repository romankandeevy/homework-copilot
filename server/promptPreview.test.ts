import { describe, expect, it } from 'vitest'
import type { HomeworkSolution } from '../src/lib/homeworkContract.ts'
import type { HomeworkModelCall } from './geometrySolutionEngine.ts'
import {
  parsePromptPreviewInput,
  promptPreviewRequest,
  PromptPreviewError,
  runPromptPreview,
  summarizePreviewSolution,
} from './promptPreview.ts'
import type { PromptPreviewSolve } from './promptPreview.ts'

const validBody = {
  subjectId: 'algebra',
  grade: '8 класс',
  prompt: '  Пиши коротко и без лишних слов.  ',
  condition: 'Решите уравнение 2x + 3 = 11 и сделайте проверку.',
}

function solution(overrides: Partial<HomeworkSolution> = {}): HomeworkSolution {
  return {
    textbookId: 'algebra',
    task: 'Решите уравнение',
    source: 'text',
    textbookEdition: 'по фото или тексту',
    sourceUrl: '',
    conditionNormalized: 'решите уравнение',
    subject: 'Алгебра',
    textbookTitle: 'Любой учебник',
    condition: validBody.condition,
    given: ['2x + 3 = 11'],
    goal: { title: 'Найти', text: 'x' },
    explanation: ['Переносим 3 вправо и делим на 2.'],
    steps: ['2x = 8', 'x = 4'],
    answer: 'x = 4',
    diagram: { kind: 'none' } as HomeworkSolution['diagram'],
    quality: { diagramRequired: false, reviewPassed: true, symbolicShare: 1 },
    createdAt: '2026-09-12T10:00:00Z',
    ...overrides,
  } as HomeworkSolution
}

function call(credits: number | null, model = 'gemini-3-6-flash-openai'): HomeworkModelCall {
  return { model, credits, seconds: 12, purpose: 'draft', failed: false }
}

describe('проверка промпта: разбор запроса', () => {
  it('принимает предмет, класс, промпт и пример задачи и обрезает пробелы', () => {
    const input = parsePromptPreviewInput({ ...validBody, compare: true })
    expect(input).toEqual({
      subjectId: 'algebra',
      subjectName: 'Алгебра',
      grade: '8 класс',
      prompt: 'Пиши коротко и без лишних слов.',
      condition: validBody.condition,
      compare: true,
    })
  })

  it('сравнение включается только явным true', () => {
    expect(parsePromptPreviewInput({ ...validBody, compare: 'yes' }).compare).toBe(false)
  })

  it('отказывает в незнакомом предмете, классе, пустом промпте и короткой задаче', () => {
    const cases: Record<string, unknown>[] = [
      { ...validBody, subjectId: 'astrology' },
      { ...validBody, grade: '4 класс' },
      { ...validBody, prompt: '   ' },
      { ...validBody, prompt: 'x'.repeat(8001) },
      { ...validBody, condition: 'коротко' },
      { ...validBody, condition: 'x'.repeat(1501) },
    ]
    for (const body of cases) {
      expect(() => parsePromptPreviewInput(body)).toThrow(PromptPreviewError)
    }
  })
})

describe('проверка промпта: запрос к решателю', () => {
  it('идёт тем же путём, что задача ученика текстом', () => {
    const request = promptPreviewRequest(parsePromptPreviewInput(validBody), 'preview-1', 'current')
    expect(request).toMatchObject({
      source: 'text',
      textbookId: 'algebra',
      subject: 'Алгебра',
      grade: '8 класс',
      textbookTitle: 'Любой учебник',
      authors: 'Сфотографируй задачу или впиши условие',
      edition: 'по фото или тексту',
      condition: validBody.condition,
      idempotencyKey: 'admin-preview:preview-1:current',
    })
    expect(request.imageDataUrl).toBeUndefined()
  })
})

describe('проверка промпта: прогон', () => {
  it('без сравнения один прогон с новым текстом', async () => {
    const seen: (string | null)[] = []
    const solve: PromptPreviewSolve = async (_request, instructions, onCost) => {
      seen.push(instructions)
      onCost(call(0.4))
      onCost(call(0.25))
      return solution()
    }
    const outcome = await runPromptPreview({
      input: parsePromptPreviewInput(validBody),
      previewId: 'preview-1',
      currentPrompt: 'Старый текст',
      currentVersion: 3,
      solve,
    })
    expect(seen).toEqual(['Пиши коротко и без лишних слов.'])
    expect(outcome.runs).toHaveLength(1)
    expect(outcome.runs[0]).toMatchObject({ variant: 'draft', ok: true, calls: 2, credits: 0.65, kopecks: 28, models: 'gemini-3-6-flash-openai×2' })
    expect(outcome.runs[0].solution?.answer).toBe('x = 4')
    expect(outcome.credits).toBe(0.65)
  })

  it('сравнение гонит текущий промпт вторым прогоном, а без промпта - правила из кода', async () => {
    const seen: (string | null)[] = []
    const solve: PromptPreviewSolve = async (_request, instructions, onCost) => {
      seen.push(instructions)
      onCost(call(null))
      return solution()
    }
    const outcome = await runPromptPreview({
      input: parsePromptPreviewInput({ ...validBody, compare: true }),
      previewId: 'preview-2',
      currentPrompt: null,
      currentVersion: null,
      solve,
    })
    expect(seen).toEqual(['Пиши коротко и без лишних слов.', null])
    expect(outcome.runs.map((run) => [run.variant, run.hadPrompt])).toEqual([['draft', true], ['current', false]])
    // Шлюз не сообщил расход - в итоге пусто, а не ноль.
    expect(outcome.credits).toBeNull()
  })

  it('неудача одного прогона не отменяет другой и объясняется по-русски', async () => {
    const solve: PromptPreviewSolve = async (_request, instructions, onCost) => {
      onCost(call(1))
      if (instructions === 'Старый текст') throw new Error('fetch failed')
      return solution({ verification: { authorIssues: ['Нет проверки'], reviewerIssues: ['Нет проверки', 'Ответ без единиц'] } as HomeworkSolution['verification'] })
    }
    const outcome = await runPromptPreview({
      input: parsePromptPreviewInput({ ...validBody, compare: true }),
      previewId: 'preview-3',
      currentPrompt: 'Старый текст',
      currentVersion: 2,
      solve,
    })
    const [draft, current] = outcome.runs
    expect(draft.ok).toBe(true)
    expect(draft.solution?.issues).toEqual(['Нет проверки', 'Ответ без единиц'])
    expect(current).toMatchObject({ ok: false, promptVersion: 2, error: 'Прогон упал: fetch failed', credits: 1 })
    expect(outcome.credits).toBe(2)
  })

  it('модель, не уложившаяся в срок, - неудача с понятной причиной', async () => {
    const solve: PromptPreviewSolve = () => new Promise(() => {})
    const outcome = await runPromptPreview({
      input: parsePromptPreviewInput(validBody),
      previewId: 'preview-4',
      currentPrompt: null,
      currentVersion: null,
      solve,
      deadlineMs: 20,
    })
    expect(outcome.runs[0].ok).toBe(false)
    expect(outcome.runs[0].error).toContain('не уложилась')
  })
})

describe('проверка промпта: сводка решения', () => {
  it('берёт разбор, запись, ответ и признак чертежа', () => {
    const summary = summarizePreviewSolution(solution({ diagram: { kind: 'scene' } as unknown as HomeworkSolution['diagram'] }))
    expect(summary).toMatchObject({
      explanation: ['Переносим 3 вправо и делим на 2.'],
      steps: ['2x = 8', 'x = 4'],
      answer: 'x = 4',
      form: 'notebook',
      reviewPassed: true,
      hasDiagram: true,
      code: null,
    })
  })
})
