import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import {
  Atom,
  ArrowRight,
  Bank,
  BookOpenText,
  Books,
  Calculator,
  Code,
  CalendarDots,
  CaretRight,
  Check,
  ChatsCircle,
  CheckCircle,
  Dna,
  Flask,
  Function,
  Globe,
  Hash,
  Planet,
  Scroll,
  TextAa,
  House,
  MagnifyingGlass,
  Moon,
  Notebook,
  ShoppingCartSimple,
  SpinnerGap,
  Stack,
  Sun,
  UserCircle,
  WarningCircle,
} from '@phosphor-icons/react'
import CopyTask from './CopyTask'
import type { TaskSubmission } from './CopyTask'
import LandingPage from './landing/LandingPage'
import LegalPage from './LegalPage'
import PrivacyNotice from './PrivacyNotice'
import { GeometryNotebookLayoutV1 } from './notebook/GeometryNotebookLayoutV1'
import type { GeometryNotebookPageSpec } from './notebook/geometry/types'
import type { Database } from './lib/database.types'
import type { AccountData } from './lib/supabase'
import type { HomeworkSolution, HomeworkSource } from './lib/homeworkContract'
import { formatRubles } from './lib/currency'
import { recordPendingLegalAcceptance, rememberPendingLegalAcceptance } from './lib/legalConsent'
import { bindPendingReferral, captureReferralFromCurrentUrl, preparePendingReferralClaim } from './lib/referrals'
import { applySeoMetadata, getSeoMetadata } from './lib/siteMetadata'
import { getSolutionPrice } from './lib/solutionPricing'
import { catalogSolutionEntries, findAvailableNumberSolution } from './lib/solutionLibrary'
import {
  isReviewedHomeworkSolution,
  loadGeneratedSolutions,
  parseStoredHomeworkSolution,
  prepareTaskPhoto,
  requestHomeworkSolution,
  saveGeneratedSolutions,
} from './lib/homeworkSolution'
import { normalizeTaskCondition } from './textbooks/taskCatalog'
import type { VerifiedTextbookTaskSource } from './textbooks/taskCatalog'
import { SolutionVerificationPanel } from './solution/SolutionVerificationPanel'
import { WrittenAnalysis } from './solution/WrittenAnalysis'
import { SiteFooter, SupportCenter, SupportLauncher } from './support/SupportCenter'
import type { SupportCategory, SupportPrefill } from './support/SupportCenter'
import './App.css'

const DesignSystemPlayground = lazy(() => import('./DesignSystemPlayground'))
// Холст тетради нужен только в разработке — в главном чанке ему делать нечего.
const NotebookCanvas = lazy(() => import('./NotebookCanvas'))
const ChatPage = lazy(() => import('./chat/ChatPage'))
const AccountDialog = lazy(() => import('./account/AccountDialog'))
const SchedulePage = lazy(() => import('./SchedulePage'))
const AdminDashboard = lazy(() => import('./AdminDashboard'))

type Theme = 'light' | 'dark'
type AccountView = 'profile' | 'wallet'
type TextbookId = string
type TextbookSourceType = 'pdf' | 'epub' | 'image' | 'link' | 'official' | 'photo'

const authIsConfigured = import.meta.env.MODE !== 'test'
  && Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)

type Textbook = {
  id: TextbookId
  subject: string
  grade: string
  title: string
  authors: string
  edition: string
  solvedTasks: readonly string[]
  icon: typeof BookOpenText
  sourceUrl?: string
  sourceType?: TextbookSourceType
  previewBeforeReading?: boolean
  // Размечен ли учебник: есть ли для него индекс задач. Без индекса ученик
  // выберет книгу и упрётся в стену — задача по номеру не найдётся.
  indexed?: boolean
  // Как адресуется задача. В большинстве учебников нумерация сквозная и
  // хватает номера. У Пёрышкина её нет вовсе: задача адресуется тройкой
  // «параграф, упражнение, задание», и одного номера недостаточно.
  taskAddress?: 'number' | 'paragraph'
}

type SolutionState = {
  mode: 'processing' | 'ready' | 'error'
  textbookId: TextbookId
  task: string
  source: HomeworkSource
  error?: string
}

type PersonalSolution = SolutionState & {
  time: string
}

type SharedHomeworkSolution = Database['public']['Tables']['homework_solution_catalog']['Row']

const themeStorageKey = 'homework-copilot:theme'
const selectedTextbookStorageKey = 'homework-copilot:selected-textbook'


const applicationRoutes = [
  { label: 'Главная', path: '/app', icon: House },
  { label: 'Решения', path: '/solutions', icon: Notebook },
  { label: 'ЦДЗ', path: '/cdz', icon: Stack },
  { label: 'ИИ-чат', path: '/chat', icon: ChatsCircle },
  { label: 'Задачи', path: '/tasks', icon: ShoppingCartSimple },
  { label: 'Расписание', path: '/schedule', icon: CalendarDots },
] as const

const navigation = applicationRoutes.filter(({ label }) => label !== 'Задачи')

type NavigationLabel = (typeof applicationRoutes)[number]['label']

