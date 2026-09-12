/* Админка: вход, второй фактор, каркас и разделы.

   Доступ решает база: `get_admin_context` говорит, есть ли у аккаунта роль
   и подключён ли второй фактор, а каждая admin-RPC сама требует aal2. Здесь
   интерфейс только ведёт человека по шагам: войти → подключить или ввести
   код из приложения-аутентификатора → работать. */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  ArrowLeft,
  BellRinging,
  MagnifyingGlass,
  BookOpenText,
  ChartLineUp,
  ClipboardText,
  CurrencyRub,
  GearSix,
  Lifebuoy,
  Moon,
  Pulse,
  ShieldWarning,
  SignOut,
  Sun,
  UsersThree,
} from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'
import { adminRpc, bool, isRecord, num, obj, rows, str } from './api'
import { AdminContext } from './context'
import type { AdminAccess, AdminPermissions, AdminRole, AdminSection, AdminSignals } from './context'
import { Button, Field, LoadingState, ToastProvider, useDialogFocus } from './ui'
import './admin.css'

const DashboardSection = lazy(() => import('./sections/DashboardSection'))
const UsersSection = lazy(() => import('./sections/UsersSection'))
const FraudSection = lazy(() => import('./sections/FraudSection'))
const SupportSection = lazy(() => import('./sections/SupportSection'))
const MonitoringSection = lazy(() => import('./sections/MonitoringSection'))
const FinanceSection = lazy(() => import('./sections/FinanceSection'))
const SettingsSection = lazy(() => import('./sections/SettingsSection'))
const NotificationsSection = lazy(() => import('./sections/NotificationsSection'))
const AuditSection = lazy(() => import('./sections/AuditSection'))
const SolutionsSection = lazy(() => import('./sections/SolutionsSection'))
const UserCard = lazy(() => import('./UserCard'))

type Theme = 'light' | 'dark'

type Gate =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'signed-out'; error?: string }
  | { kind: 'forbidden'; email: string }
  | { kind: 'mfa-enroll'; email: string }
  | { kind: 'mfa-verify'; email: string; factorId: string }
  | { kind: 'ready'; access: AdminAccess }

type NavItem = {
  id: AdminSection
  label: string
  group: string
  icon: ReactNode
  allowed: (permissions: AdminPermissions) => boolean
  count?: (signals: AdminSignals) => { value: number; alert: boolean } | null
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Дашборд', group: 'Обзор', icon: <ChartLineUp size={18} weight="duotone" aria-hidden="true" />, allowed: () => true },
  { id: 'users', label: 'Пользователи', group: 'Люди', icon: <UsersThree size={18} weight="duotone" aria-hidden="true" />, allowed: (p) => p.users },
  {
    id: 'support', label: 'Поддержка', group: 'Люди', icon: <Lifebuoy size={18} weight="duotone" aria-hidden="true" />, allowed: (p) => p.support,
    count: (s) => (s.pendingTickets ? { value: s.pendingTickets, alert: s.overdueTickets > 0 } : null),
  },
  {
    id: 'fraud', label: 'Антифрод', group: 'Люди', icon: <ShieldWarning size={18} weight="duotone" aria-hidden="true" />, allowed: (p) => p.moderate,
    count: (s) => (s.openFlags ? { value: s.openFlags, alert: false } : null),
  },
  {
    id: 'monitoring', label: 'Мониторинг', group: 'Сервис', icon: <Pulse size={18} weight="duotone" aria-hidden="true" />, allowed: (p) => p.settings,
    count: (s) => (s.openErrors ? { value: s.openErrors, alert: true } : null),
  },
  { id: 'finance', label: 'Финансы', group: 'Сервис', icon: <CurrencyRub size={18} weight="duotone" aria-hidden="true" />, allowed: (p) => p.money },
  { id: 'library', label: 'База решений', group: 'Сервис', icon: <BookOpenText size={18} weight="duotone" aria-hidden="true" />, allowed: (p) => p.moderate },
  { id: 'settings', label: 'Настройки', group: 'Управление', icon: <GearSix size={18} weight="duotone" aria-hidden="true" />, allowed: (p) => p.settings },
  { id: 'notifications', label: 'Уведомления', group: 'Управление', icon: <BellRinging size={18} weight="duotone" aria-hidden="true" />, allowed: (p) => p.settings },
  { id: 'audit', label: 'Журнал действий', group: 'Управление', icon: <ClipboardText size={18} weight="duotone" aria-hidden="true" />, allowed: () => true },
]

