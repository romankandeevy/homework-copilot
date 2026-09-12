/* Дашборд: что происходит и куда смотреть.

   Сознательно отступает от ТЗ. На сервисе с десятком учеников MRR,
   когорты, воронка и десять карточек показателей - шум: по ним нечего
   делать. Здесь только то, по чему владелец действует: что горит, как
   идёт выбранный период против предыдущего такого же к этому же моменту,
   хватит ли кредитов шлюза и живая лента событий. Все цифры отдаёт одна
   функция - admin_dashboard_period. */

import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { ArrowClockwise, ArrowRight, CheckCircle, CurrencyRub, Info, Lifebuoy, UserPlus, XCircle } from '@phosphor-icons/react'
import { adminRpc, formatDuration, formatKopecks, formatNumber, formatPercent, num, numOrNull, obj, relativeTime, rows, str } from '../api'
import type { Row } from '../api'
import type { AdminSection } from '../context'
import { useAdmin } from '../context'
import { Button, EmptyState, ErrorState, HorizontalBars, LineChart, LoadingState, PageHeader, Panel, Segmented, StackedBars, useAsync, useQueryState } from '../ui'
import './dashboard.css'

type Metric = 'tasks' | 'money' | 'users'
type Period = 'day' | 'week' | 'month' | 'year'

const periodWords: Record<Period, { current: string; previous: string; chart: string }> = {
  day: { current: 'сегодня', previous: 'вчера к этому часу', chart: 'по часам сегодня' },
  week: { current: 'за 7 дней', previous: 'прошлые 7 дней', chart: 'по дням за 7 дней' },
  month: { current: 'за 30 дней', previous: 'прошлые 30 дней', chart: 'по дням за 30 дней' },
  year: { current: 'за год', previous: 'прошлый год', chart: 'по месяцам за год' },
}

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

/* Разница с предыдущим таким же отрезком - абсолютная: на малых числах
   «+200 %» от одной задачи к трём ничего не объясняет. */
function Versus({ current, previous, label, money = false, invert = false }: { current: number; previous: number; label: string; money?: boolean; invert?: boolean }) {
  const diff = current - previous
  const tone = diff === 0 ? 'is-flat' : (diff > 0) !== invert ? 'is-good' : 'is-bad'
  const shown = money ? formatKopecks(Math.abs(diff)) : formatNumber(Math.abs(diff))
  return (
    <span className="dash-versus">
      <b className={`adm-delta ${tone}`}>{diff === 0 ? 'без изменений' : `${diff > 0 ? '+' : '−'}${shown}`}</b>
      <small>{label}: {money ? formatKopecks(previous) : formatNumber(previous)}</small>
    </span>
  )
}

