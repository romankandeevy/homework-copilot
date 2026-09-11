/* Уведомления администратору: правила по событиям, адреса, дневная
   сводка, проверка каналов и журнал последних отправок. Очередь живёт в
   базе, доставляет её функция на Vercel по вызову pg_cron раз в минуту. */

import { useMemo, useState } from 'react'
import { PaperPlaneTilt, X } from '@phosphor-icons/react'
import { adminAction, adminRpc, arr, bool, formatDateTime, num, obj, rows, str, strOrNull, type Row } from '../api'
import {
  Badge, Button, DataTable, EmptyState, ErrorState, Field, LoadingState, PageHeader, Panel,
  useAction, useAsync, useToast, type Column, type Tone,
} from '../ui'
import { useAdmin } from '../context'
import './notifications.css'

type Rule = { event: string; title: string; telegram: boolean; email: boolean }

type Notice = {
  id: string
  title: string
  body: string
  createdAt: string
  telegramSentAt: string | null
  emailSentAt: string | null
  wantTelegram: boolean
  wantEmail: boolean
  attempts: number
  lastError: string | null
}

type TestResult = { telegram: boolean; email: boolean; error: string | null; emails: string[] }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_ATTEMPTS = 5

function parseNotice(row: Row): Notice {
  return {
    id: str(row.id),
    title: str(row.title),
    body: str(row.body),
    createdAt: str(row.createdAt),
    telegramSentAt: strOrNull(row.telegramSentAt),
    emailSentAt: strOrNull(row.emailSentAt),
    wantTelegram: bool(row.wantTelegram),
    wantEmail: bool(row.wantEmail),
    attempts: num(row.attempts),
    lastError: strOrNull(row.lastError),
  }
}

// Функция на Vercel пишет ошибку как «telegram: …; email: …».
function channelError(text: string | null, channel: 'telegram' | 'email') {
  if (!text) return null
  const part = text.split('; ').find((piece) => piece.startsWith(`${channel}: `))
  return part ? part.slice(channel.length + 2) : null
}

function errorText(failure: unknown) {
  return failure instanceof Error ? failure.message : 'Операция не выполнилась.'
}

export default function NotificationsSection() {
  const { access } = useAdmin()
  if (!access.permissions.settings) {
    return (
      <div className="ntf-stack">
        <PageHeader title="Уведомления" />
        <Panel><EmptyState>Настройка уведомлений открыта ролям «администратор» и «владелец».</EmptyState></Panel>
      </div>
    )
  }
  return <NotificationsContent />
}

