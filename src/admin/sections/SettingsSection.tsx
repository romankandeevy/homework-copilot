/* Настройки без деплоя: тарифы, промокоды, промпты решателя, предметы,
   фиче-флаги, баннер и пороги, администраторы. Всё читается приложением
   и решателем из базы на лету. */

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowSquareOut, ArrowUp, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import {
  adminRpc, arr, bool, formatDateTime, formatKopecks, formatNumber, num, numOrNull, obj, rows,
  rublesInputToKopecks, str, strOrNull, type Row,
} from '../api'
import {
  Badge, Button, DataTable, Drawer, EmptyState, ErrorState, Field, LoadingState, Modal, PageHeader, Panel,
  Segmented, Tabs, useAction, useAsync, useQueryState, type Column, type Tone,
} from '../ui'
import { useAdmin } from '../context'
import { solvableSubjects } from '../../lib/subjects'
import './settings.css'

/* ---------- Данные ---------- */

type Plan = {
  id: string
  title: string
  description: string
  priceKopecks: number
  periodDays: number
  dailySolveLimit: number | null
  features: string[]
  isDefault: boolean
  active: boolean
  sort: number
  users: number
  updatedAt: string | null
}

type SubjectSetting = { id: string; enabled: boolean; sort: number; promptVersion: number | null }
type Flag = { key: string; description: string; enabled: boolean; rolloutPercent: number; updatedAt: string | null }
type Overview = { plans: Plan[]; subjects: SubjectSetting[]; flags: Flag[]; settings: Row }

function parseOverview(data: unknown): Overview {
  const overview = obj(data as Row)
  return {
    plans: rows(overview.plans).map((row) => ({
      id: str(row.id),
      title: str(row.title),
      description: str(row.description),
      priceKopecks: num(row.priceKopecks),
      periodDays: num(row.periodDays, 30),
      dailySolveLimit: numOrNull(row.dailySolveLimit),
      features: arr(row.features).filter((item): item is string => typeof item === 'string'),
      isDefault: bool(row.isDefault),
      active: bool(row.active),
      sort: num(row.sort),
      users: num(row.users),
      updatedAt: strOrNull(row.updatedAt),
    })),
    subjects: rows(overview.subjects).map((row) => ({ id: str(row.id), enabled: bool(row.enabled), sort: num(row.sort), promptVersion: numOrNull(row.promptVersion) })),
    flags: rows(overview.flags).map((row) => ({ key: str(row.key), description: str(row.description), enabled: bool(row.enabled), rolloutPercent: num(row.rolloutPercent, 100), updatedAt: strOrNull(row.updatedAt) })),
    settings: obj(overview.settings),
  }
}

const subjectNames = new Map(solvableSubjects.map((subject) => [subject.id, subject.name]))

function subjectLabel(id: string) {
  return subjectNames.get(id) ?? id
}

function kopecksToInput(kopecks: number) {
  return kopecks % 100 === 0 ? String(kopecks / 100) : (kopecks / 100).toFixed(2).replace('.', ',')
}

function intOrNull(value: string) {
  const trimmed = value.trim()
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null
}

