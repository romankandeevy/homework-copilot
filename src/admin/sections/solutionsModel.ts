/* Разбор ответов admin_solutions_v2 и admin_solution_detail_v2.

   База отдаёт jsonb, поэтому каждое поле читается безопасно: пропавшее или
   лишнее поле не должно ронять раздел. Подписи статусов и мест хранения -
   здесь же, чтобы фильтр и таблица называли одно и то же одинаково. */

import type { Json } from '../../lib/database.types'
import { arr, isRecord, num, numOrNull, obj, rows, str, strOrNull } from '../api'
import type { Row } from '../api'

export type Facet = { value: string; count: number }

export type SolutionItem = {
  id: string
  kind: string
  source: string
  subject: string
  task: string | null
  textbookTitle: string
  condition: string
  answer: string
  userId: string | null
  email: string | null
  accessCount: number
  status: string
  failedChecks: number
  priceKopecks: number | null
  costKopecks: number | null
  createdAt: string
}

export type SolutionStats = {
  total: number
  today: number
  week: number
  catalog: number
  personal: number
  guest: number
  firstAt: string | null
  lastAt: string | null
  verifiedTasks: number
  costsSince: string | null
}

export type SolutionFacets = {
  subjects: Facet[]
  sources: Facet[]
  statuses: Facet[]
  kinds: Facet[]
}

export type SolutionList = {
  total: number
  page: number
  pageSize: number
  stats: SolutionStats
  facets: SolutionFacets
  items: SolutionItem[]
}

export type SolutionFilters = {
  q: string
  subject: string
  source: string
  status: string
  kind: string
  from: string
  to: string
}

export type SolutionCheck = { label: string; note: string; passed: boolean }

export type SolutionBody = {
  condition: string
  explanation: string[]
  given: string[]
  goal: { title: string; text: string } | null
  steps: string[]
  code: { language: string; text: string } | null
  answer: string
  diagram: string | null
}

export type SolutionDetail = {
  id: string
  kind: string
  source: string
  subject: string
  task: string | null
  textbookTitle: string
  textbookEdition: string
  createdAt: string
  userId: string | null
  email: string | null
  guest: boolean
  status: string
  engineVersion: number | null
  body: SolutionBody
  checks: SolutionCheck[]
  raw: Row
  accesses: { userId: string | null; email: string | null; at: string }[]
  wallet: { amount: number; kind: string; description: string; at: string }[]
  cost: {
    models: string
    calls: number
    credits: number | null
    costKopecks: number | null
    priceKopecks: number | null
    seconds: number | null
    outcome: string
    at: string
  } | null
  job: { status: string; stage: string; grade: string; createdAt: string; finishedAt: string | null } | null
  ratings: { helpful: number; unhelpful: number; comments: { helpful: boolean; comment: string; at: string }[] }
}

export const kindLabels: Record<string, string> = {
  catalog: 'Общий каталог',
  personal: 'Личное',
  guest: 'Гость',
}

export const sourceLabels: Record<string, string> = {
  photo: 'Фото',
  text: 'Текст',
  number: 'Номер из учебника',
}

export const statusLabels: Record<string, string> = {
  passed: 'Проверка пройдена',
  failed: 'Не прошло проверку',
  unknown: 'Без отметки проверки',
}

export const jobStatusLabels: Record<string, string> = {
  queued: 'в очереди',
  running: 'решается',
  done: 'решена',
  failed: 'ошибка',
  canceled: 'отменена',
}

export function label(labels: Record<string, string>, value: string) {
  return labels[value] ?? (value || '-')
}

function parseFacets(value: Json | undefined): Facet[] {
  return rows(value).flatMap((row) => {
    const facetValue = str(row.value)
    return facetValue ? [{ value: facetValue, count: num(row.count) }] : []
  })
}

export function parseSolutionItem(row: Row): SolutionItem | null {
  const id = str(row.id)
  if (!id) return null
  return {
    id,
    kind: str(row.kind, 'personal'),
    source: str(row.source),
    subject: str(row.subject),
    task: strOrNull(row.task) || null,
    textbookTitle: str(row.textbookTitle),
    condition: str(row.condition),
    answer: str(row.answer),
    userId: strOrNull(row.userId),
    email: strOrNull(row.email),
    accessCount: num(row.accessCount, 1),
    status: str(row.status, 'unknown'),
    failedChecks: num(row.failedChecks),
    priceKopecks: numOrNull(row.priceKopecks),
    costKopecks: numOrNull(row.costKopecks),
    createdAt: str(row.createdAt),
  }
}

export function parseSolutionList(value: Json | null | undefined): SolutionList {
  const source = obj(value)
  const stats = obj(source.stats)
  const facets = obj(source.facets)
  return {
    total: num(source.total),
    page: Math.max(1, num(source.page, 1)),
    pageSize: Math.max(1, num(source.pageSize, 50)),
    stats: {
      total: num(stats.total),
      today: num(stats.today),
      week: num(stats.week),
      catalog: num(stats.catalog),
      personal: num(stats.personal),
      guest: num(stats.guest),
      firstAt: strOrNull(stats.firstAt),
      lastAt: strOrNull(stats.lastAt),
      verifiedTasks: num(stats.verifiedTasks),
      costsSince: strOrNull(stats.costsSince),
    },
    facets: {
      subjects: parseFacets(facets.subjects),
      sources: parseFacets(facets.sources),
      statuses: parseFacets(facets.statuses),
      kinds: parseFacets(facets.kinds),
    },
    items: rows(source.items).flatMap((row) => {
      const item = parseSolutionItem(row)
      return item ? [item] : []
    }),
  }
}