function NotificationsContent() {
  const toast = useToast()
  const { pending, run } = useAction()
  const { data, error, loading, reload, setData } = useAsync(() => adminRpc('admin_notifications_overview'), [])
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)

  const overview = obj(data)
  const rules = useMemo<Rule[]>(() => rows(obj(data).rules).map((row) => ({
    event: str(row.event), title: str(row.title), telegram: bool(row.telegram), email: bool(row.email),
  })), [data])
  const recent = useMemo(() => rows(obj(data).recent).map(parseNotice), [data])
  const emails = arr(overview.emails).filter((entry): entry is string => typeof entry === 'string')
  const summaryHour = num(overview.dailySummaryHour, 9)
  const lastCron = obj(overview.lastCron)
  const lastDelivery = strOrNull(overview.lastDelivery)

  const saveRule = async (rule: Rule, patch: Partial<Pick<Rule, 'telegram' | 'email'>>) => {
    const next = { ...rule, ...patch }
    const result = await run(`rule:${rule.event}`, () => adminRpc('admin_notification_rule_save', { p_event: rule.event, p_telegram: next.telegram, p_email: next.email }))
    if (result === undefined) return
    setData((current) => {
      const base = obj(current)
      const updated = rows(base.rules).map((row) => (str(row.event) === rule.event ? Object.assign({}, row, { telegram: next.telegram, email: next.email }) : row))
      return { ...base, rules: updated }
    })
  }

  const sendTest = async () => {
    setTesting(true)
    try {
      const response = await adminAction<{ results?: unknown; emails?: unknown }>('test_notification')
      const first = obj(arr(response.results as Row['results'])[0])
      const result: TestResult = {
        telegram: bool(first.telegram),
        email: bool(first.email),
        error: strOrNull(first.error),
        emails: Array.isArray(response.emails) ? response.emails.filter((entry): entry is string => typeof entry === 'string') : [],
      }
      setTestResult(result)
      if (result.error) toast.error('Проверка дошла не во все каналы - подробности ниже.')
      else toast.success('Проверка отправлена.')
    } catch (failure) {
      toast.error(errorText(failure))
    } finally {
      setTesting(false)
    }
  }

  const queueTest = async () => {
    const result = await run('queue', () => adminRpc('admin_notification_test'), 'Проверка в очереди - уйдёт в течение минуты.')
    if (result !== undefined) reload()
  }

  if (error) return <div className="ntf-stack"><PageHeader title="Уведомления" /><Panel><ErrorState message={error} onRetry={reload} /></Panel></div>
  if (!data) return <div className="ntf-stack"><PageHeader title="Уведомления" /><Panel><LoadingState /></Panel></div>

  const cronStatus = strOrNull(lastCron.status)

  const ruleColumns: Column<Rule>[] = [
    { key: 'title', header: 'Событие', render: (rule) => <span className="adm-cell-main"><strong>{rule.title}</strong><small className="adm-mono">{rule.event}</small></span> },
    {
      key: 'telegram',
      header: 'Telegram',
      align: 'center',
      render: (rule) => (
        <input type="checkbox" checked={rule.telegram} disabled={pending === `rule:${rule.event}`} aria-label={`Telegram: ${rule.title}`} onChange={(event) => void saveRule(rule, { telegram: event.target.checked })} />
      ),
    },
    {
      key: 'email',
      header: 'Почта',
      align: 'center',
      render: (rule) => (
        <input type="checkbox" checked={rule.email} disabled={pending === `rule:${rule.event}`} aria-label={`Почта: ${rule.title}`} onChange={(event) => void saveRule(rule, { email: event.target.checked })} />
      ),
    },
  ]

  const recentColumns: Column<Notice>[] = [
    { key: 'title', header: 'Уведомление', render: (notice) => <span className="adm-cell-main"><strong>{notice.title}</strong><small className="adm-clamp" title={notice.body}>{notice.body}</small></span> },
    { key: 'created', header: 'Создано', render: (notice) => <span className="adm-nowrap">{formatDateTime(notice.createdAt)}</span> },
    { key: 'telegram', header: 'Telegram', render: (notice) => <DeliveryCell want={notice.wantTelegram} sentAt={notice.telegramSentAt} attempts={notice.attempts} /> },
    { key: 'email', header: 'Почта', render: (notice) => <DeliveryCell want={notice.wantEmail} sentAt={notice.emailSentAt} attempts={notice.attempts} /> },
    { key: 'attempts', header: 'Попыток', align: 'right', mobile: false, render: (notice) => notice.attempts },
    { key: 'error', header: 'Ошибка', mobile: false, render: (notice) => (notice.lastError ? <span className="adm-clamp" title={notice.lastError}>{notice.lastError}</span> : <span className="adm-muted">-</span>) },
  ]

  return (
    <div className="ntf-stack">
      <PageHeader
        title="Уведомления"
        description="Доставка идёт раз в минуту из планировщика базы: Telegram - в чат владельца с ботом, почта - через Resend, для неё на Vercel нужен RESEND_API_KEY."
        actions={(
          <>
            <Button variant="primary" loading={testing} icon={<PaperPlaneTilt size={16} weight="bold" aria-hidden="true" />} onClick={() => void sendTest()}>Отправить проверку сейчас</Button>
            <Button loading={pending === 'queue'} onClick={() => void queueTest()}>Поставить в очередь</Button>
          </>
        )}
      />

      <Panel title="Состояние доставки" description="Успешный запуск планировщика значит, что база вызвала функцию на Vercel. Дошло ли сообщение, видно по времени отправки в журнале.">
        <div className="ntf-channels">
          <div className={`ntf-channel ${cronStatus === 'succeeded' ? 'is-ok' : cronStatus === 'failed' ? 'is-bad' : cronStatus ? 'is-warn' : ''}`}>
            <strong>Последний запуск планировщика</strong>
            <span>{cronStatus ? `${cronStatusNames[cronStatus] ?? cronStatus}, ${formatDateTime(strOrNull(lastCron.startedAt))}` : 'Запусков ещё не было'}</span>
            {str(lastCron.message) && <small>{str(lastCron.message)}</small>}
          </div>
          <div className="ntf-channel">
            <strong>Последняя доставка</strong>
            <span>{lastDelivery ? formatDateTime(lastDelivery) : 'Ещё ничего не доставлено'}</span>
          </div>
          <ChannelHealth channel="telegram" recent={recent} emails={emails} />
          <ChannelHealth channel="email" recent={recent} emails={emails} />
        </div>
        {testResult && <TestResultView result={testResult} />}
      </Panel>

      <Panel title="Правила" description="Какие события и куда присылать. Выключенное в обоих каналах событие в очередь не попадает.">
        <DataTable
          columns={ruleColumns}
          rows={rules}
          rowKey={(rule) => rule.event}
          loading={loading}
        />
      </Panel>

      <div className="adm-grid-2">
        <EmailsEditor key={emails.join(',')} initial={emails} onSaved={reload} />
        <SummaryHourEditor key={summaryHour} initial={summaryHour} onSaved={reload} />
      </div>

      <Panel title="Последние уведомления" description={`Не доставленное повторяется до ${MAX_ATTEMPTS} попыток в течение суток, потом больше не отправляется.`}>
        <DataTable
          columns={recentColumns}
          rows={recent}
          rowKey={(notice) => notice.id}
          empty="Уведомлений пока не было."
        />
      </Panel>
    </div>
  )
}

