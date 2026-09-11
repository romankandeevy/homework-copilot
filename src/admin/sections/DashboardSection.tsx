/* Дашборд: метрики с дельтой к прошлому периоду, графики, когорты,
   воронка и то, что требует внимания прямо сейчас. Цифры приходят из
   дневных агрегатов (private.daily_metrics), а не сырыми запросами. */

import { useEffect, useMemo, useRef } from 'react'
import { ArrowClockwise } from '@phosphor-icons/react'
import { adminRpc, delta, formatDuration, formatKopecks, formatNumber, formatPercent, formatShortDate, num, obj, rows, shiftDate, str, todayMsk } from '../api'
import type { Row } from '../api'
import { useAdmin } from '../context'
import { Badge, Button, DateRangePicker, ErrorState, LineChart, LoadingState, PageHeader, Panel, Stat, StatGrid, StackedBars, useAsync, useQueryState } from '../ui'

function compactRubles(kopecks: number) {
  const rubles = kopecks / 100
  if (Math.abs(rubles) >= 1_000_000) return `${formatNumber(Math.round(rubles / 100_000) / 10)} млн ₽`
  if (Math.abs(rubles) >= 10_000) return `${formatNumber(Math.round(rubles / 100) / 10)} тыс ₽`
  return `${formatNumber(Math.round(rubles * 10) / 10)} ₽`
}

const funnelLabels: Record<string, string> = {
  registered: 'Регистрация',
  first_task: 'Первая задача',
  limit_exhausted: 'Баланс исчерпан',
  paid: 'Оплата',
}

function cohortCell(value: number | null) {
  if (value === null) return { background: 'transparent', color: 'var(--color-text-subtle)' }
  const share = Math.min(1, value / 100)
  return {
    background: `color-mix(in oklch, var(--color-accent) ${Math.round(8 + share * 72)}%, var(--color-surface))`,
    color: share > 0.45 ? 'var(--color-on-accent)' : 'var(--color-text)',
  }
}

