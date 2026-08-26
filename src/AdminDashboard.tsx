import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowClockwise,
  CaretRight,
  ChartLineUp,
  CheckCircle,
  CircleNotch,
  CurrencyRub,
  EyeSlash,
  LockKey,
  MagnifyingGlass,
  Prohibit,
  Pulse,
  SignOut,
  TrendUp,
  UserCircle,
  UsersThree,
  Wallet,
  X,
} from '@phosphor-icons/react'
import { formatRubles } from './lib/currency'
import type { Json } from './lib/database.types'
import { supabase } from './lib/supabase'
import './AdminDashboard.css'

type AdminAccess = 'loading' | 'admin' | 'signed-out' | 'forbidden' | 'unavailable'

type AdminUser = {
  id: string
  email: string
  fullName: string
  grade: number | null
  balance: number
  createdAt: string | null
  lastSeenAt: string | null
  lastActivityAt: string | null
  isBanned: boolean
  banReason: string | null
  bannedAt: string | null
}

type DashboardSummary = {
  totalUsers: number
  newUsers: number
  activeUsers: number
  onlineUsers: number
  bannedUsers: number
  solutionCharges: number
  walletCredits: number
  openedSolutions: number
}

type DashboardSeriesItem = {
  date: string
  users: number
  newUsers: number
  charges: number
}

type ActivityItem = {
  id: string
  userId: string
  email: string
  fullName: string
  event: string
  path: string | null
  createdAt: string | null
}

type AdminAction = {
  id: string
  event: string
  payload: Record<string, Json | undefined>
  createdAt: string | null
}

type DashboardData = {
  periodDays: number
  summary: DashboardSummary
  series: DashboardSeriesItem[]
  recentActivity: ActivityItem[]
  recentAdminActions: AdminAction[]
}

type WalletEntry = {
  id: string
  amount: number
  kind: string
  description: string
  createdAt: string | null
}

type UserDetail = {
  user: AdminUser
  walletEntries: WalletEntry[]
  activity: ActivityItem[]
}

const emptySummary: DashboardSummary = {
  totalUsers: 0,
  newUsers: 0,
  activeUsers: 0,
  onlineUsers: 0,
  bannedUsers: 0,
  solutionCharges: 0,
  walletCredits: 0,
  openedSolutions: 0,
}

const emptyDashboard: DashboardData = {
  periodDays: 30,
  summary: emptySummary,
  series: [],
  recentActivity: [],
  recentAdminActions: [],
}

function isRecord(value: Json | undefined | null): value is Record<string, Json | undefined> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: Json | undefined, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asNullableString(value: Json | undefined) {
  return typeof value === 'string' ? value : null
}

function asNumber(value: Json | undefined, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asNullableNumber(value: Json | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asBoolean(value: Json | undefined) {
  return value === true
}

function asArray(value: Json | undefined) {
  return Array.isArray(value) ? value : []
}

function parseUser(value: Json): AdminUser {
  const source = isRecord(value) ? value : {}
  return {
    id: asString(source.id),
    email: asString(source.email, 'Без почты'),
    fullName: asString(source.fullName),
    grade: asNullableNumber(source.grade),
    balance: asNumber(source.balance),
    createdAt: asNullableString(source.createdAt),
    lastSeenAt: asNullableString(source.lastSeenAt),
    lastActivityAt: asNullableString(source.lastActivityAt),
    isBanned: asBoolean(source.isBanned),
    banReason: asNullableString(source.banReason),
    bannedAt: asNullableString(source.bannedAt),
  }
}

function parseActivity(value: Json): ActivityItem {
  const source = isRecord(value) ? value : {}
  return {
    id: asString(source.id),
    userId: asString(source.userId),
    email: asString(source.email, 'Без почты'),
    fullName: asString(source.fullName),
    event: asString(source.event),
    path: asNullableString(source.path),
    createdAt: asNullableString(source.createdAt),
  }
}

function parseDashboard(value: Json | null): DashboardData {
  const source = isRecord(value) ? value : {}
  const summary = isRecord(source.summary) ? source.summary : {}
  return {
    periodDays: asNumber(source.periodDays, 30),
    summary: {
      totalUsers: asNumber(summary.totalUsers),
      newUsers: asNumber(summary.newUsers),
      activeUsers: asNumber(summary.activeUsers),
      onlineUsers: asNumber(summary.onlineUsers),
      bannedUsers: asNumber(summary.bannedUsers),
      solutionCharges: asNumber(summary.solutionCharges),
      walletCredits: asNumber(summary.walletCredits),
      openedSolutions: asNumber(summary.openedSolutions),
    },
    series: asArray(source.series).map((item) => {
      const row = isRecord(item) ? item : {}
      return {
        date: asString(row.date),
        users: asNumber(row.users),
        newUsers: asNumber(row.newUsers),
        charges: asNumber(row.charges),
      }
    }),
    recentActivity: asArray(source.recentActivity).map(parseActivity),
    recentAdminActions: asArray(source.recentAdminActions).map((item) => {
      const row = isRecord(item) ? item : {}
      return {
        id: asString(row.id),
        event: asString(row.event),
        payload: isRecord(row.payload) ? row.payload : {},
        createdAt: asNullableString(row.createdAt),
      }
    }),
  }
}

function parseUserDetail(value: Json | null): UserDetail | null {
  const source = isRecord(value) ? value : null
  if (!source || !isRecord(source.user)) return null

  return {
    user: parseUser(source.user),
    walletEntries: asArray(source.walletEntries).map((item) => {
      const row = isRecord(item) ? item : {}
      return {
        id: asString(row.id),
        amount: asNumber(row.amount),
        kind: asString(row.kind),
        description: asString(row.description),
        createdAt: asNullableString(row.createdAt),
      }
    }),
    activity: asArray(source.activity).map(parseActivity),
  }
}

function formatDate(value: string | null, includeTime = true) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date)
}