function applicationPath(path: string) {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`
}

function currentApplicationPath(pathname = window.location.pathname) {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '')
  const relativePath = basePath && pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : pathname
  return relativePath.replace(/\/+$/, '') || '/'
}

function currentNavigationRoute(pathname = window.location.pathname): { label: NavigationLabel; solution: SolutionState | null } {
  const path = currentApplicationPath(pathname)
  if (path === '/textbooks' || path === '/tasks') return { label: 'ЦДЗ', solution: null }
  if (path === '/base') return { label: 'Решения', solution: null }
  // `/main` — прежний адрес рабочей главной. Ссылки на него уже разошлись,
  // поэтому он продолжает открывать приложение и лишь переписывается на `/app`.
  if (path === '/main') return { label: 'Главная', solution: null }
  const destination = applicationRoutes.find((item) => item.path === path)
  if (destination) return { label: destination.label, solution: null }

  const solutionMatch = path.match(/^\/solutions\/([^/]+)\/(\d{1,4}|photo-[a-z0-9-]+)$/i)
  if (solutionMatch) {
    const task = decodeURIComponent(solutionMatch[2])
    return {
      label: 'Решения',
      solution: {
        mode: 'ready',
        textbookId: decodeURIComponent(solutionMatch[1]),
        task,
        source: task.startsWith('photo-') ? 'photo' : 'number',
      },
    }
  }

  return { label: 'Главная', solution: null }
}

function normalizeNavigationPath(pathname: string) {
  const path = currentApplicationPath(pathname)
  if (path === '/textbooks' || path === '/tasks') return '/cdz'
  if (path === '/base') return '/solutions'
  // `/` теперь публичная витрина, рабочая главная живёт на `/app`.
  return path === '/' || path === '/main' ? '/app' : path
}

// Предметы, а не учебники.
//
// Раньше здесь были три конкретных издания, а условия задач брались из
// нашего индекса, распознанного из чужих учебников. От этого отказались:
// хранить и раздавать содержание учебников — прямой правовой риск, а купить
// на это лицензию нельзя, такого продукта у издательств нет.
//
// Теперь условие задачи даёт сам ученик: фотографией или текстом. Работает
// с любым учебником, любым классом и любым предметом, и ничего чужого мы
// не храним.
const textbooks: readonly Textbook[] = [
  {
    id: 'mathematics',
    subject: 'Математика',
    grade: '7-11 класс',
    title: 'Любой учебник',
    authors: 'Сфотографируй задачу или впиши условие',
    edition: 'по фото или тексту',
    solvedTasks: [],
    icon: Calculator,
    sourceType: 'photo',
    indexed: false,
  },
  {
    id: 'algebra',
    subject: 'Алгебра',
    grade: '7-11 класс',
    title: 'Любой учебник',
    authors: 'Сфотографируй задачу или впиши условие',
    edition: 'по фото или тексту',
    solvedTasks: [],
    icon: Function,
    sourceType: 'photo',
    indexed: false,
  },
  {
    id: 'geometry',
    subject: 'Геометрия',
    grade: '7-11 класс',
    title: 'Любой учебник',
    authors: 'Сфотографируй задачу или впиши условие',
    edition: 'по фото или тексту',
    solvedTasks: [],
    icon: BookOpenText,
    sourceType: 'photo',
    indexed: false,
  },
  {
    id: 'physics',
    subject: 'Физика',
    grade: '7-11 класс',
    title: 'Любой учебник',
    authors: 'Сфотографируй задачу или впиши условие',
    edition: 'по фото или тексту',
    solvedTasks: [],
    icon: Atom,
    sourceType: 'photo',
    indexed: false,
  },
  {
    id: 'chemistry',
    subject: 'Химия',
    grade: '7-11 класс',
    title: 'Любой учебник',
    authors: 'Сфотографируй задачу или впиши условие',
    edition: 'по фото или тексту',
    solvedTasks: [],
    icon: Flask,
    sourceType: 'photo',
    indexed: false,
  },
  {
    id: 'biology',
    subject: 'Биология',
    grade: '7-11 класс',
    title: 'Любой учебник',
    authors: 'Сфотографируй задачу или впиши условие',
    edition: 'по фото или тексту',
    solvedTasks: [],
    icon: Dna,
    sourceType: 'photo',
    indexed: false,
  },
  {
    id: 'informatics',
    subject: 'Информатика',
    grade: '7-11 класс',
    title: 'Любой учебник',
    authors: 'Сфотографируй задачу или впиши условие',
    edition: 'по фото или тексту',
    solvedTasks: [],
    icon: Code,
    sourceType: 'photo',
    indexed: false,
  },
  {
    id: 'russian',
    subject: 'Русский язык',
    grade: '7-11 класс',
    title: 'Любой учебник',
    authors: 'Сфотографируй задачу или впиши условие',
    edition: 'по фото или тексту',
    solvedTasks: [],
    icon: TextAa,
    sourceType: 'photo',
    indexed: false,
  },
  {
    id: 'literature',
    subject: 'Литература',
    grade: '7-11 класс',
    title: 'Любой учебник',
    authors: 'Сфотографируй задачу или впиши условие',
    edition: 'по фото или тексту',
    solvedTasks: [],
    icon: Books,
    sourceType: 'photo',
    indexed: false,
  },
  {
    id: 'english',
    subject: 'Английский язык',
    grade: '7-11 класс',
    title: 'Любой учебник',
    authors: 'Сфотографируй задачу или впиши условие',
    edition: 'по фото или тексту',
    solvedTasks: [],
    icon: Globe,
    sourceType: 'photo',
    indexed: false,
  },
  {
    id: 'history',
    subject: 'История',
    grade: '7-11 класс',
    title: 'Любой учебник',
    authors: 'Сфотографируй задачу или впиши условие',
    edition: 'по фото или тексту',
    solvedTasks: [],
    icon: Scroll,
    sourceType: 'photo',
    indexed: false,
  },
  {
    id: 'social',
    subject: 'Обществознание',
    grade: '7-11 класс',
    title: 'Любой учебник',
    authors: 'Сфотографируй задачу или впиши условие',
    edition: 'по фото или тексту',
    solvedTasks: [],
    icon: Bank,
    sourceType: 'photo',
    indexed: false,
  },
  {
    id: 'geography',
    subject: 'География',
    grade: '7-11 класс',
    title: 'Любой учебник',
    authors: 'Сфотографируй задачу или впиши условие',
    edition: 'по фото или тексту',
    solvedTasks: [],
    icon: Globe,
    sourceType: 'photo',
    indexed: false,
  },
  {
    id: 'astronomy',
    subject: 'Астрономия',
    grade: '7-11 класс',
    title: 'Любой учебник',
    authors: 'Сфотографируй задачу или впиши условие',
    edition: 'по фото или тексту',
    solvedTasks: [],
    icon: Planet,
    sourceType: 'photo',
    indexed: false,
  },
] as const

function getTextbook(id: TextbookId, items: readonly Textbook[] = textbooks) {
  return items.find((textbook) => textbook.id === id) ?? items[0] ?? textbooks[0]
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span>H</span><span>C</span>
    </span>
  )
}

function BrandLockup() {
  return (
    <span className="brand-lockup">
      <BrandMark />
      <span className="brand-name"><span>Homework</span> <span className="brand-name-accent">Copilot</span></span>
    </span>
  )
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const Icon = theme === 'light' ? Moon : Sun

  return (
    <button className="utility-button" type="button" onClick={onToggle} aria-label={theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему'}>
      <Icon size={20} weight="duotone" aria-hidden="true" />
    </button>
  )
}

function ProfileButton({ user, account, onClick, compact = false }: { user: User | null; account: AccountData | null; onClick: () => void; compact?: boolean }) {
  const name = account?.profile.full_name || (user ? user.email?.split('@')[0] : 'Войти') || 'Ученик'
  const subtitle = user ? `${account?.profile.grade ?? 8} класс` : 'Аккаунт'

  return (
    <button className={`profile-button${compact ? ' is-compact' : ''}`} type="button" aria-label={user ? 'Открыть профиль' : 'Войти или зарегистрироваться'} onClick={onClick}>
      <span><UserCircle size={21} weight="duotone" aria-hidden="true" /></span>
      {!compact && <span><strong>{name}</strong><small>{subtitle}</small></span>}
      {!compact && <CaretRight size={14} weight="bold" aria-hidden="true" />}
    </button>
  )
}

function ProductTopbar({
  theme,
  activeLabel,
  onNavigate,
  onToggleTheme,
  user,
  account,
  onOpenAccount,
  onOpenWallet,
}: {
  theme: Theme
  activeLabel: NavigationLabel
  onNavigate: (label: NavigationLabel) => void
  onToggleTheme: () => void
  user: User | null
  account: AccountData | null
  onOpenAccount: () => void
  onOpenWallet: () => void
}) {
  return (
    <header className="product-topbar">
      <button className="topbar-brand" type="button" aria-label="На главную" onClick={() => onNavigate('Главная')}>
        <BrandLockup />
      </button>

      <nav className="product-navigation" aria-label="Основная навигация">
        {navigation.map(({ label, icon: Icon }) => {
          const active = label === activeLabel
          return (
            <button className={`navigation-item${active ? ' is-active' : ''}`} type="button" key={label} aria-current={active ? 'page' : undefined} onClick={() => onNavigate(label)}>
              <Icon size={19} weight="duotone" aria-hidden="true" />
              <span className="navigation-label">{label}</span>
              {label === 'ЦДЗ' && <span className="navigation-status" aria-hidden="true">Скоро</span>}
            </button>
          )
        })}
      </nav>

      <div className="topbar-actions">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        {user && <BalanceControl user={user} balance={account?.balance ?? null} onOpenWallet={onOpenWallet} />}
        <ProfileButton user={user} account={account} onClick={onOpenAccount} />
      </div>
    </header>
  )
}

function BalanceControl({ user, balance, onOpenWallet }: { user: User | null; balance: number | null; onOpenWallet: () => void }) {
  if (!user) {
    return (
      <button className="header-sign-in" type="button" onClick={onOpenWallet}>
        <UserCircle size={20} weight="duotone" aria-hidden="true" />
        Войти
      </button>
    )
  }

  return (
    <button className="balance-control" type="button" aria-label={`Открыть баланс: ${formatRubles(balance ?? 0)}`} onClick={onOpenWallet}>
      <span><small>Баланс</small><strong>{formatRubles(balance ?? 0)}</strong></span>
      <span className="balance-open">Пополнить <ArrowRight size={15} weight="bold" aria-hidden="true" /></span>
    </button>
  )
}

function PageHeader({ account }: { account: AccountData | null }) {
  const firstName = account?.profile.full_name.trim().split(/\s+/)[0]
  const formattedDate = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
  const dateLabel = formattedDate.charAt(0).toLocaleUpperCase('ru') + formattedDate.slice(1)

  return (
    <header className="page-header">
      <div className="page-heading">
        <p className="page-greeting">{firstName ? `Добрый день, ${firstName}` : 'Добрый день'}</p>
        <span>{dateLabel}</span>
      </div>
    </header>
  )
}

function CdzComingSoon({ onGoHome }: { onGoHome: () => void }) {
  return (
    <section className="cdz-coming-soon" aria-labelledby="cdz-coming-soon-title">
      <div className="cdz-coming-soon-symbol" aria-hidden="true">
        <Stack size={72} weight="duotone" />
        <strong>ЦДЗ</strong>
      </div>
      <div className="cdz-coming-soon-copy">
        <h1 id="cdz-coming-soon-title">Раздел пока закрыт</h1>
        <p>ЦДЗ ещё не запущено. Откроем раздел только после полной подготовки и проверки.</p>
        <button className="route-primary-action" type="button" onClick={onGoHome}>
          <House size={18} weight="duotone" aria-hidden="true" />
          Вернуться на главную
        </button>
      </div>
    </section>
  )
}

function SolutionStatus({ state, textbooks: items, onOpenSolution }: { state: SolutionState; textbooks: readonly Textbook[]; onOpenSolution: (state: SolutionState) => void }) {
  const textbook = getTextbook(state.textbookId, items)

  if (state.mode === 'error') {
    return (
      <section className="active-solution solution-error" role="alert" aria-labelledby="solution-error-title">
        <header className="section-heading">
          <div>
            <h2 id="solution-error-title">Не получилось решить задачу</h2>
            <p>{state.error ?? 'Попробуй отправить задачу ещё раз.'}</p>
          </div>
        </header>
        <p className="solution-status-note">Деньги за неготовое решение не списаны.</p>
      </section>
    )
  }

  if (state.mode === 'ready') {
    return (
      <section className="ready-solution" aria-labelledby="ready-solution-title">
        <CheckCircle size={38} weight="duotone" aria-hidden="true" />
        <div>
          <h2 id="ready-solution-title">{state.source === 'photo' ? 'Решение по фото готово' : `№ ${state.task} уже готова`}</h2>
          <p>{textbook.subject}. {textbook.title}. {state.source === 'photo' ? 'Модель прочитала фото, готовый ответ можно переписать.' : 'Решение найдено в общей базе, ждать не нужно.'}</p>
        </div>
        <button type="button" onClick={() => onOpenSolution(state)}>Открыть решение <ArrowRight size={18} weight="bold" aria-hidden="true" /></button>
      </section>
    )
  }

  return (
    <section className="active-solution" aria-labelledby="active-solution-title">
      <header className="section-heading">
        <div>
          <h2 id="active-solution-title">{state.source === 'photo' ? 'Готовим задачу с фото' : `Готовим № ${state.task}`}</h2>
          <p>{textbook.subject}. {textbook.title}. {state.source === 'photo' ? 'Читаем фото и готовим решение.' : 'Готовое решение появится автоматически.'}</p>
        </div>
        <span className="solution-eta">Обычно несколько секунд</span>
      </header>

      <div className="solution-progress" role="status" aria-live="polite" aria-busy="true">
        <SpinnerGap className="solution-loader-orbit" size={36} weight="bold" aria-label="Решаем задачу" />
        <span className="solution-progress-copy"><strong>Решаем задачу</strong><small>Затем оформим ответ как в тетради</small></span>
      </div>

      <div className="solution-progress-track" role="progressbar" aria-label="Подготовка решения"><span /></div>
      <p className="solution-status-note">Статус обновится автоматически. Эту страницу можно оставить открытой.</p>
    </section>
  )
}

function HomeActionCard({
  className,
  icon: Icon,
  titleId,
  title,
  description,
  actionLabel,
  onAction,
}: {
  className: string
  icon: typeof Notebook
  titleId: string
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <section className={`home-action-card ${className}`} aria-labelledby={titleId}>
      <span className="home-action-card-icon" aria-hidden="true"><Icon size={34} weight="duotone" /></span>
      <div>
        <h2 id={titleId}>{title}</h2>
        <p>{description}</p>
      </div>
      <button type="button" onClick={onAction}>{actionLabel} <ArrowRight size={18} weight="bold" aria-hidden="true" /></button>
    </section>
  )
}

function GuestWorkspace({ onOpenAccount }: { onOpenAccount: () => void }) {
  return (
    <HomeActionCard
      className="guest-workspace"
      icon={Notebook}
      titleId="guest-workspace-title"
      title="Твои решения появятся после входа"
      description="Здесь будут твои решённые задачи и те, что ты открывал."
      actionLabel="Войти"
      onAction={onOpenAccount}
    />
  )
}

function MySolutions({ items, onOpenAll, onOpenSolution }: { items: readonly PersonalSolution[]; onOpenAll: () => void; onOpenSolution: (state: SolutionState) => void }) {
  return (
    <section className="my-solutions" aria-labelledby="my-solutions-title">
      <header className="section-heading">
        <div><h2 id="my-solutions-title">Мои решения</h2><p>Только задачи, которые ты уже открыл или запросил в этом сеансе.</p></div>
        <button className="section-link" type="button" onClick={onOpenAll}>Все мои решения <ArrowRight size={17} weight="bold" aria-hidden="true" /></button>
      </header>
      {items.length > 0 ? <div className="solution-list">
        {items.map(({ textbookId, task, time, mode, source }) => {
          const textbook = getTextbook(textbookId)
          const Icon = textbook.icon
          return (
            <button type="button" key={`${textbookId}-${task}-${time}`} onClick={() => onOpenSolution({ textbookId, task, mode, source })}>
              <Icon size={32} weight="duotone" aria-hidden="true" />
              <span><small>{textbook.subject}, {textbook.title}</small><strong>№ {task}</strong></span>
              <time>{time}</time>
              <ArrowRight size={18} weight="bold" aria-hidden="true" />
            </button>
          )
        })}
      </div> : <p className="collection-empty">Пока здесь пусто. Первое решение появится после запроса.</p>}
    </section>
  )
}

function BaseShortcut({ onOpenBase }: { onOpenBase: () => void }) {
  return (
    <HomeActionCard
      className="base-shortcut"
      icon={Stack}
      titleId="base-shortcut-title"
      title="База решений"
      description="Готовые решения, которые уже кто-то заказал. Их можно открыть сразу."
      actionLabel="Открыть базу"
      onAction={onOpenBase}
    />
  )
}

function SolutionsPage({
  user,
  personalSolutions,
  textbooks: items,
  sharedSolutions,
  sharedSolutionsStatus,
  onOpenAccount,
  onOpenSolution,
  onOpenSharedSolution,
  onRefreshSharedSolutions,
}: {
  user: User | null
  personalSolutions: readonly PersonalSolution[]
  textbooks: readonly Textbook[]
  sharedSolutions: readonly SharedHomeworkSolution[]
  sharedSolutionsStatus: 'loading' | 'ready' | 'error'
  onOpenAccount: () => void
  onOpenSolution: (state: SolutionState) => void
  onOpenSharedSolution: (textbookId: TextbookId, task: string) => void
  onRefreshSharedSolutions: () => void
}) {
  const [query, setQuery] = useState('')
  const [activeSection, setActiveSection] = useState<'personal' | 'shared'>(user ? 'personal' : 'shared')
  const entries = useMemo(() => catalogSolutionEntries(sharedSolutions, items), [items, sharedSolutions])
  const normalizedQuery = query.trim().toLocaleLowerCase('ru')
  const matches = (textbook: Textbook, task: string) => `${textbook.subject} ${textbook.title} ${task}`.toLocaleLowerCase('ru').includes(normalizedQuery)
  const results = entries.filter(({ textbook, task }) => matches(textbook, task))
  const personalResults = personalSolutions.filter(({ textbookId, task }) => matches(getTextbook(textbookId, items), task))

  return (
    <section className="route-page solutions-page" aria-labelledby="solutions-page-title">
      <header className="route-page-header">
        <h1 id="solutions-page-title">Решения</h1>
        <p>Твои задачи и готовые ответы из общей базы — в одном месте.</p>
      </header>
      <div
        className="solutions-tabs"
        role="tablist"
        aria-label="Раздел решений"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          const nextSection = activeSection === 'personal' ? 'shared' : 'personal'
          setActiveSection(nextSection)
          event.currentTarget.querySelector<HTMLButtonElement>(`[data-section="${nextSection}"]`)?.focus()
        }}
      >
        <button id="personal-solutions-tab" data-section="personal" type="button" role="tab" aria-label="Мои решения" aria-controls="solutions-panel" aria-selected={activeSection === 'personal'} tabIndex={activeSection === 'personal' ? 0 : -1} onClick={() => setActiveSection('personal')}>
          <Notebook size={18} weight="duotone" aria-hidden="true" />
          <span>Мои решения</span>
          {user && <small aria-hidden="true">{personalResults.length}</small>}
        </button>
        <button id="shared-solutions-tab" data-section="shared" type="button" role="tab" aria-label="База решений" aria-controls="solutions-panel" aria-selected={activeSection === 'shared'} tabIndex={activeSection === 'shared' ? 0 : -1} onClick={() => setActiveSection('shared')}>
          <Stack size={18} weight="duotone" aria-hidden="true" />
          <span>База решений</span>
          <small aria-hidden="true">{results.length}</small>
        </button>
      </div>
      <label className="route-search" htmlFor="solutions-search"><MagnifyingGlass size={20} weight="duotone" aria-hidden="true" /><span>Найти решение</span><input id="solutions-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Предмет или номер задачи" autoComplete="off" /></label>

      <div id="solutions-panel" className="solutions-directory" role="tabpanel" aria-labelledby={activeSection === 'personal' ? 'personal-solutions-tab' : 'shared-solutions-tab'} tabIndex={0}>
        {activeSection === 'personal' ? <section className="solutions-directory-section" aria-labelledby="personal-solutions-title">
          <header className="solutions-directory-heading"><h2 id="personal-solutions-title">Мои решения</h2>{user && <span>{personalResults.length}</span>}</header>
          {!user ? <GuestWorkspace onOpenAccount={onOpenAccount} /> : personalResults.length > 0 ? (
            <div className="solution-list route-solution-list">
              {personalResults.map(({ textbookId, task, time, mode, source }) => {
                const textbook = getTextbook(textbookId, items)
                const Icon = textbook.icon
                return (
                  <button type="button" key={`${textbookId}-${task}-${time}`} onClick={() => onOpenSolution({ textbookId, task, mode, source })}>
                    <Icon size={32} weight="duotone" aria-hidden="true" />
                    <span><small>{textbook.subject}, {textbook.title}</small><strong>№ {task}</strong></span>
                    <time>{time}</time>
                    <ArrowRight size={18} weight="bold" aria-hidden="true" />
                  </button>
                )
              })}
            </div>
          ) : <section className="route-empty" aria-labelledby="solutions-empty-title"><Notebook size={34} weight="duotone" aria-hidden="true" /><div><h2 id="solutions-empty-title">Решений пока нет</h2><p>Открой готовый ответ или отправь новую задачу, и она появится здесь.</p></div></section>}
        </section> : <section className="solutions-directory-section" aria-labelledby="shared-solutions-title">
          <header className="solutions-directory-heading"><h2 id="shared-solutions-title">База решений</h2><span>{sharedSolutionsStatus === 'loading' ? '…' : results.length}</span></header>
          {sharedSolutionsStatus === 'loading' ? <div className="route-loading" role="status">Загружаем базу решений…</div>
            : sharedSolutionsStatus === 'error' ? <section className="route-empty" aria-labelledby="base-error-title"><WarningCircle size={34} weight="duotone" aria-hidden="true" /><div><h2 id="base-error-title">База временно недоступна</h2><p>Повтори загрузку. Сохранённые решения не потеряны.</p><button className="route-secondary-action" type="button" onClick={onRefreshSharedSolutions}>Повторить</button></div></section>
            : results.length > 0 ? <div className="solution-list route-solution-list">
            {results.map(({ textbook, task }) => {
              const Icon = textbook.icon
              return (
                <button type="button" key={`${textbook.id}-${task}`} onClick={() => onOpenSharedSolution(textbook.id, task)}>
                  <Icon size={32} weight="duotone" aria-hidden="true" />
                  <span><strong>{textbook.subject} · {textbook.grade}</strong><small>Задача № {task}</small></span>
                  <span className="solution-base-open">Открыть решение</span>
                  <ArrowRight size={18} weight="bold" aria-hidden="true" />
                </button>
              )
            })}
          </div> : <section className="route-empty" aria-labelledby="base-empty-title"><MagnifyingGlass size={34} weight="duotone" aria-hidden="true" /><div><h2 id="base-empty-title">Совпадений нет</h2><p>Попробуй другой номер или отправь задачу с главной страницы.</p></div></section>}
        </section>}
      </div>
    </section>
  )
}

function asGeometryNotebookSpec(
  solution: HomeworkSolution,
  sourceDiagram?: GeometryNotebookPageSpec['sourceDiagram'],
): GeometryNotebookPageSpec {
  return {
    id: 'generated-' + solution.textbookId + '-' + solution.task,
    number: solution.source === 'photo' ? 'фото' : solution.task,
    condition: solution.condition,
    given: solution.given.slice(0, 3),
    goal: solution.goal,
    diagram: solution.diagram,
    ...(sourceDiagram ? { sourceDiagram } : {}),
    solution: solution.steps,
    ...(solution.answer ? { answer: solution.answer } : {}),
  }
}

function UnderstandingPage({
  solution,
  generatedSolution,
  onGoHome,
  onOpenSupport,
}: {
  solution: SolutionState | null
  generatedSolution?: HomeworkSolution
  onGoHome: () => void
  onOpenSupport: (context: SupportPrefill) => void
}) {
  const [copied, setCopied] = useState(false)
  // Исходный чертёж из скана учебника больше не подгружается: сканов нет,
  // а чертёж строится движком по условию.

  const notebookFixture = generatedSolution?.subject === 'Геометрия'
    ? asGeometryNotebookSpec(generatedSolution)
    : undefined

  const copySolution = async () => {
    const source = generatedSolution ?? (notebookFixture ? {
      condition: notebookFixture.condition,
      given: notebookFixture.given,
      goal: notebookFixture.goal,
      steps: notebookFixture.solution,
      answer: notebookFixture.answer ?? '',
    } : null)
    if (!source) return

    const value = [
      'Условие: ' + source.condition,
      ...(source.given.length > 0 ? ['Дано:', ...source.given] : []),
      source.goal.title + ': ' + source.goal.text,
      'Решение:',
      ...source.steps,
      ...(source.answer ? ['Ответ: ' + source.answer] : []),
    ].join('\n')

    if (!navigator.clipboard?.writeText) return
    await navigator.clipboard.writeText(value)
    setCopied(true)
  }

  const actions = (
    <div className="solution-actions">
      {(notebookFixture || generatedSolution) && (
        <button className="route-primary-action" type="button" onClick={() => { void copySolution() }}>
          {copied ? 'Скопировано' : 'Скопировать решение'}
          <Check size={18} weight="bold" aria-hidden="true" />
        </button>
      )}
      <button className="route-secondary-action" type="button" onClick={onGoHome}>
        ← На главную <House size={18} weight="bold" aria-hidden="true" />
      </button>
      <button className="route-secondary-action" type="button" onClick={() => { if (generatedSolution) { const textbook = getTextbook(generatedSolution.textbookId); onOpenSupport({ wrongSolution: { textbookId: generatedSolution.textbookId, textbookTitle: generatedSolution.textbookTitle, subject: generatedSolution.subject, grade: textbook.grade, edition: generatedSolution.textbookEdition, source: generatedSolution.source, task: generatedSolution.task, condition: generatedSolution.condition, given: generatedSolution.given, goal: generatedSolution.goal, steps: generatedSolution.steps, ...(generatedSolution.answer ? { answer: generatedSolution.answer } : {}), sourceUrl: generatedSolution.sourceUrl, ...(generatedSolution.sourcePage ? { sourcePage: generatedSolution.sourcePage } : {}) } }) } }}>
        Сообщить об ошибке <WarningCircle size={18} weight="duotone" aria-hidden="true" />
      </button>
    </div>
  )

  if (notebookFixture) {
    return (
      <section className="route-page solution-view" aria-labelledby="understanding-page-title">
        <header className="route-page-header">
          <h1 id="understanding-page-title">{solution?.source === 'photo' ? 'Решение по фото' : 'Решение № ' + notebookFixture.number}</h1>
          <p>Готовый лист для тетради. Проверь условие перед тем, как переписывать ответ.</p>
        </header>
        {generatedSolution && (
          <div className="solution-condition">
            <strong>Условие</strong>
            <p>{generatedSolution.condition}</p>
          </div>
        )}
        <div className="solution-notebook-preview"><GeometryNotebookLayoutV1 spec={notebookFixture} /></div>
        {generatedSolution?.verification && <SolutionVerificationPanel verification={generatedSolution.verification} />}
        {actions}
      </section>
    )
  }

  if (generatedSolution) {
    return (
      <section className="route-page solution-view" aria-labelledby="understanding-page-title">
        <header className="route-page-header">
          <h1 id="understanding-page-title">{solution?.source === 'photo' ? 'Решение по фото' : 'Решение № ' + generatedSolution.task}</h1>
          <p>{generatedSolution.subject}. {generatedSolution.textbookTitle}.</p>
        </header>
        <article className="written-solution" aria-label="Готовое решение задачи">
          <section className="written-solution-section">
            <h2>Условие</h2>
            <p>{generatedSolution.condition}</p>
          </section>
          {generatedSolution.given.length > 0 && (
            <section className="written-solution-section">
              <h2>Дано</h2>
              {generatedSolution.given.map((line, index) => <p key={line + index}>{line}</p>)}
            </section>
          )}
          <section className="written-solution-section">
            <h2>{generatedSolution.goal.title}</h2>
            <p>{generatedSolution.goal.text}</p>
          </section>
          <section className="written-solution-section">
            <h2>Решение</h2>
            {generatedSolution.steps.map((step, index) => <p key={step + index}>{step}</p>)}
          </section>
          {generatedSolution.analysis && (
            <section className="written-solution-section">
              <WrittenAnalysis analysis={generatedSolution.analysis} />
            </section>
          )}
          {generatedSolution.answer && (
            <section className="written-solution-section written-solution-answer">
              <h2>Ответ</h2>
              <p>{generatedSolution.answer}</p>
            </section>
          )}
        </article>
        {generatedSolution.verification && <SolutionVerificationPanel verification={generatedSolution.verification} />}
        {actions}
      </section>
    )
  }

  return (
    <section className="route-page" aria-labelledby="understanding-page-title">
      <header className="route-page-header">
        <h1 id="understanding-page-title">Решение</h1>
        <p>Открой готовый ответ, чтобы увидеть условие, ход решения и ответ в одном месте.</p>
      </header>
      <div className="understanding-flow">
        <section><BookOpenText size={30} weight="duotone" aria-hidden="true" /><h2>Выбери учебник</h2><p>Номер задачи проверяется только внутри конкретного учебника.</p></section>
        <section><Hash size={30} weight="duotone" aria-hidden="true" /><h2>Укажи задачу</h2><p>Если ответ уже есть в базе, его можно открыть без ожидания.</p></section>
        <section><Notebook size={30} weight="duotone" aria-hidden="true" /><h2>Проверь ответ</h2><p>Готовое решение оформлено так, чтобы его было удобно переписать в тетрадь.</p></section>
      </div>
      <button className="route-primary-action" type="button" onClick={onGoHome}>← На главную <House size={18} weight="bold" aria-hidden="true" /></button>
    </section>
  )
}

function AccountBlockedScreen({ reason, onSignOut }: { reason: string | null; onSignOut: () => Promise<void> }) {
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState('')

  const leaveAccount = async () => {
    if (leaving) return
    setLeaving(true)
    setError('')
    try {
      await onSignOut()
    } catch {
      setError('Не получилось выйти. Обнови страницу и попробуй ещё раз.')
      setLeaving(false)
    }
  }

  return (
    <main className="account-blocked-screen">
      <section className="account-blocked-card" aria-labelledby="account-blocked-title">
        <BrandLockup />
        <span>Доступ ограничен</span>
        <h1 id="account-blocked-title">Аккаунт временно заблокирован</h1>
        <p>{reason || 'Обратись в поддержку сервиса, чтобы уточнить причину и восстановить доступ.'}</p>
        {error && <p className="account-blocked-error" role="alert">{error}</p>}
        <button type="button" onClick={() => { void leaveAccount() }} disabled={leaving}>
          {leaving ? 'Выходим…' : 'Выйти из аккаунта'}
        </button>
      </section>
    </main>
  )
}

function HomePage() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const storedTheme = window.localStorage.getItem(themeStorageKey)
      if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme
    } catch {
      // The document theme remains the safe fallback when storage is unavailable.
    }
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  })
  const [activeNavigation, setActiveNavigation] = useState<NavigationLabel>(() => currentNavigationRoute().label)
  const [selectedTextbookId, setSelectedTextbookId] = useState<TextbookId>(() => {
    try {
      return window.localStorage.getItem(selectedTextbookStorageKey) || 'geometry'
    } catch {
      return 'geometry'
    }
  })
  const [customTextbooks] = useState<Textbook[]>([])
  const [solutionState, setSolutionState] = useState<SolutionState | null>(null)
  const [selectedSolution, setSelectedSolution] = useState<SolutionState | null>(() => currentNavigationRoute().solution)
  const [generatedSolutions, setGeneratedSolutions] = useState<HomeworkSolution[]>(loadGeneratedSolutions)
  const [sharedSolutions, setSharedSolutions] = useState<SharedHomeworkSolution[]>([])
  const [sharedSolutionsStatus, setSharedSolutionsStatus] = useState<'loading' | 'ready' | 'error'>(authIsConfigured ? 'loading' : 'ready')
  const [supabaseClient, setSupabaseClient] = useState<SupabaseClient<Database> | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [account, setAccount] = useState<AccountData | null>(null)
  const [authReady, setAuthReady] = useState(!authIsConfigured)
  const [accountReady, setAccountReady] = useState(!authIsConfigured)
  // `signin` приходит с витрины: там «Войти» должен открывать окно аккаунта,
  // а не высаживать человека на рабочую главную с просьбой поискать вход.
  const [accountOpen, setAccountOpen] = useState(() => ['reset', 'verified', 'confirm', 'signin'].includes(new URLSearchParams(window.location.search).get('auth') ?? ''))
  const [accountView, setAccountView] = useState<AccountView>('profile')
  const [passwordRecovery, setPasswordRecovery] = useState(() => new URLSearchParams(window.location.search).get('auth') === 'reset')
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState(() => sessionStorage.getItem('homework-copilot:google-verification-email') ?? '')
  const [accountNotice, setAccountNotice] = useState('')
  const [supportOpen, setSupportOpen] = useState(() => currentApplicationPath() === '/support')
  const [supportCategory, setSupportCategory] = useState<SupportCategory>('general')
  const [supportContext, setSupportContext] = useState<SupportPrefill | undefined>(undefined)
  const googleVerificationStarted = useRef(false)
  const emailConfirmationStarted = useRef(false)
  const accountTriggerRef = useRef<HTMLElement | null>(null)
  const supportReturnPathRef = useRef(currentApplicationPath() === '/support' ? '/app' : currentApplicationPath())
  const textbookObjectUrlsRef = useRef<string[]>([])
  const visibleGeneratedSolutions = useMemo(
    () => generatedSolutions.filter((solution) => (
      (!solution.ownerId || solution.ownerId === user?.id)
      && isReviewedHomeworkSolution(solution)
    )),
    [generatedSolutions, user?.id],
  )
  // Размеченные учебники идут первыми: по неразмеченному ученик всё равно
  // не получит решение, и держать его вперемешку с рабочими — вводить в
  // заблуждение. Свои загруженные книги — в конце, они всегда неразмечены.
  const availableTextbooks = useMemo(
    () => [...textbooks, ...customTextbooks].sort((left, right) => {
      if (Boolean(left.indexed) !== Boolean(right.indexed)) return left.indexed ? -1 : 1
      return left.subject.localeCompare(right.subject, 'ru-RU')
    }).map((textbook) => {
      const sharedTasks = sharedSolutions
        .filter((solution) => solution.textbook_id === textbook.id
          && solution.textbook_edition === textbook.edition
          && solution.source_url === textbook.sourceUrl)
        .map((solution) => solution.task)
      const generatedTasks = visibleGeneratedSolutions
        .filter((solution) => solution.textbookId === textbook.id && solution.source === 'number')
        .map((solution) => solution.task)
      if (generatedTasks.length === 0 && sharedTasks.length === 0) return textbook
      return {
        ...textbook,
        solvedTasks: [...new Set([...textbook.solvedTasks, ...sharedTasks, ...generatedTasks])],
      }
    }),
    [customTextbooks, sharedSolutions, visibleGeneratedSolutions],
  )
  const personalSolutions = useMemo<PersonalSolution[]>(
    () => user
      ? visibleGeneratedSolutions.map((solution) => ({
          mode: 'ready',
          textbookId: solution.textbookId,
          task: solution.task,
          source: solution.source,
          time: new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(solution.createdAt)),
        }))
      : [],
    [user, visibleGeneratedSolutions],
  )

  useEffect(() => {
    captureReferralFromCurrentUrl()
  }, [])

  useEffect(() => {
    if (!supabaseClient) return
    void preparePendingReferralClaim(supabaseClient).catch(() => undefined)
  }, [supabaseClient])

  useEffect(() => {
    const currentPath = currentApplicationPath()
    const normalizedPath = normalizeNavigationPath(currentPath)
    if (currentPath !== normalizedPath) {
      const currentUrl = new URL(window.location.href)
      currentUrl.pathname = applicationPath(normalizedPath)
      window.history.replaceState(window.history.state, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`)
    }

    const restoreNavigation = () => {
      const route = currentNavigationRoute()
      const currentPath = currentApplicationPath()
      const normalizedPath = normalizeNavigationPath(currentPath)
      if (currentPath !== normalizedPath) {
        const currentUrl = new URL(window.location.href)
        currentUrl.pathname = applicationPath(normalizedPath)
        window.history.replaceState(window.history.state, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`)
      }
      setActiveNavigation(route.label)
      setSelectedSolution(route.solution)
      setSupportOpen(currentPath === '/support')
    }

    window.addEventListener('popstate', restoreNavigation)
    return () => window.removeEventListener('popstate', restoreNavigation)
  }, [])

  useEffect(() => {
    const route = supportOpen
      ? '/support'
      : selectedSolution
        ? `/solutions/${encodeURIComponent(selectedSolution.textbookId)}/${encodeURIComponent(selectedSolution.task)}`
        : applicationRoutes.find((item) => item.label === activeNavigation)?.path ?? '/app'
    applySeoMetadata(getSeoMetadata(route, selectedSolution?.task))
  }, [activeNavigation, selectedSolution, supportOpen])

  useEffect(() => {
    if (!availableTextbooks.some((textbook) => textbook.id === selectedTextbookId)) {
      setSelectedTextbookId('geometry')
      return
    }
    try {
      window.localStorage.setItem(selectedTextbookStorageKey, selectedTextbookId)
    } catch {
      // The active book remains available for this session when storage is blocked.
    }
  }, [availableTextbooks, selectedTextbookId])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    try {
      window.localStorage.setItem(themeStorageKey, theme)
    } catch {
      // Keeping the active document theme is enough when storage is blocked.
    }
  }, [theme])

  useEffect(() => {
    saveGeneratedSolutions(generatedSolutions)
  }, [generatedSolutions])

  const refreshSharedSolutions = useCallback(async () => {
    if (!supabaseClient) return
    setSharedSolutionsStatus((current) => current === 'ready' ? current : 'loading')

    const { data, error } = await supabaseClient
      .from('homework_solution_catalog')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)

    if (error || !data) {
      setSharedSolutionsStatus('error')
      return
    }

    setSharedSolutions(data)
    setSharedSolutionsStatus('ready')
  }, [supabaseClient])

  useEffect(() => {
    if (!supabaseClient) return

    void refreshSharedSolutions()
    const onFocus = () => { void refreshSharedSolutions() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshSharedSolutions, supabaseClient])

  useEffect(() => {
    if (!supabaseClient || !user) return
    let active = true

    const restorePurchasedSolutions = async () => {
      const { data, error } = await supabaseClient.rpc('get_my_homework_solutions')

      if (!active || error || !data) return

      const restored = data
        .map(({ solution }) => parseStoredHomeworkSolution(solution, user.id))
        .filter((solution): solution is HomeworkSolution => solution !== null)

      setGeneratedSolutions((current) => [
        ...restored,
        ...current.filter((local) => !restored.some(
          (remote) => remote.textbookId === local.textbookId
            && remote.task === local.task
            && remote.textbookEdition === local.textbookEdition
            && remote.sourceUrl === local.sourceUrl
            && remote.conditionNormalized === local.conditionNormalized
            && remote.ownerId === local.ownerId,
        )),
      ])
    }

    void restorePurchasedSolutions()
    return () => { active = false }
  }, [supabaseClient, user])

  useEffect(() => {
    if (!supabaseClient || !user) return
    void recordPendingLegalAcceptance(supabaseClient, user.email)
  }, [supabaseClient, user])

  useEffect(() => {
    if (!supabaseClient || !user) return
    void bindPendingReferral(supabaseClient, user)
  }, [supabaseClient, user])

  useEffect(() => () => {
    if (typeof URL.revokeObjectURL !== 'function') return
    textbookObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  useEffect(() => {
    let active = true
    void import('./lib/supabase').then(({ supabase }) => {
      if (!active) return
      setSupabaseClient(supabase)
      if (!supabase) {
        setAuthReady(true)
        setAccountReady(true)
      }
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!supabaseClient) return
    let active = true

    void supabaseClient.auth.getSession().then(({ data }) => {
      if (!active) return
      const nextUser = data.session?.user ?? null
      setUser(nextUser)
      setAuthReady(true)
      if (!nextUser) setAccountReady(true)
    })

    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user ?? null
      setUser((current) => {
        if (current?.id !== nextUser?.id) setAccountReady(!nextUser)
        return nextUser
      })
      setAuthReady(true)
      if (!nextUser) {
        setAccount(null)
        setAccountReady(true)
      }
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true)
        setAccountOpen(true)
      }
      if (event === 'SIGNED_IN' && nextUser) {
        sessionStorage.removeItem('homework-copilot:google-auth-pending')
        sessionStorage.removeItem('homework-copilot:google-verification-email')
        sessionStorage.removeItem('homework-copilot:verification-email')
        sessionStorage.removeItem('homework-copilot:verification-kind')
        sessionStorage.removeItem('homework-copilot:verification-sent-at')
        setPendingVerificationEmail('')
        if (['verified', 'confirm'].includes(new URLSearchParams(window.location.search).get('auth') ?? '')) setAccountOpen(true)
      }
      if (event === 'SIGNED_OUT') {
        if (sessionStorage.getItem('homework-copilot:verification-email') || sessionStorage.getItem('homework-copilot:google-verification-email')) setAccountOpen(true)
        else setAccountOpen(false)
        setPasswordRecovery(false)
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [supabaseClient])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tokenHash = params.get('token_hash')
    if (!supabaseClient || params.get('auth') !== 'confirm' || !tokenHash || emailConfirmationStarted.current) return
    const authClient = supabaseClient
    emailConfirmationStarted.current = true
    let active = true

    const confirmEmail = async () => {
      const { error: confirmationError } = await authClient.auth.verifyOtp({ token_hash: tokenHash, type: 'email' })
      const cleanUrl = new URL(window.location.href)
      cleanUrl.searchParams.delete('auth')
      cleanUrl.searchParams.delete('token_hash')
      cleanUrl.searchParams.delete('type')
      window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`)

      if (!active) return
      setAccountNotice(confirmationError ? 'Ссылка устарела. Введи код из письма или запроси новый' : 'Почта подтверждена')
      setAccountOpen(true)
    }

    void confirmEmail()
    return () => { active = false }
  }, [supabaseClient])

  useEffect(() => {
    if (!supabaseClient || new URLSearchParams(window.location.search).get('auth') !== 'google-code' || googleVerificationStarted.current) return
    const authClient = supabaseClient
    googleVerificationStarted.current = true
    let active = true

    const requestGoogleCode = async () => {
      let session = null
      for (let attempt = 0; attempt < 20 && active; attempt += 1) {
        const { data } = await authClient.auth.getSession()
        session = data.session
        if (session?.user.email) break
        await new Promise((resolve) => window.setTimeout(resolve, 100))
      }
      const googleEmail = session?.user.email?.trim()
      if (!googleEmail) {
        if (active) {
          setAccountNotice('Google не вернул почту. Попробуй войти ещё раз')
          setAccountOpen(true)
        }
        return
      }

      rememberPendingLegalAcceptance('google', googleEmail)
      sessionStorage.setItem('homework-copilot:google-verification-email', googleEmail)
      const { error: codeError } = await authClient.auth.signInWithOtp({
        email: googleEmail,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/?auth=verified`,
        },
      })
      if (!codeError) {
        sessionStorage.setItem('homework-copilot:verification-email', googleEmail)
        sessionStorage.setItem('homework-copilot:verification-kind', 'google')
        sessionStorage.setItem('homework-copilot:verification-sent-at', String(Date.now()))
      }
      await authClient.auth.signOut({ scope: 'local' })

      const cleanUrl = new URL(window.location.href)
      cleanUrl.searchParams.delete('auth')
      window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`)

      if (!active) return
      setUser(null)
      setAccount(null)
      setPendingVerificationEmail(googleEmail)
      setAccountNotice(codeError ? 'Не получилось отправить письмо. Попробуй ещё раз' : '')
      setAccountOpen(true)
    }

    window.setTimeout(() => { void requestGoogleCode() }, 0)
    return () => { active = false }
  }, [supabaseClient])

  const refreshAccount = useCallback(async () => {
    if (!user) {
      setAccount(null)
      setAccountReady(true)
      return
    }
    try {
      const { loadAccountData } = await import('./lib/supabase')
      setAccount(await loadAccountData(user))
    } catch {
      setAccountNotice('Не получилось загрузить профиль. Попробуй открыть его ещё раз')
    } finally {
      setAccountReady(true)
    }
  }, [user])

  useEffect(() => {
    void refreshAccount()
  }, [refreshAccount])

  useEffect(() => {
    if (!supabaseClient || !user) return

    const accountChannel = supabaseClient
      .channel(`account-control:${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'wallet_accounts',
        filter: `user_id=eq.${user.id}`,
      }, () => { void refreshAccount() })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'account_controls',
        filter: `user_id=eq.${user.id}`,
      }, () => { void refreshAccount() })
      .subscribe()

    return () => { void supabaseClient.removeChannel(accountChannel) }
  }, [refreshAccount, supabaseClient, user])

  useEffect(() => {
    if (!supabaseClient || !user) return

    const currentPath = () => currentApplicationPath()
    const track = (event: 'session_started' | 'session_ended' | 'page_view') => {
      void supabaseClient.rpc('track_my_activity', { p_event: event, p_path: currentPath() })
    }
    const onVisibilityChange = () => {
      track(document.visibilityState === 'visible' ? 'session_started' : 'session_ended')
    }
    const onPageHide = () => track('session_ended')

    track('session_started')
    track('page_view')
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === 'visible') track('page_view')
    }, 5 * 60 * 1000)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)

    return () => {
      window.clearInterval(heartbeat)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onPageHide)
      track('session_ended')
    }
  }, [supabaseClient, user])

  const toggleTheme = () => setTheme((current) => current === 'light' ? 'dark' : 'light')
  const rememberAccountTrigger = () => {
    accountTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  const openAccount = () => {
    rememberAccountTrigger()
    setAccountNotice('')
    setAccountView('profile')
    setAccountOpen(true)
  }
  const openWallet = () => {
    rememberAccountTrigger()
    setAccountNotice('')
    setAccountView('wallet')
    setAccountOpen(true)
  }
  const closeAccount = useCallback(() => {
    setAccountOpen(false)
    setAccountNotice('')
    setPasswordRecovery(false)
    setPendingVerificationEmail('')
    sessionStorage.removeItem('homework-copilot:google-auth-pending')
    const cleanUrl = new URL(window.location.href)
    cleanUrl.searchParams.delete('auth')
    window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`)
  }, [])
  const openSupport = useCallback((nextCategory: SupportCategory = 'general', context?: SupportPrefill) => {
    const currentPath = currentApplicationPath()
    supportReturnPathRef.current = currentPath === '/support' ? '/app' : currentPath
    setSupportCategory(nextCategory)
    setSupportContext(context)
    setSupportOpen(true)
    if (currentPath !== '/support') window.history.pushState({ support: true }, '', applicationPath('/support'))
  }, [])
  const closeSupport = useCallback(() => {
    const returnPath = supportReturnPathRef.current || '/app'
    setSupportOpen(false)
    setSupportContext(undefined)
    if (currentApplicationPath() === '/support') {
      const nextPath = normalizeNavigationPath(returnPath)
      window.history.replaceState({}, '', applicationPath(nextPath))
      const route = currentNavigationRoute(nextPath)
      setActiveNavigation(route.label)
      setSelectedSolution(route.solution)
    }
  }, [])
  const signOutBlockedAccount = useCallback(async () => {
    if (!supabaseClient) return
    const { error } = await supabaseClient.auth.signOut({ scope: 'local' })
    if (error) throw error
  }, [supabaseClient])
  const navigate = (label: NavigationLabel, solution: SolutionState | null = null) => {
    const destination = applicationRoutes.find((item) => item.label === label)
    if (!destination) return
    const path = solution
      ? `/solutions/${encodeURIComponent(solution.textbookId)}/${encodeURIComponent(solution.task)}`
      : destination.path
    if (currentApplicationPath() !== path) window.history.pushState({}, '', applicationPath(path))
    setSelectedSolution(solution)
    setActiveNavigation(label)
  }
  const openSolution = (state: SolutionState) => navigate('Решения', state)

  // Переходник между формой и отправителем: форма отдаёт условие и фото,
  // остальное подставляется здесь.
  const submitFromForm = async (submission: TaskSubmission) => {
    const imageDataUrl = submission.photo ? await prepareTaskPhoto(submission.photo) : undefined
    return submitTask(
      submission.condition.slice(0, 60) || 'Задача с фото',
      true,
      submission.source,
      submission.idempotencyKey,
      undefined,
      undefined,
      submission.condition || undefined,
      imageDataUrl,
      selectedTextbookId,
      true,
      submission.subject,
      submission.grade,
    )
  }

  const submitTask = async (
    task: string,
    _ready: boolean,
    source: HomeworkSource,
    idempotencyKey: string,
    photo?: File,
    verifiedTask?: VerifiedTextbookTaskSource,
    confirmedCondition?: string,
    sourceImageDataUrl?: string,
    textbookId = selectedTextbookId,
    openWhenReady = true,
    // Предмет и класс приходят из формы. Если ученик их не указал, останутся
    // пустыми — тогда модель определит их сама по условию.
    subjectOverride?: string,
    gradeOverride?: string,
  ) => {
    const textbook = getTextbook(textbookId, availableTextbooks)
    const resolvedTask = source === 'photo'
      ? 'photo-' + idempotencyKey.replace(/[^a-z0-9-]/gi, '').slice(-44)
      : task
    const solutionPrice = getSolutionPrice()

    if (source === 'number' && !verifiedTask) {
      throw new Error('Точное условие задачи в выбранном издании не найдено. Решение не запускается')
    }
    if (supabaseClient && !user) {
      rememberAccountTrigger()
      setAccountNotice('Войди или зарегистрируйся, чтобы сохранить решение и списать его с баланса')
      setAccountOpen(true)
      return false
    }

    const previouslyGenerated = visibleGeneratedSolutions.find((solution) => (
      isReviewedHomeworkSolution(solution)
      &&
      solution.textbookId === textbookId
      && solution.task === resolvedTask
      && solution.source === source
      && solution.textbookEdition === textbook.edition
      && solution.sourceUrl === (verifiedTask?.sourceUrl ?? textbook.sourceUrl ?? '')
      && (!(verifiedTask?.condition ?? confirmedCondition) || solution.conditionNormalized === normalizeTaskCondition(verifiedTask?.condition ?? confirmedCondition ?? ''))
    ))
    if (previouslyGenerated) {
      const nextState: SolutionState = { mode: 'ready', textbookId, task: resolvedTask, source }
      setSolutionState(nextState)
      if (openWhenReady) openSolution(nextState)
      return true
    }

    if (supabaseClient && user && account && account.balance < solutionPrice) {
      rememberAccountTrigger()
      setAccountView('wallet')
      setAccountNotice(`На балансе меньше ${formatRubles(solutionPrice)}`)
      setAccountOpen(true)
      return false
    }

    const processingState: SolutionState = { mode: 'processing', textbookId, task: resolvedTask, source }
    const readyState: SolutionState = { ...processingState, mode: 'ready' }

    setSolutionState(processingState)

    try {
      const imageDataUrl = source === 'photo' && photo ? await prepareTaskPhoto(photo) : sourceImageDataUrl
      if (source === 'photo' && !imageDataUrl) throw new Error('Добавь фотографию задачи')
      if (source === 'number' && verifiedTask?.hasDiagram && !imageDataUrl) throw new Error('Не получилось загрузить чертёж из учебника')

      let accessToken: string | undefined
      if (supabaseClient && user) {
        const { data, error } = await supabaseClient.auth.getSession()
        accessToken = data.session?.access_token
        if (error || !accessToken) throw new Error('Сессия закончилась. Войди в аккаунт ещё раз')
      }

      const generatedSolution = await requestHomeworkSolution(
        import.meta.env.VITE_HOMEWORK_API_URL || applicationPath('/api/solve'),
        {
          textbookId,
          task: resolvedTask,
          source,
          subject: subjectOverride ?? textbook.subject,
          grade: gradeOverride ?? textbook.grade,
          textbookTitle: textbook.title,
          authors: textbook.authors,
          edition: textbook.edition,
          idempotencyKey,
          // Источник указываем, только если он есть. Раньше сюда подставлялась
          // строка-заглушка «photo», и в решении оставался несуществующий адрес.
          ...(verifiedTask?.sourceUrl ?? textbook.sourceUrl
            ? { sourceUrl: verifiedTask?.sourceUrl ?? textbook.sourceUrl }
            : {}),
          ...(verifiedTask || confirmedCondition ? {
            condition: verifiedTask?.condition ?? confirmedCondition,
            ...(verifiedTask?.sourcePage ? { sourcePage: verifiedTask.sourcePage } : {}),
          } : {}),
          ...(imageDataUrl ? { imageDataUrl } : {}),
        },
        accessToken,
      )

      setGeneratedSolutions((current) => [
        generatedSolution,
        ...current.filter(
          (entry) => entry.textbookId !== textbookId
            || entry.task !== resolvedTask
            || entry.source !== generatedSolution.source
            || entry.textbookEdition !== generatedSolution.textbookEdition
            || entry.conditionNormalized !== generatedSolution.conditionNormalized
            || entry.ownerId !== generatedSolution.ownerId,
        ),
      ])
      setSolutionState(readyState)
      if (supabaseClient && user) await Promise.all([refreshAccount(), refreshSharedSolutions()])
      if (openWhenReady) openSolution(readyState)
      return true
    } catch (error) {
      setSolutionState({
        ...processingState,
        mode: 'error',
        error: error instanceof Error ? error.message : 'Не получилось подготовить решение',
      })
      return false
    }
  }

  // Открыть форму с уже выбранным предметом. Номер задачи больше не поле
  // поиска, поэтому переносим только предмет.
  const checkTextbookTask = (textbookId: TextbookId) => {
    setSelectedTextbookId(textbookId)
    navigate('Главная')
  }
  const openSharedSolution = (textbookId: TextbookId, task: string) => {
    const availableSolution = findAvailableNumberSolution(visibleGeneratedSolutions, textbookId, task)
    if (availableSolution) {
      openSolution({ mode: 'ready', textbookId, task, source: 'number' })
      return
    }
    checkTextbookTask(textbookId)
  }

  if (!authReady || (user && !accountReady)) {
    return (
      <main className="session-loading-screen" aria-label="Загружаем аккаунт" aria-busy="true">
        <BrandLockup />
        <SpinnerGap size={24} weight="bold" aria-hidden="true" />
      </main>
    )
  }

  if (user && account?.control?.is_banned) {
    return <AccountBlockedScreen reason={account.control.ban_reason} onSignOut={signOutBlockedAccount} />
  }

  return (
    <main className="product-shell">
      <ProductTopbar theme={theme} activeLabel={activeNavigation} onNavigate={navigate} onToggleTheme={toggleTheme} user={user} account={account} onOpenAccount={openAccount} onOpenWallet={openWallet} />
      <div className="product-content">
        <div className="product-route">
          {activeNavigation === 'Главная' && <PageHeader account={account} />}
          {activeNavigation === 'Главная' ? (
            <div className="home-content">
              <CopyTask onSubmit={submitFromForm} />
              <div className="home-grid">
                <div className="home-column home-column-primary">
                  {solutionState && <SolutionStatus state={solutionState} textbooks={availableTextbooks} onOpenSolution={openSolution} />}
                  {user ? <MySolutions items={personalSolutions} onOpenAll={() => navigate('Решения')} onOpenSolution={openSolution} /> : <GuestWorkspace onOpenAccount={openAccount} />}
                </div>
                <div className="home-column home-column-secondary">
                  <BaseShortcut onOpenBase={() => navigate('Решения')} />
                </div>
              </div>
            </div>
          ) : selectedSolution ? (
            <UnderstandingPage
              solution={selectedSolution}
              generatedSolution={visibleGeneratedSolutions.find(
                (solution) => solution.textbookId === selectedSolution.textbookId && solution.task === selectedSolution.task,
              )}
              onGoHome={() => navigate('Главная')}
              onOpenSupport={(context) => openSupport('wrong_solution', context)}
            />
          ) : activeNavigation === 'ИИ-чат' ? (
            <Suspense fallback={<div className="route-loading" role="status">Загружаем чат…</div>}><ChatPage userId={user?.id ?? null} onRequireAuth={openAccount} onOpenWallet={openWallet} /></Suspense>
          ) : activeNavigation === 'Расписание' ? (
            <Suspense fallback={<div className="route-loading" role="status">Загружаем расписание…</div>}><SchedulePage userId={user?.id ?? null} grade={account?.profile.grade ?? 8} /></Suspense>
          ) : activeNavigation === 'Решения' ? (
            <SolutionsPage
              user={user}
              personalSolutions={personalSolutions}
              textbooks={availableTextbooks}
              sharedSolutions={sharedSolutions}
              sharedSolutionsStatus={sharedSolutionsStatus}
              onOpenAccount={openAccount}
              onOpenSolution={openSolution}
              onOpenSharedSolution={openSharedSolution}
              onRefreshSharedSolutions={() => { void refreshSharedSolutions() }}
            />
          ) : (
            <CdzComingSoon onGoHome={() => navigate('Главная')} />
          )}
        </div>
        <SiteFooter onOpenSupport={() => openSupport()} />
      </div>
      <SupportLauncher onClick={() => openSupport()} />
      {supportOpen && createPortal(
        <SupportCenter user={user} supabaseClient={supabaseClient} initialCategory={supportCategory} initialContext={supportContext} onRequireAuth={openAccount} onClose={closeSupport} />,
        document.body,
      )}
      {accountOpen && (
        <Suspense fallback={null}>
          <AccountDialog
            user={user}
            account={account}
            passwordRecovery={passwordRecovery}
            pendingVerificationEmail={pendingVerificationEmail}
            notice={accountNotice}
            initialView={accountView}
            theme={theme}
            onToggleTheme={toggleTheme}
            onClose={closeAccount}
            onReloadAccount={refreshAccount}
            returnFocusRef={accountTriggerRef}
          />
        </Suspense>
      )}
    </main>
  )
}