export default function DashboardSection() {
  const { openSection, openUser, signals } = useAdmin()
  const today = todayMsk()
  const [query, setQuery] = useQueryState({ d_from: '', d_to: '' })
  const range = { from: query.d_from || shiftDate(today, -29), to: query.d_to || today }
  const { data, error, loading, reload } = useAsync(
    () => adminRpc('admin_dashboard_v2', { p_from: range.from, p_to: range.to }),
    [range.from, range.to],
  )

  // Новое событие Realtime (обращение, ошибка) - обновляем блок внимания.
  const lastPulse = useRef(signals.pulse)
  useEffect(() => {
    if (signals.pulse === lastPulse.current) return
    lastPulse.current = signals.pulse
    const timer = window.setTimeout(reload, 1500)
    return () => window.clearTimeout(timer)
  }, [signals.pulse, reload])

  const dashboard = obj(data)
  const current = obj(dashboard.current)
  const previous = obj(dashboard.previous)
  const series = rows(dashboard.series)
  const labels = series.map((item) => str(item.date))

  const subjects = useMemo(() => {
    const totals = new Map<string, number>()
    for (const item of series) {
      for (const [subject, count] of Object.entries(obj(item.bySubject))) totals.set(subject, (totals.get(subject) ?? 0) + num(count))
    }
    const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([subject]) => subject)
    // Больше семи цветов не различить: хвост складываем в «Остальные».
    const head = ordered.slice(0, 7)
    const tail = ordered.slice(7)
    const stacks = head.map((subject) => ({ name: subject, values: series.map((item) => num(obj(item.bySubject)[subject])) }))
    if (tail.length) stacks.push({ name: 'Остальные', values: series.map((item) => tail.reduce((sum, subject) => sum + num(obj(item.bySubject)[subject]), 0)) })
    return stacks
  }, [series])

  const metric = (key: string) => num(current[key])
  const change = (key: string) => delta(num(current[key]), num(previous[key]))
  const attention = obj(dashboard.attention)
  const overdue = rows(attention.overdueTickets)
  const flags = rows(attention.fraudFlags)
  const spike = obj(attention.errorSpike)
  const funnel = rows(dashboard.funnel)
  const cohorts = rows(dashboard.cohorts)

  if (loading && !data) return <><PageHeader title="Дашборд" /><LoadingState /></>
  if (error && !data) return <><PageHeader title="Дашборд" /><ErrorState message={error} onRetry={reload} /></>

  const attentionItems: { key: string; tone: 'danger' | 'warning' | 'ok'; text: React.ReactNode; action?: React.ReactNode }[] = [
    {
      key: 'tickets',
      tone: overdue.length ? 'danger' : 'ok',
      text: overdue.length
        ? <><b>{overdue.length}</b> обращений без ответа дольше {num(attention.slaMinutes)} мин</>
        : `Все обращения отвечены в пределах ${num(attention.slaMinutes)} мин`,
      action: overdue.length ? <Button size="sm" onClick={() => openSection('support', { conversation: str(overdue[0].id), s_status: 'pending_owner' })}>Ответить</Button> : null,
    },
    {
      key: 'fraud',
      tone: num(attention.fraudOpen) ? 'warning' : 'ok',
      text: num(attention.fraudOpen) ? <><b>{num(attention.fraudOpen)}</b> пользователей с флагом фрода</> : 'Открытых флагов фрода нет',
      action: num(attention.fraudOpen) ? <Button size="sm" onClick={() => openSection('fraud')}>Разобрать</Button> : null,
    },
    {
      key: 'errors',
      tone: spike.spike ? 'danger' : 'ok',
      text: spike.spike
        ? <>Всплеск ошибок: <b>{num(spike.lastHour)}</b> за час при норме {formatNumber(num(spike.norm))}</>
        : `Ошибок за час: ${num(spike.lastHour)} - в пределах нормы`,
      action: num(spike.lastHour) ? <Button size="sm" onClick={() => openSection('monitoring', { m_tab: 'errors' })}>Открыть</Button> : null,
    },
    {
      key: 'payments',
      tone: num(attention.paymentRejections24h) ? 'warning' : 'ok',
      text: num(attention.paymentRejections24h)
        ? <><b>{num(attention.paymentRejections24h)}</b> отказов оплаты за сутки (не хватило баланса){num(attention.refunds24h) ? `, возвратов: ${num(attention.refunds24h)}` : ''}</>
        : `Отказов оплаты за сутки нет${num(attention.refunds24h) ? `, возвратов: ${num(attention.refunds24h)}` : ''}`,
      action: num(attention.paymentRejections24h) ? <Button size="sm" onClick={() => openSection('finance', { fin_tab: 'payments', fin_status: 'failed' })}>Смотреть</Button> : null,
    },
    {
      key: 'queue',
      tone: num(attention.stuckJobs) ? 'warning' : 'ok',
      text: num(attention.stuckJobs) ? <><b>{num(attention.stuckJobs)}</b> задач зависли в решении дольше 5 минут</> : 'Очередь решений движется',
      action: num(attention.stuckJobs) ? <Button size="sm" onClick={() => openSection('monitoring', { m_tab: 'health' })}>Очередь</Button> : null,
    },
  ]

  return (
    <>
      <PageHeader
        title="Дашборд"
        description={`${formatShortDate(str(dashboard.from))} - ${formatShortDate(str(dashboard.to))}, сравнение с ${formatShortDate(str(dashboard.previousFrom))} - ${formatShortDate(str(dashboard.previousTo))}. Выручка - подтверждённые пополнения минус возвраты: платёжный провайдер ещё не подключён.`}
        actions={(
          <>
            <DateRangePicker value={range} onChange={(next) => setQuery({ d_from: next.from, d_to: next.to })} />
            <Button size="sm" onClick={reload} loading={loading} icon={<ArrowClockwise size={16} weight="bold" aria-hidden="true" />} aria-label="Обновить" />
          </>
        )}
      />

      <Panel title="Требует внимания">
        <ul className="adm-attention">
          {attentionItems.map((item) => (
            <li key={item.key} className={`is-${item.tone}`}>
              <span>{item.text}</span>
              {item.action}
            </li>
          ))}
        </ul>
        {(overdue.length > 0 || flags.length > 0) && (
          <div className="adm-grid-2" style={{ marginTop: 'var(--space-4)' }}>
            {overdue.length > 0 && (
              <div>
                <h3 className="adm-muted" style={{ fontSize: 'var(--text-small)', marginBottom: 'var(--space-2)' }}>Просроченные обращения</h3>
                <ul className="adm-list">
                  {overdue.slice(0, 5).map((ticket) => (
                    <li key={str(ticket.id)}>
                      <button type="button" className="adm-list-button" onClick={() => openSection('support', { conversation: str(ticket.id) })}>
                        <span className="adm-cell-main" style={{ textAlign: 'left' }}><strong>{str(ticket.subject)}</strong><small>{str(ticket.email)}</small></span>
                        <Badge tone="danger">{formatDuration(num(ticket.waitingMinutes))}</Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {flags.length > 0 && (
              <div>
                <h3 className="adm-muted" style={{ fontSize: 'var(--text-small)', marginBottom: 'var(--space-2)' }}>Флаги фрода</h3>
                <ul className="adm-list">
                  {flags.slice(0, 5).map((flag) => (
                    <li key={str(flag.id)}>
                      <button type="button" className="adm-list-button" onClick={() => openUser(str(flag.userId))}>
                        <span className="adm-cell-main" style={{ textAlign: 'left' }}><strong>{str(flag.email)}</strong><small>{str(flag.explanation)}</small></span>
                        <Badge tone={str(flag.risk) === 'high' ? 'danger' : str(flag.risk) === 'medium' ? 'warning' : 'neutral'}>{str(flag.risk) === 'high' ? 'высокий' : str(flag.risk) === 'medium' ? 'средний' : 'низкий'}</Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Panel>

      <StatGrid>
        <Stat label="Выручка за период" value={formatKopecks(metric('revenue'))} delta={change('revenue')} hint={`${formatNumber(metric('topUps'))} пополнений`} />
        <Stat label="MRR" value={formatKopecks(metric('mrr'))} delta={change('mrr')} hint="выручка за 30 дней до конца периода" />
        <Stat label="Средний чек" value={formatKopecks(metric('averageCheck'))} delta={change('averageCheck')} />
        <Stat label="Расход на LLM" value={formatKopecks(metric('llmCost'))} delta={change('llmCost')} invert hint={`решения ${compactRubles(metric('solutionCost'))}, чат ${compactRubles(metric('chatCost'))}`} />
        <Stat label="Маржа" value={formatKopecks(metric('margin'))} delta={change('margin')} tone={metric('margin') < 0 ? 'danger' : undefined} hint="выручка минус токены" />
        <Stat label="Новые регистрации" value={formatNumber(metric('registrations'))} delta={change('registrations')} />
        <Stat label="DAU / WAU / MAU" value={`${formatNumber(metric('dau'))} / ${formatNumber(metric('wau'))} / ${formatNumber(metric('mau'))}`} delta={change('mau')} hint="DAU - среднее за день периода" />
        <Stat label="Решено задач" value={formatNumber(metric('solved'))} delta={change('solved')} hint={`не решено: ${formatNumber(metric('failed'))}`} />
        <Stat label="Регистрация → оплата" value={formatPercent(metric('conversion'))} delta={change('conversion')} hint="из зарегистрированных за период" />
        <Stat
          label="Ошибки за период"
          value={formatNumber(metric('errors'))}
          delta={change('errors')}
          invert
          tone={dashboard.errorsAboveNorm === true ? 'danger' : undefined}
          hint={dashboard.errorsAboveNorm === true ? 'за последний час выше нормы' : `за час: ${num(dashboard.errorsLastHour)}`}
        />
      </StatGrid>

      <div className="adm-grid-main">
        <Panel title="Выручка и расход на LLM" description="По дням, в рублях.">
          <LineChart
            labels={labels}
            format={compactRubles}
            series={[
              { name: 'Выручка', values: series.map((item) => num(item.revenue)), tone: 1 },
              { name: 'Расход на LLM', values: series.map((item) => num(item.llmCost)), tone: 2 },
            ]}
          />
        </Panel>
        <Panel title="Регистрации по дням">
          <LineChart kind="bar" labels={labels} series={[{ name: 'Регистрации', values: series.map((item) => num(item.registrations)), tone: 3 }]} />
        </Panel>
      </div>

      <Panel title="Задачи по дням" description="Решённые задачи с разбивкой по предметам.">
        <StackedBars labels={labels} stacks={subjects} />
      </Panel>

      <div className="adm-grid-2">
        <Panel title="Воронка" description="Зарегистрированные за период: дошли до первой задачи, исчерпали баланс, заплатили.">
          <div className="adm-funnel">
            {funnel.map((step: Row, index) => {
              const count = num(step.count)
              const first = num(funnel[0]?.count)
              const before = index > 0 ? num(funnel[index - 1].count) : count
              return (
                <div className="adm-funnel-step" key={str(step.step)}>
                  <span>{funnelLabels[str(step.step)] ?? str(step.step)}</span>
                  <div className="adm-funnel-bar" style={{ width: `${first ? Math.max(2, (count / first) * 100) : 2}%` }} />
                  <b>{formatNumber(count)}{index > 0 && before > 0 ? ` · ${formatPercent((count / before) * 100)}` : ''}</b>
                </div>
              )
            })}
          </div>
        </Panel>

        <Panel title="Удержание по неделям регистрации" description="Доля когорты, заходившая в неделю N после регистрации.">
          {cohorts.length === 0 ? <p className="adm-muted">Регистраций за 12 недель нет.</p> : (
            <div className="adm-table-wrap">
              <table className="adm-cohorts">
                <thead>
                  <tr>
                    <th>Неделя</th>
                    <th>Размер</th>
                    {Array.from({ length: 8 }, (_, index) => <th key={index}>{index}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {cohorts.map((cohort) => {
                    const retention = Array.isArray(cohort.retention) ? cohort.retention : []
                    return (
                      <tr key={str(cohort.week)}>
                        <td className="is-label">{formatShortDate(str(cohort.week))}</td>
                        <td className="is-label">{num(cohort.size)}</td>
                        {Array.from({ length: 8 }, (_, index) => {
                          const raw = retention[index]
                          const value = typeof raw === 'number' ? raw : null
                          return <td key={index} style={cohortCell(value)}>{value === null ? '' : `${formatNumber(Math.round(value))}%`}</td>
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}
