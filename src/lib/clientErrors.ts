/* Ошибки браузера - в ленту ошибок админки.

   Необработанное исключение и отклонённый промис уходят в
   `report_client_error`: база группирует их по отпечатку и сама режет
   поток до тридцати сообщений в минуту с адреса. Здесь дополнительно
   гасим повторы одной и той же ошибки, чтобы цикл рендера не завалил
   сеть одинаковыми запросами.

   Клиент приходит параметром: приложение грузит Supabase отдельным чанком. */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const recent = new Map<string, number>()
let client: SupabaseClient<Database> | null = null
let installed = false

function storedGuestId() {
  try {
    // Тот же ключ, что у бесплатного решения (guestSolutions.ts); новую метку не заводим.
    const value = window.localStorage.getItem('homework-copilot:guest-id')
    return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null
  } catch {
    return null
  }
}

export function reportClientError(message: string, stack?: string | null) {
  if (!client || !message) return
  // Шум расширений браузера к нам отношения не имеет.
  if (/ResizeObserver loop|^Script error\.?$|chrome-extension:|moz-extension:/i.test(`${message} ${stack ?? ''}`)) return
  const key = `${message}|${(stack ?? '').slice(0, 200)}`
  const now = Date.now()
  if ((recent.get(key) ?? 0) > now - 60_000) return
  recent.set(key, now)
  void client.rpc('report_client_error', {
    p_message: message.slice(0, 1000),
    p_stack: stack ? stack.slice(0, 8000) : null,
    p_route: window.location.pathname.slice(0, 120),
    p_environment: {
      url: window.location.pathname,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      language: navigator.language,
      build: import.meta.env.MODE,
    },
    p_guest_id: storedGuestId(),
  }).then(() => undefined, () => undefined)
}

export function installClientErrorReporting(nextClient: SupabaseClient<Database>) {
  client = nextClient
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (event) => {
    const error = event.error instanceof Error ? event.error : null
    reportClientError(error?.message ?? event.message ?? 'Ошибка скрипта', error?.stack ?? `${event.filename}:${event.lineno}:${event.colno}`)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason
    if (reason instanceof Error) reportClientError(reason.message, reason.stack ?? null)
    else if (typeof reason === 'string') reportClientError(reason)
  })
}
