/* Дашборд: сначала деньги, потом всё остальное.

   Владелец заходит узнать, сколько заработал. Поэтому наверху одна широкая
   карточка денег: сколько пришло за период крупно, изменение к прошлому
   такому же периоду в рублях и процентах, итог за всё время и график дохода
   против расхода. Сервис работает на кошельке с предоплатой, поэтому рядом
   три разных суммы: пришло, отработано (списано за решения) и лежит на
   кошельках - это обязательство перед учениками, а не прибыль.

   Ниже - тревоги тонкой полосой (только когда есть), четыре цифры работы
   сервиса, динамика задач и учеников, светофор сервисов, рейтинг предметов
   и лента. Цифры отдаёт admin_dashboard_period, ленту - admin_dashboard_feed. */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowClockwise, ArrowRight, CheckCircle, CurrencyRub, DownloadSimple, Info, Lifebuoy, MagnifyingGlass,
  UserPlus, Warning, WarningCircle, XCircle,
} from '@phosphor-icons/react'
import {
  adminRpc, delta, downloadCsv, formatDate, formatDuration, formatKopecks, formatNumber, formatPercent, num, numOrNull,
  obj, relativeTime, rows, str, todayMsk,
} from '../api'
import type { Row } from '../api'
import type { AdminSection } from '../context'
import { useAdmin } from '../context'
import { Button, EmptyState, ErrorState, PageHeader, Panel, Segmented, useAsync, useQueryState } from '../ui'
import './dashboard.css'

type Period = 'day' | 'week' | 'month' | 'year'
type Tone = 'ok' | 'bad' | 'warn' | 'ink' | 'blue'

const periodWords: Record<Period, { current: string; previous: string; chart: string; vs: string }> = {
  day: { current: 'сегодня', previous: 'вчера к этому часу', chart: 'по часам сегодня', vs: 'ко вчера к этому часу' },
  week: { current: 'за 7 дней', previous: 'прошлые 7 дней', chart: 'по дням за 7 дней', vs: 'к прошлым 7 дням' },
  month: { current: 'за 30 дней', previous: 'прошлые 30 дней', chart: 'по дням за 30 дней', vs: 'к прошлым 30 дням' },
  year: { current: 'за год', previous: 'прошлый год', chart: 'по месяцам за год', vs: 'к прошлому году' },
}

const serviceNames: Record<string, string> = {
  kie: 'Шлюз моделей',
  'vercel-api': 'Функции Vercel',
  'supabase-proxy': 'Прокси Supabase',
  frontend: 'Сайт',
  database: 'База данных',
  storage: 'Хранилище',
  telegram: 'Telegram',
  email: 'Почта',
}

const feedKinds = [
  { value: 'all', label: 'Все' },
  { value: 'solution', label: 'Решения' },
  { value: 'payment', label: 'Оплаты' },
  { value: 'signup', label: 'Регистрации' },
  { value: 'ticket', label: 'Обращения' },
  { value: 'error', label: 'Ошибки' },
] as const

function pointLabel(label: string, period: Period) {
  if (period === 'week' || period === 'month') {
    const [, month, day] = label.split('-')
    return day && month ? `${day}.${month}` : label
  }
  return label
}

function compactRubles(kopecks: number) {
  const rubles = kopecks / 100
  if (Math.abs(rubles) >= 1_000_000) return `${formatNumber(Math.round(rubles / 100_000) / 10)} млн ₽`
  if (Math.abs(rubles) >= 10_000) return `${formatNumber(Math.round(rubles / 100) / 10)} тыс ₽`
  return `${formatNumber(Math.round(rubles * 10) / 10)} ₽`
}

/* ---------- Подсказка у цифры ---------- */

function InfoTip({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span className="dash-tip">
      <button type="button" className="dash-tip-trigger" aria-describedby={id} aria-label="Как считается">
        <Info size={14} weight="bold" aria-hidden="true" />
      </button>
      <span role="tooltip" id={id} className="dash-tip-body">{children}</span>
    </span>
  )
}

/* ---------- Микрографик ---------- */