function PeriodNumber({ label, value, hint, children, tone }: { label: string; value: ReactNode; hint: string; children?: ReactNode; tone?: 'danger' }) {
  return (
    <div className={`adm-stat${tone ? ` is-${tone}` : ''}`} title={hint}>
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

/* Как считается каждая цифра - словами, без обращения к коду. */
function Definitions({ period }: { period: Period }) {
  const words = periodWords[period]
  return (
    <details className="dash-definitions">
      <summary><Info size={16} weight="bold" aria-hidden="true" /> Как считаются цифры</summary>
      <dl>
        <div><dt>Период</dt><dd>«День» - с полуночи по Москве до сейчас. «Неделя», «месяц», «год» - последние 7, 30 и 365 дней, включая сегодня. Сравнение всегда с предыдущим таким же отрезком до этого же момента: сегодня против вчера к этому часу, неделя против недели до неё.</dd></div>
        <div><dt>Решено задач</dt><dd>Решения, которые модель довела до конца и отдала ученику или гостю. «Не решено» - попытки, где решение не прошло проверку или сорвалось; деньги за них вернулись.</dd></div>
        <div><dt>Выручка</dt><dd>Подтверждённые пополнения кошелька минус возвраты по ним. Пополнения аккаунтов админов - проверочные - не считаются.</dd></div>
        <div><dt>Расход на модели</dt><dd>Себестоимость у шлюза моделей: кредиты, потраченные на решения задач, плюс ответы ИИ-чата. Неудачные попытки тоже стоят денег и входят сюда.</dd></div>
        <div><dt>Новые ученики</dt><dd>Аккаунты, зарегистрированные {words.current}. «Гости с задачей» - браузеры без аккаунта, которые ставили задачу.</dd></div>
        <div><dt>Онлайн</dt><dd>Ученики с активностью за последние 10 минут, от периода не зависит. «Заходили» - уникальные ученики, которые открывали приложение или ставили задачу {words.current}.</dd></div>
      </dl>
    </details>
  )
}

export default function DashboardSection() {
  const { openSection, openUser, signals } = useAdmin()
  const [query, setQuery] = useQueryState({ d_period: 'week', d_metric: 'tasks' })
  const period: Period = query.d_period === 'day' || query.d_period === 'month' || query.d_period === 'year' ? query.d_period : 'week'
  const metric: Metric = query.d_metric === 'money' || query.d_metric === 'users' ? query.d_metric : 'tasks'
  const words = periodWords[period]

  const dash = useAsync(() => adminRpc('admin_dashboard_period', { p_period: period }), [period])
  const reload = dash.reload

  // Обновляется само: раз в минуту и по событию Realtime.
  useEffect(() => {
    const timer = window.setInterval(reload, 60_000)
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
  const series = rows(data.series)
  const labels = series.map((item) => str(item.label))
  const attention = obj(data.attention)
  const overdue = rows(attention.overdueTickets)
  const gateway = obj(data.gateway)
  const services = obj(data.services)
  const feed = rows(data.feed)
  const down = Array.isArray(services.down) ? services.down.map(String) : []
  const notConfigured = Array.isArray(services.notConfigured) ? services.notConfigured.map(String) : []

  const credits = numOrNull(gateway.credits)
  const perTask = numOrNull(gateway.avgCreditsPerTask)
  const tasksLeft = credits !== null && perTask && perTask > 0 ? Math.floor(credits / perTask) : null

  const subjects = useMemo(() => rows(data.subjects).map((item) => ({
    label: str(item.subject),
    value: num(item.solved),
    hint: num(item.failed) ? `не решено ${num(item.failed)}` : undefined,
  })), [data.subjects])

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

  const periodControl = (
    <Segmented
      label="Период"
      value={period}
      onChange={(value) => setQuery({ d_period: value }, { replace: true })}
      options={[{ value: 'day', label: 'День' }, { value: 'week', label: 'Неделя' }, { value: 'month', label: 'Месяц' }, { value: 'year', label: 'Год' }]}
    />
  )

  if (dash.loading && !dash.data) return <><PageHeader title="Дашборд" actions={periodControl} /><LoadingState /></>
  if (dash.error && !dash.data) return <><PageHeader title="Дашборд" actions={periodControl} /><ErrorState message={dash.error} onRetry={reload} /></>

  const solved = num(current.solved)
  const failed = num(current.failed)
  const attempts = solved + failed

  return (
    <>
      <PageHeader
        title="Дашборд"
        description={`Цифры ${words.current}, сравнение - ${words.previous}. Обновляется само раз в минуту и при новых событиях.`}
        actions={(
          <>
            {periodControl}
            <Button size="sm" onClick={reload} loading={dash.loading} icon={<ArrowClockwise size={16} weight="bold" aria-hidden="true" />} aria-label="Обновить" />
          </>
        )}
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

      <div className="dash-numbers">
        <div className="adm-stat-grid dash-today">
          <PeriodNumber
            label={`Решено ${words.current}`}
            value={formatNumber(solved)}
            hint="Решения, которые модель довела до конца и отдала ученику или гостю."
            tone={failed > solved && failed > 2 ? 'danger' : undefined}
          >
            <Versus current={solved} previous={num(previous.solved)} label={words.previous} />
            {failed > 0 && <small className="dash-failed">не решено: {failed}{attempts ? ` (${formatPercent((failed / attempts) * 100)})` : ''}</small>}
          </PeriodNumber>
          <PeriodNumber label={`Выручка ${words.current}`} value={formatKopecks(num(current.revenue))} hint="Подтверждённые пополнения кошелька минус возвраты.">
            <Versus current={num(current.revenue)} previous={num(previous.revenue)} label={words.previous} money />
          </PeriodNumber>
          <PeriodNumber label="Расход на модели" value={formatKopecks(num(current.llmCost))} hint="Оплата шлюза моделей: кредиты задач и себестоимость ответов чата.">
            <Versus current={num(current.llmCost)} previous={num(previous.llmCost)} label={words.previous} money invert />
          </PeriodNumber>
          <PeriodNumber label="Новые ученики" value={formatNumber(num(current.registrations))} hint="Зарегистрированные аккаунты за период.">
            <Versus current={num(current.registrations)} previous={num(previous.registrations)} label={words.previous} />
            {num(current.guests) > 0 && <small>гостей с задачей: {num(current.guests)}</small>}
          </PeriodNumber>
          <PeriodNumber label="Онлайн сейчас" value={formatNumber(num(data.online))} hint="Ученики с активностью за последние 10 минут.">
            <small>заходили {words.current}: {formatNumber(num(current.active))}</small>
            <small>{words.previous}: {formatNumber(num(previous.active))}</small>
          </PeriodNumber>
        </div>
        <Definitions period={period} />
      </div>

      <div className="adm-grid-main">
        <Panel
          title="Динамика"
          description={words.chart}
          actions={<Segmented label="Показатель" value={metric} onChange={(value) => setQuery({ d_metric: value }, { replace: true })} options={[{ value: 'tasks', label: 'Задачи' }, { value: 'money', label: 'Деньги' }, { value: 'users', label: 'Ученики' }]} />}
        >
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
              kind="bar"
              labels={labels}
              series={[
                { name: 'Заходили', values: series.map((item) => num(item.active)), tone: 1 },
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

          <Panel title={`Предметы ${words.current}`}>
            {subjects.length ? <HorizontalBars items={subjects.slice(0, 8)} /> : <EmptyState>Задач {words.current} не было.</EmptyState>}
          </Panel>
        </div>
      </div>

      <Panel title="Лента" description="Последние решения, оплаты, регистрации и обращения - от периода не зависит.">
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