export function activeFilterCount(filters: SolutionFilters) {
  return Object.values(filters).filter((value) => value.trim() !== '').length
}

/* Заголовок строки - само условие: у задачи по фото или тексту в `task`
   лежит служебная метка вроде «photo-<uuid>», читать её незачем. */
export function solutionTitle(item: Pick<SolutionItem, 'condition' | 'task'>) {
  const condition = item.condition.replace(/\s+/g, ' ').trim()
  if (condition) return condition
  if (item.task) return `Задача № ${item.task}`
  return 'Условие не сохранено'
}

function strings(value: Json | undefined) {
  return arr(value).filter((line): line is string => typeof line === 'string' && line.trim() !== '')
}

const noDiagramKinds = new Set(['', 'none'])

export function parseSolutionBody(value: Json | undefined): SolutionBody {
  const solution = obj(value)
  const goal = obj(solution.goal)
  const code = isRecord(solution.code) ? solution.code : null
  const diagram = obj(solution.diagram)
  const diagramKind = str(diagram.kind)
  const diagramText = str(diagram.description).trim()
  return {
    condition: str(solution.condition).trim(),
    explanation: strings(solution.explanation),
    given: strings(solution.given),
    goal: str(goal.text).trim() ? { title: str(goal.title, 'Найти'), text: str(goal.text).trim() } : null,
    steps: strings(solution.steps),
    code: code && str(code.text).trim() ? { language: str(code.language), text: str(code.text) } : null,
    answer: str(solution.answer).trim(),
    diagram: !noDiagramKinds.has(diagramKind) && diagramText ? diagramText : null,
  }
}

export function parseSolutionDetail(value: Json | null | undefined): SolutionDetail {
  const source = obj(value)
  const solution = obj(source.solution)
  const verification = obj(solution.verification)
  const cost = isRecord(source.cost) ? source.cost : null
  const job = isRecord(source.job) ? source.job : null
  const ratings = obj(source.ratings)
  return {
    id: str(source.id),
    kind: str(source.kind, 'personal'),
    source: str(source.source),
    subject: str(source.subject),
    task: strOrNull(source.task) || null,
    textbookTitle: str(source.textbookTitle),
    textbookEdition: str(source.textbookEdition),
    createdAt: str(source.createdAt),
    userId: strOrNull(source.userId),
    email: strOrNull(source.email),
    guest: source.guest === true,
    status: str(source.status, 'unknown'),
    engineVersion: numOrNull(source.engineVersion),
    body: parseSolutionBody(source.solution),
    checks: rows(verification.checks)
      .map((row) => ({ label: str(row.label).trim(), note: str(row.note).trim(), passed: row.passed === true }))
      .filter((check) => check.label !== ''),
    raw: solution,
    accesses: rows(source.accesses).map((row) => ({ userId: strOrNull(row.userId), email: strOrNull(row.email), at: str(row.at) })),
    wallet: rows(source.wallet).map((row) => ({ amount: num(row.amount), kind: str(row.kind), description: str(row.description), at: str(row.at) })),
    cost: cost ? {
      models: str(cost.models),
      calls: num(cost.calls),
      credits: numOrNull(cost.credits),
      costKopecks: numOrNull(cost.costKopecks),
      priceKopecks: numOrNull(cost.priceKopecks),
      seconds: numOrNull(cost.seconds),
      outcome: str(cost.outcome),
      at: str(cost.at),
    } : null,
    job: job ? {
      status: str(job.status),
      stage: str(job.stage),
      grade: str(job.grade),
      createdAt: str(job.createdAt),
      finishedAt: strOrNull(job.finishedAt),
    } : null,
    ratings: {
      helpful: num(ratings.helpful),
      unhelpful: num(ratings.unhelpful),
      comments: rows(ratings.comments)
        .map((row) => ({ helpful: row.helpful === true, comment: str(row.comment).trim(), at: str(row.at) }))
        .filter((comment) => comment.comment !== ''),
    },
  }
}

/* Ключи строкам решения без номера в массиве: одинаковые строки («x > 0»
   в двух местах) получают порядковый суффикс, остальные - сам текст. */
export function keyedLines(lines: string[]) {
  const seen = new Map<string, number>()
  return lines.map((text) => {
    const count = (seen.get(text) ?? 0) + 1
    seen.set(text, count)
    return { key: count === 1 ? text : `${text}#${count}`, text }
  })
}

/* Списано с баланса за решение и возвращено по нему - по записям кошелька
   с ключом решения. */
export function walletTotals(wallet: SolutionDetail['wallet']) {
  let charged = 0
  let refunded = 0
  for (const entry of wallet) {
    if (entry.amount < 0) charged += -entry.amount
    else refunded += entry.amount
  }
  return { charged, refunded }
}
