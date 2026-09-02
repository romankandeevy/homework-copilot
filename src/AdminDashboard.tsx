import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowClockwise,
  BookOpenText,
  CaretRight,
  ChartLineUp,
  CheckCircle,
  CircleNotch,
  CurrencyRub,
  EyeSlash,
  LockKey,
  Lifebuoy,
  MagnifyingGlass,
  Pulse,
  SignOut,
  UserGear,
  UserCircle,
  UsersThree,
  Wallet,
  X,
} from '@phosphor-icons/react'
import { formatRubles, rublesToKopecks } from './lib/currency'
import type { Json } from './lib/database.types'
import { supabase } from './lib/supabase'
import AdminSolutionLibrary from './AdminSolutionLibrary'
import SupportAdminPanel from './SupportAdminPanel'
import './AdminDashboard.css'

type AdminAccess = 'loading' | 'admin' | 'signed-out' | 'forbidden' | 'unavailable'
type PeriodDays = 7 | 30 | 90
type ChartMetric = 'sessionStarts' | 'openedSolutions' | 'charges'
type AdminMutation = 'profile' | 'top-up' | 'balance' | 'ban' | null

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
  newUsersToday: number
  activeUsers: number
  activeUsersToday: number
  activeUsers7Days: number
  onlineUsers: number
  bannedUsers: number
  sessionStarts: number
  pageViews: number
  totalWalletBalance: number
  solutionCharges: number
  solutionChargesToday: number
  walletCredits: number
  openedSolutions: number
  openedSolutionsToday: number
}

type DashboardSeriesItem = {
  date: string
  users: number
  newUsers: number
  sessionStarts: number
  pageViews: number
  openedSolutions: number
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

const numberFormatter = new Intl.NumberFormat('ru-RU')

const periodOptions: { value: PeriodDays; label: string }[] = [
  { value: 7, label: '7 дней' },
  { value: 30, label: '30 дней' },
  { value: 90, label: '90 дней' },
]

const emptySummary: DashboardSummary = {
  totalUsers: 0,
  newUsers: 0,
  newUsersToday: 0,
  activeUsers: 0,
  activeUsersToday: 0,
  activeUsers7Days: 0,
  onlineUsers: 0,
  bannedUsers: 0,
  sessionStarts: 0,
  pageViews: 0,
  totalWalletBalance: 0,
  solutionCharges: 0,
  solutionChargesToday: 0,
  walletCredits: 0,
  openedSolutions: 0,
  openedSolutionsToday: 0,
}

const emptyDashboard: DashboardData = {
  periodDays: 30,
  summary: emptySummary,
  series: [],
  recentActivity: [],
  recentAdminActions: [],
}

const chartOptions: Record<ChartMetric, {
  label: string
  description: string
  totalLabel: string
  value: (item: DashboardSeriesItem) => number
}> = {
  sessionStarts: {
    label: 'Сессии',
    description: 'Запуски сессий',
    totalLabel: 'всего запусков сессий',
    value: (item) => item.sessionStarts,
  },
  openedSolutions: {
    label: 'Решения',
    description: 'Открытые решения',
    totalLabel: 'всего открыто решений',
    value: (item) => item.openedSolutions,
  },
  charges: {
    label: 'Списания',
    description: 'Списано с баланса',
    totalLabel: 'списано с баланса',
    value: (item) => item.charges,
  },
}

const isAdminPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).get('admin-preview') === '1'

const previewUsers: AdminUser[] = [
  {
    id: 'preview-user-1',
    email: 'alina.demo@example.test',
    fullName: 'Алина Смирнова',
    grade: 8,
    balance: 42,
    createdAt: '2026-08-03T10:20:00.000Z',
    lastSeenAt: '2026-08-26T09:18:00.000Z',
    lastActivityAt: '2026-08-26T09:18:00.000Z',
    isBanned: false,
    banReason: null,
    bannedAt: null,
  },
  {
    id: 'preview-user-2',
    email: 'misha.demo@example.test',
    fullName: 'Миша Волков',
    grade: 7,
    balance: 8,
    createdAt: '2026-08-18T14:40:00.000Z',
    lastSeenAt: '2026-08-25T17:40:00.000Z',
    lastActivityAt: '2026-08-25T17:40:00.000Z',
    isBanned: false,
    banReason: null,
    bannedAt: null,
  },
  {
    id: 'preview-user-3',
    email: 'sofia.demo@example.test',
    fullName: 'София Крылова',
    grade: 8,
    balance: 0,
    createdAt: '2026-07-12T08:15:00.000Z',
    lastSeenAt: '2026-08-21T12:06:00.000Z',
    lastActivityAt: '2026-08-21T12:06:00.000Z',
    isBanned: true,
    banReason: 'Повторные попытки обойти правила сервиса',
    bannedAt: '2026-08-22T11:32:00.000Z',
  },
]

function previewDate(dayOffset: number) {
  const date = new Date('2026-08-26T09:30:00.000Z')
  date.setUTCDate(date.getUTCDate() + dayOffset)
  return date.toISOString()
}

