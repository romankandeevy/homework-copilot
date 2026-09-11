/* Журнал действий администраторов: кто, когда, с какого адреса, что
   поменял (было → стало). Вторая вкладка - все обращения к админ-API,
   её видит только владелец. */

import { useState } from 'react'
import { adminRpc, downloadCsv, formatDateTime, isRecord, num, obj, rows, str, strOrNull, type CsvColumn, type Row } from '../api'
import { Badge, DataTable, ErrorState, ExportButton, Field, PageHeader, Pagination, Panel, Tabs, useAsync, useQueryState, useToast, type Column } from '../ui'
import { useAdmin } from '../context'
import './audit.css'

const eventLabels: Record<string, string> = {
  balance_adjusted: 'Изменён баланс',
  user_banned: 'Пользователь заблокирован',
  user_unbanned: 'Блокировка снята',
  user_profile_updated: 'Изменён профиль',
  user_plan_granted: 'Выдан тариф',
  user_plan_revoked: 'Тариф отозван',
  user_limit_changed: 'Изменён дневной лимит',
  user_note_added: 'Добавлена заметка',
  user_note_deleted: 'Удалена заметка',
  user_impersonated: 'Вход под пользователем',
  password_reset_sent: 'Отправлен сброс пароля',
  payment_refunded: 'Возврат пополнения',
  reservation_refunded: 'Возврат зависшего резерва',
  fraud_flag_decided: 'Решение по флагу фрода',
  fraud_rule_updated: 'Изменено правило антифрода',
  fraud_whitelist_added: 'Добавлено в белый список',
  fraud_whitelist_removed: 'Убрано из белого списка',
  support_status_changed: 'Изменён статус обращения',
  support_replied: 'Ответ в поддержке',
  support_feature_credited: 'Начисление за идею',
  solution_deleted: 'Удалено решение',
  plan_saved: 'Сохранён тариф',
  plan_deleted: 'Удалён тариф',
  plan_disabled: 'Тариф выключен',
  promo_saved: 'Сохранён промокод',
  prompt_saved: 'Новая версия промпта',
  prompt_rolled_back: 'Промпт откачен',
  prompt_disabled: 'Промпт выключен',
  subjects_saved: 'Изменены предметы',
  flag_saved: 'Изменён фиче-флаг',
  setting_saved: 'Изменена настройка',
  notification_rule_saved: 'Изменено правило уведомлений',
  admin_role_changed: 'Изменена роль администратора',
  error_status_changed: 'Изменён статус ошибки',
  jobs_expired: 'Закрыты зависшие задачи',
}

const roleNames: Record<string, string> = { owner: 'владелец', admin: 'админ', support: 'поддержка' }

function eventLabel(event: string) {
  return eventLabels[event] ?? event
}

type AuditEntry = {
  id: string
  event: string
  actorId: string | null
  actorEmail: string | null
  actorRole: string | null
  actorIp: string | null
  targetUserId: string | null
  targetEmail: string | null
  payload: Row
  before: unknown
  after: unknown
  createdAt: string
}

function parseEntry(row: Row): AuditEntry {
  return {
    id: String(row.id ?? ''),
    event: str(row.event),
    actorId: strOrNull(row.actorId),
    actorEmail: strOrNull(row.actorEmail),
    actorRole: strOrNull(row.actorRole),
    actorIp: strOrNull(row.actorIp),
    targetUserId: strOrNull(row.targetUserId),
    targetEmail: strOrNull(row.targetEmail),
    payload: obj(row.payload),
    before: row.before ?? null,
    after: row.after ?? null,
    createdAt: str(row.createdAt),
  }
}

/* ---------- Разница было → стало ---------- */

// Служебные отметки меняются при каждом сохранении и заслоняют суть.
const noiseKeys = new Set(['updated_at', 'updated_by', 'updatedAt'])

type Change = { key: string; before: unknown; after: unknown }

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  if (isRecord(value)) return value as Record<string, unknown>
  return { значение: value }
}

