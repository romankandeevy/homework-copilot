/* Карточка пользователя поверх любого раздела. Один вызов admin_user_card
   отдаёт всё сразу; после каждого действия карточка перечитывается целиком,
   чтобы на экране не оставалось полуобновлённых цифр. Права берутся из роли:
   support видит всё, но меняет только заметки. */

import { useEffect, useId, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Gauge, Key, LockOpen, Prohibit, SignIn, Trash, WarningCircle } from '@phosphor-icons/react'
import type { Json } from '../lib/database.types'
import {
  adminAction,
  adminRpc,
  arr,
  bool,
  formatDateTime,
  formatKopecks,
  formatNumber,
  formatPercent,
  isRecord,
  num,
  numOrNull,
  obj,
  relativeTime,
  rows,
  rublesInputToKopecks,
  str,
} from './api'
import type { Row } from './api'
import { useAdmin } from './context'
import { Badge, Button, CopyButton, DataTable, Drawer, EmptyState, ErrorState, Field, HorizontalBars, JsonView, LoadingState, Modal, Panel, Stat, StatGrid, Tabs, useAction, useAsync } from './ui'
import type { Column, Tone } from './ui'
import { rememberRecentUser } from './recentUsers'
import { BanDialog, ConfirmDialog } from './userDialogs'
import BalanceHistoryChart from './BalanceHistoryChart'
import './sections/users.css'

type CardTab = 'profile' | 'balance' | 'plan' | 'tasks' | 'economics' | 'sessions' | 'linked' | 'support' | 'notes' | 'audit'

type Dialog =
  | { kind: 'ban' }
  | { kind: 'unban' }
  | { kind: 'limit' }
  | { kind: 'reset' }
  | { kind: 'impersonate' }
  | { kind: 'link'; link: string; email: string }
  | { kind: 'log'; logId: string }
  | { kind: 'revokePlan' }
  | { kind: 'deleteNote'; noteId: string; body: string }

/* ---------- Форматирование ---------- */

const when = (value: string | null | undefined) => (value ? formatDateTime(value) : '-')
const ago = (value: string | null | undefined) => (value ? relativeTime(value) : '-')

// datetime-local отдаёт время без пояса, Date читает его как местное.
function localInputToIso(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function nowLocalInput() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function plural(count: number, forms: [string, string, string]) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

const RISK_LABEL: Record<string, string> = { high: 'высокий', medium: 'средний', low: 'низкий' }

function riskTone(risk: string): Tone {
  if (risk === 'high') return 'danger'
  if (risk === 'medium') return 'warning'
  return 'neutral'
}

const TASK_STATUS: Record<string, { label: string; tone: Tone }> = {
  done: { label: 'решено', tone: 'success' },
  failed: { label: 'ошибка', tone: 'danger' },
  queued: { label: 'в очереди', tone: 'info' },
  running: { label: 'решается', tone: 'info' },
  canceled: { label: 'отменено', tone: 'neutral' },
}

const TICKET_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending_owner: { label: 'ждёт ответа', tone: 'warning' },
  pending_user: { label: 'ждёт ученика', tone: 'info' },
  resolved: { label: 'решено', tone: 'success' },
}

const PLAN_SOURCE: Record<string, string> = { admin: 'выдан вручную', promo: 'промокод', payment: 'оплата' }

const PROVIDER_LABEL: Record<string, string> = { email: 'почта и пароль' }

const AUDIT_EVENT: Record<string, string> = {
  balance_adjusted: 'Изменение баланса',
  user_banned: 'Блокировка',
  user_unbanned: 'Разблокировка',
  user_limit_changed: 'Лимит решений',
  user_plan_granted: 'Тариф выдан',
  user_plan_revoked: 'Тариф отозван',
  user_note_added: 'Заметка добавлена',
  user_note_deleted: 'Заметка удалена',
  user_profile_updated: 'Профиль изменён',
  user_impersonated: 'Вход под пользователем',
  password_reset_sent: 'Письмо сброса пароля',
  fraud_flag_decided: 'Решение антифрода',
  support_replied: 'Ответ в поддержке',
  support_status_changed: 'Статус обращения',
  support_feature_credited: 'Бонус за идею',
  payment_refunded: 'Возврат пополнения',
  reservation_refunded: 'Возврат резерва',
  solution_deleted: 'Решение удалено',
}

const AUDIT_KEY: Record<string, string> = {
  isBanned: 'бан',
  reason: 'причина',
  until: 'до',
  dailySolveLimit: 'лимит в сутки',
  planId: 'тариф',
  expiresAt: 'срок',
  status: 'статус',
  priority: 'приоритет',
  assignedTo: 'назначен',
  body: 'текст',
  amount: 'сумма',
  balanceAfter: 'баланс после',
  fullNameBefore: 'имя было',
  fullNameAfter: 'имя стало',
  gradeBefore: 'класс был',
  gradeAfter: 'класс стал',
  note: 'комментарий',
  email: 'почта',
}

function auditValue(key: string, value: Json | undefined): string {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'boolean') return value ? 'да' : 'нет'
  if (typeof value === 'number') return /amount|balance|kopecks/i.test(key) ? formatKopecks(value) : formatNumber(value)
  if (typeof value === 'string') return /^\d{4}-\d{2}-\d{2}T/.test(value) ? formatDateTime(value) : value
  const text = JSON.stringify(value)
  return text.length > 160 ? `${text.slice(0, 160)}…` : text
}

/* ---------- Карточка ---------- */

export default function UserCard({ userId, onClose }: { userId: string; onClose: () => void }) {
  // Переход к связанному аккаунту меняет userId: вкладки и формы начинаются заново.
  return <UserCardView key={userId} userId={userId} onClose={onClose} />
}