function eventLabel(event: string) {
  if (event === 'session_started') return 'зашёл в сервис'
  if (event === 'session_ended') return 'вышел из сервиса'
  if (event === 'page_view') return 'открыл страницу'
  if (event === 'balance_adjusted') return 'изменён баланс'
  if (event === 'user_banned') return 'пользователь заблокирован'
  if (event === 'user_unbanned') return 'пользователь разблокирован'
  return event || 'событие'
}

function databaseErrorMessage(error: { message?: string } | null) {
  const message = error?.message || ''
  if (message.includes('admin access required')) return 'Нет доступа к админке.'
  if (message.includes('balance cannot become negative')) return 'Баланс не может стать отрицательным.'
  if (message.includes('adjustment reason')) return 'Укажи причину: от 3 до 160 символов.'
  if (message.includes('block reason')) return 'Укажи причину блокировки: от 3 до 500 символов.'
  if (message.includes('cannot block their own')) return 'Нельзя заблокировать собственный аккаунт.'
  if (message.includes('user not found')) return 'Пользователь не найден.'
  return 'Операция не выполнилась. Повтори попытку.'
}

function userName(user: Pick<AdminUser, 'fullName' | 'email'>) {
  return user.fullName.trim() || user.email
}

function MetricCard({ icon: Icon, label, value, note, tone = 'default' }: {
  icon: typeof UsersThree
  label: string
  value: string
  note: string
  tone?: 'default' | 'success' | 'danger'
}) {
  return (
    <article className={`admin-metric-card admin-metric-card--${tone}`}>
      <span className="admin-metric-icon"><Icon size={20} weight="duotone" aria-hidden="true" /></span>
      <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
    </article>
  )
}