function changedKeys(before: unknown, after: unknown): Change[] {
  const left = asObject(before)
  const right = asObject(after)
  if (!left && !right) return []
  const keys = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])
  const changes: Change[] = []
  for (const key of keys) {
    if (noiseKeys.has(key)) continue
    const a = left ? left[key] : undefined
    const b = right ? right[key] : undefined
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) changes.push({ key, before: a ?? null, after: b ?? null })
  }
  return changes
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === '') return 'пусто'
  if (typeof value === 'string') return value.length > 240 ? `${value.slice(0, 240)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const text = JSON.stringify(value)
  return text.length > 240 ? `${text.slice(0, 240)}…` : text
}

function DiffCell({ entry }: { entry: AuditEntry }) {
  const changes = changedKeys(entry.before, entry.after)
  const payloadKeys = Object.keys(entry.payload)
  if (changes.length === 0 && payloadKeys.length === 0) return <span className="adm-muted">-</span>
  const summary = changes.length > 0 ? `${changes.length} изм.` : 'подробности'
  return (
    <details className="aud-diff">
      <summary>{summary}</summary>
      {changes.length > 0 && (
        <dl className="aud-diff-list">
          {changes.map((change) => (
            <div key={change.key}>
              <dt>{change.key}</dt>
              <dd>
                {entry.before !== null && <span className="aud-before">{formatValue(change.before)}</span>}
                {entry.before !== null && entry.after !== null && ' → '}
                {entry.after !== null && <span className="aud-after">{formatValue(change.after)}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {payloadKeys.length > 0 && (
        <>
          <p className="aud-diff-caption">Подробности</p>
          <dl className="aud-diff-list">
            {payloadKeys.map((key) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{formatValue(entry.payload[key])}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </details>
  )
}

function diffText(entry: AuditEntry) {
  return changedKeys(entry.before, entry.after).map((change) => `${change.key}: ${formatValue(change.before)} → ${formatValue(change.after)}`).join('; ')
}

/* ---------- Раздел ---------- */

type AuditTab = 'log' | 'requests'

export default function AuditSection() {
  const { access } = useAdmin()
  const [query, setQuery] = useQueryState({ a_tab: 'log' })
  const canSeeRequests = access.permissions.admins
  const tab: AuditTab = query.a_tab === 'requests' && canSeeRequests ? 'requests' : 'log'
  const tabs: { value: AuditTab; label: string }[] = [{ value: 'log', label: 'Действия' }]
  if (canSeeRequests) tabs.push({ value: 'requests', label: 'Обращения к админ-API' })

  return (
    <div className="aud-stack">
      <PageHeader title="Журнал" description="Каждое изменение из админки: кто, когда, с какого адреса и что было до и после." />
      {tabs.length > 1 && <Tabs value={tab} tabs={tabs} onChange={(value) => setQuery({ a_tab: value })} />}
      {tab === 'log' ? <AuditLog /> : <RequestLog />}
    </div>
  )
}

const PAGE_SIZE = 50
// База отдаёт не больше 200 строк за раз, выгрузка собирает страницы.
const EXPORT_CHUNK = 200
const EXPORT_LIMIT = 1000

function AuditLog() {
  const { openUser } = useAdmin()
  const toast = useToast()
  const [query, setQuery] = useQueryState({ a_event: '', a_page: '1' })
  const page = Math.max(1, Number.parseInt(query.a_page, 10) || 1)
  const [exporting, setExporting] = useState(false)
  const event = query.a_event || null

  const { data, error, loading, reload } = useAsync(
    () => adminRpc('admin_audit_log_list', { p_page: page, p_page_size: PAGE_SIZE, p_event: event }),
    [page, event],
  )
  const items = rows(obj(data).items).map(parseEntry)
  const total = num(obj(data).total)

  const options = Object.entries(eventLabels).sort((a, b) => a[1].localeCompare(b[1], 'ru'))
  if (event && !eventLabels[event]) options.unshift([event, event])

  const exportCsv = async () => {
    setExporting(true)
    try {
      const collected: AuditEntry[] = []
      let expected = Infinity
      for (let chunk = 1; collected.length < Math.min(expected, EXPORT_LIMIT); chunk += 1) {
        // Страницы по очереди: следующая нужна, только если предыдущая была полной.
        // eslint-disable-next-line no-await-in-loop
        const result = obj(await adminRpc('admin_audit_log_list', { p_page: chunk, p_page_size: EXPORT_CHUNK, p_event: event }))
        expected = num(result.total)
        const part = rows(result.items).map(parseEntry)
        collected.push(...part)
        if (part.length < EXPORT_CHUNK) break
      }
      const exported = collected.slice(0, EXPORT_LIMIT)
      const columns: CsvColumn<AuditEntry>[] = [
        { header: 'Дата', value: (entry) => entry.createdAt },
        { header: 'Событие', value: (entry) => eventLabel(entry.event) },
        { header: 'Код события', value: (entry) => entry.event },
        { header: 'Кто', value: (entry) => entry.actorEmail ?? (entry.actorId ? entry.actorId : 'система') },
        { header: 'Роль', value: (entry) => (entry.actorRole ? roleNames[entry.actorRole] ?? entry.actorRole : '') },
        { header: 'IP', value: (entry) => entry.actorIp },
        { header: 'Пользователь', value: (entry) => entry.targetEmail },
        { header: 'ID пользователя', value: (entry) => entry.targetUserId },
        { header: 'Изменения', value: (entry) => diffText(entry) },
        { header: 'Подробности', value: (entry) => (Object.keys(entry.payload).length ? JSON.stringify(entry.payload) : '') },
      ]
      downloadCsv(`audit-${event ?? 'all'}-${new Date().toISOString().slice(0, 10)}`, exported, columns)
      if (expected > exported.length) toast.info(`В файл попали последние ${exported.length} из ${expected} записей. Уточни фильтр.`)
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : 'Не получилось выгрузить журнал.')
    } finally {
      setExporting(false)
    }
  }

  const columns: Column<AuditEntry>[] = [
    { key: 'when', header: 'Когда', render: (entry) => <span className="adm-nowrap">{formatDateTime(entry.createdAt)}</span> },
    {
      key: 'actor',
      header: 'Кто',
      render: (entry) => (
        <span className="aud-actor">
          <span>{entry.actorEmail ?? (entry.actorId ? <span className="adm-mono">{entry.actorId}</span> : 'система')}</span>
          <span className="aud-actor-meta">
            {entry.actorRole && <Badge tone={entry.actorRole === 'owner' ? 'accent' : 'neutral'}>{roleNames[entry.actorRole] ?? entry.actorRole}</Badge>}
            {entry.actorIp && <span className="adm-mono">{entry.actorIp}</span>}
          </span>
        </span>
      ),
    },
    { key: 'event', header: 'Событие', render: (entry) => <span title={entry.event}>{eventLabel(entry.event)}</span> },
    {
      key: 'target',
      header: 'Пользователь',
      render: (entry) => (entry.targetUserId
        ? <button type="button" className="aud-link" onClick={() => openUser(entry.targetUserId!)}>{entry.targetEmail ?? entry.targetUserId}</button>
        : <span className="adm-muted">-</span>),
    },
    { key: 'diff', header: 'Было → стало', render: (entry) => <DiffCell entry={entry} /> },
  ]

  return (
    <Panel title="Действия администраторов" actions={<ExportButton onExport={() => void exportCsv()} loading={exporting} />}>
      <div className="adm-toolbar">
        <Field label="Событие">
          <select value={query.a_event} onChange={(change) => setQuery({ a_event: change.target.value, a_page: '1' })}>
            <option value="">Все события</option>
            {options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </Field>
      </div>
      {error
        ? <ErrorState message={error} onRetry={reload} />
        : <DataTable columns={columns} rows={items} rowKey={(entry) => entry.id} loading={loading} empty="Записей нет." />}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={(next) => setQuery({ a_page: String(next) })} />
    </Panel>
  )
}

const REQUEST_PAGE_SIZE = 100

function RequestLog() {
  const [query, setQuery] = useQueryState({ a_rpage: '1' })
  const page = Math.max(1, Number.parseInt(query.a_rpage, 10) || 1)
  const { data, error, loading, reload } = useAsync(
    () => adminRpc('admin_request_log_list', { p_page: page, p_page_size: REQUEST_PAGE_SIZE }),
    [page],
  )
  const items = rows(obj(data).items)
  const total = num(obj(data).total)

  const columns: Column<Row>[] = [
    { key: 'when', header: 'Когда', render: (row) => <span className="adm-nowrap">{formatDateTime(strOrNull(row.createdAt))}</span> },
    { key: 'who', header: 'Кто', render: (row) => str(row.actorEmail, str(row.actorId)) },
    { key: 'role', header: 'Роль', render: (row) => <Badge>{roleNames[str(row.role)] ?? str(row.role)}</Badge> },
    { key: 'path', header: 'Путь', render: (row) => <span className="adm-mono">{str(row.path, '-')}</span> },
    { key: 'ip', header: 'IP', mobile: false, render: (row) => <span className="adm-mono">{str(row.ip, '-')}</span> },
  ]

  return (
    <Panel title="Обращения к админ-API" description="Каждый вызов функции админки после проверки роли и второго фактора. Хранится 90 дней.">
      {error
        ? <ErrorState message={error} onRetry={reload} />
        : (
          <DataTable
            columns={columns}
            rows={items}
            rowKey={(row) => String(row.id ?? '')}
            loading={loading}
            empty="Обращений нет."
          />
        )}
      <Pagination page={page} pageSize={REQUEST_PAGE_SIZE} total={total} onPage={(next) => setQuery({ a_rpage: String(next) })} />
    </Panel>
  )
}
