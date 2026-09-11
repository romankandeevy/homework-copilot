/* Дашборд: что происходит сейчас и куда смотреть.

   Сознательно отступает от ТЗ. На сервисе с десятком учеников MRR,
   когорты, воронка и десять карточек показателей - шум: по ним нечего
   делать. Здесь только то, по чему владелец действует: что горит, как
   идёт сегодняшний день против вчерашнего к этому же часу, хватит ли
   кредитов шлюза, куда идёт период и живая лента событий. */

import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { ArrowClockwise, ArrowRight, CheckCircle, CurrencyRub, Lifebuoy, UserPlus, XCircle } from '@phosphor-icons/react'
import { adminRpc, formatDuration, formatKopecks, formatNumber, formatPercent, num, numOrNull, obj, relativeTime, rows, shiftDate, str, todayMsk } from '../api'
import type { Row } from '../api'
import type { AdminSection } from '../context'
import { useAdmin } from '../context'
import { Button, EmptyState, ErrorState, HorizontalBars, LineChart, LoadingState, PageHeader, Panel, Segmented, StackedBars, useAsync, useQueryState } from '../ui'
import './dashboard.css'

type Metric = 'tasks' | 'money' | 'users'
type Period = '7' | '30' | '90'

const serviceNames: Record<string, string> = {
  kie: 'шлюз моделей',
  'vercel-api': 'функции Vercel',
  'supabase-proxy': 'прокси Supabase',
  frontend: 'сайт',
  database: 'база',
  storage: 'хранилище',
  telegram: 'Telegram',
  email: 'почта',
}

function compactRubles(kopecks: number) {
  const rubles = kopecks / 100
  if (Math.abs(rubles) >= 1_000_000) return `${formatNumber(Math.round(rubles / 100_000) / 10)} млн ₽`
  if (Math.abs(rubles) >= 10_000) return `${formatNumber(Math.round(rubles / 100) / 10)} тыс ₽`
  return `${formatNumber(Math.round(rubles * 10) / 10)} ₽`
}

/* Разница с вчерашним днём к этому же часу - абсолютная: на малых числах
   «+200 %» от одной задачи к трём ничего не объясняет. */
function Versus({ today, yesterday, money = false, invert = false }: { today: number; yesterday: number; money?: boolean; invert?: boolean }) {
  const diff = today - yesterday
  const tone = diff === 0 ? 'is-flat' : (diff > 0) !== invert ? 'is-good' : 'is-bad'
  const shown = money ? formatKopecks(Math.abs(diff)) : formatNumber(Math.abs(diff))
  return (
    <span className="dash-versus">
      <b className={`adm-delta ${tone}`}>{diff === 0 ? 'как вчера' : `${diff > 0 ? '+' : '−'}${shown}`}</b>
      <small>вчера к этому часу: {money ? formatKopecks(yesterday) : formatNumber(yesterday)}</small>
    </span>
  )
}

function TodayNumber({ label, value, children, tone }: { label: string; value: ReactNode; children?: ReactNode; tone?: 'danger' }) {
  return (
    <div className={`adm-stat${tone ? ` is-${tone}` : ''}`}>
      <strong className="adm-stat-value">{value}</strong>
      <span className="adm-stat-label">{label}</span>
      {children && <span className="adm-stat-foot">{children}</span>}
    </div>
  )
}

type Alarm = { key: string; level: 'danger' | 'warning'; text: ReactNode; action: string; onAction: () => void }

function feedIcon(kind: string, ok: boolean) {
  if (kind === 'solution') return ok ? <CheckCircle size={18} weight="bold" aria-hidden="true" /> : <XCircle size={18} weight="bold" aria-hidden="true" />
  if (kind === 'payment' || kind === 'refund') return <CurrencyRub size={18} weight="bold" aria-hidden="true" />
  if (kind === 'signup') return <UserPlus size={18} weight="bold" aria-hidden="true" />
  return <Lifebuoy size={18} weight="bold" aria-hidden="true" />
}