const cronStatusNames: Record<string, string> = {
  succeeded: 'успешно',
  failed: 'с ошибкой',
  running: 'выполняется',
  starting: 'запускается',
}

function DeliveryCell({ want, sentAt, attempts }: { want: boolean; sentAt: string | null; attempts: number }) {
  if (!want) return <span className="adm-muted">не нужно</span>
  if (sentAt) return <span className="adm-nowrap">{formatDateTime(sentAt)}</span>
  if (attempts >= MAX_ATTEMPTS) return <Badge tone="danger">не доставлено</Badge>
  return <Badge tone="warning">ожидает</Badge>
}

/* Здоровье канала по журналу: последняя ошибка или последняя удачная отправка. */
function ChannelHealth({ channel, recent, emails }: { channel: 'telegram' | 'email'; recent: Notice[]; emails: string[] }) {
  const title = channel === 'telegram' ? 'Telegram' : 'Почта'
  const sentKey = channel === 'telegram' ? 'telegramSentAt' : 'emailSentAt'
  const wantKey = channel === 'telegram' ? 'wantTelegram' : 'wantEmail'
  const lastSent = recent.find((notice) => notice[sentKey])
  const lastFailed = recent.find((notice) => notice[wantKey] && !notice[sentKey] && channelError(notice.lastError, channel))
  // Ошибка актуальна, только если после неё не было удачной отправки.
  const failing = lastFailed && (!lastSent || lastFailed.createdAt > lastSent.createdAt)
  const failure = failing ? channelError(lastFailed.lastError, channel) : null

  let tone: 'is-ok' | 'is-bad' | 'is-warn' | '' = ''
  let text = 'Отправок ещё не было'
  if (channel === 'email' && emails.length === 0) {
    tone = 'is-warn'
    text = 'Адреса не заданы - письма не отправляются'
  } else if (failure) {
    tone = 'is-bad'
    text = /RESEND_API_KEY/.test(failure) ? 'Письма не уходят: на Vercel не задан RESEND_API_KEY' : `Не доставляется: ${failure}`
  } else if (lastSent) {
    tone = 'is-ok'
    text = `Работает, последняя отправка ${formatDateTime(lastSent[sentKey])}`
  }
  return (
    <div className={`ntf-channel ${tone}`}>
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  )
}