const roleLabels: Record<AdminRole, string> = { owner: 'Владелец', admin: 'Администратор', support: 'Поддержка' }

const emptySignals: AdminSignals = { pendingTickets: 0, overdueTickets: 0, openFlags: 0, openErrors: 0, pulse: 0 }

const themeStorageKey = 'homework-copilot:admin-theme'

function initialTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(themeStorageKey)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Хранилище закрыто - берём тему системы.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function parsePermissions(value: unknown): AdminPermissions {
  const source = isRecord(value) ? value : {}
  return {
    users: bool(source.users),
    support: bool(source.support),
    moderate: bool(source.moderate),
    money: bool(source.money),
    settings: bool(source.settings),
    delete: bool(source.delete),
    payouts: bool(source.payouts),
    admins: bool(source.admins),
  }
}

function currentSection(): AdminSection {
  const value = new URLSearchParams(window.location.search).get('section')
  return navItems.some((item) => item.id === value) ? value as AdminSection : 'dashboard'
}

/* ------------------------------------------------------------------------
   Вход и второй фактор
   ------------------------------------------------------------------------ */

function GateCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="adm-app adm-gate">
      <section className="adm-gate-card" aria-live="polite">
        <a className="adm-wordmark" href="/"><span>H</span>Homework Copilot</a>
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  )
}

function SignInForm({ onDone, error: initialError }: { onDone: () => void; error?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(initialError ?? '')
  const [loading, setLoading] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || loading) return
    setLoading(true)
    setError('')
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setLoading(false)
    if (signInError) {
      setError(/invalid login/i.test(signInError.message) ? 'Неверная почта или пароль.' : 'Не получилось войти. Повтори попытку.')
      return
    }
    onDone()
  }

  return (
    <GateCard title="Вход в админку">
      <p>Войди аккаунтом, которому выдана роль. Если входишь через Google, войди на сайте и вернись на эту страницу.</p>
      <form onSubmit={submit}>
        <Field label="Почта"><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required data-initial-focus /></Field>
        <Field label="Пароль"><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></Field>
        {error && <p className="adm-gate-error" role="alert">{error}</p>}
        <Button type="submit" variant="primary" loading={loading}>Войти</Button>
      </form>
      <div className="adm-gate-links"><a href="/app">Войти на сайте</a></div>
    </GateCard>
  )
}