function createPreviewDashboard(periodDays: PeriodDays): DashboardData {
  const series = Array.from({ length: periodDays }, (_, index) => {
    const dayOffset = index - periodDays + 1
    const activity = 8 + ((index * 7) % 13)
    const openedSolutions = 2 + ((index * 3) % 6)
    return {
      date: previewDate(dayOffset).slice(0, 10),
      users: 3 + ((index * 5) % 8),
      newUsers: index % 5 === 0 ? 2 : index % 3 === 0 ? 1 : 0,
      sessionStarts: activity,
      pageViews: activity * 3 + (index % 4),
      openedSolutions,
      charges: openedSolutions * 5,
    }
  })

  const sessionStarts = series.reduce((total, item) => total + item.sessionStarts, 0)
  const pageViews = series.reduce((total, item) => total + item.pageViews, 0)
  const openedSolutions = series.reduce((total, item) => total + item.openedSolutions, 0)
  const newUsers = series.reduce((total, item) => total + item.newUsers, 0)

  return {
    periodDays,
    summary: {
      totalUsers: 184,
      newUsers,
      newUsersToday: 3,
      activeUsers: 61,
      activeUsersToday: 18,
      activeUsers7Days: 43,
      onlineUsers: 6,
      bannedUsers: 1,
      sessionStarts,
      pageViews,
      totalWalletBalance: 3_870,
      solutionCharges: openedSolutions * 5,
      solutionChargesToday: 35,
      walletCredits: 860,
      openedSolutions,
      openedSolutionsToday: 7,
    },
    series,
    recentActivity: [
      { id: 'preview-activity-1', userId: 'preview-user-1', email: previewUsers[0].email, fullName: previewUsers[0].fullName, event: 'page_view', path: '/main', createdAt: previewDate(0) },
      { id: 'preview-activity-2', userId: 'preview-user-2', email: previewUsers[1].email, fullName: previewUsers[1].fullName, event: 'session_started', path: '/solutions', createdAt: previewDate(-1) },
      { id: 'preview-activity-3', userId: 'preview-user-1', email: previewUsers[0].email, fullName: previewUsers[0].fullName, event: 'session_ended', path: '/main', createdAt: previewDate(-1) },
    ],
    recentAdminActions: [
      { id: 'preview-action-1', event: 'balance_adjusted', payload: { amount: 50, reason: 'Бонус за участие' }, createdAt: previewDate(-2) },
      { id: 'preview-action-2', event: 'user_banned', payload: { reason: 'Повторные попытки обойти правила сервиса' }, createdAt: previewDate(-4) },
    ],
  }
}