function App() {
  const params = new URLSearchParams(window.location.search)
  const pathname = currentApplicationPath()

  // Инструменты разработки не должны открываться на проде по угадываемой ссылке.
  if (import.meta.env.DEV) {
    if (params.get('canvas') === '1') {
      return <Suspense fallback={null}><NotebookCanvas /></Suspense>
    }

    if (params.get('design-system') === '1') {
      return <Suspense fallback={null}><DesignSystemPlayground /></Suspense>
    }
  }

  // `/` — публичная витрина, рабочая главная переехала на `/app`.
  if (pathname === '/') return <><LandingPage /><PrivacyNotice /></>
  if (pathname === '/privacy') return <><LegalPage kind="privacy" /><PrivacyNotice /></>
  if (pathname === '/terms' || pathname === '/agreement') return <><LegalPage kind="terms" /><PrivacyNotice /></>
  if (pathname === '/consent') return <><LegalPage kind="consent" /><PrivacyNotice /></>
  if (pathname === '/cookies') return <><LegalPage kind="cookies" /><PrivacyNotice /></>
  if (pathname === '/offer') return <><LegalPage kind="offer" /><PrivacyNotice /></>

  if (pathname === '/admin') {
    return <Suspense fallback={null}><AdminDashboard /></Suspense>
  }

  return <><HomePage /><PrivacyNotice /></>
}

export default App
