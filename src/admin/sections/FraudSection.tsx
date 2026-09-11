/* Антифрод: очередь флагов с решениями, граф связей, правила детекторов и
   белый список. Детекторы только ставят флаги - бан и лимит всегда решает
   администратор, поэтому для роли support раздел закрыт целиком. */

import { useId, useMemo, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { ArrowsClockwise, Graph, Trash } from '@phosphor-icons/react'
import type { Json } from '../../lib/database.types'
import { adminRpc, bool, formatDateTime, formatKopecks, formatNumber, isRecord, num, obj, rows, str } from '../api'
import type { Row } from '../api'
import { useAdmin } from '../context'
import {
  Badge,
  Button,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  JsonView,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  Panel,
  Segmented,
  Stat,
  StatGrid,
  Tabs,
  useAction,
  useAsync,
  useQueryState,
} from '../ui'
import type { Column, Tone } from '../ui'
import './fraud.css'

const PAGE_SIZE = 50
const QUERY_DEFAULTS = { f_view: 'queue', f_status: 'open', f_risk: '', f_page: '1' }

type FraudView = 'queue' | 'rules' | 'whitelist'
type FlagStatus = 'open' | 'deferred' | 'dismissed' | 'banned' | 'limited' | 'all'
type RiskFilter = 'any' | 'high' | 'medium' | 'low'
type DecisionAction = 'clear' | 'ban' | 'limit' | 'defer'
type Decision = { flag: Row; action: DecisionAction }
type WhitelistKind = 'ip' | 'email_domain' | 'user'
type RuleDraft = { enabled: boolean; threshold: string; windowHours: string; risk: string }

const VIEWS: FraudView[] = ['queue', 'rules', 'whitelist']
const STATUSES: FlagStatus[] = ['open', 'deferred', 'dismissed', 'banned', 'limited', 'all']

const STATUS_LABEL: Record<string, string> = {
  open: 'Открытые',
  deferred: 'Отложенные',
  dismissed: 'Не фрод',
  banned: 'Забанены',
  limited: 'Ограничены',
  all: 'Все',
}

const STATUS_BADGE: Record<string, { label: string; tone: Tone }> = {
  open: { label: 'открыт', tone: 'warning' },
  deferred: { label: 'отложен', tone: 'info' },
  dismissed: { label: 'не фрод', tone: 'success' },
  banned: { label: 'забанен', tone: 'danger' },
  limited: { label: 'лимит', tone: 'warning' },
}

const EMPTY_TEXT: Record<FlagStatus, string> = {
  open: 'Открытых флагов нет. Детекторы проверяют аккаунты каждые 15 минут.',
  deferred: 'Отложенных флагов нет.',
  dismissed: 'Снятых флагов нет.',
  banned: 'Флагов, закрытых баном, нет.',
  limited: 'Флагов, закрытых лимитом, нет.',
  all: 'Флагов пока не было.',
}

const RISK_LABEL: Record<string, string> = { high: 'высокий', medium: 'средний', low: 'низкий' }

function riskTone(risk: string): Tone {
  if (risk === 'high') return 'danger'
  if (risk === 'medium') return 'warning'
  return 'neutral'
}

const EVIDENCE_LABEL: Record<string, string> = {
  ip: 'IP',
  users: 'аккаунтов',
  emails: 'адресов',
  deviceId: 'метка',
  base: 'ящик',
  email: 'почта',
  domain: 'домен',
  spentKopecks: 'потрачено',
  registeredAt: 'регистрация',
  lastDebitAt: 'последнее списание',
  condition: 'условие',
  refunds: 'возвратов',
  topUpRefunds: 'по пополнениям',
  paidAt: 'оплата',
  refundedAt: 'возврат',
  solved: 'решено задач',
}

const THRESHOLD_LABEL: Record<string, string> = {
  ip_accounts: 'Аккаунтов с одного IP',
  device_accounts: 'Аккаунтов на устройстве',
  email_pattern: 'Адресов на одном ящике',
  temp_mail: 'Порог (не используется)',
  fast_free_spend: 'Минут после регистрации',
  duplicate_task_text: 'Аккаунтов с одной задачей',
  refunds: 'Возвратов за окно',
  pay_use_refund: 'Задач между оплатой и возвратом',
}

const WHITELIST_KIND: Record<WhitelistKind, { label: string; hint: string; placeholder: string }> = {
  ip: {
    label: 'IP-адрес',
    hint: 'Школа, общежитие, общий Wi-Fi. Открытые флаги «Аккаунты с одного IP» по этому адресу закроются, в графе связей он не учитывается.',
    placeholder: '203.0.113.7',
  },
  email_domain: {
    label: 'Почтовый домен',
    hint: 'Домен без @. Детектор одноразовой почты его больше не помечает.',
    placeholder: 'school.ru',
  },
  user: {
    label: 'Пользователь',
    hint: 'id пользователя из карточки. Новые флаги ему не ставятся ни по одному правилу.',
    placeholder: '00000000-0000-0000-0000-000000000000',
  },
}

const when = (value: string | null | undefined) => (value ? formatDateTime(value) : '-')

function compactEvidence(key: string, value: Json | undefined): string {
  if (value === null || value === undefined) return '-'
  if (Array.isArray(value)) return formatNumber(value.length)
  if (typeof value === 'number') return /kopecks/i.test(key) ? formatKopecks(value) : formatNumber(value)
  if (typeof value === 'boolean') return value ? 'да' : 'нет'
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDateTime(value)
    return value.length > 60 ? `${value.slice(0, 60)}…` : value
  }
  return 'объект'
}

