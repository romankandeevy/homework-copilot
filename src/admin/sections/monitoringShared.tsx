/* Общие компоненты вкладок мониторинга: строка «обновлено N назад»
   вместо кнопки и подсказка в заголовке колонки. Подписи - в
   monitoringLabels.ts, живые данные - в useLiveQuery.ts. */

import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowsClockwise, Info, WarningCircle } from '@phosphor-icons/react'
import { formatAgo } from './monitoringFormat'

/* «Обновлено 20 с назад». Тикает сама, в озвучку не лезет. */
export function LiveStatus({ updatedAt, refreshing, error, note }: {
  updatedAt: number | null
  refreshing?: boolean
  error?: string
  note?: ReactNode
}) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 10_000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <p className={`mon-live${error ? ' is-error' : ''}`}>
      {error ? (
        <WarningCircle size={15} weight="bold" aria-hidden="true" />
      ) : (
        <ArrowsClockwise size={15} weight="bold" aria-hidden="true" className={refreshing ? 'mon-live-spin' : undefined} />
      )}
      <span>
        {error
          ? `Не получилось обновить: ${error} Повторим сами.`
          : updatedAt === null ? 'Загружаем…' : `Обновлено ${formatAgo(updatedAt)}`}
      </span>
      {note && !error && <span className="mon-live-note">{note}</span>}
    </p>
  )
}

/* Заголовок колонки с объяснением: наведение или фокус на «i». */
export function HeaderHint({ label, hint }: { label: string; hint: string }) {
  const id = useId()
  return (
    <span className="mon-th-hint">
      <span>{label}</span>
      <button type="button" className="mon-hint-button" aria-label={`Что значит «${label}»`} aria-describedby={id}>
        <Info size={13} weight="bold" aria-hidden="true" />
      </button>
      <span role="tooltip" id={id} className="mon-tip">{hint}</span>
    </span>
  )
}