function FeedRow({ item, onOpenUser, onOpenSection }: { item: Row; onOpenUser: (id: string) => void; onOpenSection: (section: AdminSection) => void }) {
  const kind = str(item.kind)
  const ok = item.ok === true
  const who = str(item.name) || str(item.email) || 'Гость'
  const subject = str(item.subject)
  const userId = str(item.userId)
  let text: ReactNode
  let meta: ReactNode = null
  if (kind === 'solution') {
    text = <><b>{who}</b> {ok ? 'получил решение' : 'не получил решение'}{subject ? <> · {subject}</> : null}</>
    meta = ok
      ? <>{numOrNull(item.seconds) !== null ? `${formatNumber(Math.round(num(item.seconds)))} с · ` : ''}себест. {numOrNull(item.cost) !== null ? formatKopecks(num(item.cost)) : '—'}</>
      : 'деньги вернулись'
  } else if (kind === 'payment') {
    text = <><b>{who}</b> пополнил баланс</>
    meta = <span className="dash-plus">+{formatKopecks(num(item.amount))}</span>
  } else if (kind === 'refund') {
    text = <>Возврат пополнения <b>{who}</b></>
    meta = <span className="dash-minus">−{formatKopecks(num(item.amount))}</span>
  } else if (kind === 'signup') {
    text = <><b>{who}</b> зарегистрировался</>
  } else {
    text = <><b>{who}</b> пишет в поддержку: «{str(item.text)}»</>
  }
  const clickable = kind === 'ticket' || Boolean(userId)
  return (
    <li className={`dash-feed-item is-${kind}${kind === 'solution' && !ok ? ' is-failed' : ''}`}>
      <button
        type="button"
        disabled={!clickable}
        onClick={() => { if (kind === 'ticket') onOpenSection('support'); else if (userId) onOpenUser(userId) }}
      >
        <span className="dash-feed-icon">{feedIcon(kind, ok)}</span>
        <span className="dash-feed-text">{text}</span>
        {meta && <span className="dash-feed-meta">{meta}</span>}
        <time className="dash-feed-time">{relativeTime(str(item.at))}</time>
      </button>
    </li>
  )
}

