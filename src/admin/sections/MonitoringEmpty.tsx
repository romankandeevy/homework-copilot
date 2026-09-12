/* Пустой список ошибок. Иллюстрация - единственный свой SVG раздела:
   чертёжная сетка и ровная линия пульса, как на миллиметровке VERKSTAD.
   Это не иконка, поэтому не из Phosphor. */

import { CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { Button } from '../ui'
import { formatAgo } from './monitoringFormat'

function FlatlineIllustration() {
  const columns = Array.from({ length: 13 }, (_, index) => 16 + index * 18)
  const rows = [16, 34, 52, 70, 88]
  return (
    <svg className="mon-empty-art" viewBox="0 0 248 104" aria-hidden="true" focusable="false">
      {columns.map((x) => <line key={`v${x}`} x1={x} x2={x} y1={10} y2={94} className="mon-empty-grid" />)}
      {rows.map((y) => <line key={`h${y}`} x1={10} x2={238} y1={y} y2={y} className="mon-empty-grid" />)}
      <line x1={10} x2={238} y1={94} y2={94} className="mon-empty-axis" />
      {columns.map((x) => <line key={`t${x}`} x1={x} x2={x} y1={94} y2={98} className="mon-empty-axis" />)}
      <path d="M16 70 H214" className="mon-empty-line" />
      <circle cx={214} cy={70} r={5} className="mon-empty-dot" />
    </svg>
  )
}

export function ErrorsEmpty({ filtered, servicesDown, lastCheckAt, onReset }: {
  /** Фильтры сужают список: пусто из-за них, а не потому что ошибок нет. */
  filtered: boolean
  servicesDown: number
  lastCheckAt: string | null
  onReset: () => void
}) {
  if (filtered) {
    return (
      <div className="mon-empty">
        <p className="mon-empty-title">Под эти фильтры ошибок нет</p>
        <p className="mon-empty-text">Попробуй другой статус, маршрут или даты. Все открытые ошибки видны без фильтров.</p>
        <Button size="sm" onClick={onReset}>Сбросить фильтры</Button>
      </div>
    )
  }
  const checkedAt = lastCheckAt ? Date.parse(lastCheckAt) : Number.NaN
  const checked = Number.isFinite(checkedAt) ? `последняя проверка сервисов ${formatAgo(checkedAt)}` : 'проверок сервисов ещё не было'
  return (
    <div className="mon-empty">
      <FlatlineIllustration />
      <p className="mon-empty-title">Открытых ошибок нет</p>
      {servicesDown === 0 ? (
        <p className="mon-empty-status is-ok">
          <CheckCircle size={16} weight="fill" aria-hidden="true" />
          <span>Всё работает: {checked}</span>
        </p>
      ) : (
        <p className="mon-empty-status is-warning">
          <WarningCircle size={16} weight="fill" aria-hidden="true" />
          <span>Ошибок нет, но не отвечает сервисов: {servicesDown}. Подробности - на вкладке «Состояние».</span>
        </p>
      )}
      <p className="mon-empty-text">Новая ошибка появится здесь сама: список обновляется по сигналу базы и раз в 45 секунд.</p>
    </div>
  )
}