function createPreviewUserDetail(userId: string): UserDetail | null {
  const user = previewUsers.find((item) => item.id === userId)
  if (!user) return null

  return {
    user,
    walletEntries: [
      { id: `${user.id}-wallet-1`, amount: 50, kind: 'credit', description: 'Бонус за участие', createdAt: previewDate(-2) },
      { id: `${user.id}-wallet-2`, amount: -5, kind: 'debit', description: 'Открыто решение', createdAt: previewDate(-5) },
    ],
    activity: [
      { id: `${user.id}-activity-1`, userId: user.id, email: user.email, fullName: user.fullName, event: 'page_view', path: '/main', createdAt: user.lastActivityAt },
      { id: `${user.id}-activity-2`, userId: user.id, email: user.email, fullName: user.fullName, event: 'session_started', path: '/solutions', createdAt: previewDate(-1) },
    ],
  }
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
      newUsersToday: asNumber(summary.newUsersToday),
      activeUsers: asNumber(summary.activeUsers),
      activeUsersToday: asNumber(summary.activeUsersToday),
      activeUsers7Days: asNumber(summary.activeUsers7Days),
      onlineUsers: asNumber(summary.onlineUsers),
      bannedUsers: asNumber(summary.bannedUsers),
      sessionStarts: asNumber(summary.sessionStarts),
      pageViews: asNumber(summary.pageViews),
      totalWalletBalance: asNumber(summary.totalWalletBalance),
      solutionCharges: asNumber(summary.solutionCharges),
      solutionChargesToday: asNumber(summary.solutionChargesToday),
      walletCredits: asNumber(summary.walletCredits),
      openedSolutions: asNumber(summary.openedSolutions),
      openedSolutionsToday: asNumber(summary.openedSolutionsToday),
    },
    series: asArray(source.series).map((item) => {
      const row = isRecord(item) ? item : {}
      return {
        date: asString(row.date),
        users: asNumber(row.users),
        newUsers: asNumber(row.newUsers),
        sessionStarts: asNumber(row.sessionStarts),
        pageViews: asNumber(row.pageViews),
        openedSolutions: asNumber(row.openedSolutions),
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
  if (event === 'support_feature_credited') return 'начислено за идею'
  if (event === 'support_status_changed') return 'изменён статус обращения'
  if (event === 'user_profile_updated') return 'изменён профиль пользователя'
  if (event === 'solution_deleted') return 'решение удалено из базы'
  return event || 'событие'
}

function databaseErrorMessage(error: { message?: string } | null) {
  const message = error?.message || ''
  if (message.includes('admin access required')) return 'Нет доступа к админке.'
  if (message.includes('balance cannot become negative')) return 'Баланс не может стать отрицательным.'
  if (message.includes('adjustment reason')) return 'Укажи причину: от 3 до 160 символов.'
  if (message.includes('top up amount')) return 'Сумма пополнения должна быть целым числом от 1 до 1 000 000 ₽.'
  if (message.includes('invalid provider reference')) return 'Укажи идентификатор транзакции: от 6 символов, без пробелов.'
  if (message.includes('provider reference conflict')) return 'Этот идентификатор уже относится к другому пополнению.'
  if (message.includes('block reason')) return 'Укажи причину блокировки: от 3 до 500 символов.'
  if (message.includes('cannot block their own')) return 'Нельзя заблокировать собственный аккаунт.'
  if (message.includes('user not found')) return 'Пользователь не найден.'
  return 'Операция не выполнилась. Повтори попытку.'
}

function userName(user: Pick<AdminUser, 'fullName' | 'email'>) {
  return user.fullName.trim() || user.email
}

function chartValueLabel(metric: ChartMetric, value: number) {
  return metric === 'charges' ? formatRubles(value) : numberFormatter.format(value)
}

export default function AdminDashboard() {
  const [access, setAccess] = useState<AdminAccess>('loading')
  const [periodDays, setPeriodDays] = useState<PeriodDays>(30)
  const [chartMetric, setChartMetric] = useState<ChartMetric>('sessionStarts')
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [amount, setAmount] = useState('')
  const [balanceReason, setBalanceReason] = useState('')
  const [topUpAmount, setTopUpAmount] = useState('')
  const [topUpReference, setTopUpReference] = useState('')
  const [profileName, setProfileName] = useState('')
  const [profileGrade, setProfileGrade] = useState('8')
  const [banReason, setBanReason] = useState('')
  const [actionLoading, setActionLoading] = useState<AdminMutation>(null)
  const [activeSection, setActiveSection] = useState('overview')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const drawerRef = useRef<HTMLElement | null>(null)
  const drawerTriggerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const previousTheme = document.documentElement.dataset.theme
    const previousColorScheme = document.documentElement.style.colorScheme
    const previousTitle = document.title
    document.documentElement.dataset.theme = 'dark'
    document.documentElement.style.colorScheme = 'dark'
    document.title = 'Пульт владельца — Homework Copilot'
    return () => {
      if (previousTheme) document.documentElement.dataset.theme = previousTheme
      else delete document.documentElement.dataset.theme
      document.documentElement.style.colorScheme = previousColorScheme
      document.title = previousTitle
    }
  }, [])

  const loadDashboard = useCallback(async (days: PeriodDays) => {
    if (isAdminPreview) {
      setDashboard(createPreviewDashboard(days))
      return
    }
    if (!supabase) return
    setDashboardLoading(true)
    const { data, error: dashboardError } = await supabase.rpc('admin_dashboard', { p_period_days: days })
    if (dashboardError) setError(databaseErrorMessage(dashboardError))
    else setDashboard(parseDashboard(data))
    setDashboardLoading(false)
  }, [])

  const loadUsers = useCallback(async (nextSearch: string) => {
    if (isAdminPreview) {
      const query = nextSearch.trim().toLocaleLowerCase('ru-RU')
      setUsers(previewUsers.filter((user) => !query || `${userName(user)} ${user.email}`.toLocaleLowerCase('ru-RU').includes(query)))
      return
    }
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
    if (isAdminPreview) {
      setDetail(createPreviewUserDetail(userId))
      return
    }
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
    if (isAdminPreview) {
      setAccess('admin')
      await loadDashboard(30)
      return
    }
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
    await loadDashboard(30)
  }, [loadDashboard])

  useEffect(() => { void bootstrap() }, [bootstrap])

  useEffect(() => {
    if (access !== 'admin') return
    const timer = window.setTimeout(() => { void loadUsers(search) }, 180)
    return () => window.clearTimeout(timer)
  }, [access, loadUsers, search])

  useEffect(() => {
    if (!detail?.user.id) return
    const drawer = drawerRef.current
    const background = Array.from(document.querySelectorAll<HTMLElement>('.admin-topbar, .admin-layout'))
    const previousOverflow = document.body.style.overflow
    background.forEach((element) => {
      element.inert = true
      element.setAttribute('aria-hidden', 'true')
    })
    document.body.style.overflow = 'hidden'

    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    const focusable = () => Array.from(drawer?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
    window.requestAnimationFrame(() => focusable()[0]?.focus())

    const handleDrawerKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setDetail(null)
        return
      }
      if (event.key !== 'Tab') return
      const elements = focusable()
      if (!elements.length) return
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleDrawerKeys)
    return () => {
      window.removeEventListener('keydown', handleDrawerKeys)
      background.forEach((element) => {
        element.inert = false
        element.removeAttribute('aria-hidden')
      })
      document.body.style.overflow = previousOverflow
      drawerTriggerRef.current?.focus()
    }
  }, [detail?.user.id])

  useEffect(() => {
    const updateFromHash = () => {
      const section = window.location.hash.slice(1)
      setActiveSection(section || 'overview')
    }
    updateFromHash()
    window.addEventListener('hashchange', updateFromHash)
    return () => window.removeEventListener('hashchange', updateFromHash)
  }, [])

  useEffect(() => {
    if (!detail) return
    setProfileName(detail.user.fullName)
    setProfileGrade(String(detail.user.grade ?? 8))
  }, [detail])

  const reloadAll = async () => {
    setError('')
    setNotice('')
    await Promise.all([loadDashboard(periodDays), loadUsers(search)])
    if (detail) await loadUserDetail(detail.user.id)
  }

  const changePeriod = (nextPeriod: PeriodDays) => {
    if (nextPeriod === periodDays) return
    setPeriodDays(nextPeriod)
    setError('')
    setNotice('')
    void loadDashboard(nextPeriod)
  }

  const openUser = async (userId: string, trigger?: HTMLElement) => {
    drawerTriggerRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setNotice('')
    setError('')
    setAmount('')
    setBalanceReason('')
    setTopUpAmount('')
    setTopUpReference('')
    setBanReason('')
    await loadUserDetail(userId)
  }

  const adjustBalance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!detail || actionLoading !== null) return
    if (isAdminPreview) {
      setNotice('Предпросмотр: изменения не записываются.')
      return
    }
    if (!supabase) return
    const parsedAmount = Number(amount)
    if (!Number.isInteger(parsedAmount) || parsedAmount === 0 || Math.abs(parsedAmount) > 100000) {
      setError('Укажи целое число от −100 000 до 100 000, кроме нуля.')
      return
    }
    if (balanceReason.trim().length < 3) {
      setError('Укажи причину изменения баланса.')
      return
    }

    setActionLoading('balance')
    setError('')
    // Оператор вводит рубли, база работает в копейках.
    const { error: adjustmentError } = await supabase.rpc('admin_adjust_balance', {
      p_user_id: detail.user.id,
      p_amount: rublesToKopecks(parsedAmount),
      p_reason: balanceReason.trim(),
    })
    if (adjustmentError) setError(databaseErrorMessage(adjustmentError))
    else {
      setAmount('')
      setBalanceReason('')
      setNotice(`Баланс ${userName(detail.user)} обновлён.`)
      await Promise.all([loadDashboard(periodDays), loadUsers(search), loadUserDetail(detail.user.id)])
    }
    setActionLoading(null)
  }

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!detail || actionLoading !== null) return
    const fullName = profileName.trim()
    const grade = Number(profileGrade)
    if (fullName.length < 1 || fullName.length > 80) {
      setError('Имя должно содержать от 1 до 80 символов.')
      return
    }
    if (!Number.isInteger(grade) || grade < 1 || grade > 11) {
      setError('Укажи класс от 1 до 11.')
      return
    }

    if (isAdminPreview) {
      setDetail((current) => current ? { ...current, user: { ...current.user, fullName, grade } } : current)
      setUsers((current) => current.map((user) => user.id === detail.user.id ? { ...user, fullName, grade } : user))
      setNotice('Предпросмотр: профиль пользователя обновлён.')
      setError('')
      return
    }
    if (!supabase) return

    setActionLoading('profile')
    setError('')
    const { error: profileError } = await supabase.rpc('admin_update_user_profile', {
      p_user_id: detail.user.id,
      p_full_name: fullName,
      p_grade: grade,
    })
    if (profileError) setError(databaseErrorMessage(profileError))
    else {
      setNotice(`Профиль ${userName(detail.user)} обновлён.`)
      await Promise.all([loadUsers(search), loadUserDetail(detail.user.id), loadDashboard(periodDays)])
    }
    setActionLoading(null)
  }

  const recordVerifiedTopUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!detail || actionLoading !== null) return
    if (isAdminPreview) {
      setNotice('Предпросмотр: изменения не записываются.')
      return
    }
    if (!supabase) return

    const parsedAmount = Number(topUpAmount)
    const normalizedReference = topUpReference.trim()
    if (!Number.isInteger(parsedAmount) || parsedAmount < 1 || parsedAmount > 1000000) {
      setError('Укажи целую сумму от 1 до 1 000 000 ₽.')
      return
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/.test(normalizedReference)) {
      setError('Укажи идентификатор транзакции: от 6 символов, без пробелов.')
      return
    }

    setActionLoading('top-up')
    setError('')
    const { data, error: topUpError } = await supabase.rpc('admin_record_verified_top_up', {
      p_user_id: detail.user.id,
      p_amount: rublesToKopecks(parsedAmount),
      p_provider_reference: normalizedReference,
    })
    if (topUpError) setError(databaseErrorMessage(topUpError))
    else {
      const referralRewarded = isRecord(data) && asBoolean(data.referralRewarded)
      const applied = isRecord(data) && asBoolean(data.applied)
      setTopUpAmount('')
      setTopUpReference('')
      setNotice(applied
        ? referralRewarded
          ? 'Пополнение подтверждено и записано в историю баланса.'
          : `Пополнение ${userName(detail.user)} подтверждено.`
        : 'Это пополнение уже было подтверждено; повторных начислений нет.')
      await Promise.all([loadDashboard(periodDays), loadUsers(search), loadUserDetail(detail.user.id)])
    }
    setActionLoading(null)
  }

  const toggleBan = async () => {
    if (!detail || actionLoading !== null) return
    if (isAdminPreview) {
      setNotice('Предпросмотр: изменения не записываются.')
      return
    }
    if (!supabase) return
    const nextIsBanned = !detail.user.isBanned
    if (nextIsBanned && banReason.trim().length < 3) {
      setError('Укажи причину блокировки.')
      return
    }

    setActionLoading('ban')
    setError('')
    const { error: banError } = await supabase.rpc('admin_set_user_ban', {
      p_user_id: detail.user.id,
      p_is_banned: nextIsBanned,
      p_reason: nextIsBanned ? banReason.trim() : undefined,
    })
    if (banError) setError(databaseErrorMessage(banError))
    else {
      setBanReason('')
      setNotice(nextIsBanned ? 'Аккаунт заблокирован.' : 'Аккаунт разблокирован.')
      await Promise.all([loadDashboard(periodDays), loadUsers(search), loadUserDetail(detail.user.id)])
    }
    setActionLoading(null)
  }

  const signOut = async () => {
    if (isAdminPreview) {
      setAccess('signed-out')
      setDetail(null)
      return
    }
    if (!supabase) return
    await supabase.auth.signOut({ scope: 'local' })
    setAccess('signed-out')
    setDetail(null)
  }

  const chartSeries = useMemo(() => {
    const getValue = chartOptions[chartMetric].value
    return dashboard.series.map((item) => ({ item, value: getValue(item) }))
  }, [chartMetric, dashboard.series])

  const maxChartValue = useMemo(() => Math.max(1, ...chartSeries.map(({ value }) => value)), [chartSeries])
  const chartTotal = useMemo(() => chartSeries.reduce((total, { value }) => total + value, 0), [chartSeries])

  if (access !== 'admin') {
    const states: Record<Exclude<AdminAccess, 'admin'>, { title: string; copy: string }> = {
      loading: { title: 'Открываем пульт', copy: 'Проверяем защищённую сессию владельца.' },
      'signed-out': { title: 'Войди в свой аккаунт', copy: 'После входа в owner-аккаунт пульт откроется автоматически.' },
      forbidden: { title: 'Доступ закрыт', copy: 'Этот адрес доступен только назначенному владельцу сервиса.' },
      unavailable: { title: 'Supabase не настроен', copy: 'Пульт нельзя открыть без защищённого подключения к данным.' },
    }
    const state = states[access]
    return (
      <main className="admin-shell admin-shell--state">
        <section className="admin-state-card" aria-live="polite">
          <div className="admin-wordmark"><span>H</span> Homework Copilot</div>
          <h1>{state.title}</h1>
          <p>{state.copy}</p>
          {access === 'loading' ? <CircleNotch className="admin-state-spinner" size={24} weight="bold" aria-hidden="true" /> : <a href={import.meta.env.BASE_URL}>На сайт <ArrowLeft size={16} weight="bold" aria-hidden="true" /></a>}
        </section>
      </main>
    )
  }

  const summary = dashboard.summary
  const selectedChart = chartOptions[chartMetric]

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <a className="admin-wordmark" href={import.meta.env.BASE_URL}><span>H</span> Homework Copilot</a>
        <strong className="admin-topbar-title">Пульт владельца</strong>
        <div className="admin-topbar-actions">
          <button className="admin-icon-button" type="button" onClick={() => { void reloadAll() }} disabled={dashboardLoading || usersLoading} aria-label="Обновить данные"><ArrowClockwise size={19} weight="bold" aria-hidden="true" /></button>
          <button className="admin-signout" type="button" onClick={() => { void signOut() }}><SignOut size={17} weight="bold" aria-hidden="true" /> Выйти</button>
        </div>
      </header>

      <div className="admin-layout">
        <aside className="admin-rail" aria-label="Разделы админки">
          <a href="#overview" className={activeSection === 'overview' ? 'is-active' : ''} aria-current={activeSection === 'overview' ? 'page' : undefined}><ChartLineUp size={18} weight="duotone" aria-hidden="true" /> Обзор</a>
          <a href="#users" className={activeSection === 'users' ? 'is-active' : ''} aria-current={activeSection === 'users' ? 'page' : undefined}><UsersThree size={18} weight="duotone" aria-hidden="true" /> Пользователи</a>
          <a href="#solution-library" className={activeSection === 'solution-library' ? 'is-active' : ''} aria-current={activeSection === 'solution-library' ? 'page' : undefined}><BookOpenText size={18} weight="duotone" aria-hidden="true" /> База решений</a>
          <a href="#support" className={activeSection === 'support' ? 'is-active' : ''} aria-current={activeSection === 'support' ? 'page' : undefined}><Lifebuoy size={18} weight="duotone" aria-hidden="true" /> Поддержка</a>
          <a href="#analytics" className={activeSection === 'analytics' ? 'is-active' : ''} aria-current={activeSection === 'analytics' ? 'page' : undefined}><Pulse size={18} weight="duotone" aria-hidden="true" /> Аналитика</a>
          <a href="#events" className={activeSection === 'events' ? 'is-active' : ''} aria-current={activeSection === 'events' ? 'page' : undefined}><CheckCircle size={18} weight="duotone" aria-hidden="true" /> Журналы</a>
          <div className="admin-rail-status"><span /><div><strong>{numberFormatter.format(summary.onlineUsers)}</strong><small>онлайн сейчас</small></div></div>
        </aside>

        <section className="admin-content">
          <section className="admin-overview" id="overview" aria-labelledby="admin-overview-title">
            <header className="admin-page-heading">
              <div>
                <h1 id="admin-overview-title">Управление сервисом</h1>
                <p>Пользователи, активность и баланс за выбранный период.</p>
              </div>
              <div className="admin-heading-controls">
                <span className="admin-data-source"><i /> снимок из базы</span>
                <div className="admin-period-control" role="group" aria-label="Период аналитики">
                  {periodOptions.map((option) => <button key={option.value} type="button" className={periodDays === option.value ? 'is-selected' : ''} onClick={() => changePeriod(option.value)} aria-pressed={periodDays === option.value}>{option.label}</button>)}
                </div>
              </div>
            </header>

            <div className="admin-snapshot-grid">
              <article className="admin-population-summary">
                <header>
                  <div className="admin-summary-heading"><span className="admin-panel-icon"><UsersThree size={21} weight="duotone" aria-hidden="true" /></span><div><h2>Пользователи</h2><p>Кому доступен сервис сейчас.</p></div></div>
                  <span className="admin-online-count"><i /> {numberFormatter.format(summary.onlineUsers)} онлайн</span>
                </header>
                <div className="admin-population-body">
                  <div className="admin-total-number"><span>Всего в сервисе</span><strong>{numberFormatter.format(summary.totalUsers)}</strong><small>профилей создано</small></div>
                  <dl className="admin-summary-list">
                    <div><dt>Активны сегодня</dt><dd>{numberFormatter.format(summary.activeUsersToday)}</dd><small>последний визит сегодня</small></div>
                    <div><dt>Активны за 7 дней</dt><dd>{numberFormatter.format(summary.activeUsers7Days)}</dd><small>недельный охват</small></div>
                    <div><dt>Активны за {dashboard.periodDays} дн.</dt><dd>{numberFormatter.format(summary.activeUsers)}</dd><small>заходили хотя бы раз</small></div>
                    <div><dt>Новые пользователи</dt><dd>+{numberFormatter.format(summary.newUsers)}</dd><small>+{numberFormatter.format(summary.newUsersToday)} сегодня</small></div>
                  </dl>
                </div>
              </article>

              <article className="admin-finance-summary">
                <header className="admin-summary-heading"><span className="admin-panel-icon"><Wallet size={21} weight="duotone" aria-hidden="true" /></span><div><h2>Баланс и спрос</h2><p>Только реальные движения внутреннего баланса.</p></div></header>
                <dl className="admin-finance-list">
                  <div><dt>Баланс пользователей</dt><dd>{formatRubles(summary.totalWalletBalance)}</dd><small>суммарно в кошельках</small></div>
                  <div><dt>Списано за период</dt><dd>{formatRubles(summary.solutionCharges)}</dd><small>{formatRubles(summary.solutionChargesToday)} сегодня</small></div>
                  <div><dt>Начислено вручную</dt><dd>{formatRubles(summary.walletCredits)}</dd><small>за {dashboard.periodDays} дней</small></div>
                  <div><dt>Открыто решений</dt><dd>{numberFormatter.format(summary.openedSolutions)}</dd><small>{numberFormatter.format(summary.openedSolutionsToday)} сегодня</small></div>
                </dl>
                <p className="admin-finance-disclosure"><CurrencyRub size={17} weight="duotone" aria-hidden="true" /> Выручка и прибыль появятся здесь после подключения платежей: сейчас их нельзя честно посчитать.</p>
              </article>
            </div>
          </section>

          <section className="admin-users-workspace" id="users" aria-labelledby="admin-users-title">
            <header className="admin-users-heading">
              <div><h2 id="admin-users-title">Пользователи</h2><p>Открой карточку, чтобы посмотреть историю, изменить баланс или доступ.</p></div>
              <label className="admin-search"><MagnifyingGlass size={18} weight="bold" aria-hidden="true" /><span className="sr-only">Поиск пользователя</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Имя или почта" /></label>
            </header>

            <div className="admin-table-scroll">
              <table>
                <thead><tr><th>Пользователь</th><th>Баланс</th><th>Последняя активность</th><th className="admin-registered-column">Регистрация</th><th>Статус</th><th><span className="sr-only">Открыть</span></th></tr></thead>
                <tbody>
                  {usersLoading && <tr><td colSpan={6} className="admin-table-loading"><CircleNotch size={20} weight="bold" aria-hidden="true" /> Загружаем пользователей…</td></tr>}
                  {!usersLoading && users.map((item) => (
                    <tr key={item.id}>
                      <td><button className="admin-user-cell" type="button" onClick={(event) => { void openUser(item.id, event.currentTarget) }}><span>{userName(item)}</span><small>{item.email}{item.grade ? ` · ${item.grade} класс` : ''}</small></button></td>
                      <td className="admin-balance-cell">{formatRubles(item.balance)}</td>
                      <td>{formatDate(item.lastActivityAt || item.lastSeenAt)}</td>
                      <td className="admin-registered-column">{formatDate(item.createdAt, false)}</td>
                      <td><span className={`admin-status ${item.isBanned ? 'is-banned' : 'is-active'}`}>{item.isBanned ? 'Заблокирован' : 'Активен'}</span></td>
                      <td><button className="admin-row-open" type="button" onClick={(event) => { void openUser(item.id, event.currentTarget) }} aria-label={`Открыть ${userName(item)}`}>Открыть <CaretRight size={17} weight="bold" aria-hidden="true" /></button></td>
                    </tr>
                  ))}
                  {!usersLoading && !users.length && <tr><td colSpan={6} className="admin-table-empty">Пользователи не найдены.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <AdminSolutionLibrary preview={isAdminPreview} />

          <SupportAdminPanel preview={isAdminPreview} />

          <section className="admin-analytics-layout" id="analytics" aria-label="Аналитика">
            <article className="admin-chart-panel">
              <header className="admin-chart-heading">
                <div><h2>Динамика за {dashboard.periodDays} дней</h2><p>Один показатель за раз — без смешения рублей и действий.</p></div>
                <div className="admin-chart-switch" role="group" aria-label="Показатель графика">
                  {(Object.keys(chartOptions) as ChartMetric[]).map((metric) => <button key={metric} type="button" className={chartMetric === metric ? 'is-selected' : ''} onClick={() => setChartMetric(metric)} aria-pressed={chartMetric === metric}>{chartOptions[metric].label}</button>)}
                </div>
              </header>
              <div className={`admin-chart admin-chart--${chartMetric}`} aria-label={selectedChart.description}>
                {chartSeries.map(({ item, value }) => {
                  const height = Math.max(5, (value / maxChartValue) * 100)
                  return <div className="admin-chart-day" key={item.date} title={`${formatDate(item.date, false)}: ${chartValueLabel(chartMetric, value)}`}><div className="admin-chart-bar"><i style={{ height: `${height}%` }} /></div><span>{item.date.slice(8)}</span></div>
                })}
                {!chartSeries.length && <p>Данных пока нет.</p>}
              </div>
              <footer><span>{selectedChart.totalLabel}</span><strong>{chartValueLabel(chartMetric, chartTotal)}</strong></footer>
            </article>

            <article className="admin-signal-summary">
              <header className="admin-summary-heading"><span className="admin-panel-icon"><Pulse size={21} weight="duotone" aria-hidden="true" /></span><div><h2>Сигналы сервиса</h2><p>Что произошло за {dashboard.periodDays} дней.</p></div></header>
              <dl className="admin-signal-list">
                <div><dt>Запуски сессий</dt><dd>{numberFormatter.format(summary.sessionStarts)}</dd><small>пользователь вошёл или вернулся</small></div>
                <div><dt>Просмотры страниц</dt><dd>{numberFormatter.format(summary.pageViews)}</dd><small>события браузера</small></div>
                <div><dt>Решения открыты</dt><dd>{numberFormatter.format(summary.openedSolutions)}</dd><small>за счёт внутреннего баланса</small></div>
                <div className={summary.bannedUsers ? 'is-warning' : ''}><dt>Ограничен доступ</dt><dd>{numberFormatter.format(summary.bannedUsers)}</dd><small>{summary.bannedUsers ? 'требуют внимания' : 'все аккаунты доступны'}</small></div>
              </dl>
              <div className="admin-protection-note"><LockKey size={19} weight="duotone" aria-hidden="true" /><p>Баланс, блокировки и журнал меняются только защищёнными owner‑RPC. У ученика изменения приходят без перезагрузки.</p></div>
            </article>
          </section>

          <section className="admin-event-grid" id="events" aria-label="Журналы">
            <article className="admin-feed-panel">
              <header><div><h2>Последние действия</h2><p>Пульс сервиса в порядке времени.</p></div><Pulse size={22} weight="duotone" aria-hidden="true" /></header>
              <ol className="admin-feed">
                {dashboard.recentActivity.map((item) => <li key={item.id}><i /><div><strong>{item.fullName || item.email}</strong><span>{eventLabel(item.event)}{item.path ? ` · ${item.path}` : ''}</span></div><time>{formatDate(item.createdAt)}</time></li>)}
                {!dashboard.recentActivity.length && <li className="admin-feed-empty">Событий пока нет.</li>}
              </ol>
            </article>

            <article className="admin-feed-panel">
              <header><div><h2>Действия владельца</h2><p>Зафиксированы на сервере и не редактируются.</p></div><CheckCircle size={22} weight="duotone" aria-hidden="true" /></header>
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
        <aside ref={drawerRef} className="admin-user-drawer" role="dialog" aria-modal="true" aria-labelledby="admin-user-drawer-title" tabIndex={-1}>
          <header className="admin-drawer-topbar"><span>Карточка пользователя</span><button className="admin-icon-button" type="button" onClick={() => setDetail(null)} aria-label="Закрыть карточку пользователя"><X size={19} weight="bold" aria-hidden="true" /></button></header>
          <section className="admin-drawer-user">
            <div className="admin-avatar"><UserCircle size={38} weight="duotone" aria-hidden="true" /></div>
            <div><h2 id="admin-user-drawer-title">{userName(detail.user)}</h2><p>{detail.user.email}</p><span>{detail.user.grade ? `${detail.user.grade} класс` : 'Класс не указан'} · зарегистрирован {formatDate(detail.user.createdAt, false)}</span></div>
          </section>

          <form className="admin-profile-form" onSubmit={saveProfile}>
            <header><UserGear size={19} weight="duotone" aria-hidden="true" /><div><h3>Профиль</h3><p>Имя и класс сразу обновятся в личном кабинете.</p></div></header>
            <div className="admin-profile-fields">
              <label><span>Имя</span><input value={profileName} onChange={(event) => setProfileName(event.target.value)} minLength={1} maxLength={80} autoComplete="off" /></label>
              <label><span>Класс</span><select value={profileGrade} onChange={(event) => setProfileGrade(event.target.value)}>{Array.from({ length: 11 }, (_, index) => index + 1).map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select></label>
            </div>
            <button className="admin-primary-action" type="submit" disabled={actionLoading !== null}>{actionLoading === 'profile' ? 'Сохраняем…' : 'Сохранить профиль'}</button>
          </form>

          <section className="admin-drawer-balance"><div><span>Текущий баланс</span><strong>{formatRubles(detail.user.balance)}</strong></div><dl><div><dt>Последний визит</dt><dd>{formatDate(detail.user.lastSeenAt)}</dd></div><div><dt>Статус</dt><dd>{detail.user.isBanned ? 'Заблокирован' : 'Активен'}</dd></div></dl></section>

          <form className="admin-action-form is-verified-top-up" onSubmit={recordVerifiedTopUp}>
            <header><CurrencyRub size={19} weight="duotone" aria-hidden="true" /><div><h3>Подтвердить пополнение</h3><p>Ручная запись оплаты, которую подтвердил банк. Реферальные +10 ₽ и +5 ₽ приходят сами при подтверждении почты и от пополнения не зависят.</p></div></header>
            <label><span>Сумма, ₽</span><input type="number" value={topUpAmount} onChange={(event) => setTopUpAmount(event.target.value)} min={1} max={1000000} step="1" inputMode="numeric" placeholder="Например, 100" /></label>
            <label><span>Идентификатор транзакции</span><input value={topUpReference} onChange={(event) => setTopUpReference(event.target.value)} minLength={6} maxLength={160} autoComplete="off" placeholder="Например, bank-20260828-001" /></label>
            <button className="admin-primary-action" type="submit" disabled={actionLoading !== null}>{actionLoading === 'top-up' ? 'Подтверждаем…' : 'Подтвердить пополнение'}</button>
          </form>

          <form className="admin-action-form" onSubmit={adjustBalance}>
            <header><Wallet size={19} weight="duotone" aria-hidden="true" /><div><h3>Изменить баланс</h3><p>Положительное — начислить, отрицательное — списать.</p></div></header>
            <label><span>Сумма, ₽</span><input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} min={-100000} max={100000} step="1" inputMode="numeric" placeholder="Например, 50" /></label>
            <label><span>Причина</span><input value={balanceReason} onChange={(event) => setBalanceReason(event.target.value)} minLength={3} maxLength={160} placeholder="За что меняем баланс" /></label>
            <button className="admin-primary-action" type="submit" disabled={actionLoading !== null}>{actionLoading === 'balance' ? 'Сохраняем…' : 'Изменить баланс'}</button>
          </form>

          <section className={`admin-ban-control${detail.user.isBanned ? ' is-banned' : ''}`}>
            <header><EyeSlash size={19} weight="duotone" aria-hidden="true" /><div><h3>{detail.user.isBanned ? 'Аккаунт заблокирован' : 'Блокировка доступа'}</h3><p>{detail.user.isBanned ? detail.user.banReason || 'Причина не указана' : 'Сразу остановит доступ к сервису и списания.'}</p></div></header>
            {!detail.user.isBanned && <label><span>Причина блокировки</span><input value={banReason} onChange={(event) => setBanReason(event.target.value)} minLength={3} maxLength={500} placeholder="Опиши причину" /></label>}
            <button className={detail.user.isBanned ? 'admin-unban-action' : 'admin-ban-action'} type="button" onClick={() => { void toggleBan() }} disabled={actionLoading !== null}>{actionLoading === 'ban' ? 'Сохраняем…' : detail.user.isBanned ? 'Разблокировать' : 'Заблокировать'}</button>
          </section>

          <section className="admin-drawer-history"><header><h3>Операции баланса</h3><span>{detail.walletEntries.length}</span></header><ol>{detail.walletEntries.map((entry) => <li key={entry.id}><strong className={entry.amount >= 0 ? 'is-credit' : 'is-debit'}>{entry.amount > 0 ? '+' : ''}{formatRubles(entry.amount)}</strong><div><span>{entry.description}</span><small>{formatDate(entry.createdAt)}</small></div></li>)}{!detail.walletEntries.length && <li className="admin-drawer-empty">Операций пока нет.</li>}</ol></section>
          <section className="admin-drawer-history"><header><h3>Активность</h3><span>{detail.activity.length}</span></header><ol>{detail.activity.map((item) => <li key={item.id}><strong className="admin-activity-mark"><Pulse size={16} weight="bold" aria-hidden="true" /></strong><div><span>{eventLabel(item.event)}{item.path ? ` · ${item.path}` : ''}</span><small>{formatDate(item.createdAt)}</small></div></li>)}{!detail.activity.length && <li className="admin-drawer-empty">Активности пока нет.</li>}</ol></section>
        </aside>
      )}

      {(notice || error) && <div className={`admin-toast${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}
    </main>
  )
}
