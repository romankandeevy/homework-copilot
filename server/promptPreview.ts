/* Проверка промпта решателя без сохранения.

   Владелец пишет новый текст промпта для предмета и хочет увидеть, как с
   ним поведёт себя модель, до того как текст уйдёт ученикам. Прогон идёт
   тем же движком, что и решение ученика (`solveWithKie`), но мимо всего,
   что делает решение продажей:

   - кошелёк не трогается: ни резерва, ни списания, ни возврата;
   - очередь ученика и каталог решений прогона не видят: `solveWithKie` для
     условия текстом в базу не пишет, а `complete_homework_solution` здесь
     не зовётся;
   - себестоимость в `solution_costs` не пишется: там живёт расход на
     решения учеников, и проверки исказили бы его. Кредиты прогона лежат в
     строке проверки (`private.admin_prompt_previews`).

   Роль, второй фактор, предел частоты и журнал проверяет база
   (`admin_prompt_preview_start`). Здесь только сам прогон. */

import type { HomeworkSolution, SolveHomeworkRequest } from '../src/lib/homeworkContract.ts'
import { homeworkSolutionForm, maxConditionLength } from '../src/lib/homeworkContract.ts'
import { kieCreditKopecks } from '../src/lib/solutionPricing.ts'
import { findSubjectById, solvableGrades } from '../src/lib/subjects.ts'
import type { HomeworkModelCall } from './geometrySolutionEngine.ts'

/* Тот же срок, что у решения ученика (solveTimeBudgetMs в homeworkSolver.ts):
   модель, которая не уложилась здесь, не уложится и у ученика. */
export const promptPreviewDeadlineMs = 230_000

export const promptPreviewMaxPrompt = 8000

/* Так приложение подписывает задачу, поставленную текстом (список textbooks
   в App.tsx). Эти строки попадают в сообщение модели, и проверка должна
   видеть тот же запрос, что и ученик. */
export const promptPreviewTextbook = {
  textbookTitle: 'Любой учебник',
  authors: 'Сфотографируй задачу или впиши условие',
  edition: 'по фото или тексту',
} as const

export class PromptPreviewError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type PromptPreviewInput = {
  subjectId: string
  subjectName: string
  grade: string
  prompt: string
  condition: string
  /* Второй прогон с текущим промптом предмета - для сравнения «было/стало». */
  compare: boolean
}

export function parsePromptPreviewInput(body: Record<string, unknown>): PromptPreviewInput {
  const subject = typeof body.subjectId === 'string' ? findSubjectById(body.subjectId.trim()) : null
  if (!subject) throw new PromptPreviewError(400, 'Выбери предмет из списка.')
  const grade = typeof body.grade === 'string' ? body.grade.trim() : ''
  if (!(solvableGrades as readonly string[]).includes(grade)) throw new PromptPreviewError(400, 'Выбери класс из списка.')
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (prompt.length < 1 || prompt.length > promptPreviewMaxPrompt) {
    throw new PromptPreviewError(400, `Промпт - от 1 до ${promptPreviewMaxPrompt} символов.`)
  }
  const condition = typeof body.condition === 'string' ? body.condition.trim() : ''
  if (condition.length < 15 || condition.length > maxConditionLength) {
    throw new PromptPreviewError(400, `Пример задачи - от 15 до ${maxConditionLength} символов.`)
  }
  return { subjectId: subject.id, subjectName: subject.name, grade, prompt, condition, compare: body.compare === true }
}

export type PromptPreviewVariant = 'draft' | 'current'

export function promptPreviewRequest(input: PromptPreviewInput, previewId: string, variant: PromptPreviewVariant): SolveHomeworkRequest {
  return {
    textbookId: input.subjectId,
    task: input.condition.slice(0, 60).trim(),
    source: 'text',
    subject: input.subjectName,
    grade: input.grade,
    ...promptPreviewTextbook,
    condition: input.condition,
    idempotencyKey: `admin-preview:${previewId}:${variant}`,
  }
}

export type PromptPreviewSolution = {
  condition: string
  given: string[]
  goal: { title: string; text: string }
  explanation: string[]
  steps: string[]
  answer: string
  code: { language: string; text: string } | null
  form: 'notebook' | 'essay'
  reviewPassed: boolean
  /* Замечания проверки кодом: правила предмета, счёт, класс. */
  issues: string[]
  hasDiagram: boolean
}

export type PromptPreviewRun = {
  variant: PromptPreviewVariant
  /* Версия текущего промпта; null - у предмета промпта нет или это новый текст. */
  promptVersion: number | null
  hadPrompt: boolean
  ok: boolean
  error: string | null
  seconds: number
  calls: number
  /* Кредиты шлюза. null - шлюз не сообщил расход, выдумывать ноль нельзя. */
  credits: number | null
  kopecks: number | null
  models: string
  solution: PromptPreviewSolution | null
}

export type PromptPreviewOutcome = {
  runs: PromptPreviewRun[]
  credits: number | null
  kopecks: number | null
  seconds: number
}