export default function FraudSection() {
  const { access } = useAdmin()
  if (!access.permissions.moderate) {
    return (
      <div className="adm-fraud">
        <PageHeader title="Антифрод" />
        <Panel>
          <EmptyState>
            Раздел доступен ролям admin и owner: решения по флагам - это блокировки и лимиты. Флаги конкретного ученика видны в его карточке.
          </EmptyState>
        </Panel>
      </div>
    )
  }
  return <FraudWorkspace />
}

function FraudWorkspace() {
  const { openUser, refreshSignals } = useAdmin()
  const { pending, run } = useAction()
  const [query, setQuery] = useQueryState(QUERY_DEFAULTS)
  const view: FraudView = VIEWS.find((item) => item === query.f_view) ?? 'queue'
  const status: FlagStatus = STATUSES.find((item) => item === query.f_status) ?? 'open'
  const risk = query.f_risk === 'high' || query.f_risk === 'medium' || query.f_risk === 'low' ? query.f_risk : ''
  const page = Math.max(1, Number.parseInt(query.f_page, 10) || 1)

  const overview = useAsync(
    () => adminRpc<Json>('admin_fraud_overview', { p_status: status, p_risk: risk || null, p_page: page, p_page_size: PAGE_SIZE }),
    [status, risk, page],
  )
  const data = obj(overview.data)
  const counts = obj(data.counts)
  const items = rows(data.items)
  const rules = rows(data.rules)
  const whitelist = rows(data.whitelist)
  const total = num(data.total)
  const openCount = num(counts.open)
  const highCount = num(counts.high)
  const deferredCount = num(counts.deferred)

  const [decision, setDecision] = useState<Decision | null>(null)
  const [graphUser, setGraphUser] = useState<Row | null>(null)
  const [removeEntry, setRemoveEntry] = useState<Row | null>(null)

  const afterChange = () => {
    overview.reload()
    refreshSignals()
  }

  const runNow = async () => {
    const result = await run('run', () => adminRpc<Json>('admin_fraud_run_now'), (response) => {
      const raised = num(obj(response).raised)
      return raised ? `Детекторы отработали: новых флагов ${formatNumber(raised)}` : 'Детекторы отработали: новых флагов нет'
    })
    if (result !== undefined) afterChange()
  }

  const decide = async (payload: Record<string, unknown>) => {
    if (!decision) return
    const { flag, action } = decision
    const success = action === 'clear'
      ? 'Флаг снят, исключение записано'
      : action === 'ban'
        ? 'Пользователь заблокирован'
        : action === 'limit'
          ? `Лимит ${num(payload.limit as Json)} решений в сутки поставлен`
          : `Флаг отложен на ${num(payload.days as Json)} дн.`
    const result = await run('decide', () => adminRpc<Json>('admin_fraud_decide', { p_flag_id: str(flag.id), p_action: action, p_payload: payload }), success)
    if (result === undefined) return
    setDecision(null)
    afterChange()
  }

  const saveRule = async (rule: Row, draft: RuleDraft) => {
    const id = str(rule.id)
    const result = await run(
      `rule:${id}`,
      () => adminRpc<Json>('admin_fraud_update_rule', {
        p_rule_id: id,
        p_enabled: draft.enabled,
        p_threshold: Number(draft.threshold),
        p_window_hours: Number(draft.windowHours),
        p_risk: draft.risk,
      }),
      `Правило «${str(rule.title, id)}» сохранено`,
    )
    if (result !== undefined) overview.reload()
  }

  const addWhitelist = async (kind: WhitelistKind, value: string, note: string) => {
    const result = await run(
      'wl-add',
      () => adminRpc<Json>('admin_fraud_whitelist', { p_action: 'add', p_kind: kind, p_value: value, p_note: note || null }),
      'Добавлено в белый список',
    )
    if (result === undefined) return false
    afterChange()
    return true
  }

  const removeWhitelist = async () => {
    if (!removeEntry) return
    const id = str(removeEntry.id)
    const result = await run('wl-remove', () => adminRpc<Json>('admin_fraud_whitelist', { p_action: 'remove', p_id: id }), 'Убрано из белого списка')
    if (result === undefined) return
    setRemoveEntry(null)
    overview.reload()
  }

  const statusTabs = STATUSES.map((value) => ({
    value,
    label: STATUS_LABEL[value],
    badge: value === 'open' ? openCount : value === 'deferred' ? deferredCount : undefined,
  }))

  const initialLoading = overview.loading && !overview.data

  return (
    <div className="adm-fraud">
      <PageHeader
        title="Антифрод"
        description="Детекторы проверяют аккаунты каждые 15 минут и только ставят флаги. Бан и лимит - решение администратора."
        actions={(
          <Button variant="primary" icon={<ArrowsClockwise size={16} weight="bold" aria-hidden="true" />} loading={pending === 'run'} onClick={() => void runNow()}>
            Прогнать детекторы сейчас
          </Button>
        )}
      />

      <StatGrid>
        <Stat label="Открытые флаги" value={formatNumber(openCount)} tone={openCount ? 'warning' : undefined} />
        <Stat label="Из них с высоким риском" value={formatNumber(highCount)} tone={highCount ? 'danger' : undefined} />
        <Stat label="Отложенные" value={formatNumber(deferredCount)} />
      </StatGrid>

      <div className="adm-fraud-views">
        <Segmented<FraudView>
          label="Раздел антифрода"
          value={view}
          options={[
            { value: 'queue', label: 'Очередь' },
            { value: 'rules', label: 'Правила' },
            { value: 'whitelist', label: 'Белый список' },
          ]}
          onChange={(value) => setQuery({ f_view: value })}
        />
      </div>

      {overview.error && <ErrorState message={overview.error} onRetry={overview.reload} />}

      {view === 'queue' && (
        <Panel>
          <Tabs<FlagStatus> value={status} tabs={statusTabs} onChange={(value) => setQuery({ f_status: value, f_page: '1' })} />
          <div className="adm-toolbar adm-fraud-toolbar">
            <Segmented<RiskFilter>
              label="Риск"
              value={risk || 'any'}
              options={[
                { value: 'any', label: 'Любой риск' },
                { value: 'high', label: 'Высокий' },
                { value: 'medium', label: 'Средний' },
                { value: 'low', label: 'Низкий' },
              ]}
              onChange={(value) => setQuery({ f_risk: value === 'any' ? '' : value, f_page: '1' })}
            />
            {overview.data ? <span className="adm-muted">Найдено: {formatNumber(total)}</span> : null}
          </div>
          {initialLoading && <LoadingState />}
          {!initialLoading && items.length === 0 && !overview.error && <EmptyState>{EMPTY_TEXT[status]}</EmptyState>}
          {items.length > 0 && (
            <ul className="adm-list adm-fraud-list">
              {items.map((flag) => (
                <FlagItem
                  key={str(flag.id)}
                  flag={flag}
                  stale={overview.loading}
                  onOpenUser={openUser}
                  onDecide={(action) => setDecision({ flag, action })}
                  onGraph={() => setGraphUser(flag)}
                />
              ))}
            </ul>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={(next) => setQuery({ f_page: String(next) })} />
        </Panel>
      )}

      {view === 'rules' && (
        <Panel title="Правила детекторов" description="Изменения действуют со следующего прогона. Выключенное правило не ставит новых флагов, открытые остаются.">
          {initialLoading ? <LoadingState /> : rules.length === 0 ? <EmptyState>Правил нет.</EmptyState> : (
            <ul className="adm-list">
              {rules.map((rule) => (
                <RuleEditor
                  key={`${str(rule.id)}:${str(rule.updatedAt)}`}
                  rule={rule}
                  saving={pending === `rule:${str(rule.id)}`}
                  onSave={(draft) => void saveRule(rule, draft)}
                />
              ))}
            </ul>
          )}
        </Panel>
      )}

      {view === 'whitelist' && (
        <WhitelistPanel
          items={whitelist}
          loading={initialLoading}
          adding={pending === 'wl-add'}
          onAdd={addWhitelist}
          onRemove={setRemoveEntry}
        />
      )}

      {decision && <DecisionDialog decision={decision} pending={pending === 'decide'} onClose={() => setDecision(null)} onSubmit={(payload) => void decide(payload)} />}

      {graphUser && (
        <GraphDrawer
          user={graphUser}
          onClose={() => setGraphUser(null)}
          onOpenUser={(id) => {
            // Граф закрываем: иначе Escape в карточке закрыл бы оба окна разом.
            setGraphUser(null)
            openUser(id)
          }}
        />
      )}

      {removeEntry && (
        <Modal
          open
          title="Убрать из белого списка"
          onClose={() => setRemoveEntry(null)}
          footer={(
            <>
              <Button onClick={() => setRemoveEntry(null)}>Отмена</Button>
              <Button variant="danger" loading={pending === 'wl-remove'} onClick={() => void removeWhitelist()} data-initial-focus>Убрать</Button>
            </>
          )}
        >
          <p>
            {WHITELIST_KIND[str(removeEntry.kind) as WhitelistKind]?.label ?? str(removeEntry.kind)} <span className="adm-mono">{str(removeEntry.value)}</span> снова будет проверяться детекторами со следующего прогона.
          </p>
        </Modal>
      )}
    </div>
  )
}

/* ---------- Флаг ---------- */

function FlagItem({ flag, stale, onOpenUser, onDecide, onGraph }: {
  flag: Row
  stale: boolean
  onOpenUser: (id: string) => void
  onDecide: (action: DecisionAction) => void
  onGraph: () => void
}) {
  const risk = str(flag.risk)
  const status = str(flag.status)
  const name = str(flag.fullName).trim()
  const email = str(flag.email)
  const decidable = status === 'open' || status === 'deferred'
  const banned = bool(flag.isBanned)
  const badge = STATUS_BADGE[status]

  return (
    <li className={`adm-fraud-flag is-${risk}`} style={stale ? { opacity: 0.6 } : undefined}>
      <div className="adm-fraud-flag-head">
        <button type="button" className="adm-fraud-user" onClick={() => onOpenUser(str(flag.userId))}>{name || email || str(flag.userId)}</button>
        {name && <span className="adm-muted">{email}</span>}
        <Badge tone={riskTone(risk)}>риск: {RISK_LABEL[risk] ?? risk}</Badge>
        <Badge>{str(flag.ruleTitle, str(flag.ruleId))}</Badge>
        {status !== 'open' && badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
        {banned && status !== 'banned' && <Badge tone="danger">аккаунт забанен</Badge>}
        <span className="adm-fraud-balance adm-mono" title="Баланс">{formatKopecks(num(flag.balance))}</span>
      </div>
      <p className="adm-fraud-why"><span className="adm-muted">Почему сработало: </span>{str(flag.explanation)}</p>
      <EvidenceView evidence={flag.evidence} />
      <div className="adm-fraud-meta">
        <span>Поставлен {when(str(flag.createdAt))}</span>
        <span>Обновлён {when(str(flag.updatedAt))}</span>
        {str(flag.deferredUntil) && <span>Отложен до {when(str(flag.deferredUntil))}</span>}
      </div>
      <div className="adm-fraud-actions">
        {decidable && (
          <>
            <Button size="sm" onClick={() => onDecide('clear')}>Ок, не фрод</Button>
            {!banned && <Button size="sm" variant="danger" onClick={() => onDecide('ban')}>Забанить</Button>}
            <Button size="sm" onClick={() => onDecide('limit')}>Ограничить лимит</Button>
            <Button size="sm" variant="ghost" onClick={() => onDecide('defer')}>Отложить</Button>
          </>
        )}
        <Button size="sm" variant="ghost" icon={<Graph size={16} weight="bold" aria-hidden="true" />} onClick={onGraph}>Граф связей</Button>
      </div>
    </li>
  )
}

function EvidenceView({ evidence }: { evidence: Json | undefined }) {
  if (!isRecord(evidence)) return null
  const entries = Object.entries(evidence)
  if (!entries.length) return null
  return (
    <div className="adm-fraud-evidence">
      <div className="adm-fraud-evidence-line">
        {entries.map(([key, value]) => (
          <span key={key}><b>{EVIDENCE_LABEL[key] ?? key}:</b> {compactEvidence(key, value)}</span>
        ))}
      </div>
      <details>
        <summary>Улики целиком</summary>
        <JsonView value={evidence} maxHeight={260} />
      </details>
    </div>
  )
}

function DecisionDialog({ decision, pending, onClose, onSubmit }: {
  decision: Decision
  pending: boolean
  onClose: () => void
  onSubmit: (payload: Record<string, unknown>) => void
}) {
  const formId = useId()
  const [reason, setReason] = useState('')
  const [limit, setLimit] = useState('5')
  const [days, setDays] = useState('7')
  const [error, setError] = useState('')
  const { flag, action } = decision
  const who = str(flag.email) || str(flag.userId)
  const ruleTitle = str(flag.ruleTitle, str(flag.ruleId))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const cleanReason = reason.trim()
    if (action === 'clear') {
      onSubmit({})
      return
    }
    if (action === 'ban') {
      if (cleanReason && cleanReason.length < 3) {
        setError('Причина - от 3 символов или оставь поле пустым.')
        return
      }
      onSubmit(cleanReason ? { reason: cleanReason } : {})
      return
    }
    if (action === 'limit') {
      const value = Number(limit)
      if (limit.trim() === '' || !Number.isInteger(value) || value < 0 || value > 1000) {
        setError('Лимит - целое число от 0 до 1000.')
        return
      }
      onSubmit(cleanReason ? { limit: value, reason: cleanReason } : { limit: value })
      return
    }
    const value = Number(days)
    if (!Number.isInteger(value) || value < 1 || value > 90) {
      setError('Срок - от 1 до 90 дней.')
      return
    }
    onSubmit({ days: value })
  }

  const title = action === 'clear' ? 'Ок, не фрод' : action === 'ban' ? 'Забанить' : action === 'limit' ? 'Ограничить лимит' : 'Отложить флаг'
  const confirm = action === 'clear' ? 'Снять флаг' : action === 'ban' ? 'Забанить' : action === 'limit' ? 'Поставить лимит' : 'Отложить'

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button type="submit" form={formId} variant={action === 'ban' ? 'danger' : 'primary'} loading={pending} data-initial-focus={action === 'clear' ? true : undefined}>{confirm}</Button>
        </>
      )}
    >
      <form id={formId} className="adm-card-form adm-fraud-rule" onSubmit={submit}>
        <p><b>{who}</b> · {ruleTitle}</p>
        <p className="adm-muted">{str(flag.explanation)}</p>
        {action === 'clear' && (
          <p>Флаг закроется, а для этого аккаунта появится исключение: правило «{ruleTitle}» его больше не помечает. Решение попадёт в журнал.</p>
        )}
        {action === 'ban' && (
          <>
            <p>Аккаунт будет заблокирован бессрочно, флаг получит статус «забанен». Снять блокировку можно в карточке пользователя.</p>
            <Field label="Причина" hint="Пусто - в причину попадёт объяснение флага.">
              <textarea data-initial-focus value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
            </Field>
          </>
        )}
        {action === 'limit' && (
          <>
            <p>Аккаунт сможет решать не больше указанного числа задач в сутки. Снять лимит можно в карточке пользователя.</p>
            <Field label="Решений в сутки" hint="0 - решать нельзя совсем.">
              <input data-initial-focus type="number" min={0} max={1000} step={1} value={limit} onChange={(event) => setLimit(event.target.value)} />
            </Field>
            <Field label="Причина (необязательно)" hint="Пусто - в причину попадёт объяснение флага.">
              <input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
            </Field>
          </>
        )}
        {action === 'defer' && (
          <>
            <p>Флаг уйдёт из очереди и вернётся в неё сам, когда срок выйдет.</p>
            <Field label="На сколько дней">
              <input data-initial-focus type="number" min={1} max={90} step={1} value={days} onChange={(event) => setDays(event.target.value)} />
            </Field>
          </>
        )}
        {error && <p className="adm-fraud-error" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}

/* ---------- Граф связей ---------- */

type GraphNode = { id: string; email: string; fullName: string; isBanned: boolean; flags: number; balance: number; depth: number; x: number; y: number; angle: number; links: number }
type GraphEdge = { key: string; source: string; target: string; kind: 'ip' | 'device'; values: string[] }

const GRAPH_SIZE = 640
const GRAPH_CENTER = GRAPH_SIZE / 2

function ringRadii(count: number) {
  if (count <= 1) return [200]
  const inner = 120
  const outer = 270
  return Array.from({ length: count }, (_, index) => inner + ((outer - inner) * index) / (count - 1))
}

/* Раскладка без библиотек: проверяемый аккаунт в центре, остальные на
   кольцах по числу шагов от него. Внешнее кольцо упорядочено по углу
   «родителя», чтобы рёбра меньше перекрещивались. */
function layoutGraph(rootId: string, nodeRows: Row[], edgeRows: Row[]) {
  const edges = new Map<string, GraphEdge>()
  const adjacency = new Map<string, Set<string>>()
  const link = (a: string, b: string) => {
    const set = adjacency.get(a) ?? new Set<string>()
    set.add(b)
    adjacency.set(a, set)
  }
  for (const row of edgeRows) {
    const source = str(row.source)
    const target = str(row.target)
    if (!source || !target || source === target) continue
    const kind = str(row.kind) === 'device' ? 'device' : 'ip'
    const [a, b] = source < target ? [source, target] : [target, source]
    const key = `${a}|${b}|${kind}`
    const value = str(row.value)
    const existing = edges.get(key)
    if (existing) {
      if (value && !existing.values.includes(value)) existing.values.push(value)
    } else {
      edges.set(key, { key, source: a, target: b, kind, values: value ? [value] : [] })
    }
    link(a, b)
    link(b, a)
  }

  const depth = new Map<string, number>([[rootId, 0]])
  const queue = [rootId]
  while (queue.length) {
    const id = queue.shift() as string
    for (const next of adjacency.get(id) ?? []) {
      if (!depth.has(next)) {
        depth.set(next, (depth.get(id) ?? 0) + 1)
        queue.push(next)
      }
    }
  }
  const maxDepth = Math.max(0, ...depth.values())

  const rings = new Map<number, Row[]>()
  for (const row of nodeRows) {
    const id = str(row.id)
    if (!id) continue
    const level = id === rootId ? 0 : depth.get(id) ?? maxDepth + 1
    rings.set(level, [...(rings.get(level) ?? []), row])
  }

  const levels = [...rings.keys()].filter((level) => level > 0).sort((a, b) => a - b)
  const radii = ringRadii(levels.length)
  const placed = new Map<string, GraphNode>()
  const make = (row: Row, level: number, x: number, y: number, angle: number): GraphNode => ({
    id: str(row.id),
    email: str(row.email),
    fullName: str(row.fullName),
    isBanned: bool(row.isBanned),
    flags: num(row.flags),
    balance: num(row.balance),
    depth: level,
    x,
    y,
    angle,
    links: adjacency.get(str(row.id))?.size ?? 0,
  })

  for (const row of rings.get(0) ?? []) placed.set(str(row.id), make(row, 0, GRAPH_CENTER, GRAPH_CENTER, 0))

  levels.forEach((level, ringIndex) => {
    const parentAngle = (row: Row) => {
      let best: number | null = null
      for (const neighbour of adjacency.get(str(row.id)) ?? []) {
        const node = placed.get(neighbour)
        if (node && node.depth < level && node.depth > 0) {
          best = best === null ? node.angle : Math.min(best, node.angle)
        }
      }
      return best ?? 0
    }
    const list = [...(rings.get(level) ?? [])].sort((a, b) => parentAngle(a) - parentAngle(b))
    const radius = radii[ringIndex]
    const offset = -Math.PI / 2 + ringIndex * 0.35
    list.forEach((row, index) => {
      const angle = offset + (index / list.length) * Math.PI * 2
      placed.set(str(row.id), make(row, level, GRAPH_CENTER + radius * Math.cos(angle), GRAPH_CENTER + radius * Math.sin(angle), angle))
    })
  })

  return { nodes: [...placed.values()], edges: [...edges.values()], radii }
}

function edgePath(a: GraphNode, b: GraphNode, kind: GraphEdge['kind']) {
  if (kind === 'ip') return `M${a.x},${a.y} L${b.x},${b.y}`
  // Связь по устройству - дугой: если между парой есть и IP, линии не сливаются.
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy) || 1
  const cx = (a.x + b.x) / 2 - (dy / length) * 22
  const cy = (a.y + b.y) / 2 + (dx / length) * 22
  return `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`
}

