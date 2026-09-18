import type { HomeworkSource, SolveReceipt } from './homeworkContract'
import { formatKopecks } from './currency'

/* Чек решения: сколько шло и сколько списано.

   Сервер присылает его вместе с решением, а хранится он в браузере, по
   задаче: в общий каталог решений сумма ученика не идёт. На другом
   устройстве чека нет - там время считается по строке очереди, а суммы
   просто не видно. */

const storageKey = 'homework-copilot:solve-receipts'
const keptReceipts = 60

export function receiptKey(textbookId: string, task: string, source: HomeworkSource) {
  return `${textbookId}|${source}|${task}`
}

export function loadReceipts(): Record<string, SolveReceipt> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, SolveReceipt> : {}
  } catch {
    return {}
  }
}

export function withReceipt(receipts: Record<string, SolveReceipt>, key: string, receipt: SolveReceipt) {
  // Свежий чек - последним, старые срезаются с начала.
  const entries = Object.entries(receipts).filter(([existing]) => existing !== key)
  const next = Object.fromEntries([...entries, [key, receipt]].slice(-keptReceipts))
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(next))
  } catch {
    // Хранилище закрыто - чек живёт до перезагрузки, и этого хватает.
  }
  return next
}

export function formatSolveDuration(seconds: number) {
  const whole = Math.max(1, Math.round(seconds))
  if (whole < 60) return `${whole} с`
  const rest = whole % 60
  return rest === 0 ? `${whole / 60} мин` : `${Math.floor(whole / 60)} мин ${rest} с`
}

/* «решено за 24 с · списано 5,20 ₽». Нет ни времени, ни суммы - null. */
export function receiptLabel(receipt: SolveReceipt | null | undefined, fallbackSeconds: number | null = null) {
  if (receipt?.reused) return 'уже было решено · повторно бесплатно'
  const seconds = receipt?.seconds ?? fallbackSeconds
  const parts: string[] = []
  if (seconds !== null && Number.isFinite(seconds)) parts.push(`решено за ${formatSolveDuration(seconds)}`)
  if (receipt) parts.push(receipt.kopecks > 0 ? `списано ${formatKopecks(receipt.kopecks)}` : 'бесплатно')
  return parts.length > 0 ? parts.join(' · ') : null
}
