import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import type { HomeworkSource } from './homeworkContract'

/* Очередь решений.

   Задача живёт не во вкладке, а строкой в базе: клиент её заводит, решатель
   двигает по стадиям, любое устройство читает. Отсюда сразу три вещи, которых
   раньше не было, — перезаход не теряет работу, задач можно поставить
   несколько, и на телефоне видно то, что запущено с ноутбука. */

export type SolutionJobStage = 'queued' | 'reading' | 'solving' | 'checking' | 'writing' | 'done' | 'failed'
export type SolutionJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled'

export type SolutionJob = {
  id: string
  idempotencyKey: string
  deviceId: string
  textbookId: string
  task: string
  source: HomeworkSource
  subject: string
  grade: string
  conditionPreview: string
  status: SolutionJobStatus
  stage: SolutionJobStage
  error: string
  createdAt: string
  updatedAt: string
  startedAt: string
  finishedAt: string
}

export type StartJobInput = {
  idempotencyKey: string
  textbookId: string
  task: string
  source: HomeworkSource
  subject?: string
  grade?: string
  conditionPreview?: string
}

/* Стадии — то, что решатель действительно сообщает о себе, а не бегунок,
   изображающий занятость. `reading` ставится, когда запрос принят и оплата
   зарезервирована; `solving` — когда запущены проходы модели; `checking` —
   когда проходы сошлись или позван рецензент; `writing` — когда решение
   получено и сохраняется. */
export const solutionStages = [
  { id: 'reading', title: 'Читаем', note: 'Разбираем, что дано и что найти' },
  { id: 'solving', title: 'Решаем', note: 'Два независимых прохода одновременно' },
  { id: 'checking', title: 'Проверяем', note: 'Сверяем ответы проходов между собой' },
  { id: 'writing', title: 'Оформляем', note: 'Переносим решение на тетрадную страницу' },
] as const

export type SolutionStageId = (typeof solutionStages)[number]['id']

const stageOrder: readonly SolutionJobStage[] = ['queued', 'reading', 'solving', 'checking', 'writing', 'done']

export function stageIndex(stage: SolutionJobStage) {
  const index = stageOrder.indexOf(stage)
  return index < 0 ? 0 : index
}

/** Пройденные шаги — те, что строго до текущего. Текущий идёт отдельно. */
export function stageState(stage: SolutionJobStage, candidate: SolutionStageId): 'done' | 'current' | 'waiting' {
  if (stage === 'done') return 'done'
  const current = stageIndex(stage)
  const target = stageIndex(candidate)
  if (current > target) return 'done'
  return current === target ? 'current' : 'waiting'
}

export function isActiveJob(job: SolutionJob) {
  return job.status === 'queued' || job.status === 'running'
}

export function isFinishedJob(job: SolutionJob) {
  return !isActiveJob(job)
}

/* Что показывать, пока опрос базы не догнал события этой вкладки.

   О своих событиях вкладка узнаёт первой: запрос ушёл — задача в работе,
   запрос упал — задача сорвалась, и всё это раньше, чем ответит опрос.
   Держать в такие моменты прежнее состояние значит врать в лицо. Но дальше
   собственного шага вкладка не знает ничего: стадию внутри решения сообщает
   только сам решатель. Отсюда правило — вперёд пропускаем того, кто дальше
   продвинулся, а закрытую задачу база уже никому не отдаёт. */
const statusRank: Record<SolutionJobStatus, number> = {
  queued: 0,
  running: 1,
  done: 2,
  failed: 2,
  canceled: 2,
}