function shortEmail(email: string) {
  const local = email.split('@')[0] ?? email
  return local.length > 14 ? `${local.slice(0, 13)}…` : local
}

function GraphDrawer({ user, onClose, onOpenUser }: { user: Row; onClose: () => void; onOpenUser: (id: string) => void }) {
  const userId = str(user.userId)
  const graph = useAsync(() => adminRpc<Json>('admin_fraud_graph', { p_user_id: userId }), [userId])
  const data = obj(graph.data)

  let body
  if (graph.loading && !graph.data) body = <LoadingState label="Строим граф…" />
  else if (graph.error) body = <ErrorState message={graph.error} onRetry={graph.reload} />
  else body = <FraudGraph root={str(data.root, userId)} nodeRows={rows(data.nodes)} edgeRows={rows(data.edges)} onOpenUser={onOpenUser} />

  return (
    <Drawer open wide title="Граф связей" subtitle={str(user.email) || userId} onClose={onClose}>
      {body}
    </Drawer>
  )
}

function FraudGraph({ root, nodeRows, edgeRows, onOpenUser }: { root: string; nodeRows: Row[]; edgeRows: Row[]; onOpenUser: (id: string) => void }) {
  const { nodes, edges, radii } = useMemo(() => layoutGraph(root, nodeRows, edgeRows), [root, nodeRows, edgeRows])
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const showLabels = nodes.length <= 30
  const ipCount = edges.filter((edge) => edge.kind === 'ip').length
  const deviceCount = edges.length - ipCount

  const onKey = (event: KeyboardEvent<SVGGElement>, id: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpenUser(id)
    }
  }

  if (nodes.length <= 1 || edges.length === 0) {
    return <EmptyState>Связей через общий IP или метку устройства не нашлось.</EmptyState>
  }

  const listColumns: Column<GraphNode>[] = [
    {
      key: 'account',
      header: 'Аккаунт',
      render: (node) => (
        <div className="adm-cell-main">
          <strong>{node.fullName || node.email || node.id}</strong>
          {node.fullName && <small>{node.email}</small>}
        </div>
      ),
    },
    { key: 'depth', header: 'Шагов', align: 'right', render: (node) => (node.depth === 0 ? 'центр' : formatNumber(node.depth)) },
    { key: 'links', header: 'Связей', align: 'right', render: (node) => formatNumber(node.links) },
    { key: 'flags', header: 'Флаги', align: 'right', render: (node) => (node.flags ? <Badge tone="warning">{formatNumber(node.flags)}</Badge> : '-') },
    { key: 'balance', header: 'Баланс', align: 'right', mobile: false, render: (node) => <span className="adm-nowrap">{formatKopecks(node.balance)}</span> },
    { key: 'banned', header: 'Статус', render: (node) => (node.isBanned ? <Badge tone="danger">забанен</Badge> : <Badge tone="success">активен</Badge>) },
  ]
  const ordered = [...nodes].sort((a, b) => a.depth - b.depth || b.flags - a.flags || b.links - a.links)

  return (
    <>
      <div className="adm-graph-legend" aria-label="Легенда">
        <span><i className="is-line is-ip" />общий IP · {formatNumber(ipCount)}</span>
        <span><i className="is-line is-device" />общее устройство · {formatNumber(deviceCount)}</span>
        <span><i className="is-dot is-root" />проверяемый</span>
        <span><i className="is-dot is-flagged" />есть открытые флаги</span>
        <span><i className="is-dot is-banned" />забанен</span>
        <span><i className="is-dot" />без флагов</span>
      </div>
      <div className="adm-fraud-graph">
        <svg viewBox={`0 0 ${GRAPH_SIZE} ${GRAPH_SIZE}`} role="img" aria-label={`Граф связей: ${nodes.length} аккаунтов, ${edges.length} связей`}>
          {radii.map((radius) => <circle key={radius} className="adm-graph-ring" cx={GRAPH_CENTER} cy={GRAPH_CENTER} r={radius} />)}
          <g>
            {edges.map((edge) => {
              const a = byId.get(edge.source)
              const b = byId.get(edge.target)
              if (!a || !b) return null
              return (
                <path key={edge.key} d={edgePath(a, b, edge.kind)} className={`adm-graph-edge is-${edge.kind}`} strokeWidth={1.5 + Math.min(3, edge.values.length - 1) * 0.6}>
                  <title>{edge.kind === 'ip' ? 'Общий IP' : 'Общее устройство'}: {edge.values.join(', ') || 'без значения'}</title>
                </path>
              )
            })}
          </g>
          <g>
            {nodes.map((node) => {
              const classes = ['adm-graph-node', node.depth === 0 ? 'is-root' : '', node.isBanned ? 'is-banned' : node.flags > 0 ? 'is-flagged' : ''].filter(Boolean).join(' ')
              const label = node.email || node.id
              return (
                <g
                  key={node.id}
                  className={classes}
                  transform={`translate(${node.x} ${node.y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${label}${node.isBanned ? ', забанен' : ''}${node.flags ? `, флагов ${node.flags}` : ''}. Открыть карточку`}
                  onClick={() => onOpenUser(node.id)}
                  onKeyDown={(event) => onKey(event, node.id)}
                >
                  <title>{`${label}${'\n'}флагов: ${node.flags} · баланс ${formatKopecks(node.balance)}${node.isBanned ? ' · забанен' : ''}`}</title>
                  <circle r={node.depth === 0 ? 16 : 10} />
                  {(showLabels || node.depth === 0) && (
                    <text className="adm-graph-label" y={node.depth === 0 ? 30 : 22} textAnchor="middle">{shortEmail(label)}</text>
                  )}
                </g>
              )
            })}
          </g>
        </svg>
      </div>
      <p className="adm-muted">Показаны связи до двух шагов от проверяемого аккаунта. Адреса из белого списка не учитываются. Нажми на аккаунт, чтобы открыть карточку.</p>
      <DataTable columns={listColumns} rows={ordered} rowKey={(node) => node.id} onRowClick={(node) => onOpenUser(node.id)} />
    </>
  )
}