export default function AdminDashboard() {
  const [access, setAccess] = useState<AdminAccess>('loading')
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const previousTheme = document.documentElement.dataset.theme
    const previousColorScheme = document.documentElement.style.colorScheme
    const previousTitle = document.title
    document.documentElement.dataset.theme = 'dark'
    document.documentElement.style.colorScheme = 'dark'
    document.title = 'Пульт управления — Homework Copilot'
    return () => {
      if (previousTheme) document.documentElement.dataset.theme = previousTheme
      else delete document.documentElement.dataset.theme
      document.documentElement.style.colorScheme = previousColorScheme
      document.title = previousTitle
    }
  }, [])

  const loadDashboard = useCallback(async () => {
    if (!supabase) return
    setDashboardLoading(true)
    const { data, error: dashboardError } = await supabase.rpc('admin_dashboard', { p_period_days: 30 })
    if (dashboardError) setError(databaseErrorMessage(dashboardError))
    else setDashboard(parseDashboard(data))
    setDashboardLoading(false)
  }, [])

  const loadUsers = useCallback(async (nextSearch: string) => {
    if (!supabase) return
    setUsersLoading(true)
    const { data, error: usersError } = await supabase.rpc('admin_list_users', {
      p_search: nextSearch.trim(),
      p_limit: 100,
    })
    if (usersError) setError(databaseErrorMessage(usersError))
    else setUsers(asArray(data).map(parseUser))
    setUsersLoading(false)
  }, [])

  const loadUserDetail = useCallback(async (userId: string) => {
    if (!supabase) return
    setDetailLoading(true)
    const { data, error: detailError } = await supabase.rpc('admin_user_detail', { p_user_id: userId })
    if (detailError) {
      setError(databaseErrorMessage(detailError))
      setDetail(null)
    } else {
      setDetail(parseUserDetail(data))
    }
    setDetailLoading(false)
  }, [])

  const bootstrap = useCallback(async () => {
    if (!supabase) {
      setAccess('unavailable')
      return
    }
    setAccess('loading')
    setError('')
    const { data: sessionData } = await supabase.auth.getSession()
    if (!sessionData.session?.user) {
      setAccess('signed-out')
      return
    }

    const { data: context, error: contextError } = await supabase.rpc('get_admin_context')
    if (contextError) {
      setAccess('forbidden')
      return
    }
    const isAdmin = isRecord(context) && asBoolean(context.isAdmin)
    if (!isAdmin) {
      setAccess('forbidden')
      return
    }

    setAccess('admin')
    await loadDashboard()
  }, [loadDashboard])

  useEffect(() => { void bootstrap() }, [bootstrap])

  useEffect(() => {
    if (access !== 'admin') return
    const timer = window.setTimeout(() => { void loadUsers(search) }, 180)
    return () => window.clearTimeout(timer)
  }, [access, loadUsers, search])

  const reloadAll = async () => {
    setError('')
    setNotice('')
    await Promise.all([loadDashboard(), loadUsers(search)])
    if (detail) await loadUserDetail(detail.user.id)
  }

  const openUser = async (userId: string) => {
    setNotice('')
    setError('')
    setAmount('')
    setReason('')
    await loadUserDetail(userId)
  }

  const adjustBalance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || !detail || actionLoading) return
    const parsedAmount = Number(amount)
    if (!Number.isInteger(parsedAmount) || parsedAmount === 0 || Math.abs(parsedAmount) > 100000) {
      setError('Укажи целое число от −100 000 до 100 000, кроме нуля.')
      return
    }
    if (reason.trim().length < 3) {
      setError('Укажи причину изменения баланса.')
      return
    }

    setActionLoading(true)
    setError('')
    const { error: adjustmentError } = await supabase.rpc('admin_adjust_balance', {
      p_user_id: detail.user.id,
      p_amount: parsedAmount,
      p_reason: reason.trim(),
    })
    if (adjustmentError) setError(databaseErrorMessage(adjustmentError))
    else {
      setAmount('')
      setReason('')
      setNotice(`Баланс ${userName(detail.user)} обновлён.`)
      await Promise.all([loadDashboard(), loadUsers(search), loadUserDetail(detail.user.id)])
    }
    setActionLoading(false)
  }

  const toggleBan = async () => {
    if (!supabase || !detail || actionLoading) return
    const nextIsBanned = !detail.user.isBanned
    if (nextIsBanned && reason.trim().length < 3) {
      setError('Укажи причину блокировки.')
      return
    }

    setActionLoading(true)
    setError('')
    const { error: banError } = await supabase.rpc('admin_set_user_ban', {
      p_user_id: detail.user.id,
      p_is_banned: nextIsBanned,
      p_reason: nextIsBanned ? reason.trim() : undefined,
    })
    if (banError) setError(databaseErrorMessage(banError))
    else {
      setReason('')
      setNotice(nextIsBanned ? 'Аккаунт заблокирован.' : 'Аккаунт разблокирован.')
      await Promise.all([loadDashboard(), loadUsers(search), loadUserDetail(detail.user.id)])
    }
    setActionLoading(false)
  }

  const signOut = async () => {
    if (!supabase) return
    await supabase.auth.signOut({ scope: 'local' })
    setAccess('signed-out')
    setDetail(null)
  }

  const maxSeriesValue = useMemo(() => Math.max(
    1,
    ...dashboard.series.map((item) => Math.max(item.users, item.charges)),
  ), [dashboard.series])

  if (access !== 'admin') {
    const states: Record<Exclude<AdminAccess, 'admin'>, { eyebrow: string; title: string; copy: string }> = {
      loading: { eyebrow: 'Проверка доступа', title: 'Открываем пульт', copy: 'Проверяем защищённую owner-сессию.' },
      'signed-out': { eyebrow: 'Нужен вход', title: 'Войди в свой аккаунт', copy: 'После входа в owner-аккаунт пульт откроется автоматически.' },
      forbidden: { eyebrow: '403', title: 'Доступ закрыт', copy: 'Этот адрес доступен только назначенному владельцу сервиса.' },
      unavailable: { eyebrow: 'Нет подключения', title: 'Supabase не настроен', copy: 'Пульт нельзя открыть без защищённого подключения к данным.' },
    }
    const state = states[access]
    return (
      <main className="admin-shell admin-shell--state">
        <section className="admin-state-card" aria-live="polite">
          <div className="admin-wordmark"><span>H</span> Homework Copilot</div>
          <p>{state.eyebrow}</p>
          <h1>{state.title}</h1>
          <span>{state.copy}</span>
          {access === 'loading' ? <CircleNotch className="admin-state-spinner" size={24} weight="bold" aria-hidden="true" /> : <a href={import.meta.env.BASE_URL}>На сайт <ArrowLeft size={16} weight="bold" aria-hidden="true" /></a>}
        </section>
      </main>
    )
  }

  const summary = dashboard.summary

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <a className="admin-wordmark" href={import.meta.env.BASE_URL}><span>H</span> Homework Copilot</a>
        <div className="admin-topbar-title"><span>Owner console</span><strong>Пульт управления</strong></div>
        <div className="admin-topbar-actions">
          <button className="admin-icon-button" type="button" onClick={() => { void reloadAll() }} disabled={dashboardLoading || usersLoading} aria-label="Обновить данные"><ArrowClockwise size={19} weight="bold" aria-hidden="true" /></button>
          <button className="admin-signout" type="button" onClick={() => { void signOut() }}><SignOut size={17} weight="bold" aria-hidden="true" /> Выйти</button>
        </div>
      </header>

      <div className="admin-layout">
        <aside className="admin-rail" aria-label="Разделы админки">
          <div className="admin-rail-label">Наблюдение</div>
          <a href="#overview" className="is-active"><ChartLineUp size={18} weight="duotone" aria-hidden="true" /> Обзор</a>
          <a href="#users"><UsersThree size={18} weight="duotone" aria-hidden="true" /> Пользователи</a>
          <a href="#events"><Pulse size={18} weight="duotone" aria-hidden="true" /> События</a>
          <div className="admin-rail-status"><span /><div><strong>{summary.onlineUsers}</strong><small>онлайн сейчас</small></div></div>
        </aside>

        <section className="admin-content">
          <section className="admin-overview" id="overview" aria-labelledby="admin-overview-title">
            <div className="admin-section-heading">
              <div><p>Контур сервиса · {dashboard.periodDays} дней</p><h1 id="admin-overview-title">Живые показатели</h1></div>
              <span className="admin-live-badge"><i /> данные из Supabase</span>
            </div>

            <div className="admin-metric-grid">
              <MetricCard icon={UsersThree} label="Всего пользователей" value={String(summary.totalUsers)} note={`+${summary.newUsers} за период`} />
              <MetricCard icon={TrendUp} label="Активны за месяц" value={String(summary.activeUsers)} note="заходили хотя бы раз" tone="success" />
              <MetricCard icon={Pulse} label="Сейчас онлайн" value={String(summary.onlineUsers)} note="активны последние 10 минут" tone="success" />
              <MetricCard icon={Prohibit} label="Заблокировано" value={String(summary.bannedUsers)} note="ограничение включено" tone={summary.bannedUsers ? 'danger' : 'default'} />
              <MetricCard icon={Wallet} label="Списано баланса" value={formatRubles(summary.solutionCharges)} note="не является выручкой" />
              <MetricCard icon={CurrencyRub} label="Подтверждённый доход" value="0 ₽" note="платёжный провайдер не подключён" />
            </div>

            <div className="admin-insight-grid">
              <article className="admin-panel admin-activity-chart">
                <header><div><span>Динамика</span><h2>Активность и списания</h2></div><small>{summary.openedSolutions} открыто решений</small></header>
                <div className="admin-chart" aria-label="Динамика ежедневной активности">
                  {dashboard.series.map((item) => {
                    const usersHeight = Math.max(4, (item.users / maxSeriesValue) * 100)
                    const chargesHeight = Math.max(4, (item.charges / maxSeriesValue) * 100)
                    return <div className="admin-chart-day" key={item.date} title={`${item.date}: ${item.users} активных, ${formatRubles(item.charges)} списано`}><div className="admin-chart-bars"><i style={{ height: `${usersHeight}%` }} /><b style={{ height: `${chargesHeight}%` }} /></div><span>{item.date.slice(8)}</span></div>
                  })}
                  {!dashboard.series.length && <p>Данных пока нет.</p>}
                </div>
                <footer><span><i /> активные пользователи</span><span><b /> списано с баланса</span></footer>
              </article>

              <article className="admin-panel admin-control-note">
                <span className="admin-panel-icon"><LockKey size={21} weight="duotone" aria-hidden="true" /></span>
                <p>Контроль доступа</p>
                <h2>Изменения защищены сервером</h2>
                <span>Баланс, блокировки и журнал действий меняются только owner‑RPC. У ученика баланс обновляется без перезагрузки.</span>
              </article>
            </div>
          </section>

          <section className="admin-panel admin-users-panel" id="users" aria-labelledby="admin-users-title">
            <header className="admin-panel-heading">
              <div><span>Управление</span><h2 id="admin-users-title">Пользователи</h2></div>
              <label className="admin-search"><MagnifyingGlass size={18} weight="bold" aria-hidden="true" /><span className="sr-only">Поиск пользователя</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Имя или почта" /></label>
            </header>

            <div className="admin-table-scroll">
              <table>
                <thead><tr><th>Пользователь</th><th>Баланс</th><th>Последняя активность</th><th>Статус</th><th><span className="sr-only">Открыть</span></th></tr></thead>
                <tbody>
                  {usersLoading && <tr><td colSpan={5} className="admin-table-loading"><CircleNotch size={20} weight="bold" aria-hidden="true" /> Загружаем пользователей…</td></tr>}
                  {!usersLoading && users.map((item) => (
                    <tr key={item.id}>
                      <td><button className="admin-user-cell" type="button" onClick={() => { void openUser(item.id) }}><span>{userName(item)}</span><small>{item.email}{item.grade ? ` · ${item.grade} класс` : ''}</small></button></td>
                      <td className="admin-balance-cell">{formatRubles(item.balance)}</td>
                      <td>{formatDate(item.lastActivityAt || item.lastSeenAt)}</td>
                      <td><span className={`admin-status ${item.isBanned ? 'is-banned' : 'is-active'}`}>{item.isBanned ? 'Заблокирован' : 'Активен'}</span></td>
                      <td><button className="admin-row-open" type="button" onClick={() => { void openUser(item.id) }} aria-label={`Открыть ${userName(item)}`}><CaretRight size={19} weight="bold" aria-hidden="true" /></button></td>
                    </tr>
                  ))}
                  {!usersLoading && !users.length && <tr><td colSpan={5} className="admin-table-empty">Пользователи не найдены.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="admin-event-grid" id="events" aria-label="Журналы">
            <article className="admin-panel admin-feed-panel">
              <header><div><span>Пульс сервиса</span><h2>Последние действия</h2></div><Pulse size={22} weight="duotone" aria-hidden="true" /></header>
              <ol className="admin-feed">
                {dashboard.recentActivity.map((item) => <li key={item.id}><i /><div><strong>{item.fullName || item.email}</strong><span>{eventLabel(item.event)}{item.path ? ` · ${item.path}` : ''}</span></div><time>{formatDate(item.createdAt)}</time></li>)}
                {!dashboard.recentActivity.length && <li className="admin-feed-empty">Событий пока нет.</li>}
              </ol>
            </article>

            <article className="admin-panel admin-feed-panel">
              <header><div><span>Неподменяемый журнал</span><h2>Действия owner</h2></div><CheckCircle size={22} weight="duotone" aria-hidden="true" /></header>
              <ol className="admin-feed">
                {dashboard.recentAdminActions.map((item) => <li key={item.id}><i /><div><strong>{eventLabel(item.event)}</strong><span>{asString(item.payload.reason) || (typeof item.payload.amount === 'number' ? `${item.payload.amount > 0 ? '+' : ''}${formatRubles(item.payload.amount)}` : 'зафиксировано сервером')}</span></div><time>{formatDate(item.createdAt)}</time></li>)}
                {!dashboard.recentAdminActions.length && <li className="admin-feed-empty">Действий ещё не было.</li>}
              </ol>
            </article>
          </section>
        </section>
      </div>

      {detailLoading && <div className="admin-drawer-loading" role="status"><CircleNotch size={24} weight="bold" aria-hidden="true" /></div>}
      {detail && (
        <aside className="admin-user-drawer" aria-labelledby="admin-user-drawer-title">
          <header><button className="admin-icon-button" type="button" onClick={() => setDetail(null)} aria-label="Закрыть карточку пользователя"><X size={19} weight="bold" aria-hidden="true" /></button><span>Карточка пользователя</span></header>
          <section className="admin-drawer-user">
            <div className="admin-avatar"><UserCircle size={36} weight="duotone" aria-hidden="true" /></div>
            <div><h2 id="admin-user-drawer-title">{userName(detail.user)}</h2><p>{detail.user.email}</p><span>{detail.user.grade ? `${detail.user.grade} класс` : 'Класс не указан'} · зарегистрирован {formatDate(detail.user.createdAt, false)}</span></div>
          </section>

          <section className="admin-drawer-balance"><span>Текущий баланс</span><strong>{formatRubles(detail.user.balance)}</strong><small>Онлайн: {formatDate(detail.user.lastSeenAt)}</small></section>

          <form className="admin-action-form" onSubmit={adjustBalance}>
            <header><Wallet size={19} weight="duotone" aria-hidden="true" /><div><h3>Изменить баланс</h3><p>Положительное — начислить, отрицательное — списать.</p></div></header>
            <label><span>Сумма, ₽</span><input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} min={-100000} max={100000} step="1" inputMode="numeric" placeholder="Например, 50" /></label>
            <label><span>Причина</span><input value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={160} placeholder="За что меняем баланс" /></label>
            <button className="admin-primary-action" type="submit" disabled={actionLoading}>{actionLoading ? 'Сохраняем…' : 'Применить изменение'}</button>
          </form>

          <section className={`admin-ban-control${detail.user.isBanned ? ' is-banned' : ''}`}>
            <header><EyeSlash size={19} weight="duotone" aria-hidden="true" /><div><h3>{detail.user.isBanned ? 'Аккаунт заблокирован' : 'Блокировка доступа'}</h3><p>{detail.user.isBanned ? detail.user.banReason || 'Причина не указана' : 'Сразу остановит доступ к сервису и списания.'}</p></div></header>
            {!detail.user.isBanned && <label><span>Причина блокировки</span><input value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} placeholder="Опиши причину" /></label>}
            <button className={detail.user.isBanned ? 'admin-unban-action' : 'admin-ban-action'} type="button" onClick={() => { void toggleBan() }} disabled={actionLoading}>{detail.user.isBanned ? 'Разблокировать' : 'Заблокировать'}</button>
          </section>

          <section className="admin-drawer-history"><header><h3>Операции баланса</h3><span>{detail.walletEntries.length}</span></header><ol>{detail.walletEntries.map((entry) => <li key={entry.id}><strong className={entry.amount >= 0 ? 'is-credit' : 'is-debit'}>{entry.amount > 0 ? '+' : ''}{formatRubles(entry.amount)}</strong><div><span>{entry.description}</span><small>{formatDate(entry.createdAt)}</small></div></li>)}{!detail.walletEntries.length && <li className="admin-drawer-empty">Операций пока нет.</li>}</ol></section>
          <section className="admin-drawer-history"><header><h3>Активность</h3><span>{detail.activity.length}</span></header><ol>{detail.activity.map((item) => <li key={item.id}><strong className="admin-activity-mark"><Pulse size={16} weight="bold" aria-hidden="true" /></strong><div><span>{eventLabel(item.event)}{item.path ? ` · ${item.path}` : ''}</span><small>{formatDate(item.createdAt)}</small></div></li>)}{!detail.activity.length && <li className="admin-drawer-empty">Активности пока нет.</li>}</ol></section>
        </aside>
      )}

      {(notice || error) && <div className={`admin-toast${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}
    </main>
  )
}