function Trend({ values, tone, label }: { values: number[]; tone: Tone; label: string }) {
  if (values.length < 2) return <span className="dash-trend is-empty" aria-hidden="true" />
  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const width = 120
  const height = 36
  const points = values.map((value, index) => [
    (index / (values.length - 1)) * width,
    height - 3 - ((value - min) / span) * (height - 6),
  ])
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `0,${height} ${line} ${width},${height}`
  const [lastX, lastY] = points[points.length - 1]
  return (
    <svg className={`dash-trend is-${tone}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <polygon points={area} />
      <polyline points={line} vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r="2.5" />
    </svg>
  )
}

/* Разница с прошлым периодом: абсолютная и в процентах, цвет по смыслу. */
function Change({ current, previous, vs, money = false, invert = false }: { current: number; previous: number; vs: string; money?: boolean; invert?: boolean }) {
  const diff = current - previous
  const percent = delta(current, previous)
  const tone = diff === 0 ? 'is-flat' : (diff > 0) !== invert ? 'is-good' : 'is-bad'
  const shown = money ? formatKopecks(Math.abs(diff)) : formatNumber(Math.abs(diff))
  return (
    <span className={`dash-change ${tone}`}>
      <b>{diff === 0 ? 'без изменений' : `${diff > 0 ? '+' : '−'}${shown}`}{diff !== 0 && percent !== null ? ` (${diff > 0 ? '+' : '−'}${formatPercent(Math.abs(percent))})` : ''}</b>
      <small>{vs}: {money ? formatKopecks(previous) : formatNumber(previous)}</small>
    </span>
  )
}

function Kpi({ id, label, tip, value, tone = 'ink', state, trend, trendLabel, children }: {
  id: string
  label: string
  tip: ReactNode
  value: ReactNode
  tone?: Tone
  state?: 'warn' | 'bad'
  trend: number[]
  trendLabel: string
  children?: ReactNode
}) {
  return (
    <article className={`dash-kpi${state ? ` is-${state}` : ''}`} aria-labelledby={`${id}-label`}>
      <header className="dash-kpi-head">
        <h3 id={`${id}-label`}>{label}</h3>
        <InfoTip id={`${id}-tip`}>{tip}</InfoTip>
      </header>
      <strong className={`dash-kpi-value is-${tone}`}>{value}</strong>
      {children && <div className="dash-kpi-foot">{children}</div>}
      <Trend values={trend} tone={tone} label={trendLabel} />
    </article>
  )
}

function Skeleton({ kind }: { kind: 'kpi' | 'hero' }) {
  if (kind === 'hero') {
    return (
      <div className="dash-hero is-loading" aria-hidden="true">
        <div className="dash-hero-main"><span className="dash-skel is-line" /><span className="dash-skel is-hero" /><span className="dash-skel is-line is-short" /></div>
        <span className="dash-skel is-chart" />
      </div>
    )
  }
  return (
    <div className="dash-kpi is-loading" aria-hidden="true">
      <span className="dash-skel is-line" />
      <span className="dash-skel is-value" />
      <span className="dash-skel is-line is-short" />
    </div>
  )
}

/* ---------- Интерактивный график ---------- */

type ChartSeries = { key: string; name: string; tone: Tone; values: number[] }

function DynamicsChart({ labels, fullLabels, series, stacked, format, compact = false }: {
  labels: string[]
  fullLabels: string[]
  series: ChartSeries[]
  stacked: boolean
  format: (value: number) => string
  compact?: boolean
}) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [active, setActive] = useState<number | null>(null)
  const visible = series.filter((item) => !hidden.has(item.key))
  const totals = labels.map((_, index) => visible.reduce((sum, item) => sum + Math.max(0, item.values[index] ?? 0), 0))
  const peak = stacked
    ? Math.max(1, ...totals)
    : Math.max(1, ...visible.flatMap((item) => item.values.map((value) => Math.max(0, value))))
  const step = labels.length > 16 ? Math.ceil(labels.length / 8) : 1

  const toggle = (key: string) => {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else if (series.length - next.size > 1) next.add(key)
      return next
    })
  }

  return (
    <div className={`dash-chart${compact ? ' is-compact' : ''}`}>
      <div className="dash-legend" role="group" aria-label="Показать на графике">
        {series.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`dash-legend-item is-${item.tone}`}
            aria-pressed={!hidden.has(item.key)}
            onClick={() => toggle(item.key)}
          >
            <i aria-hidden="true" />
            {item.name}
          </button>
        ))}
      </div>
      <div className="dash-plot" onMouseLeave={() => setActive(null)}>
        <div className="dash-grid-lines" aria-hidden="true">
          <span><em>{format(peak)}</em></span>
          <span><em>{format(peak / 2)}</em></span>
          <span><em>0</em></span>
        </div>
        <div className="dash-columns" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>
          {labels.map((label, index) => ({ label, full: fullLabels[index] ?? label, index })).map(({ label, full, index }) => {
            const description = `${full}: ${visible.map((item) => `${item.name} ${format(item.values[index] ?? 0)}`).join(', ')}`
            return (
              <div
                key={full}
                className={`dash-column${active === index ? ' is-active' : ''}`}
                tabIndex={0}
                aria-label={description}
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              >
                <div className={`dash-bars${stacked ? ' is-stacked' : ''}`}>
                  {visible.map((item) => (
                    <span
                      key={item.key}
                      className={`dash-bar is-${item.tone}`}
                      style={{ height: `${(Math.max(0, item.values[index] ?? 0) / peak) * 100}%` }}
                    />
                  ))}
                </div>
                {active === index && (
                  <div className={`dash-point-tip${index > labels.length / 2 ? ' is-left' : ''}`} role="presentation">
                    <strong>{full}</strong>
                    {visible.map((item) => (
                      <span key={item.key} className={`is-${item.tone}`}><i aria-hidden="true" />{item.name}<b>{format(item.values[index] ?? 0)}</b></span>
                    ))}
                  </div>
                )}
                <small className="dash-x">{index % step === 0 || index === labels.length - 1 ? label : ''}</small>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ---------- Деньги ---------- */

function MoneyHero({ period, current, previous, money, labels, fullLabels, revenueSeries, costSeries }: {
  period: Period
  current: Row
  previous: Row
  money: Row
  labels: string[]
  fullLabels: string[]
  revenueSeries: number[]
  costSeries: number[]
}) {
  const words = periodWords[period]
  const revenue = num(current.revenue)
  const llmCost = num(current.llmCost)
  const profit = revenue - llmCost
  const previousProfit = num(previous.revenue) - num(previous.llmCost)
  const topUps = num(current.topUps)
  const allTime = num(money.allTimeRevenue)
  const nobodyPaid = num(money.payersAllTime) === 0

  return (
    <section className="dash-hero" aria-labelledby="dash-hero-title">
      <div className="dash-hero-main">
        <header className="dash-kpi-head">
          <h2 id="dash-hero-title">Заработано {words.current}</h2>
          <InfoTip id="dash-hero-tip">
            Деньги, которые пришли от учеников: подтверждённые пополнения кошелька минус возвраты. Проверочные пополнения аккаунтов админов не считаются.
          </InfoTip>
        </header>
        <strong className={`dash-hero-value${revenue > 0 ? ' is-ok' : ''}`}>{formatKopecks(revenue)}</strong>
        <Change current={revenue} previous={num(previous.revenue)} vs={words.vs} money />
        <p className="dash-hero-total">
          За всё время: <b>{formatKopecks(allTime)}</b>
          {!nobodyPaid && <>, платили <b>{formatNumber(num(money.payersAllTime))}</b> учеников с {formatDate(str(money.firstPaymentAt))}</>}
        </p>
        {nobodyPaid && (
          <p className="dash-hero-note">
            Оплат от учеников ещё не было. Платёжного провайдера нет: пополнение подтверждается вручную в карточке ученика, и только оно попадает сюда.
          </p>
        )}
      </div>

      <div className="dash-hero-chart">
        <DynamicsChart
          key={`money-${period}`}
          compact
          labels={labels}
          fullLabels={fullLabels}
          stacked={false}
          format={compactRubles}
          series={[
            { key: 'revenue', name: 'Заработано', tone: 'ok', values: revenueSeries },
            { key: 'llmCost', name: 'Расход на модели', tone: 'bad', values: costSeries },
          ]}
        />
      </div>

      <dl className="dash-hero-stats">
        <div className={profit < 0 ? 'is-bad' : profit > 0 ? 'is-ok' : ''}>
          <dt>Прибыль <InfoTip id="tip-profit">Заработано минус себестоимость у шлюза моделей: решения задач, включая неудачные, и ответы ИИ-чата. Налоги и комиссии здесь не вычтены.</InfoTip></dt>
          <dd>{formatKopecks(profit)}</dd>
          <small>{words.previous}: {formatKopecks(previousProfit)}</small>
        </div>
        <div className={llmCost > 0 ? 'is-bad' : ''}>
          <dt>Расход на модели</dt>
          <dd>{llmCost > 0 ? '−' : ''}{formatKopecks(llmCost)}</dd>
          <small>{words.previous}: {formatKopecks(num(previous.llmCost))}</small>
        </div>
        <div>
          <dt>Платили учеников</dt>
          <dd>{formatNumber(num(current.payers))}</dd>
          <small>{num(current.firstPayers) ? `впервые: ${formatNumber(num(current.firstPayers))}` : `${words.previous}: ${formatNumber(num(previous.payers))}`}</small>
        </div>
        <div>
          <dt>Средний чек</dt>
          <dd>{topUps ? formatKopecks(Math.round(revenue / topUps)) : '-'}</dd>
          <small>пополнений: {formatNumber(topUps)}</small>
        </div>
        <div>
          <dt>Отработано <InfoTip id="tip-consumption">Сколько ученики потратили с кошельков на решения и чат за период, за вычетом возвратов за неудачные решения. Это деньги, за которые сервис уже сделал работу.</InfoTip></dt>
          <dd>{formatKopecks(num(current.consumption))}</dd>
          <small>{words.previous}: {formatKopecks(num(previous.consumption))}</small>
        </div>
        <div className={num(money.walletLiability) > 0 ? 'is-warn' : ''}>
          <dt>На кошельках <InfoTip id="tip-liability">Деньги учеников, которые ещё не потрачены: их предстоит отработать решениями или вернуть. Это обязательство, а не прибыль. Сейчас, без учёта периода.</InfoTip></dt>
          <dd>{formatKopecks(num(money.walletLiability))}</dd>
          <small>у {formatNumber(num(money.walletsWithMoney))} учеников</small>
        </div>
      </dl>
    </section>
  )
}

/* ---------- Лента ---------- */

function feedIcon(kind: string, ok: boolean) {
  if (kind === 'solution') return ok ? <CheckCircle size={18} weight="bold" aria-hidden="true" /> : <XCircle size={18} weight="bold" aria-hidden="true" />
  if (kind === 'payment' || kind === 'refund') return <CurrencyRub size={18} weight="bold" aria-hidden="true" />
  if (kind === 'signup') return <UserPlus size={18} weight="bold" aria-hidden="true" />
  if (kind === 'error') return <WarningCircle size={18} weight="bold" aria-hidden="true" />
  return <Lifebuoy size={18} weight="bold" aria-hidden="true" />
}

function FeedRow({ item, onOpenUser, onOpenSection }: { item: Row; onOpenUser: (id: string) => void; onOpenSection: (section: AdminSection, params?: Record<string, string>) => void }) {
  const kind = str(item.kind)
  const ok = item.ok === true
  const who = str(item.name) || str(item.email) || (kind === 'error' ? 'Система' : 'Гость')
  const subject = str(item.subject)
  const userId = str(item.userId)
  let text: ReactNode
  let meta: ReactNode = null
  let tone = ''
  if (kind === 'solution') {
    text = <><b>{who}</b> {ok ? 'получил решение' : 'не получил решение'}{subject ? <>, {subject}</> : null}</>
    meta = ok
      ? <>{numOrNull(item.seconds) !== null ? `${formatNumber(Math.round(num(item.seconds)))} с, ` : ''}себест. {numOrNull(item.cost) !== null ? formatKopecks(num(item.cost)) : '-'}</>
      : 'деньги вернулись'
    tone = ok ? 'is-ok' : 'is-bad'
  } else if (kind === 'payment') {
    text = <><b>{who}</b> пополнил баланс</>
    meta = <span className="dash-plus">+{formatKopecks(num(item.amount))}</span>
    tone = 'is-ok'
  } else if (kind === 'refund') {
    text = <>Возврат пополнения <b>{who}</b></>
    meta = <span className="dash-minus">−{formatKopecks(num(item.amount))}</span>
    tone = 'is-bad'
  } else if (kind === 'signup') {
    text = <><b>{who}</b> зарегистрировался</>
    tone = 'is-blue'
  } else if (kind === 'error') {
    text = <><b>{subject || 'Ошибка'}</b>: {str(item.text)}</>
    tone = ok ? 'is-warn' : 'is-bad'
  } else {
    text = <><b>{who}</b> пишет в поддержку: «{str(item.text)}»</>
    tone = 'is-blue'
  }
  const open = () => {
    if (kind === 'ticket') onOpenSection('support')
    else if (kind === 'error') onOpenSection('monitoring', { m_tab: 'errors' })
    else if (userId) onOpenUser(userId)
  }
  const clickable = kind === 'ticket' || kind === 'error' || Boolean(userId)
  return (
    <li className={`dash-feed-item ${tone}`}>
      <button type="button" disabled={!clickable} onClick={open}>
        <span className="dash-feed-icon">{feedIcon(kind, ok)}</span>
        <span className="dash-feed-text">{text}</span>
        {meta && <span className="dash-feed-meta">{meta}</span>}
        <time className="dash-feed-time">{relativeTime(str(item.at))}</time>
      </button>
    </li>
  )
}

function Feed({ onOpenUser, onOpenSection, pulse }: { onOpenUser: (id: string) => void; onOpenSection: (section: AdminSection, params?: Record<string, string>) => void; pulse: number }) {
  const [kind, setKind] = useState<(typeof feedKinds)[number]['value']>('all')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(5)

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const feed = useAsync(() => adminRpc('admin_dashboard_feed', { p_kind: kind, p_search: query, p_limit: limit }), [kind, query, limit, pulse])
  const data = obj(feed.data)
  const items = rows(data.items)

  return (
    <Panel title="Лента" description="События за 30 дней: решения, оплаты, регистрации, обращения и ошибки." className="dash-feed-panel">
      <div className="dash-feed-tools">
        <div className="dash-chips" role="group" aria-label="Вид событий">
          {feedKinds.map((option) => (
            <button
              key={option.value}
              type="button"
              className="dash-chip"
              aria-pressed={kind === option.value}
              onClick={() => { setKind(option.value); setLimit(5) }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="dash-search">
          <MagnifyingGlass size={16} weight="bold" aria-hidden="true" />
          <span className="adm-visually-hidden">Поиск по ленте</span>
          <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(5) }} placeholder="Имя, почта, предмет, текст" />
        </label>
      </div>
      {feed.error && !feed.data ? (
        <ErrorState message={feed.error} onRetry={feed.reload} />
      ) : items.length ? (
        <>
          <ol className="dash-feed" aria-busy={feed.loading || undefined}>
            {items.map((item) => (
              <FeedRow key={`${str(item.kind)}-${str(item.at)}-${str(item.userId)}-${str(item.text).slice(0, 20)}`} item={item} onOpenUser={onOpenUser} onOpenSection={onOpenSection} />
            ))}
          </ol>
          {data.hasMore === true && (
            <div className="dash-feed-more">
              <Button size="sm" variant="ghost" loading={feed.loading} onClick={() => setLimit((current) => current + 10)}>Показать ещё</Button>
              <small>всего {formatNumber(num(data.total))}</small>
            </div>
          )}
        </>
      ) : feed.loading ? (
        <ol className="dash-feed" aria-hidden="true">
          {['first', 'second', 'third'].map((slot) => <li key={slot} className="dash-feed-item"><span className="dash-skel is-row" /></li>)}
        </ol>
      ) : (
        <EmptyState>{query || kind !== 'all' ? 'Ничего не нашлось. Смени вид событий или запрос.' : 'Событий за 30 дней не было.'}</EmptyState>
      )}
    </Panel>
  )
}

/* ---------- Раздел ---------- */

type Alarm = { key: string; level: 'danger' | 'warning'; text: ReactNode; action: string; onAction: () => void }

export default function DashboardSection() {
  const { openSection, openUser, signals } = useAdmin()
  const [query, setQuery] = useQueryState({ d_period: 'month', d_metric: 'tasks' })
  const period: Period = query.d_period === 'day' || query.d_period === 'week' || query.d_period === 'year' ? query.d_period : 'month'
  const metric = query.d_metric === 'users' ? 'users' : 'tasks'
  const words = periodWords[period]

  const dash = useAsync(() => adminRpc('admin_dashboard_period', { p_period: period }), [period])
  const reload = dash.reload

  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') reload() }, 60_000)
    return () => window.clearInterval(timer)
  }, [reload])

  const lastPulse = useRef(signals.pulse)
  useEffect(() => {
    if (signals.pulse === lastPulse.current) return
    lastPulse.current = signals.pulse
    const timer = window.setTimeout(reload, 1200)
    return () => window.clearTimeout(timer)
  }, [signals.pulse, reload])

  const data = obj(dash.data)
  const current = obj(data.current)
  const previous = obj(data.previous)
  const money = obj(data.money)
  const series = rows(data.series)
  const attention = obj(data.attention)
  const reconciliation = obj(attention.reconciliation)
  const overdue = rows(attention.overdueTickets)
  const gateway = obj(data.gateway)
  const services = obj(data.services)
  const serviceList = rows(services.list)

  const credits = numOrNull(gateway.credits)
  const perTask = numOrNull(gateway.avgCreditsPerTask)
  const tasksLeft = credits !== null && perTask && perTask > 0 ? Math.floor(credits / perTask) : null

  const labels = series.map((item) => pointLabel(str(item.label), period))
  const fullLabels = series.map((item) => (period === 'day' ? `Сегодня, ${str(item.label)}` : pointLabel(str(item.label), period)))
  const pick = (key: string) => series.map((item) => num(item[key]))

  const subjects = useMemo(() => rows(data.subjects).map((item) => ({ label: str(item.subject), solved: num(item.solved), failed: num(item.failed) })), [data.subjects])
  const subjectPeak = Math.max(1, ...subjects.map((item) => item.solved + item.failed))

  const solved = num(current.solved)
  const failed = num(current.failed)
  const attempts = solved + failed

  /* Что горит: только то, что есть, каждое со своим действием. */
  const alarms: Alarm[] = []
  const down = serviceList.filter((item) => item.ok !== true && str(item.status) !== 'not_configured')
  if (overdue.length) {
    alarms.push({
      key: 'overdue', level: 'danger',
      text: <>Без ответа дольше {num(attention.slaMinutes)} мин: <b>{overdue.length}</b>. {str(overdue[0].subject)}, ждёт {formatDuration(num(overdue[0].waitingMinutes))}</>,
      action: 'Ответить', onAction: () => openSection('support', { conversation: str(overdue[0].id), s_status: 'pending_owner' }),
    })
  } else if (signals.pendingTickets) {
    alarms.push({ key: 'pending', level: 'warning', text: <>Ждут ответа: <b>{signals.pendingTickets}</b> обращ.</>, action: 'Открыть', onAction: () => openSection('support', { s_status: 'pending_owner' }) })
  }
  if (down.length) {
    alarms.push({
      key: 'down', level: 'danger',
      text: <>Не отвечает: <b>{down.map((item) => serviceNames[str(item.service)] ?? str(item.service)).join(', ')}</b>{str(down[0].downSince) ? `, с ${relativeTime(str(down[0].downSince))}` : ''}</>,
      action: 'Мониторинг', onAction: () => openSection('monitoring', { m_tab: 'health' }),
    })
  }
  if (num(reconciliation.stuckReservations) || num(reconciliation.walletMismatches)) {
    const parts = [
      num(reconciliation.stuckReservations) ? `${num(reconciliation.stuckReservations)} зависших резервов на ${formatKopecks(num(reconciliation.stuckAmount))}` : '',
      num(reconciliation.walletMismatches) ? `${num(reconciliation.walletMismatches)} балансов не сходятся с операциями` : '',
    ].filter(Boolean)
    alarms.push({ key: 'reconciliation', level: 'danger', text: <>Сверка кошельков: <b>{parts.join(', ')}</b></>, action: 'Сверка', onAction: () => openSection('finance', { fin_tab: 'reconciliation' }) })
  }
  if (tasksLeft !== null && tasksLeft < 300) {
    alarms.push({ key: 'credits', level: tasksLeft < 100 ? 'danger' : 'warning', text: <>Кредитов шлюза хватит примерно на <b>{formatNumber(tasksLeft)}</b> задач</>, action: 'Подробнее', onAction: () => openSection('monitoring', { m_tab: 'health' }) })
  }
  if (num(attention.stuckJobs)) {
    alarms.push({ key: 'stuck', level: 'warning', text: <>Зависли в решении дольше 5 минут: <b>{num(attention.stuckJobs)}</b></>, action: 'Очередь', onAction: () => openSection('monitoring', { m_tab: 'health' }) })
  }
  if (obj(attention.errorSpike).spike === true) {
    alarms.push({ key: 'spike', level: 'danger', text: <>Всплеск ошибок: <b>{num(obj(attention.errorSpike).lastHour)}</b> за час</>, action: 'Ошибки', onAction: () => openSection('monitoring', { m_tab: 'errors' }) })
  } else if (signals.openErrors) {
    alarms.push({ key: 'errors', level: 'warning', text: <>Новых групп ошибок: <b>{signals.openErrors}</b></>, action: 'Ошибки', onAction: () => openSection('monitoring', { m_tab: 'errors', m_status: 'new' }) })
  }
  if (num(attention.fraudOpen)) {
    alarms.push({ key: 'fraud', level: 'warning', text: <>Флаги фрода без решения: <b>{num(attention.fraudOpen)}</b></>, action: 'Разобрать', onAction: () => openSection('fraud') })
  }
  alarms.sort((a, b) => (a.level === b.level ? 0 : a.level === 'danger' ? -1 : 1))

  const exportReport = () => {
    const toRubles = (kopecks: number) => (kopecks / 100).toFixed(2).replace('.', ',')
    const lines = [
      { label: `Итого ${words.current}`, ...current },
      { label: `Сравнение: ${words.previous}`, ...previous },
      ...series.map((item) => ({ ...item, label: pointLabel(str(item.label), period) })),
    ] as Row[]
    downloadCsv(`homework-copilot-dashboard-${period}-${todayMsk()}`, lines, [
      { header: 'Период', value: (row) => str(row.label) },
      { header: 'Заработано, ₽', value: (row) => toRubles(num(row.revenue)) },
      { header: 'Расход на модели, ₽', value: (row) => toRubles(num(row.llmCost)) },
      { header: 'Прибыль после моделей, ₽', value: (row) => toRubles(num(row.revenue) - num(row.llmCost)) },
      { header: 'Отработано, ₽', value: (row) => (row.consumption === undefined ? '' : toRubles(num(row.consumption))) },
      { header: 'Платили учеников', value: (row) => (row.payers === undefined ? '' : num(row.payers)) },
      { header: 'Решено', value: (row) => num(row.solved) },
      { header: 'Не решено', value: (row) => num(row.failed) },
      { header: 'Новые ученики', value: (row) => num(row.registrations) },
      { header: 'Заходили', value: (row) => num(row.active) },
    ])
  }

  const header = (
    <PageHeader
      title="Дашборд"
      description={`Цифры ${words.current}, сравнение - ${words.previous}. Обновляется само.`}
      actions={(
        <>
          <Segmented
            label="Период"
            value={period}
            onChange={(value) => setQuery({ d_period: value }, { replace: true })}
            options={[{ value: 'day', label: 'День' }, { value: 'week', label: 'Неделя' }, { value: 'month', label: 'Месяц' }, { value: 'year', label: 'Год' }]}
          />
          <Button size="sm" onClick={reload} loading={dash.loading} icon={<ArrowClockwise size={16} weight="bold" aria-hidden="true" />} aria-label="Обновить" />
          <Button size="sm" variant="primary" disabled={!dash.data} onClick={exportReport} icon={<DownloadSimple size={16} weight="bold" aria-hidden="true" />}>Скачать отчёт</Button>
        </>
      )}
    />
  )

  if (dash.error && !dash.data) return <>{header}<ErrorState message={dash.error} onRetry={reload} /></>

  const loading = !dash.data

  return (
    <>
      {header}

      {loading ? <Skeleton kind="hero" /> : (
        <MoneyHero
          period={period}
          current={current}
          previous={previous}
          money={money}
          labels={labels}
          fullLabels={fullLabels}
          revenueSeries={pick('revenue')}
          costSeries={pick('llmCost')}
        />
      )}

      {!loading && (alarms.length ? (
        <section className={`dash-alerts${alarms.some((alarm) => alarm.level === 'danger') ? ' is-danger' : ' is-warning'}`} aria-label={`Требует внимания: ${alarms.length}`}>
          <ul className="dash-alert-list">
            {alarms.map((alarm) => (
              <li key={alarm.key} className={`dash-alert is-${alarm.level}`}>
                {alarm.level === 'danger'
                  ? <WarningCircle className="dash-alert-icon" size={20} weight="fill" aria-hidden="true" />
                  : <Warning className="dash-alert-icon" size={20} weight="fill" aria-hidden="true" />}
                <p>{alarm.text}</p>
                <Button size="sm" variant={alarm.level === 'danger' ? 'accent' : 'secondary'} onClick={alarm.onAction} icon={<ArrowRight size={14} weight="bold" aria-hidden="true" />}>{alarm.action}</Button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="dash-calm"><CheckCircle size={20} weight="fill" aria-hidden="true" /> <span><b>Всё спокойно.</b> Обращения отвечены, сервисы работают, сверка сходится.</span></p>
      ))}

      <div className="dash-kpis">
        {loading ? (
          <><Skeleton kind="kpi" /><Skeleton kind="kpi" /><Skeleton kind="kpi" /><Skeleton kind="kpi" /></>
        ) : (
          <>
            <Kpi
              id="kpi-solved"
              label={`Решено ${words.current}`}
              tip="Решения, которые модель довела до конца и отдала ученику или гостю. «Не решено» - попытки, где решение не прошло проверку или сорвалось; деньги за них вернулись."
              value={formatNumber(solved)}
              tone={solved > 0 ? 'ok' : 'ink'}
              state={failed > solved && failed > 2 ? 'bad' : undefined}
              trend={pick('solved')}
              trendLabel={`Решено ${words.chart}`}
            >
              <Change current={solved} previous={num(previous.solved)} vs={words.previous} />
              {failed > 0 && <small className="dash-bad-text">не решено: {failed}{attempts ? ` (${formatPercent((failed / attempts) * 100)})` : ''}</small>}
            </Kpi>

            <Kpi
              id="kpi-students"
              label="Новые ученики"
              tip={`Аккаунты, зарегистрированные ${words.current}. «Гости с задачей» - браузеры без аккаунта, которые ставили задачу.`}
              value={formatNumber(num(current.registrations))}
              tone={num(current.registrations) > 0 ? 'ok' : 'ink'}
              trend={pick('registrations')}
              trendLabel={`Регистрации ${words.chart}`}
            >
              <Change current={num(current.registrations)} previous={num(previous.registrations)} vs={words.previous} />
              {num(current.guests) > 0 && <small>гостей с задачей: {num(current.guests)}</small>}
            </Kpi>

            <Kpi
              id="kpi-online"
              label="Онлайн сейчас"
              tip={`Ученики с активностью за последние 10 минут, от периода не зависит. «Заходили» - уникальные ученики, которые открывали приложение или ставили задачу ${words.current}. Пульс активности пишется с 12 сентября.`}
              value={formatNumber(num(data.online))}
              tone="blue"
              trend={pick('active')}
              trendLabel={`Заходили ${words.chart}`}
            >
              <small>заходили {words.current}: <b>{formatNumber(num(current.active))}</b></small>
              <small>{words.previous}: {formatNumber(num(previous.active))}</small>
            </Kpi>

            <Kpi
              id="kpi-credits"
              label="Кредиты шлюза"
              tip="Остаток на счету шлюза моделей по последней проверке и примерный запас задач: остаток, делённый на средний расход кредитов на задачу за 7 дней. Микрографик - сколько задач уходило в шлюз."
              value={credits !== null ? formatNumber(Math.round(credits)) : '-'}
              tone={tasksLeft !== null && tasksLeft < 100 ? 'bad' : tasksLeft !== null && tasksLeft < 300 ? 'warn' : 'ink'}
              state={tasksLeft !== null && tasksLeft < 100 ? 'bad' : tasksLeft !== null && tasksLeft < 300 ? 'warn' : undefined}
              trend={series.map((item) => num(item.solved) + num(item.failed))}
              trendLabel={`Задачи в шлюз ${words.chart}`}
            >
              <small>
                {tasksLeft !== null
                  ? <>хватит примерно на <b>{formatNumber(tasksLeft)}</b> задач</>
                  : 'запас появится после первых задач за неделю'}
              </small>
              {str(gateway.checkedAt) && <small>проверено {relativeTime(str(gateway.checkedAt))}</small>}
            </Kpi>
          </>
        )}
      </div>

      <Panel
        title="Задачи и ученики"
        description={`${words.chart[0].toUpperCase()}${words.chart.slice(1)}. Наведи на столбец - покажет значения; легенда включает и выключает ряды.`}
        actions={(
          <Segmented
            label="Показатель"
            value={metric}
            onChange={(value) => setQuery({ d_metric: value }, { replace: true })}
            options={[{ value: 'tasks', label: 'Задачи' }, { value: 'users', label: 'Ученики' }]}
          />
        )}
      >
        {loading ? <span className="dash-skel is-chart" aria-hidden="true" /> : metric === 'tasks' ? (
          <DynamicsChart
            key={`tasks-${period}`}
            labels={labels}
            fullLabels={fullLabels}
            stacked
            format={(value) => formatNumber(Math.round(value))}
            series={[
              { key: 'solved', name: 'Решено', tone: 'ok', values: pick('solved') },
              { key: 'failed', name: 'Не решено', tone: 'bad', values: pick('failed') },
            ]}
          />
        ) : (
          <DynamicsChart
            key={`users-${period}`}
            labels={labels}
            fullLabels={fullLabels}
            stacked={false}
            format={(value) => formatNumber(Math.round(value))}
            series={[
              { key: 'active', name: 'Заходили', tone: 'blue', values: pick('active') },
              { key: 'registrations', name: 'Новые', tone: 'ok', values: pick('registrations') },
            ]}
          />
        )}
      </Panel>

      <div className="adm-grid-2 dash-pair">
        <Panel title="Сервисы" actions={<Button size="sm" variant="ghost" onClick={() => openSection('monitoring', { m_tab: 'health' })}>Мониторинг</Button>}>
          {serviceList.length ? (
            <ul className="dash-lights">
              {serviceList.map((item) => {
                const status = str(item.status)
                const state = item.ok === true ? 'ok' : status === 'not_configured' ? 'off' : 'bad'
                const name = serviceNames[str(item.service)] ?? str(item.service)
                const note = state === 'ok'
                  ? (numOrNull(item.latencyMs) !== null ? `${formatNumber(num(item.latencyMs))} мс` : 'работает')
                  : state === 'off' ? 'не настроено' : `не отвечает${str(item.downSince) ? ` с ${relativeTime(str(item.downSince))}` : ''}`
                return (
                  <li key={str(item.service)} className={`is-${state}`}>
                    <i aria-hidden="true" />
                    <span className="dash-light-name">{name}</span>
                    <span className="dash-light-note">{note}</span>
                    <span className="adm-visually-hidden">{state === 'ok' ? 'работает' : state === 'off' ? 'не настроено' : 'не отвечает'}</span>
                  </li>
                )
              })}
            </ul>
          ) : <EmptyState>Проверок ещё не было.</EmptyState>}
          {str(services.checkedAt) && <p className="dash-note">Проверено {relativeTime(str(services.checkedAt))}. Проверка раз в 5 минут.</p>}
        </Panel>

        <Panel title={`Предметы ${words.current}`}>
          {subjects.length ? (
            <ol className="dash-rank">
              {subjects.slice(0, 8).map((item, index) => (
                <li key={item.label}>
                  <span className="dash-rank-place">{index + 1}</span>
                  <span className="dash-rank-name">{item.label}</span>
                  <span className="dash-rank-bar" aria-hidden="true">
                    <i className="is-ok" style={{ width: `${(item.solved / subjectPeak) * 100}%` }} />
                    <i className="is-bad" style={{ width: `${(item.failed / subjectPeak) * 100}%` }} />
                  </span>
                  <span className="dash-rank-value">
                    <b>{formatNumber(item.solved)}</b>
                    {item.failed > 0 && <small>не решено {item.failed}</small>}
                  </span>
                </li>
              ))}
            </ol>
          ) : <EmptyState>Задач {words.current} не было.</EmptyState>}
        </Panel>
      </div>

      <Feed onOpenUser={openUser} onOpenSection={(section, params) => openSection(section, params)} pulse={signals.pulse} />
    </>
  )
}
