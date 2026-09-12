/* График ошибок по времени: столбцы по часу, шести часам или суткам,
   внутри столбца - вид ошибки. Наведение и стрелки на клавиатуре
   показывают время и числа; легенда включает и выключает виды. */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { formatNumber } from '../api'
import { kindLabels, kindOrder } from './monitoringLabels'
import type { ErrorKind } from './monitoringLabels'
import { errorsWord, formatBucket } from './monitoringFormat'

export type ErrorBucket = { start: string; end: string; total: number; byKind: Record<ErrorKind, number> }

const HEIGHT = 200
const PADDING = { top: 14, right: 8, bottom: 26, left: 34 }

function niceMax(value: number) {
  const target = Math.max(2, value)
  const exponent = Math.pow(10, Math.floor(Math.log10(target)))
  const fraction = target / exponent
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return nice * exponent
}

export function ErrorChart({ buckets, bucketMinutes, periodLabel }: {
  buckets: ErrorBucket[]
  bucketMinutes: number
  periodLabel: string
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(720)
  const [active, setActive] = useState<number | null>(null)
  const [hidden, setHidden] = useState<Set<ErrorKind>>(() => new Set())
  const [announce, setAnnounce] = useState('')

  // Ширина холста = ширина блока: подписи оси остаются 10 px и на телефоне.
  useEffect(() => {
    const node = wrapRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 720)
      if (next > 0) setWidth(Math.max(280, next))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const visible = kindOrder.filter((kind) => !hidden.has(kind))
  const totals = useMemo(() => buckets.map((bucket) => visible.reduce((sum, kind) => sum + bucket.byKind[kind], 0)), [buckets, visible])
  const kindTotals = useMemo(() => Object.fromEntries(kindOrder.map((kind) => [kind, buckets.reduce((sum, bucket) => sum + bucket.byKind[kind], 0)])) as Record<ErrorKind, number>, [buckets])
  const periodTotal = kindOrder.reduce((sum, kind) => sum + kindTotals[kind], 0)
  const max = niceMax(Math.max(0, ...totals))
  const innerWidth = width - PADDING.left - PADDING.right
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom
  const count = buckets.length
  const group = count ? innerWidth / count : innerWidth
  const barWidth = Math.max(3, Math.min(28, group * 0.68))
  const y = (value: number) => PADDING.top + innerHeight - (value / max) * innerHeight
  const baseStep = bucketMinutes >= 1440 ? 5 : bucketMinutes > 60 ? 4 : 3
  const labelStep = width < 520 ? baseStep * 2 : baseStep

  const toggle = (kind: ErrorKind) => {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      // Выключить все виды нельзя: пустой график ничего не говорит.
      return next.size === kindOrder.length ? new Set() : next
    })
  }

  const describe = (index: number) => {
    const bucket = buckets[index]
    if (!bucket) return ''
    const parts = visible.filter((kind) => bucket.byKind[kind] > 0).map((kind) => `${kindLabels[kind]} ${formatNumber(bucket.byKind[kind])}`)
    return `${formatBucket(bucket.start, bucket.end, bucketMinutes, 'full')}: ${errorsWord(totals[index] ?? 0)}${parts.length ? ` (${parts.join(', ')})` : ''}`
  }

  const move = (index: number) => {
    const next = Math.max(0, Math.min(count - 1, index))
    setActive(next)
    setAnnounce(describe(next))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!count) return
    const current = active ?? count - 1
    if (event.key === 'ArrowLeft') move(current - 1)
    else if (event.key === 'ArrowRight') move(current + 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(count - 1)
    else return
    event.preventDefault()
  }

  const activeBucket = active !== null ? buckets[active] : null
  const activeX = active !== null ? PADDING.left + group * active + group / 2 : 0
  const ratio = width ? activeX / width : 0
  const tipAlign = ratio < 0.22 ? 'is-left' : ratio > 0.78 ? 'is-right' : 'is-center'

  return (
    <div className="mon-chart">
      <div
        ref={wrapRef}
        className="mon-chart-canvas"
        role="group"
        tabIndex={0}
        aria-label={`Ошибки за ${periodLabel}: всего ${errorsWord(periodTotal)}. Стрелки влево и вправо - по столбцам.`}
        onKeyDown={onKeyDown}
        onFocus={() => { if (active === null && count) move(count - 1) }}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
      >
        <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true" focusable="false">
          {[0, 0.5, 1].map((share) => (
            <g key={share}>
              <line x1={PADDING.left} x2={width - PADDING.right} y1={y(max * share)} y2={y(max * share)} className={share === 0 ? 'mon-chart-base' : 'mon-chart-grid'} />
              <text x={PADDING.left - 8} y={y(max * share) + 3.5} textAnchor="end" className="mon-chart-axis">{formatNumber(max * share)}</text>
            </g>
          ))}
          {buckets.map((bucket, index) => {
            let offset = 0
            const x = PADDING.left + group * index + (group - barWidth) / 2
            return (
              <g key={bucket.start} className={active !== null && active !== index ? 'is-dim' : undefined}>
                {visible.map((kind) => {
                  const value = bucket.byKind[kind]
                  if (!value) return null
                  const height = (value / max) * innerHeight
                  offset += height
                  return <rect key={kind} className={`mon-bar mon-kind-${kind}`} x={x} y={PADDING.top + innerHeight - offset} width={barWidth} height={height} />
                })}
                {((count - 1 - index) % labelStep === 0) && (
                  <text x={PADDING.left + group * index + group / 2} y={HEIGHT - 8} textAnchor="middle" className="mon-chart-axis">
                    {formatBucket(bucket.start, bucket.end, bucketMinutes, 'axis')}
                  </text>
                )}
                <rect
                  className="mon-chart-hit"
                  x={PADDING.left + group * index}
                  y={PADDING.top}
                  width={group}
                  height={innerHeight}
                  onMouseEnter={() => setActive(index)}
                />
              </g>
            )
          })}
          {active !== null && (
            <line x1={activeX} x2={activeX} y1={PADDING.top} y2={PADDING.top + innerHeight} className="mon-chart-cursor" />
          )}
        </svg>
        {periodTotal === 0 && <p className="mon-chart-zero">За {periodLabel} ошибок не было</p>}
        {activeBucket && (
          <div className={`mon-chart-tip ${tipAlign}`} style={{ left: `${activeX}px` }} aria-hidden="true">
            <strong>{formatBucket(activeBucket.start, activeBucket.end, bucketMinutes, 'full')}</strong>
            <span className="mon-chart-tip-total">{errorsWord(totals[active ?? 0] ?? 0)}</span>
            {visible.filter((kind) => activeBucket.byKind[kind] > 0).map((kind) => (
              <span key={kind} className="mon-chart-tip-row">
                <i className={`mon-swatch mon-kind-${kind}`} />
                {kindLabels[kind]}
                <b>{formatNumber(activeBucket.byKind[kind])}</b>
              </span>
            ))}
          </div>
        )}
      </div>
      <p className="mon-sr" aria-live="polite">{announce}</p>

      <div className="mon-legend" role="group" aria-label="Виды ошибок на графике">
        {kindOrder.map((kind) => (
          <button
            key={kind}
            type="button"
            className="mon-legend-item"
            aria-pressed={!hidden.has(kind)}
            onClick={() => toggle(kind)}
          >
            <i className={`mon-swatch mon-kind-${kind}`} />
            <span>{kindLabels[kind]}</span>
            <b>{formatNumber(kindTotals[kind])}</b>
          </button>
        ))}
      </div>

      <details className="mon-chart-table">
        <summary>Те же числа таблицей</summary>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Время, МСК</th>
                {kindOrder.map((kind) => <th key={kind} className="is-right">{kindLabels[kind]}</th>)}
                <th className="is-right">Всего</th>
              </tr>
            </thead>
            <tbody>
              {buckets.filter((bucket) => bucket.total > 0).map((bucket) => (
                <tr key={bucket.start}>
                  <td className="adm-nowrap">{formatBucket(bucket.start, bucket.end, bucketMinutes, 'full')}</td>
                  {kindOrder.map((kind) => <td key={kind} className="is-right">{formatNumber(bucket.byKind[kind])}</td>)}
                  <td className="is-right"><strong>{formatNumber(bucket.total)}</strong></td>
                </tr>
              ))}
              {periodTotal === 0 && <tr><td colSpan={kindOrder.length + 2} className="adm-muted">Ошибок за период не было.</td></tr>}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