/* ---------- Правила ---------- */

function RuleEditor({ rule, saving, onSave }: { rule: Row; saving: boolean; onSave: (draft: RuleDraft) => void }) {
  const id = str(rule.id)
  const initial: RuleDraft = {
    enabled: bool(rule.enabled),
    threshold: String(num(rule.threshold)),
    windowHours: String(num(rule.windowHours)),
    risk: str(rule.risk, 'medium'),
  }
  const [draft, setDraft] = useState<RuleDraft>(initial)
  const [error, setError] = useState('')
  const dirty = draft.enabled !== initial.enabled || draft.threshold !== initial.threshold || draft.windowHours !== initial.windowHours || draft.risk !== initial.risk

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const threshold = Number(draft.threshold)
    const windowHours = Number(draft.windowHours)
    if (draft.threshold.trim() === '' || !Number.isFinite(threshold) || threshold < 0) {
      setError('Порог - число не меньше 0.')
      return
    }
    if (!Number.isInteger(windowHours) || windowHours < 1 || windowHours > 8760) {
      setError('Окно - целое число часов от 1 до 8760.')
      return
    }
    setError('')
    onSave(draft)
  }

  return (
    <li className="adm-fraud-rule">
      <div className="adm-fraud-rule-head">
        <strong>{str(rule.title, id)}</strong>
        <Badge tone={riskTone(initial.risk)}>риск: {RISK_LABEL[initial.risk] ?? initial.risk}</Badge>
        {!initial.enabled && <Badge>выключено</Badge>}
        <span className="adm-mono adm-muted">{id}</span>
      </div>
      <p>{str(rule.description)}</p>
      <form className="adm-fraud-rule-grid" onSubmit={submit}>
        <label className="adm-fraud-check">
          <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
          Включено
        </label>
        <Field label={THRESHOLD_LABEL[id] ?? 'Порог'}>
          <input type="number" min={0} step="any" value={draft.threshold} onChange={(event) => setDraft({ ...draft, threshold: event.target.value })} />
        </Field>
        <Field label="Окно, часов">
          <input type="number" min={1} max={8760} step={1} value={draft.windowHours} onChange={(event) => setDraft({ ...draft, windowHours: event.target.value })} />
        </Field>
        <Field label="Риск">
          <select value={draft.risk} onChange={(event) => setDraft({ ...draft, risk: event.target.value })}>
            <option value="low">Низкий</option>
            <option value="medium">Средний</option>
            <option value="high">Высокий</option>
          </select>
        </Field>
        <Button type="submit" variant="primary" size="sm" disabled={!dirty} loading={saving}>Сохранить</Button>
      </form>
      {error && <p className="adm-fraud-error" role="alert">{error}</p>}
      <small className="adm-muted">Изменено {when(str(rule.updatedAt))}</small>
    </li>
  )
}