function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`set-check${disabled ? ' is-disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function ConfirmModal({ title, children, confirmLabel, danger, loading, onConfirm, onClose }: {
  title: string
  children: React.ReactNode
  confirmLabel: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      )}
    >
      {children}
    </Modal>
  )
}

/* ---------- Раздел ---------- */

type SetTab = 'plans' | 'promo' | 'prompts' | 'subjects' | 'flags' | 'site' | 'admins'

const allTabs: { value: SetTab; label: string }[] = [
  { value: 'plans', label: 'Тарифы' },
  { value: 'promo', label: 'Промокоды' },
  { value: 'prompts', label: 'Промпты решателя' },
  { value: 'subjects', label: 'Предметы' },
  { value: 'flags', label: 'Фиче-флаги' },
  { value: 'site', label: 'Сайт и пороги' },
  { value: 'admins', label: 'Администраторы' },
]

export default function SettingsSection() {
  const { access } = useAdmin()
  if (!access.permissions.settings) {
    return (
      <div className="set-stack">
        <PageHeader title="Настройки" />
        <Panel><EmptyState>Настройки открыты ролям «администратор» и «владелец».</EmptyState></Panel>
      </div>
    )
  }
  return <SettingsContent />
}

function SettingsContent() {
  const { access } = useAdmin()
  const [query, setQuery] = useQueryState({ set_tab: 'plans' })
  const tabs = allTabs.filter((tab) => tab.value !== 'admins' || access.permissions.admins)
  const tab = tabs.find((item) => item.value === query.set_tab)?.value ?? 'plans'
  const { data, error, reload } = useAsync(() => adminRpc('admin_settings_overview'), [])
  const overview = useMemo(() => parseOverview(data), [data])

  let body: React.ReactNode
  if (tab === 'admins') body = <AdminsTab />
  else if (tab === 'prompts') body = <PromptsTab subjects={overview.subjects} onChanged={reload} />
  else if (error) body = <Panel><ErrorState message={error} onRetry={reload} /></Panel>
  else if (!data) body = <Panel><LoadingState /></Panel>
  else if (tab === 'plans') body = <PlansTab plans={overview.plans} onChanged={reload} />
  else if (tab === 'promo') body = <PromoTab plans={overview.plans} />
  else if (tab === 'subjects') body = <SubjectsTab key={JSON.stringify(overview.subjects)} subjects={overview.subjects} onChanged={reload} />
  else if (tab === 'flags') body = <FlagsTab flags={overview.flags} onChanged={reload} />
  else body = <SiteTab settings={overview.settings} onChanged={reload} />

  return (
    <div className="set-stack">
      <PageHeader title="Настройки" description="Изменения действуют сразу, без выкладки. Каждое сохранение попадает в журнал действий." />
      <Tabs value={tab} tabs={tabs} onChange={(value) => setQuery({ set_tab: value })} />
      {body}
    </div>
  )
}

/* ---------- Тарифы ---------- */

function PlansTab({ plans, onChanged }: { plans: Plan[]; onChanged: () => void }) {
  const { access } = useAdmin()
  const { pending, run } = useAction()
  const [editing, setEditing] = useState<Plan | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Plan | null>(null)

  const remove = async (plan: Plan) => {
    const result = await run('delete', () => adminRpc('admin_plan_delete', { p_plan_id: plan.id }), (response) => (bool(obj(response).disabled)
      ? `Тариф «${plan.title}» выключен: его уже выдавали, история сохранена, действующие выдачи отозваны.`
      : `Тариф «${plan.title}» удалён.`))
    if (result === undefined) return
    setDeleting(null)
    onChanged()
  }

  const columns: Column<Plan>[] = [
    {
      key: 'title',
      header: 'Тариф',
      render: (plan) => (
        <span className="adm-cell-main">
          <strong>{plan.title}</strong>
          <small><span className="adm-mono">{plan.id}</span>{plan.description ? ` · ${plan.description}` : ''}</small>
        </span>
      ),
    },
    { key: 'price', header: 'Цена', align: 'right', render: (plan) => <span className="adm-mono adm-nowrap">{formatKopecks(plan.priceKopecks)}</span> },
    { key: 'period', header: 'Срок', align: 'right', mobile: false, render: (plan) => `${formatNumber(plan.periodDays)} дн.` },
    { key: 'limit', header: 'Решений в сутки', align: 'right', render: (plan) => (plan.dailySolveLimit === null ? 'без предела' : formatNumber(plan.dailySolveLimit)) },
    { key: 'users', header: 'Выдан', align: 'right', mobile: false, render: (plan) => formatNumber(plan.users) },
    {
      key: 'state',
      header: 'Статус',
      render: (plan) => (
        <span className="set-badges">
          {plan.isDefault && <Badge tone="accent">по умолчанию</Badge>}
          <Badge tone={plan.active ? 'success' : 'neutral'}>{plan.active ? 'включён' : 'выключен'}</Badge>
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (plan) => (
        <span className="set-row-actions">
          <Button size="sm" icon={<PencilSimple size={14} weight="bold" aria-hidden="true" />} onClick={() => setEditing(plan)}>Изменить</Button>
          {access.permissions.delete && !plan.isDefault && (
            <Button size="sm" variant="danger" icon={<Trash size={14} weight="bold" aria-hidden="true" />} aria-label={`Удалить тариф ${plan.title}`} onClick={() => setDeleting(plan)} />
          )}
        </span>
      ),
    },
  ]

  return (
    <Panel
      title="Тарифы"
      description="Цена решения задаётся в коде (от 4 ₽, зависит от размера задачи), тариф её не меняет: он задаёт дневной предел решений и состав услуги."
      actions={<Button variant="primary" icon={<Plus size={16} weight="bold" aria-hidden="true" />} onClick={() => setEditing('new')}>Новый тариф</Button>}
    >
      <p className="set-note" style={{ marginBottom: 'var(--space-3)' }}>
        Цена тарифа пока справочная: платёжного провайдера нет, её никто не списывает. Тариф выдаётся вручную из админки, срок выдачи - период тарифа.
      </p>
      <DataTable columns={columns} rows={plans} rowKey={(plan) => plan.id} empty="Тарифов нет." />
      {editing && (
        <PlanForm
          plan={editing === 'new' ? null : editing}
          existingIds={plans.map((plan) => plan.id)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            onChanged()
          }}
        />
      )}
      {deleting && (
        <ConfirmModal
          title={`Удалить тариф «${deleting.title}»?`}
          confirmLabel="Удалить"
          danger
          loading={pending === 'delete'}
          onConfirm={() => void remove(deleting)}
          onClose={() => setDeleting(null)}
        >
          <p className="set-note">
            Если тариф уже кому-то выдавали, он не удалится, а выключится: история выдач останется, действующие выдачи будут отозваны, и эти ученики вернутся на тариф по умолчанию.
          </p>
        </ConfirmModal>
      )}
    </Panel>
  )
}

function PlanForm({ plan, existingIds, onClose, onSaved }: { plan: Plan | null; existingIds: string[]; onClose: () => void; onSaved: () => void }) {
  const { pending, run } = useAction()
  const [id, setId] = useState(plan?.id ?? '')
  const [title, setTitle] = useState(plan?.title ?? '')
  const [description, setDescription] = useState(plan?.description ?? '')
  const [price, setPrice] = useState(plan ? kopecksToInput(plan.priceKopecks) : '0')
  const [periodDays, setPeriodDays] = useState(String(plan?.periodDays ?? 30))
  const [limit, setLimit] = useState(plan?.dailySolveLimit === null || plan?.dailySolveLimit === undefined ? '' : String(plan.dailySolveLimit))
  const [features, setFeatures] = useState((plan?.features ?? []).join('\n'))
  const [active, setActive] = useState(plan?.active ?? true)
  const [isDefault, setIsDefault] = useState(plan?.isDefault ?? false)
  const [sort, setSort] = useState(String(plan?.sort ?? 0))

  const normalizedId = id.trim().toLowerCase()
  const priceKopecks = rublesInputToKopecks(price)
  const period = intOrNull(periodDays)
  const limitValue = limit.trim() === '' ? null : intOrNull(limit)
  const sortValue = /^-?\d+$/.test(sort.trim()) ? Number(sort.trim()) : null

  const problem = !/^[a-z0-9_-]{2,40}$/.test(normalizedId)
    ? 'Идентификатор - латиница, цифры, _ и -, от 2 до 40 символов.'
    : !plan && existingIds.includes(normalizedId)
      ? 'Тариф с таким идентификатором уже есть.'
      : title.trim().length < 1 || title.trim().length > 80
        ? 'Название - от 1 до 80 символов.'
        : priceKopecks === null || priceKopecks < 0 || priceKopecks > 10_000_000
          ? 'Цена - от 0 до 100 000 ₽.'
          : period === null || period < 1 || period > 3650
            ? 'Срок - от 1 до 3650 дней.'
            : limit.trim() !== '' && (limitValue === null || limitValue > 10_000)
              ? 'Предел решений - целое число от 0 до 10 000 или пусто.'
              : sortValue === null ? 'Порядок - целое число.' : ''

  const save = async () => {
    if (problem) return
    const payload = {
      id: normalizedId,
      title: title.trim(),
      description: description.trim(),
      priceKopecks,
      periodDays: period,
      dailySolveLimit: limitValue,
      features: features.split('\n').map((line) => line.trim()).filter(Boolean),
      active: isDefault ? true : active,
      isDefault,
      sort: sortValue,
    }
    const result = await run('save', () => adminRpc('admin_plan_save', { p_plan: payload }), 'Тариф сохранён.')
    if (result !== undefined) onSaved()
  }

  const wasDefault = plan?.isDefault ?? false

  return (
    <Drawer open title={plan ? `Тариф «${plan.title}»` : 'Новый тариф'} subtitle={plan?.updatedAt ? `Изменён ${formatDateTime(plan.updatedAt)}` : undefined} onClose={onClose}>
      <form className="set-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
        <div className="adm-form-grid">
          <Field label="Идентификатор" hint={plan ? 'После создания не меняется.' : 'Латиница, цифры, _ и -.'}>
            <input value={id} disabled={Boolean(plan)} onChange={(event) => setId(event.target.value)} autoComplete="off" data-initial-focus />
          </Field>
          <Field label="Название">
            <input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Цена, ₽" hint="Справочная, пока без списания.">
            <input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
          </Field>
          <Field label="Срок, дней">
            <input type="number" min={1} max={3650} value={periodDays} onChange={(event) => setPeriodDays(event.target.value)} />
          </Field>
          <Field label="Решений в сутки" hint="Пусто - без предела.">
            <input type="number" min={0} max={10000} value={limit} onChange={(event) => setLimit(event.target.value)} />
          </Field>
          <Field label="Порядок в списке">
            <input type="number" value={sort} onChange={(event) => setSort(event.target.value)} />
          </Field>
        </div>
        <Field label="Описание" hint="До 500 символов.">
          <textarea value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Field label="Что входит" hint="По одному пункту в строке. Ученик видит их в кабинете.">
          <textarea value={features} onChange={(event) => setFeatures(event.target.value)} />
        </Field>
        <Check label="Включён" checked={isDefault || active} disabled={isDefault} onChange={setActive} />
        <Check label="Тариф по умолчанию" checked={isDefault} disabled={wasDefault} onChange={setIsDefault} />
        <p className="set-note">
          {wasDefault
            ? 'Это тариф по умолчанию: он всегда включён. Снять отметку можно, только назначив основным другой тариф.'
            : 'Тариф по умолчанию действует у всех, кому не выдан другой. Он может быть только один.'}
        </p>
        {problem && <p className="set-form-error" role="alert">{problem}</p>}
        <div className="adm-form-actions">
          <Button onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={Boolean(problem)} loading={pending === 'save'}>Сохранить</Button>
        </div>
      </form>
    </Drawer>
  )
}

/* ---------- Промокоды ---------- */

type Promo = {
  code: string
  kind: 'balance' | 'plan'
  amountKopecks: number | null
  planId: string | null
  planDays: number | null
  startsAt: string | null
  expiresAt: string | null
  maxUses: number | null
  active: boolean
  note: string | null
  createdAt: string | null
  uses: number
  lastUsedAt: string | null
  creditedKopecks: number
  paidAfter: number
  recent: { email: string; redeemedAt: string }[]
}

function parsePromo(row: Row): Promo {
  return {
    code: str(row.code),
    kind: str(row.kind) === 'plan' ? 'plan' : 'balance',
    amountKopecks: numOrNull(row.amountKopecks),
    planId: strOrNull(row.planId),
    planDays: numOrNull(row.planDays),
    startsAt: strOrNull(row.startsAt),
    expiresAt: strOrNull(row.expiresAt),
    maxUses: numOrNull(row.maxUses),
    active: bool(row.active),
    note: strOrNull(row.note),
    createdAt: strOrNull(row.createdAt),
    uses: num(row.uses),
    lastUsedAt: strOrNull(row.lastUsedAt),
    creditedKopecks: num(row.creditedKopecks),
    paidAfter: num(row.paidAfter),
    recent: rows(row.recent).map((item) => ({ email: str(item.email), redeemedAt: str(item.redeemedAt) })),
  }
}

function promoPayload(promo: Pick<Promo, 'code' | 'kind' | 'amountKopecks' | 'planId' | 'planDays' | 'startsAt' | 'expiresAt' | 'maxUses' | 'active' | 'note'>) {
  return {
    code: promo.code,
    kind: promo.kind,
    amountKopecks: promo.kind === 'balance' ? promo.amountKopecks : null,
    planId: promo.kind === 'plan' ? promo.planId : null,
    planDays: promo.kind === 'plan' ? promo.planDays : null,
    startsAt: promo.startsAt,
    expiresAt: promo.expiresAt,
    maxUses: promo.maxUses,
    active: promo.active,
    note: promo.note ?? '',
  }
}

function promoState(promo: Promo): { label: string; tone: Tone } {
  const now = Date.now()
  if (!promo.active) return { label: 'выключен', tone: 'neutral' }
  if (promo.expiresAt && new Date(promo.expiresAt).getTime() <= now) return { label: 'истёк', tone: 'warning' }
  if (promo.startsAt && new Date(promo.startsAt).getTime() > now) return { label: 'ещё не начался', tone: 'info' }
  if (promo.maxUses !== null && promo.uses >= promo.maxUses) return { label: 'исчерпан', tone: 'warning' }
  return { label: 'действует', tone: 'success' }
}

function promoWhat(promo: Promo, plans: Plan[]) {
  if (promo.kind === 'balance') return `+${formatKopecks(promo.amountKopecks ?? 0)} на баланс`
  const title = plans.find((plan) => plan.id === promo.planId)?.title ?? promo.planId ?? 'тариф'
  return `«${title}» на ${formatNumber(promo.planDays ?? 0)} дн.`
}

function promoPeriod(promo: Promo) {
  if (!promo.startsAt && !promo.expiresAt) return 'бессрочно'
  return `${promo.startsAt ? `с ${formatDateTime(promo.startsAt)}` : ''}${promo.startsAt && promo.expiresAt ? ' ' : ''}${promo.expiresAt ? `до ${formatDateTime(promo.expiresAt)}` : ''}`
}

// Поле datetime-local живёт в поясе браузера, база хранит момент времени.
function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromLocalInput(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function PromoTab({ plans }: { plans: Plan[] }) {
  const { pending, run } = useAction()
  const { data, error, loading, reload } = useAsync(() => adminRpc('admin_promo_list'), [])
  const promos = useMemo(() => rows(data).map(parsePromo), [data])
  const [editing, setEditing] = useState<Promo | 'new' | null>(null)
  const [detailCode, setDetailCode] = useState<string | null>(null)
  const detail = promos.find((promo) => promo.code === detailCode) ?? null

  const toggle = async (promo: Promo) => {
    const result = await run(`toggle:${promo.code}`, () => adminRpc('admin_promo_save', { p_promo: promoPayload({ ...promo, active: !promo.active }) }), promo.active ? `Код ${promo.code} выключен.` : `Код ${promo.code} включён.`)
    if (result !== undefined) reload()
  }

  const columns: Column<Promo>[] = [
    { key: 'code', header: 'Код', render: (promo) => <span className="adm-cell-main"><strong className="adm-mono">{promo.code}</strong>{promo.note && <small>{promo.note}</small>}</span> },
    { key: 'what', header: 'Что даёт', render: (promo) => promoWhat(promo, plans) },
    { key: 'period', header: 'Срок', mobile: false, render: (promo) => <span className="adm-nowrap">{promoPeriod(promo)}</span> },
    { key: 'uses', header: 'Использований', align: 'right', render: (promo) => `${formatNumber(promo.uses)}${promo.maxUses !== null ? ` / ${formatNumber(promo.maxUses)}` : ''}` },
    { key: 'last', header: 'Последнее', mobile: false, render: (promo) => (promo.lastUsedAt ? <span className="adm-nowrap">{formatDateTime(promo.lastUsedAt)}</span> : <span className="adm-muted">-</span>) },
    { key: 'credited', header: 'Начислено', align: 'right', mobile: false, render: (promo) => <span className="adm-mono">{formatKopecks(promo.creditedKopecks)}</span> },
    { key: 'paid', header: 'Оплатили после', align: 'right', mobile: false, render: (promo) => formatNumber(promo.paidAfter) },
    { key: 'state', header: 'Статус', render: (promo) => { const state = promoState(promo); return <Badge tone={state.tone}>{state.label}</Badge> } },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (promo) => (
        <span className="set-row-actions">
          <Button size="sm" loading={pending === `toggle:${promo.code}`} onClick={() => void toggle(promo)}>{promo.active ? 'Выключить' : 'Включить'}</Button>
          <Button size="sm" icon={<PencilSimple size={14} weight="bold" aria-hidden="true" />} aria-label={`Изменить ${promo.code}`} onClick={() => setEditing(promo)} />
        </span>
      ),
    },
  ]

  return (
    <Panel
      title="Промокоды"
      description="Код даёт деньги на баланс или тариф на срок. Один ученик погашает код один раз."
      actions={<Button variant="primary" icon={<Plus size={16} weight="bold" aria-hidden="true" />} onClick={() => setEditing('new')}>Новый код</Button>}
    >
      <p className="set-note" style={{ marginBottom: 'var(--space-3)' }}>
        Ученик вводит код в окне аккаунта, во вкладке «Баланс». Поле ввода можно скрыть флагом promo_codes.
      </p>
      {error
        ? <ErrorState message={error} onRetry={reload} />
        : <DataTable columns={columns} rows={promos} rowKey={(promo) => promo.code} loading={loading} empty="Промокодов нет." onRowClick={(promo) => setDetailCode(promo.code)} />}
      {detail && (
        <Drawer open title={`Код ${detail.code}`} subtitle={promoWhat(detail, plans)} onClose={() => setDetailCode(null)}>
          <dl className="adm-kv">
            <dt>Статус</dt><dd><Badge tone={promoState(detail).tone}>{promoState(detail).label}</Badge></dd>
            <dt>Срок</dt><dd>{promoPeriod(detail)}</dd>
            <dt>Использований</dt><dd>{formatNumber(detail.uses)}{detail.maxUses !== null ? ` из ${formatNumber(detail.maxUses)}` : ', без ограничения'}</dd>
            <dt>Последнее</dt><dd>{detail.lastUsedAt ? formatDateTime(detail.lastUsedAt) : 'не использовался'}</dd>
            <dt>Начислено</dt><dd>{formatKopecks(detail.creditedKopecks)}</dd>
            <dt>Оплатили после</dt><dd>{formatNumber(detail.paidAfter)} чел.</dd>
            <dt>Создан</dt><dd>{formatDateTime(detail.createdAt)}</dd>
            {detail.note && <><dt>Заметка</dt><dd>{detail.note}</dd></>}
          </dl>
          <Panel title="Последние погасившие">
            {detail.recent.length === 0
              ? <EmptyState>Код ещё никто не погасил.</EmptyState>
              : (
                <ul className="adm-list">
                  {detail.recent.map((item) => <li key={`${item.email}:${item.redeemedAt}`}>{item.email} · {formatDateTime(item.redeemedAt)}</li>)}
                </ul>
              )}
          </Panel>
          <div className="adm-form-actions">
            <Button onClick={() => { setEditing(detail); setDetailCode(null) }}>Изменить</Button>
          </div>
        </Drawer>
      )}
      {editing && (
        <PromoForm
          promo={editing === 'new' ? null : editing}
          plans={plans}
          existingCodes={promos.map((promo) => promo.code)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
    </Panel>
  )
}

function PromoForm({ promo, plans, existingCodes, onClose, onSaved }: { promo: Promo | null; plans: Plan[]; existingCodes: string[]; onClose: () => void; onSaved: () => void }) {
  const { pending, run } = useAction()
  const activePlans = plans.filter((plan) => plan.active || plan.id === promo?.planId)
  const [code, setCode] = useState(promo?.code ?? '')
  const [kind, setKind] = useState<'balance' | 'plan'>(promo?.kind ?? 'balance')
  const [amount, setAmount] = useState(promo?.amountKopecks ? kopecksToInput(promo.amountKopecks) : '')
  const [planId, setPlanId] = useState(promo?.planId ?? activePlans[0]?.id ?? '')
  const [planDays, setPlanDays] = useState(promo?.planDays ? String(promo.planDays) : '30')
  const [startsAt, setStartsAt] = useState(toLocalInput(promo?.startsAt ?? null))
  const [expiresAt, setExpiresAt] = useState(toLocalInput(promo?.expiresAt ?? null))
  const [maxUses, setMaxUses] = useState(promo?.maxUses ? String(promo.maxUses) : '')
  const [active, setActive] = useState(promo?.active ?? true)
  const [note, setNote] = useState(promo?.note ?? '')

  const normalized = code.trim().toUpperCase()
  const amountKopecks = rublesInputToKopecks(amount)
  const days = intOrNull(planDays)
  const uses = maxUses.trim() === '' ? null : intOrNull(maxUses)
  const startsIso = fromLocalInput(startsAt)
  const expiresIso = fromLocalInput(expiresAt)

  const problem = !/^[A-Z0-9_-]{3,32}$/.test(normalized)
    ? 'Код - от 3 до 32 символов: латиница, цифры, _ и -.'
    : !promo && existingCodes.includes(normalized)
      ? 'Такой код уже есть - открой его на изменение.'
      : kind === 'balance' && (amountKopecks === null || amountKopecks < 1 || amountKopecks > 1_000_000)
        ? 'Сумма начисления - от 0,01 до 10 000 ₽.'
        : kind === 'plan' && !planId
          ? 'Выбери тариф.'
          : kind === 'plan' && (days === null || days < 1 || days > 3650)
            ? 'Срок тарифа - от 1 до 3650 дней.'
            : maxUses.trim() !== '' && (uses === null || uses < 1 || uses > 1_000_000)
              ? 'Лимит использований - от 1 до 1 000 000 или пусто.'
              : startsIso && expiresIso && startsIso >= expiresIso ? 'Окончание должно быть позже начала.' : ''

  const save = async () => {
    if (problem) return
    const payload = promoPayload({
      code: normalized,
      kind,
      amountKopecks,
      planId,
      planDays: days,
      startsAt: startsIso,
      expiresAt: expiresIso,
      maxUses: uses,
      active,
      note: note.trim(),
    })
    const result = await run('save', () => adminRpc('admin_promo_save', { p_promo: payload }), `Код ${normalized} сохранён.`)
    if (result !== undefined) onSaved()
  }

  return (
    <Drawer open title={promo ? `Код ${promo.code}` : 'Новый промокод'} onClose={onClose}>
      <form className="set-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
        <Field label="Код" hint={promo ? 'После создания не меняется.' : 'Заглавная латиница, цифры, _ и -.'}>
          <input value={code} disabled={Boolean(promo)} maxLength={32} onChange={(event) => setCode(event.target.value.toUpperCase())} autoComplete="off" className="adm-mono" data-initial-focus />
        </Field>
        <div className="adm-field">
          <span className="adm-field-label">Что даёт</span>
          <Segmented label="Тип промокода" value={kind} options={[{ value: 'balance', label: 'Деньги на баланс' }, { value: 'plan', label: 'Тариф' }]} onChange={setKind} />
        </div>
        {kind === 'balance'
          ? (
            <Field label="Сумма, ₽" hint="До 10 000 ₽.">
              <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
            </Field>
          )
          : (
            <div className="adm-form-grid">
              <Field label="Тариф">
                <select value={planId} onChange={(event) => setPlanId(event.target.value)}>
                  {activePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}
                </select>
              </Field>
              <Field label="На сколько дней">
                <input type="number" min={1} max={3650} value={planDays} onChange={(event) => setPlanDays(event.target.value)} />
              </Field>
            </div>
          )}
        <div className="adm-form-grid">
          <Field label="Начало" hint="Пусто - сразу. Время по поясу браузера.">
            <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
          </Field>
          <Field label="Окончание" hint="Пусто - бессрочно.">
            <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          </Field>
          <Field label="Всего использований" hint="Пусто - без ограничения.">
            <input type="number" min={1} value={maxUses} onChange={(event) => setMaxUses(event.target.value)} />
          </Field>
        </div>
        <Field label="Заметка" hint="Для себя: откуда код, для кого. До 200 символов.">
          <input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <Check label="Включён" checked={active} onChange={setActive} />
        {problem && <p className="set-form-error" role="alert">{problem}</p>}
        <div className="adm-form-actions">
          <Button onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={Boolean(problem)} loading={pending === 'save'}>Сохранить</Button>
        </div>
      </form>
    </Drawer>
  )
}

/* ---------- Промпты решателя ---------- */

type PromptVersion = {
  id: string
  version: number
  body: string
  note: string | null
  active: boolean
  authorEmail: string | null
  createdAt: string | null
}

type DiffLine = { type: 'same' | 'add' | 'del'; text: string; id: number }

/* Построчная разница по наибольшей общей подпоследовательности. Промпт до
   8000 символов - это сотни строк, таблица помещается в память легко. */
function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const result: DiffLine[] = []
  const push = (type: DiffLine['type'], text: string) => {
    result.push({ type, text, id: result.length })
  }
  if (a.length * b.length > 400_000) {
    a.forEach((text) => push('del', text))
    b.forEach((text) => push('add', text))
    return result
  }
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i])
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push('del', a[i])
      i += 1
    } else {
      push('add', b[j])
      j += 1
    }
  }
  while (i < a.length) { push('del', a[i]); i += 1 }
  while (j < b.length) { push('add', b[j]); j += 1 }
  return result
}

function PromptsTab({ subjects, onChanged }: { subjects: SubjectSetting[]; onChanged: () => void }) {
  const fallback = solvableSubjects[0]?.id ?? ''
  const [query, setQuery] = useQueryState({ set_subject: fallback })
  const subject = subjectNames.has(query.set_subject) ? query.set_subject : fallback
  const enabled = subjects.find((item) => item.id === subject)?.enabled

  return (
    <div className="set-stack">
      <Panel
        title="Промпты решателя"
        description="Текст добавляется к сообщению решателю по этому предмету. Правила предмета из кода (требования к записи и допустимые приёмы по классу) он не отменяет."
      >
        <div className="adm-toolbar" style={{ marginBottom: 0 }}>
          <Field label="Предмет">
            <select value={subject} onChange={(event) => setQuery({ set_subject: event.target.value })}>
              {solvableSubjects.map((item) => {
                const version = subjects.find((setting) => setting.id === item.id)?.promptVersion
                return <option key={item.id} value={item.id}>{item.name}{version ? ` · v${version}` : ''}</option>
              })}
            </select>
          </Field>
          {enabled === false && <Badge tone="warning">предмет выключен</Badge>}
        </div>
      </Panel>
      <PromptWorkspace key={subject} subject={subject} onChanged={onChanged} />
    </div>
  )
}

function PromptWorkspace({ subject, onChanged }: { subject: string; onChanged: () => void }) {
  const { pending, run } = useAction()
  const { data, error, loading, reload } = useAsync(() => adminRpc('admin_prompt_action', { p_action: 'list', p_subject_id: subject }), [subject])
  const versions = useMemo<PromptVersion[]>(() => rows(data).map((row) => ({
    id: str(row.id),
    version: num(row.version),
    body: str(row.body),
    note: strOrNull(row.note),
    active: bool(row.active),
    authorEmail: strOrNull(row.authorEmail),
    createdAt: strOrNull(row.createdAt),
  })), [data])
  const active = versions.find((version) => version.active) ?? null
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = versions.find((version) => version.id === selectedId && !version.active) ?? null
  const [confirmDisable, setConfirmDisable] = useState(false)
  const diff = useMemo(() => (selected ? lineDiff(active?.body ?? '', selected.body) : []), [selected, active])

  const refresh = () => {
    reload()
    onChanged()
  }

  const activate = async (version: PromptVersion) => {
    const result = await run(`activate:${version.id}`, () => adminRpc('admin_prompt_action', { p_action: 'activate', p_subject_id: null, p_body: null, p_note: null, p_prompt_id: version.id }), `Активна версия ${version.version}.`)
    if (result === undefined) return
    setSelectedId(null)
    refresh()
  }

  const disable = async () => {
    const result = await run('disable', () => adminRpc('admin_prompt_action', { p_action: 'disable', p_subject_id: subject }), 'Промпт выключен: решатель работает без него.')
    if (result === undefined) return
    setConfirmDisable(false)
    refresh()
  }

  if (error) return <Panel><ErrorState message={error} onRetry={reload} /></Panel>
  if (!data && loading) return <Panel><LoadingState /></Panel>

  return (
    <>
      <Panel
        title={active ? `Активная версия ${active.version}` : 'Активной версии нет'}
        description={active ? `${active.authorEmail ?? 'автор неизвестен'} · ${formatDateTime(active.createdAt)}${active.note ? ` · ${active.note}` : ''}` : 'Решатель работает только по правилам из кода.'}
        actions={active ? <Button size="sm" variant="danger" onClick={() => setConfirmDisable(true)}>Выключить промпт</Button> : undefined}
      >
        <PromptEditor key={active?.id ?? 'none'} subject={subject} initial={active?.body ?? ''} onSaved={refresh} />
      </Panel>

      {selected && (
        <Panel
          title={`Разница: версия ${selected.version} против ${active ? `активной ${active.version}` : 'пустого промпта'}`}
          description="Красным - строки только в активной, зелёным - только в выбранной."
          actions={<Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>Скрыть</Button>}
        >
          <pre className="set-diff">
            {diff.map((line) => (
              <span key={line.id} className={`is-${line.type}`}>{line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : '  '}{line.text || ' '}</span>
            ))}
          </pre>
        </Panel>
      )}

      <Panel title="История версий" description="Сохранение создаёт новую версию и сразу делает её активной. Откат делает активной старую версию, новую не создаёт.">
        {versions.length === 0
          ? <EmptyState>Для этого предмета промпт ещё не писали.</EmptyState>
          : (
            <ul className="set-versions">
              {versions.map((version) => (
                <li key={version.id} className={`${version.active ? 'is-active' : ''}${selected?.id === version.id ? ' is-selected' : ''}`}>
                  <div className="set-version-head">
                    <span className="set-badges">
                      <strong>Версия {version.version}</strong>
                      {version.active && <Badge tone="success">активна</Badge>}
                    </span>
                    {!version.active && (
                      <span className="set-row-actions">
                        <Button size="sm" variant="ghost" onClick={() => setSelectedId(selected?.id === version.id ? null : version.id)}>
                          {selected?.id === version.id ? 'Скрыть разницу' : 'Сравнить с активной'}
                        </Button>
                        <Button size="sm" loading={pending === `activate:${version.id}`} onClick={() => void activate(version)}>Откатить к этой версии</Button>
                      </span>
                    )}
                  </div>
                  <span className="set-version-meta">{version.authorEmail ?? 'автор неизвестен'} · {formatDateTime(version.createdAt)}{version.note ? ` · ${version.note}` : ''}</span>
                  <details>
                    <summary className="set-version-meta">Текст</summary>
                    <pre className="set-prompt-body">{version.body}</pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
      </Panel>

      {confirmDisable && (
        <ConfirmModal title="Выключить промпт?" confirmLabel="Выключить" danger loading={pending === 'disable'} onConfirm={() => void disable()} onClose={() => setConfirmDisable(false)}>
          <p className="set-note">Решатель по предмету «{subjectLabel(subject)}» будет работать только по правилам из кода. История версий сохранится, любую можно вернуть.</p>
        </ConfirmModal>
      )}
    </>
  )
}

function PromptEditor({ subject, initial, onSaved }: { subject: string; initial: string; onSaved: () => void }) {
  const { pending, run } = useAction()
  const [body, setBody] = useState(initial)
  const [note, setNote] = useState('')
  const trimmed = body.trim()
  const unchanged = trimmed === initial.trim()
  const problem = trimmed.length === 0 ? 'Промпт не может быть пустым - чтобы убрать его, нажми «Выключить промпт».' : trimmed.length > 8000 ? 'Промпт - не длиннее 8000 символов.' : ''

  const save = async () => {
    if (problem || unchanged) return
    const result = await run('save', () => adminRpc('admin_prompt_action', { p_action: 'save', p_subject_id: subject, p_body: trimmed, p_note: note.trim() || null }), (response) => `Сохранена версия ${num(obj(response).version)}, она активна.`)
    if (result !== undefined) onSaved()
  }

  return (
    <form className="set-form set-editor" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <Field label="Текст промпта" hint={`${formatNumber(trimmed.length)} из 8000 символов. Действует на следующие решения, готовые не меняются.`}>
        <textarea value={body} onChange={(event) => setBody(event.target.value)} spellCheck={false} />
      </Field>
      <Field label="Что поменялось" hint="Короткая заметка к версии, до 300 символов.">
        <input value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {problem && !unchanged && <p className="set-form-error" role="alert">{problem}</p>}
      <div className="adm-form-actions">
        {!unchanged && <Button variant="ghost" onClick={() => setBody(initial)}>Вернуть как было</Button>}
        <Button type="submit" variant="primary" disabled={Boolean(problem) || unchanged} loading={pending === 'save'}>Сохранить как новую версию</Button>
      </div>
    </form>
  )
}

/* ---------- Предметы ---------- */

function SubjectsTab({ subjects, onChanged }: { subjects: SubjectSetting[]; onChanged: () => void }) {
  const { pending, run } = useAction()
  const original = useMemo(() => [...subjects].sort((a, b) => a.sort - b.sort), [subjects])
  const [list, setList] = useState(original)
  const dirty = list.some((item, index) => original[index]?.id !== item.id || original[index]?.enabled !== item.enabled)
  const enabledCount = list.filter((item) => item.enabled).length

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= list.length) return
    const next = [...list]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    setList(next)
  }

  const save = async () => {
    const result = await run('save', () => adminRpc('admin_subjects_save', { p_items: list.map((item, index) => ({ id: item.id, enabled: item.enabled, sort: index })) }), 'Предметы сохранены.')
    if (result !== undefined) onChanged()
  }

  return (
    <Panel
      title="Предметы"
      description="Выключенный предмет решатель не принимает: ученик получит ответ, что предмет временно выключен."
      actions={(
        <>
          {dirty && <Button variant="ghost" onClick={() => setList(original)}>Отменить</Button>}
          <Button variant="primary" disabled={!dirty || enabledCount === 0} loading={pending === 'save'} onClick={() => void save()}>Сохранить</Button>
        </>
      )}
    >
      <p className="set-note" style={{ marginBottom: 'var(--space-3)' }}>
        Порядок и включение действуют сразу: форма решения показывает предметы в этом порядке, выключенный предмет не предлагается, а решатель его не принимает.
        {enabledCount === 0 && ' Хотя бы один предмет должен остаться включённым.'}
      </p>
      <ol className="set-order">
        {list.map((item, index) => (
          <li key={item.id} className={item.enabled ? '' : 'is-off'}>
            <span className="set-order-index">{index + 1}</span>
            <span className="set-order-name">
              <strong>{subjectLabel(item.id)}</strong>
              <small>{item.promptVersion ? `промпт v${item.promptVersion}` : 'без промпта'}</small>
            </span>
            <span className="set-order-move">
              <button type="button" className="adm-icon-button" disabled={index === 0} aria-label={`Поднять ${subjectLabel(item.id)}`} onClick={() => move(index, -1)}>
                <ArrowUp size={16} weight="bold" aria-hidden="true" />
              </button>
              <button type="button" className="adm-icon-button" disabled={index === list.length - 1} aria-label={`Опустить ${subjectLabel(item.id)}`} onClick={() => move(index, 1)}>
                <ArrowDown size={16} weight="bold" aria-hidden="true" />
              </button>
            </span>
            <Check label="включён" checked={item.enabled} onChange={(value) => {
                const next = [...list]
                next[index] = { ...item, enabled: value }
                setList(next)
              }} />
          </li>
        ))}
      </ol>
    </Panel>
  )
}

/* ---------- Фиче-флаги ---------- */

// Что на самом деле читает код. Остальные ключи хранятся, но ни на что не влияют.
const flagEffects: Record<string, string> = {
  ai_chat: 'Проверяет сервер чата: выключенный флаг - отказ в ИИ-чате.',
  photo_input: 'Проверяет решатель: выключенный флаг - задачу по фото не принимает. В форме пропадает кнопка фото.',
  schedule: 'Приложение прячет раздел «Расписание» и показывает, что он временно выключен.',
  solution_rating: 'Под разбором пропадает оценка «помог / не помог».',
  promo_codes: 'В кошельке пропадает поле ввода промокода.',
}

function FlagsTab({ flags, onChanged }: { flags: Flag[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<Flag | 'new' | null>(null)

  const columns: Column<Flag>[] = [
    { key: 'key', header: 'Флаг', render: (flag) => <span className="adm-cell-main"><strong className="adm-mono">{flag.key}</strong>{flag.description && <small>{flag.description}</small>}</span> },
    { key: 'enabled', header: 'Состояние', render: (flag) => <Badge tone={flag.enabled ? 'success' : 'neutral'}>{flag.enabled ? 'включён' : 'выключен'}</Badge> },
    { key: 'rollout', header: 'Раскатка', align: 'right', render: (flag) => `${flag.rolloutPercent} %` },
    { key: 'effect', header: 'Где действует', mobile: false, render: (flag) => (flagEffects[flag.key] ? <span className="adm-clamp">{flagEffects[flag.key]}</span> : <Badge tone="warning">код не читает</Badge>) },
    { key: 'updated', header: 'Изменён', mobile: false, render: (flag) => <span className="adm-nowrap">{formatDateTime(flag.updatedAt)}</span> },
    { key: 'actions', header: '', align: 'right', render: (flag) => <Button size="sm" icon={<PencilSimple size={14} weight="bold" aria-hidden="true" />} onClick={() => setEditing(flag)}>Изменить</Button> },
  ]

  return (
    <Panel
      title="Фиче-флаги"
      description="Раскатка в процентах считается по устойчивому хэшу аккаунта или гостя: один и тот же человек видит функцию всегда одинаково."
      actions={<Button variant="primary" icon={<Plus size={16} weight="bold" aria-hidden="true" />} onClick={() => setEditing('new')}>Новый флаг</Button>}
    >
      <p className="set-note" style={{ marginBottom: 'var(--space-3)' }}>
        Действуют флаги, которые читает код: ai_chat, photo_input, schedule, solution_rating и promo_codes. Новый ключ ни на что не влияет, пока его не начнёт читать код.
      </p>
      <DataTable columns={columns} rows={flags} rowKey={(flag) => flag.key} empty="Флагов нет." />
      {editing && (
        <FlagForm
          flag={editing === 'new' ? null : editing}
          existingKeys={flags.map((flag) => flag.key)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            onChanged()
          }}
        />
      )}
    </Panel>
  )
}

function FlagForm({ flag, existingKeys, onClose, onSaved }: { flag: Flag | null; existingKeys: string[]; onClose: () => void; onSaved: () => void }) {
  const { pending, run } = useAction()
  const [key, setKey] = useState(flag?.key ?? '')
  const [description, setDescription] = useState(flag?.description ?? '')
  const [enabled, setEnabled] = useState(flag?.enabled ?? true)
  const [rollout, setRollout] = useState(String(flag?.rolloutPercent ?? 100))
  const normalized = key.trim().toLowerCase()
  const rolloutValue = intOrNull(rollout)

  const problem = !/^[a-z0-9_]{2,40}$/.test(normalized)
    ? 'Ключ - строчная латиница, цифры и _, от 2 до 40 символов.'
    : !flag && existingKeys.includes(normalized)
      ? 'Такой флаг уже есть.'
      : rolloutValue === null || rolloutValue > 100 ? 'Раскатка - целое число от 0 до 100.' : ''

  const save = async () => {
    if (problem) return
    const result = await run('save', () => adminRpc('admin_flag_save', { p_key: normalized, p_enabled: enabled, p_rollout: rolloutValue, p_description: description.trim() || null }), `Флаг ${normalized} сохранён.`)
    if (result !== undefined) onSaved()
  }

  return (
    <Drawer open title={flag ? `Флаг ${flag.key}` : 'Новый флаг'} subtitle={flag ? flagEffects[flag.key] ?? 'Код этот флаг пока не читает.' : undefined} onClose={onClose}>
      <form className="set-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
        <Field label="Ключ" hint={flag ? 'После создания не меняется.' : 'Флаг начнёт действовать, только когда его прочитает код.'}>
          <input value={key} disabled={Boolean(flag)} maxLength={40} className="adm-mono" onChange={(event) => setKey(event.target.value)} autoComplete="off" data-initial-focus />
        </Field>
        <Field label="Описание">
          <input value={description} maxLength={200} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Check label="Включён" checked={enabled} onChange={setEnabled} />
        <Field label="Раскатка, %" hint="100 - всем, 0 - никому, даже если флаг включён.">
          <input type="number" min={0} max={100} step={1} value={rollout} onChange={(event) => setRollout(event.target.value)} />
        </Field>
        <input type="range" min={0} max={100} step={5} value={rolloutValue ?? 0} aria-label="Раскатка, %" onChange={(event) => setRollout(event.target.value)} />
        {problem && <p className="set-form-error" role="alert">{problem}</p>}
        <div className="adm-form-actions">
          <Button onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={Boolean(problem)} loading={pending === 'save'}>Сохранить</Button>
        </div>
      </form>
    </Drawer>
  )
}

/* ---------- Сайт и пороги ---------- */

type BannerTone = 'info' | 'warning' | 'danger'
type Banner = { enabled: boolean; text: string; tone: BannerTone; link: string }

function parseBanner(value: Row['x']): Banner {
  const banner = obj(value)
  const tone = str(banner.tone)
  return {
    enabled: bool(banner.enabled),
    text: str(banner.text),
    tone: tone === 'warning' || tone === 'danger' ? tone : 'info',
    link: str(banner.link),
  }
}

const numericSettings: { key: string; label: string; hint: string; fallback: number; min: number }[] = [
  { key: 'support_sla_minutes', label: 'Ответ в поддержке, минут', hint: 'После этого срока обращение считается просроченным: метка в поддержке и на дашборде.', fallback: 30, min: 1 },
  { key: 'error_alert_users', label: 'Алерт: ошибка задела больше N человек', hint: 'Уведомление «новая ошибка задела много пользователей».', fallback: 5, min: 0 },
  { key: 'error_alert_window_minutes', label: 'Окно для этого подсчёта, минут', hint: 'За сколько последних минут считать затронутых.', fallback: 10, min: 1 },
  { key: 'error_spike_hourly', label: 'Всплеск: ошибок за час больше', hint: 'Уведомление «всплеск ошибок», не чаще раза в час.', fallback: 20, min: 0 },
]

function SiteTab({ settings, onChanged }: { settings: Row; onChanged: () => void }) {
  const { openSection } = useAdmin()
  const banner = parseBanner(settings.site_banner)
  return (
    <div className="set-stack">
      <BannerEditor key={JSON.stringify(banner)} initial={banner} onSaved={onChanged} />
      <Panel
        title="Поддержка и алерты по ошибкам"
        description="Проверка порогов ошибок идёт раз в минуту вместе с рассылкой уведомлений."
        actions={<Button size="sm" icon={<ArrowSquareOut size={16} weight="bold" aria-hidden="true" />} onClick={() => openSection('fraud')}>Пороги антифрода</Button>}
      >
        <div className="adm-form-grid">
          {numericSettings.map((setting) => {
            const current = num(settings[setting.key], setting.fallback)
            return <NumberSetting key={`${setting.key}:${current}`} setting={setting} initial={current} onSaved={onChanged} />
          })}
        </div>
      </Panel>
    </div>
  )
}

function NumberSetting({ setting, initial, onSaved }: { setting: (typeof numericSettings)[number]; initial: number; onSaved: () => void }) {
  const { pending, run } = useAction()
  const [value, setValue] = useState(String(initial))
  const parsed = intOrNull(value)
  const valid = parsed !== null && parsed >= setting.min && parsed <= 10_000

  const save = async () => {
    if (!valid) return
    const result = await run('save', () => adminRpc('admin_setting_save', { p_key: setting.key, p_value: parsed }), 'Сохранено.')
    if (result !== undefined) onSaved()
  }

  return (
    <form className="set-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <Field label={setting.label} hint={valid ? setting.hint : `Целое число от ${setting.min} до 10 000.`}>
        <input type="number" min={setting.min} max={10000} step={1} inputMode="numeric" value={value} onChange={(event) => setValue(event.target.value)} />
      </Field>
      <div>
        <Button type="submit" size="sm" variant="primary" disabled={!valid || parsed === initial} loading={pending === 'save'}>Сохранить</Button>
      </div>
    </form>
  )
}

function BannerEditor({ initial, onSaved }: { initial: Banner; onSaved: () => void }) {
  const { pending, run } = useAction()
  const [banner, setBanner] = useState(initial)
  const text = banner.text.trim()
  const link = banner.link.trim()
  const dirty = JSON.stringify({ ...banner, text, link }) !== JSON.stringify({ ...initial, text: initial.text.trim(), link: initial.link.trim() })
  const problem = text.length > 300
    ? 'Текст - не длиннее 300 символов.'
    : banner.enabled && text.length === 0
      ? 'Включённому баннеру нужен текст.'
      : link && !/^(https:\/\/|\/)\S+$/.test(link) ? 'Ссылка должна начинаться с https:// или с /.' : ''

  const save = async () => {
    if (problem) return
    const result = await run('banner', () => adminRpc('admin_setting_save', { p_key: 'site_banner', p_value: { enabled: banner.enabled, text, tone: banner.tone, link } }), 'Баннер сохранён.')
    if (result !== undefined) onSaved()
  }

  return (
    <Panel title="Баннер на сайте" description="Короткое объявление над интерфейсом: технические работы, сбой, новость.">
      <form className="set-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
        <p className="set-note">
          Баннер появляется над приложением у всех учеников при следующем открытии страницы. Ученик может его скрыть; новый текст покажется снова.
        </p>
        <Check label="Показывать баннер" checked={banner.enabled} onChange={(value) => setBanner({ ...banner, enabled: value })} />
        <Field label="Текст" hint={`${text.length} из 300 символов.`}>
          <textarea value={banner.text} maxLength={300} onChange={(event) => setBanner({ ...banner, text: event.target.value })} />
        </Field>
        <div className="adm-form-grid">
          <div className="adm-field">
            <span className="adm-field-label">Тон</span>
            <Segmented
              label="Тон баннера"
              value={banner.tone}
              options={[{ value: 'info', label: 'Инфо' }, { value: 'warning', label: 'Внимание' }, { value: 'danger', label: 'Сбой' }]}
              onChange={(tone) => setBanner({ ...banner, tone })}
            />
          </div>
          <Field label="Ссылка" hint="Необязательно. https://… или путь на сайте, например /support.">
            <input value={banner.link} onChange={(event) => setBanner({ ...banner, link: event.target.value })} inputMode="url" autoComplete="off" />
          </Field>
        </div>
        <div className="adm-field">
          <span className="adm-field-label">Предпросмотр{banner.enabled ? '' : ' (баннер выключен)'}</span>
          <div className={`set-banner-preview is-${banner.tone}${banner.enabled ? '' : ' is-off'}`} role="note">
            <span>{text || 'Текст баннера'}</span>
            {link && <a href={link} target="_blank" rel="noreferrer">Подробнее</a>}
          </div>
        </div>
        {problem && <p className="set-form-error" role="alert">{problem}</p>}
        <div className="adm-form-actions">
          {dirty && <Button variant="ghost" onClick={() => setBanner(initial)}>Отменить</Button>}
          <Button type="submit" variant="primary" disabled={!dirty || Boolean(problem)} loading={pending === 'banner'}>Сохранить баннер</Button>
        </div>
      </form>
    </Panel>
  )
}

/* ---------- Администраторы ---------- */

type RoleValue = 'owner' | 'admin' | 'support' | 'none'

const roleInfo: { value: Exclude<RoleValue, 'none'>; label: string; can: string }[] = [
  { value: 'owner', label: 'Владелец', can: 'Всё, включая удаление данных, возвраты денег и назначение ролей.' },
  { value: 'admin', label: 'Администратор', can: 'Всё, кроме удаления данных, возвратов денег и управления администраторами.' },
  { value: 'support', label: 'Поддержка', can: 'Обращения в поддержку и просмотр карточек пользователей.' },
]

function roleLabel(role: string) {
  return roleInfo.find((item) => item.value === role)?.label ?? role
}

type AdminRow = { userId: string; email: string; fullName: string | null; role: string; grantedAt: string | null; mfaEnrolled: boolean; lastSignInAt: string | null }

function AdminsTab() {
  const { access } = useAdmin()
  const { pending, run } = useAction()
  const { data, error, loading, reload } = useAsync(() => adminRpc('admin_list_admins'), [])
  const admins = useMemo<AdminRow[]>(() => rows(data).map((row) => ({
    userId: str(row.userId),
    email: str(row.email),
    fullName: strOrNull(row.fullName),
    role: str(row.role),
    grantedAt: strOrNull(row.grantedAt),
    mfaEnrolled: bool(row.mfaEnrolled),
    lastSignInAt: strOrNull(row.lastSignInAt),
  })), [data])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Exclude<RoleValue, 'none'>>('support')
  const [confirm, setConfirm] = useState<{ email: string; role: RoleValue } | null>(null)

  if (!access.permissions.admins) {
    return <Panel><EmptyState>Назначать администраторов может только владелец.</EmptyState></Panel>
  }

  const apply = async () => {
    if (!confirm) return
    const result = await run('role', () => adminRpc('admin_set_admin_role', { p_email: confirm.email, p_role: confirm.role }), confirm.role === 'none' ? `Доступ ${confirm.email} отозван.` : `${confirm.email}: роль «${roleLabel(confirm.role)}».`)
    if (result === undefined) return
    setConfirm(null)
    setEmail('')
    reload()
  }

  const normalizedEmail = email.trim().toLowerCase()
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)

  const columns: Column<AdminRow>[] = [
    { key: 'who', header: 'Администратор', render: (row) => <span className="adm-cell-main"><strong>{row.email}</strong>{row.fullName && <small>{row.fullName}</small>}</span> },
    {
      key: 'role',
      header: 'Роль',
      render: (row) => (row.userId === access.userId
        ? <Badge tone="accent">{roleLabel(row.role)} · это ты</Badge>
        : (
          <select value={row.role} aria-label={`Роль ${row.email}`} onChange={(event) => setConfirm({ email: row.email, role: event.target.value as RoleValue })}>
            {roleInfo.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        )),
    },
    { key: 'mfa', header: 'Второй фактор', render: (row) => <Badge tone={row.mfaEnrolled ? 'success' : 'danger'}>{row.mfaEnrolled ? 'подключён' : 'нет'}</Badge> },
    { key: 'granted', header: 'Доступ с', mobile: false, render: (row) => <span className="adm-nowrap">{formatDateTime(row.grantedAt)}</span> },
    { key: 'last', header: 'Последний вход', mobile: false, render: (row) => <span className="adm-nowrap">{formatDateTime(row.lastSignInAt)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (row.userId === access.userId ? null : <Button size="sm" variant="danger" onClick={() => setConfirm({ email: row.email, role: 'none' })}>Отозвать</Button>),
    },
  ]

  return (
    <div className="set-stack">
      <Panel title="Администраторы" description="Без второго фактора (приложение-аутентификатор) роль ничего не открывает: база отказывает в каждом запросе.">
        {error
          ? <ErrorState message={error} onRetry={reload} />
          : <DataTable columns={columns} rows={admins} rowKey={(row) => row.userId} loading={loading} empty="Администраторов нет." />}
      </Panel>
      <div className="adm-grid-2">
        <Panel title="Выдать доступ" description="У человека уже должен быть аккаунт на сайте с этим адресом.">
          <form className="set-form" onSubmit={(event) => { event.preventDefault(); if (emailValid) setConfirm({ email: normalizedEmail, role }) }}>
            <Field label="Email">
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" />
            </Field>
            <Field label="Роль">
              <select value={role} onChange={(event) => setRole(event.target.value as Exclude<RoleValue, 'none'>)}>
                {roleInfo.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </Field>
            <div className="adm-form-actions">
              <Button type="submit" variant="primary" disabled={!emailValid}>Выдать</Button>
            </div>
          </form>
        </Panel>
        <Panel title="Что может каждая роль">
          <ul className="set-roles">
            {roleInfo.map((item) => <li key={item.value}><strong>{item.label}</strong><span>{item.can}</span></li>)}
          </ul>
        </Panel>
      </div>
      {confirm && (
        <ConfirmModal
          title={confirm.role === 'none' ? 'Отозвать доступ?' : 'Изменить роль?'}
          confirmLabel={confirm.role === 'none' ? 'Отозвать' : 'Подтвердить'}
          danger={confirm.role === 'none' || confirm.role === 'owner'}
          loading={pending === 'role'}
          onConfirm={() => void apply()}
          onClose={() => setConfirm(null)}
        >
          <p className="set-note">
            {confirm.role === 'none'
              ? `${confirm.email} больше не сможет войти в админку.`
              : `${confirm.email} получит роль «${roleLabel(confirm.role)}». ${roleInfo.find((item) => item.value === confirm.role)?.can ?? ''}`}
          </p>
        </ConfirmModal>
      )}
    </div>
  )
}
