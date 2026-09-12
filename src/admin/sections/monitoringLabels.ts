/* Подписи и служебные функции мониторинга без React-компонентов. */

import type { Tone } from '../ui'

export const kindOrder = ['frontend', 'api', 'llm', 'payments', 'db'] as const
export type ErrorKind = (typeof kindOrder)[number]
export const kindLabels: Record<string, string> = { frontend: 'Фронтенд', api: 'API', llm: 'Модель', payments: 'Платежи', db: 'База' }

export const severityLabels: Record<string, string> = { critical: 'Критично', error: 'Ошибка', warning: 'Предупреждение', info: 'Инфо' }
export const severityTones: Record<string, Tone> = { critical: 'danger', error: 'danger', warning: 'warning', info: 'info' }

export const errorStatusLabels: Record<string, string> = { new: 'Новая', in_progress: 'В работе', resolved: 'Решена', ignored: 'Игнор' }
export const errorStatusTones: Record<string, Tone> = { new: 'danger', in_progress: 'warning', resolved: 'success', ignored: 'neutral' }

export const outcomeLabels: Record<string, string> = { solved: 'Решено', failed: 'Сбой' }
export const outcomeTones: Record<string, Tone> = { solved: 'success', failed: 'danger' }

/* Имена сервисов - как их пишет server/admin.ts (runHealthChecks). */
export const serviceLabels: Record<string, string> = {
  kie: 'Шлюз моделей Kie.ai',
  'vercel-api': 'Функции на Vercel',
  'supabase-proxy': 'Прокси Supabase - Vercel',
  frontend: 'Сайт на GitHub Pages',
  database: 'База данных',
  storage: 'Хранилище файлов',
  telegram: 'Бот в Telegram',
  email: 'Почта (Resend)',
}

export function serviceLabel(service: string) {
  return serviceLabels[service] ?? service
}

/* Переход между вкладками с фильтрами: пишем адрес одним шагом и будим
   все useQueryState раздела тем же событием, что и кнопка «назад». */
export function pushParams(patch: Record<string, string>) {
  const params = new URLSearchParams(window.location.search)
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value)
    else params.delete(key)
  }
  const query = params.toString()
  window.history.pushState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
}

/* Самая старая отметка из нескольких запросов вкладки: «обновлено» не
   должно выглядеть свежее, чем самый отставший из них. */
export function oldest(...values: (number | null)[]) {
  const known = values.filter((value): value is number => value !== null)
  return known.length ? Math.min(...known) : null
}