function UserCardView({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { access, openUser, openSection } = useAdmin()
  const canModerate = access.permissions.moderate
  const canMoney = access.permissions.money
  const { pending, run } = useAction()
  const [tab, setTab] = useState<CardTab>('profile')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const card = useAsync(() => adminRpc<Json>('admin_user_card', { p_user_id: userId }), [userId])

  const data = obj(card.data)
  const profile = obj(data.profile)
  const controls = obj(data.controls)
  const wallet = obj(data.wallet)
  const plan = obj(data.plan)
  const payments = rows(data.payments)
  const tasks = rows(data.tasks)
  const economics = obj(data.economics)
  const devices = rows(data.devices)
  const activity = rows(data.activity)
  const linked = rows(data.linked)
  const tickets = rows(data.tickets)
  const flags = rows(data.flags)
  const notes = rows(data.notes)
  const audit = rows(data.audit)

  const email = str(profile.email)
  const fullName = str(profile.fullName).trim()
  const isBanned = bool(controls.isBanned)
  const bannedUntil = str(controls.bannedUntil)
  const banReason = str(controls.banReason)
  const dailyLimit = numOrNull(controls.dailySolveLimit)
  const limitReason = str(controls.limitReason)
  const isAdmin = bool(profile.isAdmin)
  const isSelf = access.userId === userId
  const activeFlags = flags.filter((flag) => str(flag.status) === 'open' || str(flag.status) === 'deferred')
  const loaded = card.data !== null

  // Открытая карточка попадает в «недавние» быстрого поиска раздела «Пользователи».
  useEffect(() => {
    if (loaded && (email || fullName)) rememberRecentUser({ id: userId, email, name: fullName })
  }, [loaded, userId, email, fullName])

  // Действие: выполнить, сообщить итог, перечитать карточку.
  const perform = async <T,>(key: string, action: () => Promise<T>, success: string | ((result: T) => string)) => {
    const result = await run(key, action, success)
    if (result === undefined) return undefined
    card.reload()
    return result
  }

  const closeDialog = () => setDialog(null)
  const performAndClose = async <T,>(key: string, action: () => Promise<T>, success: string | ((result: T) => string)) => {
    const result = await perform(key, action, success)
    if (result !== undefined) setDialog(null)
  }

  const ban = (reason: string, until: string | null) => performAndClose(
    'ban',
    () => adminRpc<Json>('admin_set_user_ban', { p_user_id: userId, p_is_banned: true, p_reason: reason, p_until: until }),
    until ? `Заблокирован до ${formatDateTime(until)}` : 'Заблокирован бессрочно',
  )

  const unban = () => performAndClose(
    'unban',
    () => adminRpc<Json>('admin_set_user_ban', { p_user_id: userId, p_is_banned: false, p_reason: null, p_until: null }),
    'Блокировка снята',
  )

  const setLimit = (limit: number | null, reason: string) => performAndClose(
    'limit',
    () => adminRpc<Json>('admin_set_user_limit', { p_user_id: userId, p_limit: limit, p_reason: reason || null }),
    limit === null ? 'Личный лимит снят' : `Лимит: ${limit} в сутки`,
  )

  const resetPassword = () => performAndClose(
    'reset',
    () => adminAction<{ sent?: boolean; email?: string }>('reset_password', { userId }),
    (result) => `Письмо для смены пароля отправлено на ${result.email ?? email}`,
  )

  const impersonate = async (reason: string) => {
    const result = await run('impersonate', () => adminAction<{ link?: string; email?: string }>('impersonate', { userId, reason }))
    if (!result) return
    if (typeof result.link !== 'string' || !result.link) return
    card.reload()
    setDialog({ kind: 'link', link: result.link, email: result.email ?? email })
  }

  const revokePlan = () => performAndClose(
    'plan',
    () => adminRpc<Json>('admin_set_user_plan', { p_user_id: userId, p_plan_id: null, p_expires_at: null, p_note: null }),
    'Тариф отозван',
  )

  const deleteNote = (noteId: string) => performAndClose(
    'note-delete',
    () => adminRpc<Json>('admin_user_note', { p_action: 'delete', p_note_id: noteId }),
    'Заметка удалена',
  )

  const title = fullName || email || 'Пользователь'
  const subtitle = card.data ? [fullName ? email : '', profile.createdAt ? `с нами с ${when(str(profile.createdAt))}` : ''].filter(Boolean).join(' · ') : undefined

  const tabs: { value: CardTab; label: string; badge?: number }[] = [
    { value: 'profile', label: 'Профиль' },
    { value: 'balance', label: 'Баланс' },
    { value: 'plan', label: 'Тариф и платежи' },
    { value: 'tasks', label: 'Задачи', badge: tasks.length },
    { value: 'economics', label: 'Экономика' },
    { value: 'sessions', label: 'Сессии и IP', badge: devices.length },
    { value: 'linked', label: 'Связанные', badge: linked.length },
    { value: 'support', label: 'Поддержка', badge: tickets.length },
    { value: 'notes', label: 'Заметки', badge: notes.length },
    { value: 'audit', label: 'Журнал' },
  ]

  let content: ReactNode
  if (card.loading && !card.data) content = <LoadingState label="Загружаем карточку…" />
  else if (card.error && !card.data) content = <ErrorState message={card.error} onRetry={card.reload} />
  else {
    content = (
      <>
        {card.error && <ErrorState message={card.error} onRetry={card.reload} />}

        <section className="adm-card-head" aria-label="Состояние аккаунта">
          <div className="adm-card-status">
            {isBanned
              ? <Badge tone="danger">{bannedUntil ? `Забанен до ${formatDateTime(bannedUntil)}` : 'Забанен бессрочно'}</Badge>
              : <Badge tone="success">Активен</Badge>}
            {dailyLimit !== null && <Badge tone="warning">Лимит {formatNumber(dailyLimit)} в сутки</Badge>}
            {isAdmin && <Badge tone="accent">Администратор</Badge>}
            <Badge>{str(obj(plan.current).title, 'Без тарифа')}</Badge>
            <Badge tone="info">{formatKopecks(num(wallet.balance))}</Badge>
          </div>
          {isBanned && banReason && <p className="adm-card-note">Причина блокировки: {banReason}</p>}
          {dailyLimit !== null && limitReason && <p className="adm-card-note">Причина лимита: {limitReason}</p>}

          {canModerate && (
            <div className="adm-card-actions">
              {isBanned && (
                <Button size="sm" icon={<LockOpen size={16} weight="bold" aria-hidden="true" />} onClick={() => setDialog({ kind: 'unban' })}>Разбанить</Button>
              )}
              {!isBanned && !isSelf && (
                <Button size="sm" variant="danger" icon={<Prohibit size={16} weight="bold" aria-hidden="true" />} onClick={() => setDialog({ kind: 'ban' })}>Забанить</Button>
              )}
              <Button size="sm" icon={<Gauge size={16} weight="bold" aria-hidden="true" />} onClick={() => setDialog({ kind: 'limit' })}>Лимит решений</Button>
              <Button size="sm" icon={<Key size={16} weight="bold" aria-hidden="true" />} onClick={() => setDialog({ kind: 'reset' })}>Сбросить пароль</Button>
              {!isAdmin && !isSelf && (
                <Button size="sm" icon={<SignIn size={16} weight="bold" aria-hidden="true" />} onClick={() => setDialog({ kind: 'impersonate' })}>Войти под пользователем</Button>
              )}
            </div>
          )}

          {activeFlags.length > 0 && (
            <div className="adm-card-flags" role="note">
              <div className="adm-card-flags-head">
                <strong>
                  <WarningCircle size={18} weight="bold" aria-hidden="true" />
                  Антифрод: {activeFlags.length} {plural(activeFlags.length, ['флаг', 'флага', 'флагов'])} без решения
                </strong>
                {canModerate && (
                  <Button size="sm" variant="ghost" onClick={() => openSection('fraud')}>Открыть антифрод</Button>
                )}
              </div>
              <ul>
                {activeFlags.slice(0, 5).map((flag) => {
                  const risk = str(flag.risk)
                  return (
                    <li key={str(flag.id)}>
                      <Badge tone={riskTone(risk)}>{RISK_LABEL[risk] ?? risk}</Badge>
                      <span>{str(flag.explanation)}</span>
                      {str(flag.status) === 'deferred' && <span className="adm-muted">отложен</span>}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </section>

        <Tabs value={tab} tabs={tabs} onChange={setTab} />

        {tab === 'profile' && (
          <ProfileTab
            profile={profile}
            devices={devices}
            linkedCount={linked.length}
            canEdit={canModerate}
            saving={pending === 'profile'}
            onSave={async (name, grade) => (await perform('profile', () => adminRpc<Json>('admin_update_user_profile', { p_user_id: userId, p_full_name: name, p_grade: grade }), 'Профиль сохранён')) !== undefined}
            onShowSessions={() => setTab('sessions')}
          />
        )}
        {tab === 'balance' && <BalanceHistoryChart userId={userId} />}
        {tab === 'balance' && (
          <BalanceTab
            wallet={wallet}
            canMoney={canMoney}
            pending={pending}
            onAdjust={async (amount, reason) => (await perform(
              'adjust',
              () => adminRpc<Json>('admin_adjust_balance', { p_user_id: userId, p_amount: amount, p_reason: reason }),
              amount > 0 ? `Начислено ${formatKopecks(amount)}` : `Списано ${formatKopecks(-amount)}`,
            )) !== undefined}
            onTopUp={async (amount, reference) => (await perform(
              'topup',
              () => adminRpc<Json>('admin_record_verified_top_up', { p_user_id: userId, p_amount: amount, p_provider_reference: reference }),
              (result) => {
                const response = obj(result)
                if (!bool(response.applied)) return 'Это пополнение уже записано раньше - повторно не начислено.'
                return bool(response.referralRewarded)
                  ? `Пополнение ${formatKopecks(amount)} записано, реферальные бонусы начислены.`
                  : `Пополнение ${formatKopecks(amount)} записано.`
              },
            )) !== undefined}
          />
        )}
        {tab === 'plan' && (
          <PlanTab
            plan={plan}
            payments={payments}
            canEdit={canModerate}
            saving={pending === 'plan'}
            onGrant={async (planId, expiresAt, note) => (await perform(
              'plan',
              () => adminRpc<Json>('admin_set_user_plan', { p_user_id: userId, p_plan_id: planId, p_expires_at: expiresAt, p_note: note || null }),
              'Тариф выдан',
            )) !== undefined}
            onRevoke={() => setDialog({ kind: 'revokePlan' })}
          />
        )}
        {tab === 'tasks' && <TasksTab tasks={tasks} onOpenLog={(logId) => setDialog({ kind: 'log', logId })} />}
        {tab === 'economics' && <EconomicsTab economics={economics} />}
        {tab === 'sessions' && <SessionsTab devices={devices} activity={activity} />}
        {tab === 'linked' && <LinkedTab linked={linked} onOpen={openUser} />}
        {tab === 'support' && (
          // Переход в раздел сам закрывает карточку: отдельный onClose дал бы лишнюю запись в истории.
          <SupportTab tickets={tickets} onOpen={(conversationId) => openSection('support', { conversation: conversationId })} />
        )}
        {tab === 'notes' && (
          <NotesTab
            notes={notes}
            saving={pending === 'note-add'}
            onAdd={async (body) => (await perform('note-add', () => adminRpc<Json>('admin_user_note', { p_action: 'add', p_user_id: userId, p_body: body }), 'Заметка добавлена')) !== undefined}
            onDelete={(note) => setDialog({ kind: 'deleteNote', noteId: str(note.id), body: str(note.body) })}
          />
        )}
        {tab === 'audit' && <AuditTab audit={audit} />}
      </>
    )
  }

  return (
    <>
      {/* Escape слушают все открытые окна сразу: пока поверх открыт диалог,
          закрываем только его, а не всю карточку. */}
      <Drawer open wide title={title} subtitle={subtitle} onClose={() => { if (!dialog) onClose() }}>
        {content}
      </Drawer>

      {dialog?.kind === 'ban' && <BanDialog pending={pending === 'ban'} onClose={closeDialog} onSubmit={(reason, until) => void ban(reason, until)} />}
      {dialog?.kind === 'unban' && (
        <ConfirmDialog title="Снять блокировку" confirmLabel="Разбанить" pending={pending === 'unban'} onClose={closeDialog} onConfirm={() => void unban()}>
          <p>{email} снова сможет пользоваться аккаунтом. Снятие попадёт в журнал.</p>
        </ConfirmDialog>
      )}
      {dialog?.kind === 'limit' && (
        <LimitDialog current={dailyLimit} currentReason={limitReason} pending={pending === 'limit'} onClose={closeDialog} onSubmit={(limit, reason) => void setLimit(limit, reason)} />
      )}
      {dialog?.kind === 'reset' && (
        <ConfirmDialog title="Сбросить пароль" confirmLabel="Отправить письмо" pending={pending === 'reset'} onClose={closeDialog} onConfirm={() => void resetPassword()}>
          <p>На {email} уйдёт письмо со ссылкой для смены пароля. Отправка попадёт в журнал.</p>
        </ConfirmDialog>
      )}
      {dialog?.kind === 'impersonate' && (
        <ImpersonateDialog email={email} pending={pending === 'impersonate'} onClose={closeDialog} onSubmit={(reason) => void impersonate(reason)} />
      )}
      {dialog?.kind === 'link' && <LinkDialog link={dialog.link} email={dialog.email} onClose={closeDialog} />}
      {dialog?.kind === 'log' && <SolutionLogDialog logId={dialog.logId} onClose={closeDialog} />}
      {dialog?.kind === 'revokePlan' && (
        <ConfirmDialog title="Отозвать тариф" confirmLabel="Отозвать" tone="danger" pending={pending === 'plan'} onClose={closeDialog} onConfirm={() => void revokePlan()}>
          <p>Выданный тариф закончится сейчас, ученик вернётся на тариф по умолчанию. Действие попадёт в журнал.</p>
        </ConfirmDialog>
      )}
      {dialog?.kind === 'deleteNote' && (
        <ConfirmDialog title="Удалить заметку" confirmLabel="Удалить" tone="danger" pending={pending === 'note-delete'} onClose={closeDialog} onConfirm={() => void deleteNote(dialog.noteId)}>
          <p className="adm-card-note-body">{dialog.body}</p>
          <p className="adm-card-hint">Текст удалённой заметки сохранится в журнале.</p>
        </ConfirmDialog>
      )}
    </>
  )
}

/* ---------- Вкладки ---------- */

function ProfileTab({ profile, devices, linkedCount, canEdit, saving, onSave, onShowSessions }: {
  profile: Row
  devices: Row[]
  linkedCount: number
  canEdit: boolean
  saving: boolean
  onSave: (name: string, grade: number) => Promise<boolean>
  onShowSessions: () => void
}) {
  const [name, setName] = useState(str(profile.fullName))
  const [grade, setGrade] = useState(() => {
    const value = numOrNull(profile.grade)
    return value === null ? '' : String(value)
  })
  const [error, setError] = useState('')
  const id = str(profile.id)
  const email = str(profile.email)
  const currentGrade = numOrNull(profile.grade)
  const providers = arr(profile.providers).filter((item): item is string => typeof item === 'string')
  const ips = new Set(devices.map((device) => str(device.ip)).filter(Boolean))
  const deviceIds = new Set(devices.map((device) => str(device.deviceId)).filter(Boolean))
  const lastDevice = devices[0]
  const confirmedAt = str(profile.emailConfirmedAt)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const clean = name.trim()
    if (clean.length < 1 || clean.length > 80) {
      setError('Имя - от 1 до 80 символов.')
      return
    }
    const gradeNumber = Number(grade)
    if (!Number.isInteger(gradeNumber) || gradeNumber < 1 || gradeNumber > 11) {
      setError('Выбери класс от 1 до 11.')
      return
    }
    setError('')
    await onSave(clean, gradeNumber)
  }

  return (
    <div className="adm-card-section">
      <Panel title="Профиль">
        <dl className="adm-kv">
          <dt>Почта</dt>
          <dd className="adm-card-inline">{email || '-'}{email && <CopyButton value={email} label="Скопировать почту" />}</dd>
          <dt>ID</dt>
          <dd className="adm-card-inline"><span className="adm-mono">{id}</span><CopyButton value={id} label="Скопировать id" /></dd>
          <dt>Имя</dt>
          <dd>{str(profile.fullName) || '-'}</dd>
          <dt>Класс</dt>
          <dd>{currentGrade === null ? 'не указан' : `${currentGrade} класс`}</dd>
          <dt>Регистрация</dt>
          <dd>{when(str(profile.createdAt))}</dd>
          <dt>Последний вход</dt>
          <dd>{when(str(profile.lastSignInAt))}</dd>
          <dt>Последняя активность</dt>
          <dd>{ago(str(profile.lastSeenAt))}</dd>
          <dt>Почта подтверждена</dt>
          <dd>{confirmedAt ? when(confirmedAt) : <Badge tone="warning">не подтверждена</Badge>}</dd>
          <dt>Способ входа</dt>
          <dd>{providers.length ? providers.map((provider) => PROVIDER_LABEL[provider] ?? provider).join(', ') : '-'}</dd>
        </dl>
      </Panel>

      {canEdit && (
        <Panel title="Имя и класс" description="Класс ограничивает приёмы, которыми можно решать задачи. Изменение попадёт в журнал.">
          <form className="adm-card-form" onSubmit={(event) => void submit(event)}>
            <div className="adm-form-grid">
              <Field label="Имя">
                <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
              </Field>
              <Field label="Класс">
                <select value={grade} onChange={(event) => setGrade(event.target.value)}>
                  <option value="" disabled>Выбери класс</option>
                  {Array.from({ length: 11 }, (_, index) => index + 1).map((value) => (
                    <option key={value} value={String(value)}>{value} класс</option>
                  ))}
                </select>
              </Field>
            </div>
            {error && <p className="adm-card-error" role="alert">{error}</p>}
            <div className="adm-form-actions">
              <Button type="submit" variant="primary" loading={saving}>Сохранить</Button>
            </div>
          </form>
        </Panel>
      )}

      <Panel title="Устройства" actions={<Button size="sm" variant="ghost" onClick={onShowSessions}>Все сессии</Button>}>
        {devices.length === 0 || !lastDevice ? (
          <EmptyState>Устройств пока нет.</EmptyState>
        ) : (
          <dl className="adm-kv">
            <dt>Записей</dt>
            <dd>{devices.length >= 50 ? '50 и больше' : formatNumber(devices.length)}</dd>
            <dt>Разных IP</dt>
            <dd>{formatNumber(ips.size)}</dd>
            <dt>Меток браузера</dt>
            <dd>{formatNumber(deviceIds.size)}</dd>
            <dt>Последнее</dt>
            <dd>
              {ago(str(lastDevice.lastSeenAt))} · <span className="adm-mono">{str(lastDevice.ip) || 'IP неизвестен'}</span>
              {str(lastDevice.userAgent) && <><br /><span className="adm-muted">{str(lastDevice.userAgent)}</span></>}
            </dd>
            <dt>Связанных аккаунтов</dt>
            <dd>{formatNumber(linkedCount)}</dd>
          </dl>
        )}
      </Panel>
    </div>
  )
}

const ENTRY_COLUMNS: Column<Row>[] = [
  { key: 'date', header: 'Когда', render: (row) => <span className="adm-nowrap">{when(str(row.createdAt))}</span> },
  {
    key: 'amount',
    header: 'Сумма',
    align: 'right',
    render: (row) => {
      const amount = num(row.amount)
      return <span className={amount >= 0 ? 'adm-money-plus' : 'adm-money-minus'}>{amount > 0 ? '+' : amount < 0 ? '-' : ''}{formatKopecks(Math.abs(amount))}</span>
    },
  },
  { key: 'kind', header: 'Тип', mobile: false, render: (row) => (str(row.kind) === 'credit' ? <Badge tone="success">начисление</Badge> : <Badge>списание</Badge>) },
  { key: 'description', header: 'Описание', render: (row) => <span className="adm-clamp">{str(row.description) || '-'}</span> },
  { key: 'key', header: 'Ключ', mobile: false, render: (row) => <span className="adm-mono adm-clamp">{str(row.key)}</span> },
]

function BalanceTab({ wallet, canMoney, pending, onAdjust, onTopUp }: {
  wallet: Row
  canMoney: boolean
  pending: string | null
  onAdjust: (amount: number, reason: string) => Promise<boolean>
  onTopUp: (amount: number, reference: string) => Promise<boolean>
}) {
  const entries = rows(wallet.entries)
  return (
    <div className="adm-card-section">
      <StatGrid>
        <Stat label="Баланс" value={formatKopecks(num(wallet.balance))} />
        <Stat label="Начислено всего" value={formatKopecks(num(wallet.credited))} />
        <Stat label="Списано всего" value={formatKopecks(num(wallet.debited))} />
      </StatGrid>
      {canMoney && (
        <div className="adm-grid-2">
          <AdjustForm saving={pending === 'adjust'} onSubmit={onAdjust} />
          <TopUpForm saving={pending === 'topup'} onSubmit={onTopUp} />
        </div>
      )}
      <Panel title="Операции" description={entries.length >= 100 ? 'Показаны последние 100 операций.' : `Операций: ${formatNumber(entries.length)}`}>
        <DataTable columns={ENTRY_COLUMNS} rows={entries} rowKey={(row) => str(row.id)} empty="Операций пока нет." />
      </Panel>
    </div>
  )
}

function AdjustForm({ saving, onSubmit }: { saving: boolean; onSubmit: (amount: number, reason: string) => Promise<boolean> }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const kopecks = rublesInputToKopecks(amount)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (kopecks === null || kopecks === 0 || Math.abs(kopecks) > 10_000_000) {
      setError('Сумма - ненулевая, не больше 100 000 ₽ по модулю.')
      return
    }
    const clean = reason.trim()
    if (clean.length < 3 || clean.length > 160) {
      setError('Причина - от 3 до 160 символов.')
      return
    }
    setError('')
    if (await onSubmit(kopecks, clean)) {
      setAmount('')
      setReason('')
    }
  }

  const label = kopecks && kopecks > 0 ? `Начислить ${formatKopecks(kopecks)}` : kopecks && kopecks < 0 ? `Списать ${formatKopecks(-kopecks)}` : 'Провести'

  return (
    <Panel title="Корректировка баланса" description="Плюс - начислить, минус - списать. Уйти в минус баланс не может.">
      <form className="adm-card-form" onSubmit={(event) => void submit(event)}>
        <Field label="Сумма, ₽">
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="150 или -40" />
        </Field>
        <Field label="Причина">
          <input value={reason} maxLength={160} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {error && <p className="adm-card-error" role="alert">{error}</p>}
        <div className="adm-form-actions">
          <Button type="submit" variant={kopecks !== null && kopecks < 0 ? 'danger' : 'primary'} loading={saving}>{label}</Button>
        </div>
      </form>
    </Panel>
  )
}

function TopUpForm({ saving, onSubmit }: { saving: boolean; onSubmit: (amount: number, reference: string) => Promise<boolean> }) {
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [error, setError] = useState('')
  const kopecks = rublesInputToKopecks(amount)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (kopecks === null || kopecks <= 0 || kopecks > 100_000_000) {
      setError('Сумма пополнения - от 0,01 до 1 000 000 ₽.')
      return
    }
    const clean = reference.trim().toLowerCase()
    if (clean.length < 6 || clean.length > 160 || !/^[a-z0-9][a-z0-9._:/-]*$/.test(clean)) {
      setError('Идентификатор - от 6 символов: латиница, цифры и ._:/-')
      return
    }
    setError('')
    if (await onSubmit(kopecks, clean)) {
      setAmount('')
      setReference('')
    }
  }

  return (
    <Panel title="Подтверждённое пополнение" description="Деньги, которые пришли у платёжного провайдера. Тот же идентификатор второй раз не начислится.">
      <form className="adm-card-form" onSubmit={(event) => void submit(event)}>
        <Field label="Сумма, ₽">
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="500" />
        </Field>
        <Field label="Идентификатор транзакции">
          <input className="adm-mono" value={reference} maxLength={160} onChange={(event) => setReference(event.target.value)} placeholder="yookassa:2d4f…" />
        </Field>
        {error && <p className="adm-card-error" role="alert">{error}</p>}
        <div className="adm-form-actions">
          <Button type="submit" variant="primary" loading={saving}>{kopecks && kopecks > 0 ? `Записать ${formatKopecks(kopecks)}` : 'Записать'}</Button>
        </div>
      </form>
    </Panel>
  )
}

function PlanTab({ plan, payments, canEdit, saving, onGrant, onRevoke }: {
  plan: Row
  payments: Row[]
  canEdit: boolean
  saving: boolean
  onGrant: (planId: string, expiresAt: string | null, note: string) => Promise<boolean>
  onRevoke: () => void
}) {
  const current = obj(plan.current)
  const grant = isRecord(plan.grant) ? plan.grant : null
  const available = rows(plan.available)
  const history = rows(plan.history)
  const titles = new Map(available.map((item) => [str(item.id), str(item.title)]))
  const [planId, setPlanId] = useState(() => str(current.id) || (available.length ? str(available[0].id) : ''))
  const [expires, setExpires] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const limit = numOrNull(current.dailySolveLimit)
  const price = num(current.priceKopecks)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!planId) {
      setError('Выбери тариф.')
      return
    }
    const expiresIso = localInputToIso(expires)
    if (expires && (!expiresIso || new Date(expiresIso).getTime() <= Date.now())) {
      setError('Срок тарифа должен быть в будущем.')
      return
    }
    setError('')
    if (await onGrant(planId, expiresIso, note.trim())) {
      setExpires('')
      setNote('')
    }
  }

  const historyColumns: Column<Row>[] = [
    { key: 'plan', header: 'Тариф', render: (row) => titles.get(str(row.planId)) || str(row.planId) },
    { key: 'source', header: 'Как', mobile: false, render: (row) => PLAN_SOURCE[str(row.source)] ?? str(row.source) },
    { key: 'started', header: 'С', render: (row) => <span className="adm-nowrap">{when(str(row.startedAt))}</span> },
    { key: 'expires', header: 'До', render: (row) => <span className="adm-nowrap">{str(row.expiresAt) ? when(str(row.expiresAt)) : 'бессрочно'}</span> },
    {
      key: 'state',
      header: 'Состояние',
      render: (row) => {
        if (str(row.revokedAt)) return <Badge>отозван {when(str(row.revokedAt))}</Badge>
        const expiresAt = str(row.expiresAt)
        if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return <Badge tone="warning">истёк</Badge>
        return <Badge tone="success">действует</Badge>
      },
    },
  ]

  const paymentColumns: Column<Row>[] = [
    { key: 'date', header: 'Когда', render: (row) => <span className="adm-nowrap">{when(str(row.createdAt))}</span> },
    { key: 'amount', header: 'Сумма', align: 'right', render: (row) => <span className="adm-nowrap">{formatKopecks(num(row.amount))}</span> },
    { key: 'refunded', header: 'Возвращено', align: 'right', render: (row) => (num(row.refunded) > 0 ? <span className="adm-money-minus">{formatKopecks(num(row.refunded))}</span> : '-') },
    { key: 'reference', header: 'Идентификатор', render: (row) => <span className="adm-mono adm-clamp">{str(row.reference)}</span> },
    { key: 'source', header: 'Источник', mobile: false, render: (row) => str(row.source) || '-' },
  ]

  return (
    <div className="adm-card-section">
      <Panel
        title="Текущий тариф"
        actions={canEdit && grant ? <Button size="sm" variant="danger" onClick={onRevoke}>Отозвать тариф</Button> : undefined}
      >
        <dl className="adm-kv">
          <dt>Тариф</dt>
          <dd className="adm-card-inline">{str(current.title, '-')}{!grant && <Badge>по умолчанию</Badge>}</dd>
          <dt>Решений в сутки</dt>
          <dd>{limit === null ? 'без ограничения' : formatNumber(limit)}</dd>
          <dt>Стоимость</dt>
          <dd>{price > 0 ? formatKopecks(price) : 'бесплатно'}</dd>
          <dt>Выдан</dt>
          <dd>{grant ? when(str(grant.startedAt)) : 'не выдавался'}</dd>
          <dt>Дата следующего списания</dt>
          <dd>{grant ? (str(grant.expiresAt) ? when(str(grant.expiresAt)) : 'нет, тариф бессрочный') : '-'}</dd>
          {grant && str(grant.note) && (
            <>
              <dt>Комментарий</dt>
              <dd>{str(grant.note)}</dd>
            </>
          )}
        </dl>
      </Panel>

      {canEdit && (
        <Panel title="Выдать тариф" description="Выдача заменяет текущий тариф. Без срока тариф бессрочный.">
          <form className="adm-card-form" onSubmit={(event) => void submit(event)}>
            <div className="adm-form-grid">
              <Field label="Тариф">
                <select value={planId} onChange={(event) => setPlanId(event.target.value)}>
                  {!planId && <option value="">Выбери тариф</option>}
                  {available.map((item) => <option key={str(item.id)} value={str(item.id)}>{str(item.title, str(item.id))}</option>)}
                </select>
              </Field>
              <Field label="Действует до (необязательно)" hint="Время по часам этого компьютера.">
                <input type="datetime-local" value={expires} min={nowLocalInput()} onChange={(event) => setExpires(event.target.value)} />
              </Field>
              <Field label="Комментарий">
                <input value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
              </Field>
            </div>
            {error && <p className="adm-card-error" role="alert">{error}</p>}
            <div className="adm-form-actions">
              <Button type="submit" variant="primary" loading={saving} disabled={!available.length}>Выдать тариф</Button>
            </div>
          </form>
        </Panel>
      )}

      <Panel title="История тарифов">
        <DataTable columns={historyColumns} rows={history} rowKey={(row) => `${str(row.planId)}:${str(row.startedAt)}`} empty="Тарифы не выдавались." />
      </Panel>

      <Panel title="Платежи" description="Подтверждённые пополнения и возвраты по ним.">
        <DataTable columns={paymentColumns} rows={payments} rowKey={(row) => str(row.id)} empty="Пополнений не было." />
      </Panel>
    </div>
  )
}

function TasksTab({ tasks, onOpenLog }: { tasks: Row[]; onOpenLog: (logId: string) => void }) {
  const columns: Column<Row>[] = [
    { key: 'date', header: 'Когда', render: (row) => <span className="adm-nowrap">{when(str(row.createdAt))}</span> },
    {
      key: 'task',
      header: 'Задача',
      render: (row) => (
        <div className="adm-cell-main">
          <strong>{str(row.subject) || 'без предмета'}{str(row.grade) ? `, ${str(row.grade)}` : ''}</strong>
          {str(row.preview) && <small className="adm-clamp">{str(row.preview)}</small>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Статус',
      render: (row) => {
        const status = TASK_STATUS[str(row.status)]
        return <Badge tone={status?.tone ?? 'neutral'}>{status?.label ?? str(row.status)}</Badge>
      },
    },
    { key: 'error', header: 'Ошибка', mobile: false, render: (row) => (str(row.error) ? <span className="adm-clamp adm-card-error">{str(row.error)}</span> : '-') },
    { key: 'cost', header: 'Себестоимость', align: 'right', render: (row) => { const cost = numOrNull(row.costKopecks); return <span className="adm-nowrap">{cost === null ? '-' : formatKopecks(cost)}</span> } },
    {
      key: 'log',
      header: '',
      align: 'right',
      render: (row) => (str(row.logId) ? <Button size="sm" variant="ghost" onClick={() => onOpenLog(str(row.logId))}>Лог</Button> : null),
    },
  ]
  return (
    <Panel title="Задачи" description={tasks.length >= 50 ? 'Показаны последние 50 задач.' : undefined}>
      <DataTable columns={columns} rows={tasks} rowKey={(row) => str(row.key) || str(row.createdAt)} empty="Задач пока не было." />
    </Panel>
  )
}

function EconomicsTab({ economics }: { economics: Row }) {
  const solutionCost = num(economics.solutionCostKopecks)
  const chatCost = num(economics.chatCostKopecks)
  const cost = solutionCost + chatCost
  const solutionCharged = num(economics.solutionChargedKopecks)
  const chatCharged = num(economics.chatChargedKopecks)
  const consumed = solutionCharged + chatCharged
  const paid = num(economics.paidKopecks)
  const refunded = num(economics.refundedKopecks)
  const netPaid = paid - refunded
  const usageMargin = consumed - cost
  const usageMarginPercent = consumed > 0 ? (usageMargin / consumed) * 100 : null
  const cashMargin = netPaid - cost

  return (
    <div className="adm-card-section">
      <StatGrid>
        <Stat label="Себестоимость моделей" value={formatKopecks(cost)} hint={`решения ${formatKopecks(solutionCost)} · чат ${formatKopecks(chatCost)}`} />
        <Stat label="Списано с баланса" value={formatKopecks(consumed)} hint={`решения ${formatKopecks(solutionCharged)} · чат ${formatKopecks(chatCharged)}`} />
        <Stat label="Внесено деньгами" value={formatKopecks(netPaid)} hint={refunded ? `оплачено ${formatKopecks(paid)}, возвращено ${formatKopecks(refunded)}` : 'возвратов не было'} />
        <Stat
          label="Маржа на использовании"
          value={formatKopecks(usageMargin)}
          tone={usageMargin < 0 ? 'danger' : usageMargin > 0 ? 'success' : undefined}
          hint={usageMarginPercent === null ? 'списаний не было' : `${formatPercent(usageMarginPercent)} от списанного`}
        />
        <Stat
          label="Маржа на деньгах"
          value={formatKopecks(cashMargin)}
          tone={cashMargin < 0 ? 'danger' : cashMargin > 0 ? 'success' : undefined}
          hint="внесено минус себестоимость"
        />
      </StatGrid>
      <Panel title="Сравнение">
        <HorizontalBars
          format={formatKopecks}
          items={[
            { label: 'Внесено деньгами', value: Math.max(0, netPaid) },
            { label: 'Списано с баланса', value: Math.max(0, consumed) },
            { label: 'Себестоимость', value: Math.max(0, cost) },
          ]}
        />
        <p className="adm-card-econ-note">
          Списано с баланса включает стартовые и бонусные деньги, поэтому может быть больше внесённого.
          Маржа на использовании - сколько осталось со списанного после оплаты моделей, маржа на деньгах - то же относительно реально внесённых денег.
        </p>
      </Panel>
    </div>
  )
}

const DEVICE_COLUMNS: Column<Row>[] = [
  { key: 'ip', header: 'IP', render: (row) => <span className="adm-mono">{str(row.ip) || '-'}</span> },
  { key: 'ua', header: 'Браузер', render: (row) => <span className="adm-clamp">{str(row.userAgent) || '-'}</span> },
  { key: 'device', header: 'Метка устройства', mobile: false, render: (row) => (str(row.deviceId) ? <span className="adm-mono" title={str(row.deviceId)}>{str(row.deviceId).slice(0, 12)}</span> : '-') },
  { key: 'hits', header: 'Заходов', align: 'right', render: (row) => formatNumber(num(row.hits)) },
  { key: 'first', header: 'Впервые', mobile: false, render: (row) => <span className="adm-nowrap">{when(str(row.firstSeenAt))}</span> },
  { key: 'last', header: 'Последний раз', render: (row) => <span className="adm-nowrap">{ago(str(row.lastSeenAt))}</span> },
]

const ACTIVITY_COLUMNS: Column<Row>[] = [
  { key: 'date', header: 'Когда', render: (row) => <span className="adm-nowrap">{when(str(row.createdAt))}</span> },
  { key: 'event', header: 'Событие', render: (row) => <span className="adm-mono">{str(row.event)}</span> },
  { key: 'path', header: 'Страница', render: (row) => <span className="adm-mono adm-clamp">{str(row.path) || '-'}</span> },
]

function SessionsTab({ devices, activity }: { devices: Row[]; activity: Row[] }) {
  return (
    <div className="adm-card-section">
      <Panel title="Устройства и IP" description={devices.length >= 50 ? 'Последние 50 записей.' : undefined}>
        <DataTable columns={DEVICE_COLUMNS} rows={devices} rowKey={(row) => `${str(row.ip)}|${str(row.deviceId)}|${str(row.userAgent)}|${str(row.firstSeenAt)}`} empty="Устройств пока нет." />
      </Panel>
      <Panel title="Недавняя активность" description={activity.length >= 50 ? 'Последние 50 событий.' : undefined}>
        <DataTable columns={ACTIVITY_COLUMNS} rows={activity} rowKey={(row) => str(row.id)} empty="Событий пока нет." />
      </Panel>
    </div>
  )
}

function LinkedTab({ linked, onOpen }: { linked: Row[]; onOpen: (userId: string) => void }) {
  const columns: Column<Row>[] = [
    { key: 'email', header: 'Аккаунт', render: (row) => <strong className="adm-users-link">{str(row.email) || str(row.userId)}</strong> },
    { key: 'via', header: 'Связь', render: (row) => (str(row.via) === 'device' ? <Badge tone="warning">устройство</Badge> : <Badge tone="info">IP</Badge>) },
    { key: 'value', header: 'Общее значение', render: (row) => <span className="adm-mono adm-clamp">{str(row.value)}</span> },
    { key: 'banned', header: 'Статус', render: (row) => (bool(row.isBanned) ? <Badge tone="danger">забанен</Badge> : <Badge tone="success">активен</Badge>) },
  ]
  return (
    <Panel title="Связанные аккаунты" description="Аккаунты с общим IP или общей меткой устройства. Нажми на строку, чтобы открыть карточку.">
      <DataTable
        columns={columns}
        rows={linked}
        rowKey={(row) => `${str(row.userId)}|${str(row.via)}|${str(row.value)}`}
        onRowClick={(row) => onOpen(str(row.userId))}
        empty="Связанных аккаунтов не нашлось."
      />
    </Panel>
  )
}

function SupportTab({ tickets, onOpen }: { tickets: Row[]; onOpen: (conversationId: string) => void }) {
  const columns: Column<Row>[] = [
    {
      key: 'subject',
      header: 'Обращение',
      render: (row) => (
        <div className="adm-cell-main">
          <strong>{str(row.subject) || 'Без темы'}</strong>
          {str(row.category) && <small>{str(row.category)}</small>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Статус',
      render: (row) => {
        const status = TICKET_STATUS[str(row.status)]
        return <Badge tone={status?.tone ?? 'neutral'}>{status?.label ?? str(row.status)}</Badge>
      },
    },
    { key: 'updated', header: 'Обновлено', render: (row) => <span className="adm-nowrap">{ago(str(row.updatedAt))}</span> },
  ]
  return (
    <Panel title="Обращения в поддержку" description="Нажми на обращение, чтобы открыть переписку.">
      <DataTable columns={columns} rows={tickets} rowKey={(row) => str(row.id)} onRowClick={(row) => onOpen(str(row.id))} empty="Обращений не было." />
    </Panel>
  )
}

function NotesTab({ notes, saving, onAdd, onDelete }: {
  notes: Row[]
  saving: boolean
  onAdd: (body: string) => Promise<boolean>
  onDelete: (note: Row) => void
}) {
  const [body, setBody] = useState('')
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const clean = body.trim()
    if (clean.length < 1 || clean.length > 2000) {
      setError('Заметка - от 1 до 2000 символов.')
      return
    }
    setError('')
    if (await onAdd(clean)) setBody('')
  }

  return (
    <div className="adm-card-section">
      <Panel title="Новая заметка" description="Заметки видят только администраторы. Добавление и удаление попадают в журнал.">
        <form className="adm-card-form" onSubmit={(event) => void submit(event)}>
          <Field label="Текст">
            <textarea value={body} maxLength={2000} onChange={(event) => setBody(event.target.value)} />
          </Field>
          {error && <p className="adm-card-error" role="alert">{error}</p>}
          <div className="adm-form-actions">
            <span className="adm-card-hint">{body.length} / 2000</span>
            <Button type="submit" variant="primary" loading={saving} disabled={!body.trim()}>Добавить</Button>
          </div>
        </form>
      </Panel>
      <Panel title="Заметки">
        {notes.length === 0 ? (
          <EmptyState>Заметок пока нет.</EmptyState>
        ) : (
          <ul className="adm-list">
            {notes.map((note) => (
              <li key={str(note.id)} className="adm-card-note-item">
                <p className="adm-card-note-body">{str(note.body)}</p>
                <div className="adm-card-note-meta">
                  <span>{str(note.authorEmail) || 'автор удалён'} · {when(str(note.createdAt))}</span>
                  <Button size="sm" variant="ghost" icon={<Trash size={14} weight="bold" aria-hidden="true" />} onClick={() => onDelete(note)}>Удалить</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

function AuditChange({ before, after, payload }: { before: Json | undefined; after: Json | undefined; payload: Json | undefined }) {
  const previous = isRecord(before) ? before : null
  const next = isRecord(after) ? after : null
  if (!previous && !next) {
    // Старые записи хранят только полезную нагрузку - показываем её простые поля.
    const simple = Object.entries(obj(payload)).filter(([, value]) => value === null || typeof value !== 'object')
    if (!simple.length) return null
    return (
      <ul className="adm-card-diff">
        {simple.map(([key, value]) => (
          <li key={key}><b>{AUDIT_KEY[key] ?? key}:</b> {auditValue(key, value)}</li>
        ))}
      </ul>
    )
  }
  const keys = Array.from(new Set([...Object.keys(previous ?? {}), ...Object.keys(next ?? {})]))
  const changed = keys.filter((key) => JSON.stringify(previous?.[key] ?? null) !== JSON.stringify(next?.[key] ?? null))
  const shown = changed.length ? changed : keys
  return (
    <ul className="adm-card-diff">
      {shown.map((key) => (
        <li key={key}>
          <b>{AUDIT_KEY[key] ?? key}:</b>{' '}
          {previous && <span className="adm-card-before">{auditValue(key, previous[key])}</span>}
          {previous && next && ' → '}
          {next && <span className="adm-card-after">{auditValue(key, next[key])}</span>}
        </li>
      ))}
    </ul>
  )
}

function AuditTab({ audit }: { audit: Row[] }) {
  return (
    <Panel title="Журнал" description="Последние 50 действий администраторов с этим аккаунтом.">
      {audit.length === 0 ? (
        <EmptyState>Действий с этим аккаунтом пока не было.</EmptyState>
      ) : (
        <ul className="adm-list">
          {audit.map((entry) => {
            const event = str(entry.event)
            const payload = entry.payload
            const hasPayload = isRecord(payload) && Object.keys(payload).length > 0
            return (
              <li key={str(entry.id)} className="adm-card-audit">
                <div className="adm-card-audit-head">
                  <strong>{AUDIT_EVENT[event] ?? event}</strong>
                  <span>{str(entry.actorEmail) || 'система'} · {when(str(entry.createdAt))}</span>
                </div>
                <AuditChange before={entry.before} after={entry.after} payload={payload} />
                {hasPayload && (
                  <details className="adm-card-details">
                    <summary>Подробности</summary>
                    <JsonView value={payload} maxHeight={220} />
                  </details>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

/* ---------- Диалоги ---------- */

function LimitDialog({ current, currentReason, pending, onClose, onSubmit }: {
  current: number | null
  currentReason: string
  pending: boolean
  onClose: () => void
  onSubmit: (limit: number | null, reason: string) => void
}) {
  const formId = useId()
  const [value, setValue] = useState(current === null ? '' : String(current))
  const [reason, setReason] = useState(currentReason)
  const [error, setError] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const limit = Number(value)
    if (value.trim() === '' || !Number.isInteger(limit) || limit < 0 || limit > 1000) {
      setError('Лимит - целое число от 0 до 1000 решений в сутки.')
      return
    }
    onSubmit(limit, reason.trim())
  }

  return (
    <Modal
      open
      title="Лимит решений в сутки"
      onClose={onClose}
      footer={(
        <>
          {current !== null && <Button variant="ghost" loading={pending} onClick={() => onSubmit(null, '')}>Снять лимит</Button>}
          <Button onClick={onClose}>Отмена</Button>
          <Button type="submit" form={formId} variant="primary" loading={pending}>Сохранить</Button>
        </>
      )}
    >
      <form id={formId} className="adm-card-form" onSubmit={submit}>
        <p>
          Личный лимит для этого аккаунта. {current === null ? 'Сейчас действует лимит тарифа.' : `Сейчас: ${current} в сутки.`} 0 - решать нельзя совсем.
        </p>
        <Field label="Решений в сутки">
          <input data-initial-focus type="number" min={0} max={1000} step={1} value={value} onChange={(event) => setValue(event.target.value)} />
        </Field>
        <Field label="Причина (необязательно)">
          <input value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {error && <p className="adm-card-error" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}

function ImpersonateDialog({ email, pending, onClose, onSubmit }: { email: string; pending: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const formId = useId()
  const [reason, setReason] = useState('')
  return (
    <Modal
      open
      title="Войти под пользователем"
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button type="submit" form={formId} variant="primary" loading={pending}>Получить ссылку</Button>
        </>
      )}
    >
      <form
        id={formId}
        className="adm-card-form"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(reason.trim())
        }}
      >
        <p>Выпишем одноразовую ссылку входа в аккаунт {email}. Вход с причиной попадёт в журнал.</p>
        <Field label="Зачем входишь" hint="Например: проверить, что видит ученик после жалобы.">
          <input data-initial-focus value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </form>
    </Modal>
  )
}

function LinkDialog({ link, email, onClose }: { link: string; email: string; onClose: () => void }) {
  return (
    <Modal open title="Ссылка входа готова" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Готово</Button>}>
      <div className="adm-card-warning" role="alert">
        <strong>Открой ссылку только в приватном окне (инкогнито).</strong> В обычном окне этого браузера вход под {email} заменит твою сессию администратора - админка выйдет из аккаунта.
      </div>
      <Field label="Одноразовая ссылка">
        <span className="adm-card-link-field">
          <input readOnly value={link} onFocus={(event) => event.target.select()} />
          <CopyButton value={link} label="Скопировать ссылку" />
        </span>
      </Field>
      <p className="adm-card-hint">Ссылка срабатывает один раз. Вход под пользователем уже записан в журнал.</p>
    </Modal>
  )
}

function SolutionLogDialog({ logId, onClose }: { logId: string; onClose: () => void }) {
  const log = useAsync(() => adminRpc<Json>('admin_solution_log', { p_log_id: logId }), [logId])
  const data = obj(log.data)
  const calls = arr(data.calls)
  const issues = arr(data.issues)
  const cost = numOrNull(data.cost_kopecks)
  const credits = numOrNull(data.credits)
  const httpStatus = numOrNull(data.status)
  const photoBytes = num(data.photo_bytes)
  // Замечания могут повторяться дословно: ключ - текст плюс номер повтора.
  const seenIssues = new Map<string, number>()
  const issueItems = issues.map((issue) => {
    const text = typeof issue === 'string' ? issue : JSON.stringify(issue)
    const repeat = (seenIssues.get(text) ?? 0) + 1
    seenIssues.set(text, repeat)
    return { key: `${text}#${repeat}`, text }
  })

  let body: ReactNode
  if (log.loading && !log.data) body = <LoadingState label="Загружаем лог…" />
  else if (log.error) body = <ErrorState message={log.error} onRetry={log.reload} />
  else {
    body = (
      <>
        <dl className="adm-kv">
          <dt>Когда</dt>
          <dd>{when(str(data.created_at))}</dd>
          <dt>Предмет и класс</dt>
          <dd>{str(data.subject) || '-'}{str(data.grade) ? `, ${str(data.grade)}` : ''}</dd>
          <dt>Тип задачи</dt>
          <dd>{str(data.task) || '-'}</dd>
          <dt>Источник</dt>
          <dd>{str(data.source) || '-'}{photoBytes > 0 ? ` · фото ${formatNumber(Math.round(photoBytes / 1024))} КБ` : ''}</dd>
          <dt>Итог</dt>
          <dd className="adm-card-inline">
            <Badge tone={str(data.outcome) === 'success' || str(data.outcome) === 'done' ? 'success' : str(data.error) ? 'danger' : 'neutral'}>{str(data.outcome) || '-'}</Badge>
            {httpStatus !== null && <span className="adm-mono">HTTP {httpStatus}</span>}
            {bool(data.truncated) && <Badge tone="warning">лог обрезан</Badge>}
          </dd>
          <dt>Модели</dt>
          <dd className="adm-mono">{str(data.models) || '-'}</dd>
          <dt>Вызовов модели</dt>
          <dd>{formatNumber(calls.length)}</dd>
          <dt>Время</dt>
          <dd>{formatNumber(num(data.seconds))} с</dd>
          <dt>Себестоимость</dt>
          <dd>{cost === null ? '-' : formatKopecks(cost)}{credits !== null ? ` · ${formatNumber(credits)} кредитов` : ''}</dd>
          <dt>Цена для ученика</dt>
          <dd>{formatKopecks(num(data.price_kopecks))}</dd>
          <dt>Ответ</dt>
          <dd>{formatNumber(num(data.answer_chars))} символов · шагов {formatNumber(num(data.steps_count))} · чертёж {bool(data.has_diagram) ? 'есть' : 'нет'}</dd>
          {str(data.error) && (
            <>
              <dt>Ошибка</dt>
              <dd className="adm-card-error">{str(data.error)}</dd>
            </>
          )}
        </dl>
        <h3>Условие</h3>
        <pre className="adm-card-pre">{str(data.condition) || '-'}</pre>
        {str(data.note) && (
          <>
            <h3>Примечание</h3>
            <pre className="adm-card-pre">{str(data.note)}</pre>
          </>
        )}
        <h3>Замечания проверки: {formatNumber(issues.length)}</h3>
        {issueItems.length ? (
          <ul>
            {issueItems.map((issue) => <li key={issue.key}>{issue.text}</li>)}
          </ul>
        ) : <p className="adm-card-hint">Замечаний нет.</p>}
        <h3>Вызовы модели</h3>
        <JsonView value={calls} maxHeight={260} />
        <h3>Запрос</h3>
        <JsonView value={data.request ?? null} />
        <h3>Ответ модели</h3>
        <JsonView value={data.response ?? null} />
      </>
    )
  }

  return (
    <Modal open title="Лог решения" onClose={onClose} footer={<Button onClick={onClose}>Закрыть</Button>}>
      <div className="adm-card-log">{body}</div>
    </Modal>
  )
}