export default function DashboardSection() {
  const { openSection, openUser, signals } = useAdmin()
  const [query, setQuery] = useQueryState({ d_period: '30', d_metric: 'tasks' })
  const period: Period = query.d_period === '7' || query.d_period === '90' ? query.d_period : '30'
  const metric: Metric = query.d_metric === 'money' || query.d_metric === 'users' ? query.d_metric : 'tasks'
  const today = todayMsk()

  const live = useAsync(() => adminRpc('admin_dashboard_today'), [])
  const trend = useAsync(
    () => adminRpc('admin_dashboard_v2', { p_from: shiftDate(today, -(Number(period) - 1)), p_to: today }),
    [period, today],
  )
  const reloadLive = live.reload
  const reloadTrend = trend.reload

  // Сегодняшние цифры и лента обновляются сами: раз в минуту и по событию Realtime.
  useEffect(() => {
    const timer = window.setInterval(reloadLive, 60_000)
    return () => window.clearInterval(timer)
  }, [reloadLive])

  const lastPulse = useRef(signals.pulse)
  useEffect(() => {
    if (signals.pulse === lastPulse.current) return
    lastPulse.current = signals.pulse
    const timer = window.setTimeout(() => { reloadLive(); reloadTrend() }, 1200)
    return () => window.clearTimeout(timer)
  }, [signals.pulse, reloadLive, reloadTrend])

  const now = obj(live.data)
  const todayCounts = obj(now.today)
  const yesterdayCounts = obj(now.yesterday)
  const gateway = obj(now.gateway)
  const services = obj(now.services)
  const feed = rows(now.feed)
  const down = Array.isArray(services.down) ? services.down.map(String) : []
  const notConfigured = Array.isArray(services.notConfigured) ? services.notConfigured.map(String) : []

  const period$ = obj(trend.data)
  const summary = obj(period$.current)
  const series = rows(period$.series)
  const labels = series.map((item) => str(item.date))
  const attention = obj(period$.attention)
  const overdue = rows(attention.overdueTickets)

  const credits = numOrNull(gateway.credits)
  const perTask = numOrNull(gateway.avgCreditsPerTask)
  const tasksLeft = credits !== null && perTask && perTask > 0 ? Math.floor(credits / perTask) : null

  const subjects = useMemo(() => {
    const totals = new Map<string, number>()
    for (const item of series) {
      for (const [subject, count] of Object.entries(obj(item.bySubject))) totals.set(subject, (totals.get(subject) ?? 0) + num(count))
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))
  }, [series])

  /* Что горит: только то, что есть, каждое со своим действием. */
  const alarms: Alarm[] = []
  if (overdue.length) {
    alarms.push({
      key: 'overdue', level: 'danger',
      text: <>Без ответа дольше {num(attention.slaMinutes)} мин: <b>{overdue.length}</b> · {str(overdue[0].subject)}, ждёт {formatDuration(num(overdue[0].waitingMinutes))}</>,
      action: 'Ответить', onAction: () => openSection('support', { conversation: str(overdue[0].id), s_status: 'pending_owner' }),
    })
  } else if (signals.pendingTickets) {
    alarms.push({ key: 'pending', level: 'warning', text: <>Ждут ответа: <b>{signals.pendingTickets}</b> обращ.</>, action: 'Открыть', onAction: () => openSection('support', { s_status: 'pending_owner' }) })
  }
  if (down.length) {
    alarms.push({ key: 'down', level: 'danger', text: <>Не отвечает: <b>{down.map((name) => serviceNames[name] ?? name).join(', ')}</b></>, action: 'Мониторинг', onAction: () => openSection('monitoring', { m_tab: 'health' }) })
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

  const loadingFirst = (live.loading && !live.data) || (trend.loading && !trend.data)
  if (loadingFirst) return <><PageHeader title="Дашборд" /><LoadingState /></>
  if (live.error && !live.data) return <><PageHeader title="Дашборд" /><ErrorState message={live.error} onRetry={reloadLive} /></>

  const solvedToday = num(todayCounts.solved)
  const failedToday = num(todayCounts.failed)
  const periodSolved = num(summary.solved)
  const periodFailed = num(summary.failed)

  return (
    <>
      <PageHeader
        title="Дашборд"
        description={`Сегодня, ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'Europe/Moscow' }).format(new Date())}. Цифры и лента обновляются сами.`}
        actions={<Button size="sm" onClick={() => { reloadLive(); reloadTrend() }} loading={live.loading || trend.loading} icon={<ArrowClockwise size={16} weight="bold" aria-hidden="true" />}>Обновить</Button>}
      />

      {alarms.length ? (
        <section className="dash-alarms" aria-label="Что требует действия">
          {alarms.map((alarm) => (
            <div key={alarm.key} className={`dash-alarm is-${alarm.level}`}>
              <span className="dash-alarm-dot" aria-hidden="true" />
              <p>{alarm.text}</p>
              <Button size="sm" variant={alarm.level === 'danger' ? 'accent' : 'secondary'} onClick={alarm.onAction} icon={<ArrowRight size={14} weight="bold" aria-hidden="true" />}>{alarm.action}</Button>
            </div>
          ))}
        </section>
      ) : (
        <section className="dash-calm" aria-label="Что требует действия">
          <span className="dash-alarm-dot" aria-hidden="true" />
          <p><b>Всё спокойно.</b> Обращения отвечены, сервисы работают, очередь движется.</p>
        </section>
      )}

      <div className="adm-stat-grid dash-today">
        <TodayNumber label="Решено сегодня" value={formatNumber(solvedToday)} tone={failedToday > solvedToday && failedToday > 2 ? 'danger' : undefined}>
          <Versus today={solvedToday} yesterday={num(yesterdayCounts.solved)} />
          {failedToday > 0 && <small className="dash-failed">не решено: {failedToday}</small>}
        </TodayNumber>
        <TodayNumber label="Заработано сегодня" value={formatKopecks(num(todayCounts.revenue))}>
          <Versus today={num(todayCounts.revenue)} yesterday={num(yesterdayCounts.revenue)} money />
        </TodayNumber>
        <TodayNumber label="Расход на модели" value={formatKopecks(num(todayCounts.llmCost))}>
          <Versus today={num(todayCounts.llmCost)} yesterday={num(yesterdayCounts.llmCost)} money invert />
        </TodayNumber>
        <TodayNumber label="Новые ученики" value={formatNumber(num(todayCounts.registrations))}>
          <Versus today={num(todayCounts.registrations)} yesterday={num(yesterdayCounts.registrations)} />
          {num(todayCounts.guests) > 0 && <small>гостей с задачей: {num(todayCounts.guests)}</small>}
        </TodayNumber>
        <TodayNumber label="Онлайн сейчас" value={formatNumber(num(now.online))}>
          <small>заходили сегодня: {formatNumber(num(todayCounts.active))}</small>
        </TodayNumber>
      </div>

      <div className="adm-grid-main">
        <Panel
          title="Динамика"
          actions={(
            <>
              <Segmented label="Показатель" value={metric} onChange={(value) => setQuery({ d_metric: value }, { replace: true })} options={[{ value: 'tasks', label: 'Задачи' }, { value: 'money', label: 'Деньги' }, { value: 'users', label: 'Ученики' }]} />
              <Segmented label="Период" value={period} onChange={(value) => setQuery({ d_period: value }, { replace: true })} options={[{ value: '7', label: '7 дн' }, { value: '30', label: '30 дн' }, { value: '90', label: '90 дн' }]} />
            </>
          )}
        >
          <dl className="dash-totals">
            {metric === 'tasks' && (
              <>
                <div><dt>Решено</dt><dd>{formatNumber(periodSolved)}</dd></div>
                <div><dt>Не решено</dt><dd>{formatNumber(periodFailed)}</dd></div>
                <div><dt>Доля неудач</dt><dd>{periodSolved + periodFailed ? formatPercent((periodFailed / (periodSolved + periodFailed)) * 100) : '—'}</dd></div>
              </>
            )}
            {metric === 'money' && (
              <>
                <div><dt>Выручка</dt><dd>{formatKopecks(num(summary.revenue))}</dd></div>
                <div><dt>Расход на модели</dt><dd>{formatKopecks(num(summary.llmCost))}</dd></div>
                <div><dt>Маржа</dt><dd className={num(summary.margin) < 0 ? 'is-negative' : ''}>{formatKopecks(num(summary.margin))}</dd></div>
              </>
            )}
            {metric === 'users' && (
              <>
                <div><dt>Новых</dt><dd>{formatNumber(num(summary.registrations))}</dd></div>
                <div><dt>Активных за 30 дн</dt><dd>{formatNumber(num(summary.mau))}</dd></div>
                <div><dt>Дошли до оплаты</dt><dd>{formatPercent(num(summary.conversion))}</dd></div>
              </>
            )}
          </dl>
          {metric === 'tasks' && (
            <StackedBars
              labels={labels}
              stacks={[
                { name: 'Решено', values: series.map((item) => num(item.solved)) },
                { name: 'Не решено', values: series.map((item) => num(item.failed)) },
              ]}
            />
          )}
          {metric === 'money' && (
            <LineChart
              kind="bar"
              labels={labels}
              format={compactRubles}
              series={[
                { name: 'Выручка', values: series.map((item) => num(item.revenue)), tone: 1 },
                { name: 'Расход на модели', values: series.map((item) => num(item.llmCost)), tone: 2 },
              ]}
            />
          )}
          {metric === 'users' && (
            <LineChart
              labels={labels}
              series={[
                { name: 'Заходили', values: series.map((item) => num(item.activeUsers)), tone: 1 },
                { name: 'Новые', values: series.map((item) => num(item.registrations)), tone: 2 },
              ]}
            />
          )}
        </Panel>

        <div className="dash-side">
          <Panel title="Шлюз моделей" actions={<Button size="sm" variant="ghost" onClick={() => openSection('monitoring', { m_tab: 'health' })}>Сервисы</Button>}>
            <div className="dash-gateway">
              <strong className="adm-stat-value">{credits !== null ? formatNumber(Math.round(credits)) : '—'}</strong>
              <span className="adm-stat-label">кредитов на счету</span>
              <p>
                {tasksLeft !== null
                  ? <>Хватит примерно на <b>{formatNumber(tasksLeft)}</b> задач: в среднем {formatNumber(perTask ?? 0)} кредита за задачу за 7 дней.</>
                  : 'Средний расход появится после первых задач за неделю.'}
              </p>
            </div>
            <p className={`dash-services${down.length ? ' is-down' : ''}`}>
              <span className="dash-alarm-dot" aria-hidden="true" />
              {down.length
                ? <>Не отвечает: {down.map((name) => serviceNames[name] ?? name).join(', ')}</>
                : <>Все сервисы работают{str(services.checkedAt) ? `, проверено ${relativeTime(str(services.checkedAt))}` : ''}</>}
            </p>
            {notConfigured.length > 0 && (
              <p className="dash-note">Не настроено: {notConfigured.map((name) => serviceNames[name] ?? name).join(', ')}.</p>
            )}
          </Panel>

          <Panel title={`Предметы за ${period} дн`}>
            {subjects.length ? <HorizontalBars items={subjects.slice(0, 8)} /> : <EmptyState>Решённых задач за период нет.</EmptyState>}
          </Panel>
        </div>
      </div>

      <Panel title="Лента" description="Решения, оплаты, регистрации и обращения по мере того, как они происходят.">
        {feed.length ? (
          <ol className="dash-feed">
            {feed.map((item) => (
              <FeedRow key={`${str(item.kind)}-${str(item.at)}-${str(item.userId)}`} item={item} onOpenUser={openUser} onOpenSection={(section) => openSection(section)} />
            ))}
          </ol>
        ) : (
          <EmptyState>Событий пока нет: первые появятся, когда ученики начнут решать задачи.</EmptyState>
        )}
      </Panel>
    </>
  )
}
