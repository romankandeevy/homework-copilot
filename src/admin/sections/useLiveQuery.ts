/* Живые данные мониторинга без кнопки «Обновить».

   Как useAsync из ui.tsx, но с тихим обновлением: раз в intervalMs, пока
   вкладка браузера видна, и по сигналу Realtime админки (signals.pulse -
   новая ошибка, обращение). Тихое обновление не мигает таблицей, а при
   сбое оставляет прежние данные и сообщает об этом строкой статуса. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAdmin } from '../context'

export type LiveQuery<T> = {
  data: T | null
  error: string
  loading: boolean
  refreshing: boolean
  refreshError: string
  updatedAt: number | null
  /** Загрузить заново с индикатором (после смены фильтра или действия). */
  reload: () => void
  /** Тихо обновить: таблица не мигает, при сбое остаются прежние данные. */
  refresh: () => void
}

export function useLiveQuery<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[],
  { intervalMs = 45_000, onPulse = true }: { intervalMs?: number | null; onPulse?: boolean } = {},
): LiveQuery<T> {
  const { signals } = useAdmin()
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const requestRef = useRef(0)
  const updatedRef = useRef<number | null>(null)

  const run = useCallback((silent: boolean) => {
    const id = ++requestRef.current
    if (silent) setRefreshing(true)
    else {
      setLoading(true)
      setError('')
    }
    loaderRef.current()
      .then((result) => {
        if (id !== requestRef.current) return
        const now = Date.now()
        updatedRef.current = now
        setData(result)
        setUpdatedAt(now)
        setError('')
        setRefreshError('')
      })
      .catch((failure: unknown) => {
        if (id !== requestRef.current) return
        const message = failure instanceof Error ? failure.message : 'Не получилось загрузить данные.'
        if (silent) setRefreshError(message)
        else setError(message)
      })
      .finally(() => {
        if (id !== requestRef.current) return
        setLoading(false)
        setRefreshing(false)
      })
  }, [])

  useEffect(() => {
    run(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    if (!intervalMs) return
    const tick = () => {
      if (document.visibilityState === 'visible') run(true)
    }
    const timer = window.setInterval(tick, intervalMs)
    // Вернулись на вкладку после перерыва - догоняем сразу, а не через минуту.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && updatedRef.current !== null && Date.now() - updatedRef.current > intervalMs) run(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs, run])

  const pulseRef = useRef(signals.pulse)
  useEffect(() => {
    if (!onPulse || pulseRef.current === signals.pulse) return
    pulseRef.current = signals.pulse
    // События приходят пачкой: одна ошибка у десяти учеников - одно обновление.
    const timer = window.setTimeout(() => run(true), 800)
    return () => window.clearTimeout(timer)
  }, [signals.pulse, onPulse, run])

  const reload = useCallback(() => run(false), [run])
  const refresh = useCallback(() => run(true), [run])
  return { data, error, loading, refreshing, refreshError, updatedAt, reload, refresh }
}