export type PromptPreviewSolve = (
  request: SolveHomeworkRequest,
  instructions: string | null,
  onCost: (call: HomeworkModelCall) => void,
) => Promise<HomeworkSolution>

export function summarizePreviewSolution(solution: HomeworkSolution): PromptPreviewSolution {
  const verification = solution.verification
  const issues = [...new Set([...(verification?.authorIssues ?? []), ...(verification?.reviewerIssues ?? [])])]
  return {
    condition: solution.condition,
    given: solution.given.slice(0, 40),
    goal: { title: solution.goal.title, text: solution.goal.text },
    explanation: (solution.explanation ?? []).slice(0, 40),
    steps: solution.steps.slice(0, 60),
    answer: solution.answer,
    code: solution.code ? { language: solution.code.language, text: solution.code.text.slice(0, 8000) } : null,
    form: homeworkSolutionForm(solution.subject, solution.taskType ?? 'mixed'),
    reviewPassed: solution.quality?.reviewPassed === true,
    issues: issues.slice(0, 20),
    hasDiagram: Boolean(solution.diagram && solution.diagram.kind !== 'none'),
  }
}

function sumCredits(values: readonly (number | null)[]) {
  const known = values.filter((value): value is number => value !== null)
  return known.length > 0 ? Number(known.reduce((total, value) => total + value, 0).toFixed(4)) : null
}

function toKopecks(credits: number | null) {
  return credits === null ? null : Math.round(credits * kieCreditKopecks)
}

function modelsLine(calls: readonly HomeworkModelCall[]) {
  const perModel = new Map<string, number>()
  for (const call of calls) perModel.set(call.model, (perModel.get(call.model) ?? 0) + 1)
  return [...perModel].map(([model, count]) => (count > 1 ? `${model}×${count}` : model)).join(',')
}

function failureText(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (/[а-яё]/iu.test(message)) return message.slice(0, 400)
  return message ? `Прогон упал: ${message.slice(0, 300)}` : 'Прогон упал без объяснения.'
}

async function runVariant(params: {
  input: PromptPreviewInput
  previewId: string
  variant: PromptPreviewVariant
  instructions: string | null
  promptVersion: number | null
  solve: PromptPreviewSolve
  deadlineMs: number
  now: () => number
}): Promise<PromptPreviewRun> {
  const calls: HomeworkModelCall[] = []
  const startedAt = params.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new PromptPreviewError(504, `Модель не уложилась в ${Math.round(params.deadlineMs / 1000)} секунд - тот же срок у решения ученика.`))
    }, params.deadlineMs)
    // Таймер не должен держать процесс, если прогон кончился раньше.
    if (typeof timer === 'object' && timer && 'unref' in timer) timer.unref()
  })
  const request = promptPreviewRequest(params.input, params.previewId, params.variant)
  const finish = (solution: HomeworkSolution | null, error: unknown): PromptPreviewRun => {
    const credits = sumCredits(calls.map((call) => call.credits))
    return {
      variant: params.variant,
      promptVersion: params.promptVersion,
      hadPrompt: Boolean(params.instructions),
      ok: solution !== null,
      error: solution ? null : failureText(error),
      seconds: Number(((params.now() - startedAt) / 1000).toFixed(1)),
      calls: calls.length,
      credits,
      kopecks: toKopecks(credits),
      models: modelsLine(calls),
      solution: solution ? summarizePreviewSolution(solution) : null,
    }
  }
  try {
    const solution = await Promise.race([
      params.solve(request, params.instructions, (call) => calls.push(call)),
      deadline,
    ])
    return finish(solution, null)
  } catch (error) {
    return finish(null, error)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/* Новый текст - всегда; текущий промпт предмета - вторым прогоном, если
   попросили сравнение. Прогоны идут одновременно: срок у них общий, а ждать
   их по очереди значит удвоить ожидание. Неудача одного не отменяет другой. */
export async function runPromptPreview(params: {
  input: PromptPreviewInput
  previewId: string
  currentPrompt: string | null
  currentVersion: number | null
  solve: PromptPreviewSolve
  deadlineMs?: number
  now?: () => number
}): Promise<PromptPreviewOutcome> {
  const deadlineMs = params.deadlineMs ?? promptPreviewDeadlineMs
  const now = params.now ?? Date.now
  const variants: { variant: PromptPreviewVariant; instructions: string | null; promptVersion: number | null }[] = [
    { variant: 'draft', instructions: params.input.prompt, promptVersion: null },
  ]
  if (params.input.compare) {
    variants.push({ variant: 'current', instructions: params.currentPrompt?.trim() || null, promptVersion: params.currentVersion })
  }
  const runs = await Promise.all(variants.map((variant) => runVariant({
    input: params.input,
    previewId: params.previewId,
    variant: variant.variant,
    instructions: variant.instructions,
    promptVersion: variant.promptVersion,
    solve: params.solve,
    deadlineMs,
    now,
  })))
  const credits = sumCredits(runs.map((run) => run.credits))
  return {
    runs,
    credits,
    kopecks: toKopecks(credits),
    seconds: Math.max(0, ...runs.map((run) => run.seconds)),
  }
}