export function mergeJobs(remote: readonly SolutionJob[], local: readonly SolutionJob[]): SolutionJob[] {
  const byKey = new Map(remote.map((job) => [job.idempotencyKey, job]))

  for (const job of local) {
    const known = byKey.get(job.idempotencyKey)
    if (!known) {
      byKey.set(job.idempotencyKey, job)
      continue
    }
    if (isFinishedJob(known)) continue
    if (statusRank[job.status] <= statusRank[known.status]) continue

    byKey.set(job.idempotencyKey, {
      ...known,
      status: job.status,
      stage: job.stage,
      error: job.error,
      startedAt: known.startedAt || job.startedAt,
      finishedAt: job.finishedAt || known.finishedAt,
    })
  }

  return [...byKey.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

const deviceStorageKey = 'homework-copilot:device-id'

/** Метка вкладки. По ней видно, чья задача выполняется прямо здесь, а чья —
    на другом устройстве, где мы не можем ни ускорить её, ни перезапустить. */
export function getDeviceId() {
  try {
    const stored = window.localStorage.getItem(deviceStorageKey)
    if (stored) return stored
    const created = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`
    window.localStorage.setItem(deviceStorageKey, created)
    return created
  } catch {
    // Без хранилища метка живёт до перезагрузки: очередь работает, но задача
    // после перезахода будет считаться чужой и просто показываться.
    return 'session'
  }
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

export function parseSolutionJob(value: unknown): SolutionJob | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const id = text(row.id)
  const idempotencyKey = text(row.idempotency_key)
  if (!id || !idempotencyKey) return null

  const source = row.source === 'photo' ? 'photo' : row.source === 'number' ? 'number' : 'text'
  const status = ['queued', 'running', 'done', 'failed', 'canceled'].includes(text(row.status))
    ? text(row.status) as SolutionJobStatus
    : 'queued'
  const stage = stageOrder.includes(text(row.stage) as SolutionJobStage) || text(row.stage) === 'failed'
    ? text(row.stage) as SolutionJobStage
    : 'queued'

  return {
    id,
    idempotencyKey,
    deviceId: text(row.device_id),
    textbookId: text(row.textbook_id),
    task: text(row.task),
    source: source as HomeworkSource,
    subject: text(row.subject),
    grade: text(row.grade),
    conditionPreview: text(row.condition_preview),
    status,
    stage,
    error: text(row.error),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    startedAt: text(row.started_at),
    finishedAt: text(row.finished_at),
  }
}

/* Порядок очереди — по времени постановки, от ранней к поздней. Именно в этом
   порядке задачи и уходят в работу, поэтому номер в списке — не украшение,
   а настоящее место в очереди. */
export function orderedActiveJobs(jobs: readonly SolutionJob[]) {
  return jobs.filter(isActiveJob).slice().sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

export function queuePosition(job: SolutionJob, jobs: readonly SolutionJob[]) {
  return orderedActiveJobs(jobs).findIndex((entry) => entry.id === job.id) + 1
}

/* Кого запускать следующим.

   Выполняет задачу то устройство, которое её завело: только у него есть
   фотография и сессия ученика. Чужие задачи мы показываем, но не трогаем —
   иначе одна и та же задача пойдёт в модель дважды.

   Уже начатую задачу тоже не трогаем. После перезахода вкладка не помнит,
   что она отправляла, а решатель на сервере продолжает считать и сохранит
   решение сам. Взяться за такую строку заново значило бы гнать вторую
   генерацию поверх работающей первой. Не дождётся — строку закроет срок,
   и ученик увидит честную неудачу с кнопкой повтора. */
export function nextRunnableJob(
  jobs: readonly SolutionJob[],
  deviceId: string,
  runningKeys: ReadonlySet<string>,
  concurrency: number,
): SolutionJob | null {
  const mine = orderedActiveJobs(jobs).filter((job) => job.deviceId === deviceId)
  const inFlight = mine.filter((job) => job.status === 'running' || runningKeys.has(job.idempotencyKey)).length
  if (inFlight >= concurrency) return null
  return mine.find((job) => job.status === 'queued' && !runningKeys.has(job.idempotencyKey)) ?? null
}

export async function startSolutionJob(
  client: SupabaseClient<Database>,
  input: StartJobInput,
  guestId: string | null,
): Promise<SolutionJob | null> {
  const { data, error } = await client.rpc('start_homework_job', {
    p_idempotency_key: input.idempotencyKey,
    p_device_id: getDeviceId(),
    p_textbook_id: input.textbookId,
    p_task: input.task,
    p_source: input.source,
    p_subject: input.subject ?? '',
    p_grade: input.grade ?? '',
    p_condition_preview: (input.conditionPreview ?? '').slice(0, 400),
    p_guest_id: guestId,
  })
  if (error) return null
  return parseSolutionJob(data)
}

export async function listSolutionJobs(
  client: SupabaseClient<Database>,
  guestId: string | null,
): Promise<SolutionJob[] | null> {
  const { data, error } = await client.rpc('list_homework_jobs', { p_guest_id: guestId })
  if (error || !Array.isArray(data)) return null
  return data
    .map((entry) => parseSolutionJob(entry))
    .filter((entry): entry is SolutionJob => entry !== null)
}

/* Решение гостя после перезахода.

   Ученику с аккаунтом решения возвращает `get_my_homework_solutions`.
   У гостя аккаунта нет, поэтому его решение хранится по метке браузера —
   иначе очередь доходила бы до «Решение готово», а открывать было бы нечего:
   ответ решателя умер вместе с перезагруженной вкладкой. */
export async function fetchGuestSolution(
  client: SupabaseClient<Database>,
  guestId: string,
  idempotencyKey: string,
): Promise<unknown> {
  const { data, error } = await client.rpc('get_guest_homework_solution', {
    p_guest_id: guestId,
    p_idempotency_key: idempotencyKey,
  })
  if (error) return null
  return data
}

export async function closeSolutionJob(
  client: SupabaseClient<Database>,
  idempotencyKey: string,
  status: 'failed' | 'canceled',
  reason: string,
  guestId: string | null,
): Promise<void> {
  await client.rpc('close_homework_job', {
    p_idempotency_key: idempotencyKey,
    p_status: status,
    p_error: reason.slice(0, 400) || null,
    p_guest_id: guestId,
  })
}