/* ---------- Белый список ---------- */

function WhitelistPanel({ items, loading, adding, onAdd, onRemove }: {
  items: Row[]
  loading: boolean
  adding: boolean
  onAdd: (kind: WhitelistKind, value: string, note: string) => Promise<boolean>
  onRemove: (entry: Row) => void
}) {
  const [kind, setKind] = useState<WhitelistKind>('ip')
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    let clean = value.trim().toLowerCase()
    if (kind === 'email_domain') clean = clean.replace(/^@+/, '')
    if (clean.length < 2 || clean.length > 200) {
      setError('Значение - от 2 до 200 символов.')
      return
    }
    if (kind === 'ip' && !/^[0-9a-f:.]+$/.test(clean)) {
      setError('IP-адрес - цифры, точки или двоеточия, например 203.0.113.7.')
      return
    }
    if (kind === 'email_domain' && !/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(clean)) {
      setError('Домен - например school.ru, без @ и пробелов.')
      return
    }
    if (kind === 'user' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clean)) {
      setError('Нужен полный id пользователя из карточки.')
      return
    }
    setError('')
    if (await onAdd(kind, clean, note.trim())) {
      setValue('')
      setNote('')
    }
  }

  const columns: Column<Row>[] = [
    { key: 'kind', header: 'Тип', render: (row) => <Badge>{WHITELIST_KIND[str(row.kind) as WhitelistKind]?.label ?? str(row.kind)}</Badge> },
    { key: 'value', header: 'Значение', render: (row) => <span className="adm-mono">{str(row.value)}</span> },
    { key: 'note', header: 'Комментарий', render: (row) => <span className="adm-clamp">{str(row.note) || '-'}</span> },
    { key: 'created', header: 'Добавлено', mobile: false, render: (row) => <span className="adm-nowrap">{when(str(row.createdAt))}</span> },
    {
      key: 'remove',
      header: '',
      align: 'right',
      render: (row) => <Button size="sm" variant="ghost" icon={<Trash size={14} weight="bold" aria-hidden="true" />} onClick={() => onRemove(row)}>Убрать</Button>,
    },
  ]

  return (
    <>
      <Panel title="Добавить в белый список" description={WHITELIST_KIND[kind].hint}>
        <form className="adm-card-form" onSubmit={(event) => void submit(event)}>
          <div className="adm-form-grid">
            <Field label="Тип">
              <select value={kind} onChange={(event) => setKind(event.target.value as WhitelistKind)}>
                <option value="ip">{WHITELIST_KIND.ip.label}</option>
                <option value="email_domain">{WHITELIST_KIND.email_domain.label}</option>
                <option value="user">{WHITELIST_KIND.user.label}</option>
              </select>
            </Field>
            <Field label="Значение">
              <input className="adm-mono" value={value} maxLength={200} placeholder={WHITELIST_KIND[kind].placeholder} onChange={(event) => setValue(event.target.value)} />
            </Field>
            <Field label="Комментарий">
              <input value={note} maxLength={200} placeholder="Почему это не фрод" onChange={(event) => setNote(event.target.value)} />
            </Field>
          </div>
          {error && <p className="adm-fraud-error" role="alert">{error}</p>}
          <div className="adm-form-actions">
            <Button type="submit" variant="primary" loading={adding}>Добавить</Button>
          </div>
        </form>
      </Panel>
      <Panel title="Белый список" description={items.length ? `Записей: ${formatNumber(items.length)}` : undefined}>
        {loading ? <LoadingState /> : <DataTable columns={columns} rows={items} rowKey={(row) => str(row.id)} empty="Белый список пуст." />}
      </Panel>
    </>
  )
}