function TestResultView({ result }: { result: TestResult }) {
  const telegramError = channelError(result.error, 'telegram')
  const emailError = channelError(result.error, 'email')
  const emailState: { tone: Tone; text: string } = result.emails.length === 0
    ? { tone: 'warning', text: 'не проверяли: адреса не заданы' }
    : result.email
      ? { tone: 'success', text: `отправлено на ${result.emails.join(', ')}` }
      : { tone: 'danger', text: emailError && /RESEND_API_KEY/.test(emailError) ? 'не ушло: на Vercel не задан RESEND_API_KEY' : `не ушло: ${emailError ?? 'причина неизвестна'}` }
  return (
    <div className="ntf-channels" style={{ marginTop: 'var(--space-3)' }} role="status">
      <div className={`ntf-channel ${result.telegram ? 'is-ok' : 'is-bad'}`}>
        <strong>Проверка: Telegram</strong>
        <span>{result.telegram ? 'отправлено в чат владельца' : `не ушло: ${telegramError ?? 'причина неизвестна'}`}</span>
      </div>
      <div className={`ntf-channel ${emailState.tone === 'success' ? 'is-ok' : emailState.tone === 'danger' ? 'is-bad' : 'is-warn'}`}>
        <strong>Проверка: почта</strong>
        <span>{emailState.text}</span>
      </div>
    </div>
  )
}

function EmailsEditor({ initial, onSaved }: { initial: string[]; onSaved: () => void }) {
  const { pending, run } = useAction()
  const [list, setList] = useState(initial)
  const [draft, setDraft] = useState('')
  const normalized = draft.trim().toLowerCase()
  const draftError = normalized === ''
    ? ''
    : !EMAIL_PATTERN.test(normalized) ? 'Похоже, в адресе ошибка.' : list.includes(normalized) ? 'Этот адрес уже в списке.' : ''
  const dirty = list.join(',') !== initial.join(',')

  const add = () => {
    if (!normalized || draftError || list.length >= 10) return
    setList([...list, normalized])
    setDraft('')
  }

  const save = async () => {
    const result = await run('emails', () => adminRpc('admin_setting_save', { p_key: 'notify_emails', p_value: list }), 'Адреса сохранены.')
    if (result !== undefined) onSaved()
  }

  return (
    <Panel title="Адреса для писем" description="На них уходят уведомления с включённой почтой. До 10 адресов.">
      {list.length > 0
        ? (
          <ul className="ntf-emails">
            {list.map((email) => (
              <li key={email}>
                {email}
                <button type="button" className="adm-icon-button is-small" aria-label={`Убрать ${email}`} onClick={() => setList(list.filter((item) => item !== email))}>
                  <X size={12} weight="bold" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )
        : <p className="ntf-note" style={{ marginBottom: 'var(--space-3)' }}>Адресов нет - письма не отправляются.</p>}
      <form className="ntf-inline" onSubmit={(event) => { event.preventDefault(); add() }}>
        <Field label="Новый адрес" hint={draftError || undefined}>
          <input type="email" value={draft} onChange={(event) => setDraft(event.target.value)} autoComplete="off" />
        </Field>
        <Button type="submit" disabled={!normalized || Boolean(draftError) || list.length >= 10}>Добавить</Button>
      </form>
      <div className="adm-form-actions">
        {dirty && <Button variant="ghost" onClick={() => setList(initial)}>Отменить</Button>}
        <Button variant="primary" disabled={!dirty} loading={pending === 'emails'} onClick={() => void save()}>Сохранить адреса</Button>
      </div>
    </Panel>
  )
}

function SummaryHourEditor({ initial, onSaved }: { initial: number; onSaved: () => void }) {
  const { pending, run } = useAction()
  const [value, setValue] = useState(String(initial))
  const hour = Number(value)
  const valid = /^\d{1,2}$/.test(value.trim()) && hour >= 0 && hour <= 23

  const save = async () => {
    if (!valid) return
    const result = await run('hour', () => adminRpc('admin_setting_save', { p_key: 'daily_summary_hour', p_value: hour }), 'Час сводки сохранён.')
    if (result !== undefined) onSaved()
  }

  return (
    <Panel title="Дневная сводка" description="Итоги вчерашнего дня: выручка, регистрации, решения, расход на LLM, ошибки, флаги фрода и обращения.">
      <form className="ntf-inline" onSubmit={(event) => { event.preventDefault(); void save() }}>
        <Field label="Час отправки по Москве" hint={valid ? `Сводка уйдёт в начале ${hour}:00 МСК.` : 'Целое число от 0 до 23.'}>
          <input type="number" min={0} max={23} step={1} inputMode="numeric" value={value} onChange={(event) => setValue(event.target.value)} />
        </Field>
        <Button type="submit" variant="primary" disabled={!valid || hour === initial} loading={pending === 'hour'}>Сохранить</Button>
      </form>
    </Panel>
  )
}