function MfaEnroll({ email, onDone, onSignOut }: { email: string; onDone: () => void; onSignOut: () => void }) {
  const [enrollment, setEnrollment] = useState<{ factorId: string; qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (!supabase || started.current) return
    started.current = true
    const client = supabase
    void (async () => {
      // Недоделанная прошлая попытка мешает новой: убираем неподтверждённые факторы.
      const { data: factors } = await client.auth.mfa.listFactors()
      for (const factor of factors?.all ?? []) {
        if (factor.factor_type === 'totp' && factor.status === 'unverified') {
          // eslint-disable-next-line no-await-in-loop
          await client.auth.mfa.unenroll({ factorId: factor.id })
        }
      }
      const { data, error: enrollError } = await client.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Админка ${new Date().toISOString().slice(0, 16)}`,
      })
      if (enrollError || !data) {
        setError('Не получилось начать подключение второго фактора. Обнови страницу.')
        return
      }
      setEnrollment({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    })()
  }, [])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || !enrollment || loading) return
    setLoading(true)
    setError('')
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment.factorId, code: code.trim() })
    setLoading(false)
    if (verifyError) {
      setError('Код не подошёл. Проверь время на телефоне и введи новый код.')
      return
    }
    onDone()
  }

  return (
    <GateCard title="Подключи второй фактор">
      <p>Админка открывается только с подтверждением из приложения-аутентификатора ({email}). Отсканируй код в Google Authenticator, Яндекс Ключе или 1Password и введи шесть цифр.</p>
      {!enrollment && !error && <LoadingState label="Готовим код…" />}
      {enrollment && (
        <>
          <img className="adm-gate-qr" src={enrollment.qr} alt="QR-код для приложения-аутентификатора" />
          <p className="adm-gate-secret">Ключ для ручного ввода: {enrollment.secret}</p>
          <form onSubmit={submit}>
            <Field label="Код из приложения"><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required data-initial-focus /></Field>
            <Button type="submit" variant="primary" loading={loading} disabled={code.length !== 6}>Подтвердить</Button>
          </form>
        </>
      )}
      {error && <p className="adm-gate-error" role="alert">{error}</p>}
      <div className="adm-gate-links"><button type="button" onClick={onSignOut}>Выйти</button></div>
    </GateCard>
  )
}

function MfaVerify({ email, factorId, onDone, onSignOut }: { email: string; factorId: string; onDone: () => void; onSignOut: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || loading) return
    setLoading(true)
    setError('')
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
    setLoading(false)
    if (verifyError) {
      setError('Код не подошёл. Введи новый код из приложения.')
      setCode('')
      return
    }
    onDone()
  }

  return (
    <GateCard title="Подтверди вход">
      <p>Введи код из приложения-аутентификатора для {email}.</p>
      <form onSubmit={submit}>
        <Field label="Код"><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required data-initial-focus autoFocus /></Field>
        {error && <p className="adm-gate-error" role="alert">{error}</p>}
        <Button type="submit" variant="primary" loading={loading} disabled={code.length !== 6}>Войти</Button>
      </form>
      <div className="adm-gate-links"><button type="button" onClick={onSignOut}>Выйти</button></div>
    </GateCard>
  )
}

/* ------------------------------------------------------------------------
   Быстрый переход: Ctrl+K - раздел или пользователь по почте
   ------------------------------------------------------------------------ */

type PaletteItem = { key: string; title: string; hint: string; run: () => void }

function CommandPalette({ items, onClose, openUser }: { items: NavItem[]; onClose: () => void; openUser: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<PaletteItem[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Пользователей ищем в базе, когда набрано хотя бы два знака.
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setUsers([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const data = obj(await adminRpc('admin_users_list', { p_search: trimmed, p_filters: {}, p_sort: 'last_seen', p_dir: 'desc', p_page: 1, p_page_size: 6 }))
        if (cancelled) return
        setUsers(rows(data.items).map((user) => ({
          key: `user:${str(user.id)}`,
          title: str(user.fullName) || str(user.email),
          hint: `${str(user.email)} · ${str(user.planTitle)}`,
          run: () => openUser(str(user.id)),
        })))
      } catch {
        if (!cancelled) setUsers([])
      }
    }, 200)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [query, openUser])

  const sections: PaletteItem[] = items
    .filter((item) => !query.trim() || item.label.toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU')))
    .map((item) => ({ key: `section:${item.id}`, title: item.label, hint: item.group, run: () => { window.location.assign(item.id === 'dashboard' ? '/admin' : `/admin?section=${item.id}`) } }))
  const all = [...users, ...sections]
  const current = Math.min(active, Math.max(0, all.length - 1))

  const choose = (item: PaletteItem) => {
    onClose()
    item.run()
  }

  return (
    <div className="adm-overlay is-centered" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="adm-palette" role="dialog" aria-modal="true" aria-label="Быстрый переход">
        <div className="adm-palette-input">
          <MagnifyingGlass size={18} weight="bold" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            placeholder="Раздел или почта ученика"
            aria-label="Поиск по админке"
            onChange={(event) => { setQuery(event.target.value); setActive(0) }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.preventDefault(); onClose() }
              if (event.key === 'ArrowDown') { event.preventDefault(); setActive((value) => Math.min(value + 1, all.length - 1)) }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)) }
              if (event.key === 'Enter' && all[current]) { event.preventDefault(); choose(all[current]) }
            }}
          />
        </div>
        {all.length === 0 ? (
          <p className="adm-palette-empty">{query.trim().length >= 2 ? 'Никого не нашлось. Поиск идёт по почте, имени и id.' : 'Набери название раздела или почту ученика.'}</p>
        ) : (
          <ul className="adm-palette-list">
            {users.length > 0 && <li className="adm-palette-group adm-eyebrow">Пользователи</li>}
            {users.map((item, index) => (
              <li key={item.key}>
                <button type="button" className={index === current ? 'is-active' : ''} onMouseEnter={() => setActive(index)} onClick={() => choose(item)}>
                  <span className="adm-cell-main"><strong>{item.title}</strong><small>{item.hint}</small></span>
                </button>
              </li>
            ))}
            {sections.length > 0 && <li className="adm-palette-group adm-eyebrow">Разделы</li>}
            {sections.map((item, index) => {
              const position = users.length + index
              return (
                <li key={item.key}>
                  <button type="button" className={position === current ? 'is-active' : ''} onMouseEnter={() => setActive(position)} onClick={() => choose(item)}>
                    <span className="adm-cell-main"><strong>{item.title}</strong><small>{item.hint}</small></span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <div className="adm-palette-foot"><span>↑↓ выбор</span><span>Enter открыть</span><span>Esc закрыть</span></div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------
   Каркас
   ------------------------------------------------------------------------ */

function AdminShell({ access, theme, onToggleTheme, onSignOut }: { access: AdminAccess; theme: Theme; onToggleTheme: () => void; onSignOut: () => void }) {
  const [section, setSection] = useState<AdminSection>(currentSection)
  const [signals, setSignals] = useState<AdminSignals>(emptySignals)
  const [online, setOnline] = useState(0)
  const [openUserId, setOpenUserId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('user'))
  const [paletteOpen, setPaletteOpen] = useState(false)
  const refreshTimer = useRef<number | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const allowedItems = useMemo(() => navItems.filter((item) => item.allowed(access.permissions)), [access.permissions])
  const activeSection = allowedItems.some((item) => item.id === section) ? section : 'dashboard'

  useEffect(() => {
    const onPop = () => {
      setSection(currentSection())
      setOpenUserId(new URLSearchParams(window.location.search).get('user'))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  /* Счётчики меню. Журнал обращений к админ-API 12 сентября показал 2-3
     вызова в минуту: к опросу раз в минуту добавлялся перезапрос на каждое
     событие Realtime. Теперь не чаще раза в 30 секунд, а в скрытой вкладке -
     никогда: вернулся на вкладку - обновилось. */
  const lastSignalsAt = useRef(0)
  const loadSignals = useCallback(async (force = false) => {
    if (!force && (document.visibilityState === 'hidden' || Date.now() - lastSignalsAt.current < 30_000)) return
    lastSignalsAt.current = Date.now()
    try {
      const data = obj(await adminRpc('admin_signal_counts'))
      setSignals((current) => ({
        pendingTickets: num(data.pendingTickets),
        overdueTickets: num(data.overdueTickets),
        openFlags: num(data.openFlags),
        openErrors: num(data.openErrors),
        pulse: current.pulse,
      }))
      setOnline(num(data.online))
    } catch {
      // Счётчики меню - подсказка, а не работа: ошибку покажет сам раздел.
    }
  }, [])

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current)
    refreshTimer.current = window.setTimeout(() => { void loadSignals() }, 800)
  }, [loadSignals])

  useEffect(() => {
    void loadSignals(true)
    const interval = window.setInterval(() => { void loadSignals() }, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void loadSignals() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadSignals])

  /* Реальное время: новое сообщение ученика, смена статуса обращения,
     новая ошибка. Разделы узнают о событии по signals.pulse. */
  useEffect(() => {
    if (!supabase) return
    const client = supabase
    const bump = () => {
      setSignals((current) => ({ ...current, pulse: current.pulse + 1 }))
      scheduleRefresh()
    }
    const channel = client
      .channel('admin-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_conversations' }, bump)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_signals' }, bump)
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [scheduleRefresh])

  const writeUrl = useCallback((params: URLSearchParams, replace = false) => {
    const query = params.toString()
    const url = `${window.location.pathname}${query ? `?${query}` : ''}`
    if (replace) window.history.replaceState(window.history.state, '', url)
    else window.history.pushState(window.history.state, '', url)
  }, [])

  const openSection = useCallback((next: AdminSection, params: Record<string, string> = {}) => {
    const search = new URLSearchParams()
    if (next !== 'dashboard') search.set('section', next)
    for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
    writeUrl(search)
    setSection(next)
    setOpenUserId(null)
    window.scrollTo({ top: 0 })
  }, [writeUrl])

  const openUser = useCallback((userId: string) => {
    const search = new URLSearchParams(window.location.search)
    search.set('user', userId)
    writeUrl(search)
    setOpenUserId(userId)
  }, [writeUrl])

  const closeUser = useCallback(() => {
    const search = new URLSearchParams(window.location.search)
    search.delete('user')
    writeUrl(search)
    setOpenUserId(null)
  }, [writeUrl])

  /* Карточка пользователя грузится отдельным чанком: между кликом и её
     появлением проходит доля секунды. Без этого место-заполнителя Escape,
     нажатый в этот зазор, не находит ничего в стопке окон, бьёт в пустоту -
     а карточка потом всё равно всплывает, когда чанк наконец пришёл. */
  useDialogFocus(Boolean(openUserId), closeUser)

  const contextValue = useMemo(() => ({
    access,
    signals,
    openUser,
    openSection,
    refreshSignals: () => { void loadSignals() },
  }), [access, signals, openUser, openSection, loadSignals])

  const groups = Array.from(new Set(allowedItems.map((item) => item.group)))

  return (
    <AdminContext.Provider value={contextValue}>
      <div className="adm-app">
        <header className="adm-topbar">
          <a className="adm-wordmark" href="/" aria-label="Homework Copilot"><span>H</span><b className="adm-wordmark-text">Homework Copilot</b></a>
          <span className="adm-topbar-role">{roleLabels[access.role]}</span>
          <span className="adm-topbar-spacer" />
          <button type="button" className="adm-search-trigger" onClick={() => setPaletteOpen(true)} aria-label="Быстрый переход">
            <MagnifyingGlass size={15} weight="bold" aria-hidden="true" />
            <span>Раздел или ученик</span>
            <kbd>Ctrl K</kbd>
          </button>
          <span className="adm-topbar-meta">
            <span className="adm-online" title="Пользователи с активностью за последние 10 минут"><i />{online} онлайн</span>
            <span className="adm-hide-mobile">{access.email}</span>
          </span>
          <button type="button" className="adm-icon-button" onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}>
            {theme === 'dark' ? <Sun size={18} weight="bold" aria-hidden="true" /> : <Moon size={18} weight="bold" aria-hidden="true" />}
          </button>
          <button type="button" className="adm-icon-button" onClick={onSignOut} aria-label="Выйти"><SignOut size={18} weight="bold" aria-hidden="true" /></button>
        </header>
        <div className="adm-layout">
          <nav className="adm-rail" aria-label="Разделы админки">
            {groups.map((group) => (
              <div key={group} style={{ display: 'contents' }}>
                <span className="adm-rail-group">{group}</span>
                {allowedItems.filter((item) => item.group === group).map((item) => {
                  const count = item.count?.(signals) ?? null
                  const href = item.id === 'dashboard' ? '/admin' : `/admin?section=${item.id}`
                  return (
                    <a
                      key={item.id}
                      href={href}
                      className={activeSection === item.id ? 'is-active' : ''}
                      aria-current={activeSection === item.id ? 'page' : undefined}
                      onClick={(event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey) return
                        event.preventDefault()
                        openSection(item.id)
                      }}
                    >
                      {item.icon}
                      {item.label}
                      {count && <span className={`adm-rail-count${count.alert ? ' is-alert' : ''}`}>{count.value}</span>}
                    </a>
                  )
                })}
              </div>
            ))}
            <div className="adm-rail-footer">
              <a href="/app"><ArrowLeft size={16} weight="bold" aria-hidden="true" /> В приложение</a>
            </div>
          </nav>
          <main className="adm-main">
            <div className="adm-main-inner">
              <Suspense fallback={<LoadingState />}>
                {activeSection === 'dashboard' && <DashboardSection />}
                {activeSection === 'users' && <UsersSection />}
                {activeSection === 'fraud' && <FraudSection />}
                {activeSection === 'support' && <SupportSection />}
                {activeSection === 'monitoring' && <MonitoringSection />}
                {activeSection === 'finance' && <FinanceSection />}
                {activeSection === 'library' && <SolutionsSection />}
                {activeSection === 'settings' && <SettingsSection />}
                {activeSection === 'notifications' && <NotificationsSection />}
                {activeSection === 'audit' && <AuditSection />}
              </Suspense>
            </div>
          </main>
        </div>
        {openUserId && (
          <Suspense fallback={null}>
            <UserCard key={openUserId} userId={openUserId} onClose={closeUser} />
          </Suspense>
        )}
        {paletteOpen && <CommandPalette items={allowedItems} onClose={() => setPaletteOpen(false)} openUser={openUser} />}
      </div>
    </AdminContext.Provider>
  )
}

/* ------------------------------------------------------------------------
   Вход в админку
   ------------------------------------------------------------------------ */

export default function AdminApp() {
  const [gate, setGate] = useState<Gate>({ kind: 'loading' })
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => {
    const root = document.documentElement
    const previousTheme = root.dataset.theme
    const previousScheme = root.style.colorScheme
    const previousTitle = document.title
    document.title = 'Админка - Homework Copilot'
    return () => {
      if (previousTheme) root.dataset.theme = previousTheme
      else delete root.dataset.theme
      root.style.colorScheme = previousScheme
      document.title = previousTitle
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    try {
      window.localStorage.setItem(themeStorageKey, theme)
    } catch {
      // Тема просто не запомнится.
    }
  }, [theme])

  const bootstrap = useCallback(async () => {
    if (!supabase) {
      setGate({ kind: 'unavailable' })
      return
    }
    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData.session?.user
    if (!user) {
      setGate({ kind: 'signed-out' })
      return
    }
    const email = user.email ?? ''
    const { data, error } = await supabase.rpc('get_admin_context')
    const context = isRecord(data) ? data : null
    if (error || !context || !bool(context.isAdmin)) {
      setGate({ kind: 'forbidden', email })
      return
    }
    if (!bool(context.mfaEnrolled)) {
      setGate({ kind: 'mfa-enroll', email })
      return
    }
    const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (level?.currentLevel !== 'aal2') {
      const { data: factors } = await supabase.auth.mfa.listFactors()
      const factor = factors?.totp.find((item) => item.status === 'verified')
      if (!factor) {
        setGate({ kind: 'mfa-enroll', email })
        return
      }
      setGate({ kind: 'mfa-verify', email, factorId: factor.id })
      return
    }
    const role = str(context.role)
    setGate({
      kind: 'ready',
      access: {
        userId: user.id,
        email,
        role: role === 'owner' || role === 'admin' ? role : 'support',
        permissions: parsePermissions(context.permissions),
      },
    })
  }, [])

  // Сбой проверки (сеть, битая сессия) не должен оставлять вечную загрузку.
  const safeBootstrap = useCallback(async () => {
    try {
      await bootstrap()
    } catch {
      setGate({ kind: 'signed-out', error: 'Не получилось проверить доступ. Войди заново.' })
    }
  }, [bootstrap])

  useEffect(() => { void safeBootstrap() }, [safeBootstrap])

  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') setGate({ kind: 'signed-out' })
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut({ scope: 'local' })
    setGate({ kind: 'signed-out' })
  }, [])

  if (gate.kind === 'loading') return <GateCard title="Открываем админку"><LoadingState label="Проверяем доступ…" /></GateCard>
  if (gate.kind === 'unavailable') return <GateCard title="База не подключена"><p>Админка не работает без подключения к Supabase.</p></GateCard>
  if (gate.kind === 'signed-out') return <SignInForm error={gate.error} onDone={() => { void safeBootstrap() }} />
  if (gate.kind === 'forbidden') {
    return (
      <GateCard title="Доступ закрыт">
        <p>У аккаунта {gate.email} нет роли в админке. Роль выдаёт владелец сервиса.</p>
        <div className="adm-gate-links"><a href="/app">В приложение</a><button type="button" onClick={() => { void signOut() }}>Войти другим аккаунтом</button></div>
      </GateCard>
    )
  }
  if (gate.kind === 'mfa-enroll') return <MfaEnroll email={gate.email} onDone={() => { void safeBootstrap() }} onSignOut={() => { void signOut() }} />
  if (gate.kind === 'mfa-verify') return <MfaVerify email={gate.email} factorId={gate.factorId} onDone={() => { void safeBootstrap() }} onSignOut={() => { void signOut() }} />

  return (
    <ToastProvider>
      <AdminShell
        access={gate.access}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        onSignOut={() => { void signOut() }}
      />
    </ToastProvider>
  )
}
