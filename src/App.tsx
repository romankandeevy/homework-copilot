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
  Dna,
  Flask,
  Function,
  Globe,
  Planet,
  Scroll,
  TextAa,
  House,
  MagnifyingGlass,
  Moon,
  Notebook,
  SpinnerGap,
  Stack,
  Sun,
  UserCircle,
  WarningCircle,
} from '@phosphor-icons/react'
import CopyTask from './CopyTask'
import type { TaskSubmission } from './CopyTask'
import { applicationPath, currentApplicationPath } from './lib/appPath'
import { keyed } from './lib/listKeys'
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
import { forgetGuestSolution, getGuestId, guestSolutionUsed, rememberGuestSolutionUsed } from './lib/guestSolutions'
import { applySeoMetadata, getSeoMetadata } from './lib/siteMetadata'
import { getSolutionPrice } from './lib/solutionPricing'
import { findSubjectByName } from './lib/subjects'
import {
  isCurrentEngineSolution,
  isReviewedHomeworkSolution,
  loadGeneratedSolutions,
  parseStoredHomeworkSolution,
  prepareTaskPhoto,
  requestHomeworkSolution,
  SolutionConnectionLostError,
  saveGeneratedSolutions,
} from './lib/homeworkSolution'
import { normalizeTaskCondition } from './textbooks/taskCatalog'
import {
  findPendingSolution,
  forgetPendingSolution,
  savePendingSolution,
  type PendingSolution,
} from './lib/pendingSolutions'
import {
  closeSolutionJob,
  fetchGuestSolution,
  getDeviceId,
  isActiveJob,
  listSolutionJobs,
  mergeJobs,
  nextRunnableJob,
  startSolutionJob,
} from './lib/solutionJobs'
import type { SolutionJob } from './lib/solutionJobs'
import { SolutionQueue } from './solution/SolutionQueue'
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

/* Открытое решение. Ход работы сюда больше не входит: он живёт строкой
   очереди в базе, одинаковой для всех устройств ученика. */
type SolutionState = {
  mode: 'ready'
  textbookId: TextbookId
  task: string
  source: HomeworkSource
}

type PersonalSolution = SolutionState & {
  time: string
}

const themeStorageKey = 'homework-copilot:theme'
const selectedTextbookStorageKey = 'homework-copilot:selected-textbook'
const dismissedJobsStorageKey = 'homework-copilot:dismissed-jobs-v1'

/* Сколько задач решается одновременно.

   Очередь, а не залп: каждое решение — это два параллельных вызова модели, и
   вчетвером они упираются в ограничения провайдера, из-за которых задача
   возвращается с «модель перегружена». Две в работе, остальные ждут — так
   три задачи расходятся быстрее, чем по одной, и ни одна не отваливается. */
const solveConcurrency = 2

// Закрытые карточки — дело вкладки, а не общей очереди: строка задачи в базе
// остаётся, чтобы на другом устройстве результат никуда не делся.
function loadDismissedJobs(): string[] {
  try {
    const stored = window.localStorage.getItem(dismissedJobsStorageKey)
    const parsed: unknown = stored ? JSON.parse(stored) : []
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

function saveDismissedJobs(keys: readonly string[]) {
  try {
    window.localStorage.setItem(dismissedJobsStorageKey, JSON.stringify(keys.slice(0, 60)))
  } catch {
    // Скрытая карточка вернётся после перезахода — это лучше, чем упасть.
  }
}

// Задача, о которой знает только эта вкладка: база недоступна или ещё не
// ответила. Форма и очередь должны работать и в этом случае.
function localSolutionJob(input: {
  idempotencyKey: string
  textbookId: string
  task: string
  source: HomeworkSource
  subject: string
  grade: string
  conditionPreview: string
  deviceId: string
}): SolutionJob {
  const now = new Date().toISOString()
  return {
    id: `local-${input.idempotencyKey}`,
    idempotencyKey: input.idempotencyKey,
    deviceId: input.deviceId,
    textbookId: input.textbookId,
    task: input.task,
    source: input.source,
    subject: input.subject,
    grade: input.grade,
    conditionPreview: input.conditionPreview,
    status: 'queued',
    stage: 'queued',
    error: '',
    createdAt: now,
    updatedAt: now,
    startedAt: '',
    finishedAt: '',
  }
}


/* Сколько ждём молчащего решателя, прежде чем признать задачу сорванной.
   Его собственный бюджет — 230 секунд (server/homeworkSolver.ts), здесь запас
   поверх него на сохранение решения и ответ. */
const silentSolverLimitMs = 300_000

const applicationRoutes = [
  { label: 'Главная', path: '/app', icon: House },
  { label: 'Решения', path: '/solutions', icon: Notebook },
  { label: 'ЦДЗ', path: '/cdz', icon: Stack },
  { label: 'ИИ-чат', path: '/chat', icon: ChatsCircle },
  { label: 'Расписание', path: '/schedule', icon: CalendarDots },
] as const

// В основном меню только то, что уже работает. «ЦДЗ» пока закрыт: пункт
// занимал место, забирал клик и ничего не отдавал. Маршрут остаётся рабочим
// и доступен из подвала, поэтому мёртвых ссылок не появляется.
const navigation = applicationRoutes.filter(({ label }) => label !== 'ЦДЗ')

type NavigationLabel = (typeof applicationRoutes)[number]['label']

function currentNavigationRoute(pathname = window.location.pathname): { label: NavigationLabel; solution: SolutionState | null } {
  const path = currentApplicationPath(pathname)
  if (path === '/textbooks' || path === '/tasks') return { label: 'ЦДЗ', solution: null }
  if (path === '/base') return { label: 'Решения', solution: null }
  // `/main` — прежний адрес рабочей главной. Ссылки на него уже разошлись,
  // поэтому он продолжает открывать приложение и лишь переписывается на `/app`.
  if (path === '/main') return { label: 'Главная', solution: null }
  const destination = applicationRoutes.find((item) => item.path === path)
  if (destination) return { label: destination.label, solution: null }

  // Подпись задачи — не только номер: у решения по вписанному условию это
  // срез самого условия. Раньше такой адрес не распознавался, и перезагрузка
  // страницы текстового решения уводила на главную.
  const solutionMatch = path.match(/^\/solutions\/([^/]+)\/([^/]+)$/i)
  if (solutionMatch) {
    const task = decodeURIComponent(solutionMatch[2])
    return {
      label: 'Решения',
      solution: {
        mode: 'ready',
        textbookId: decodeURIComponent(solutionMatch[1]),
        task,
        source: task.startsWith('photo-')
          ? 'photo'
          : /^\d{1,4}(\.\d{1,3}){0,2}$/.test(task) ? 'number' : 'text',
      },
    }
  }

  return { label: 'Главная', solution: null }
}

/* Адреса, которые приложение действительно обслуживает. Всё остальное —
   404, а не тихая главная. Легальные страницы и витрина разбираются выше,
   в `App`, поэтому в списке их нет. */
const knownApplicationPaths = new Set([
  // `/` попадает сюда с возврата авторизации: витрина отдаёт его приложению,
  // а `normalizeNavigationPath` переписывает на `/app`.
  '/', '/app', '/main', '/solutions', '/base', '/cdz', '/tasks', '/textbooks',
  '/chat', '/schedule', '/support',
])

function isKnownApplicationPath(pathname: string) {
  return knownApplicationPaths.has(pathname) || /^\/solutions\/[^/]+\/[^/]+$/i.test(pathname)
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
    grade: '5–11 класс',
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
    grade: '5–11 класс',
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
    grade: '5–11 класс',
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
    grade: '5–11 класс',
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
    grade: '5–11 класс',
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
    grade: '5–11 класс',
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
    grade: '5–11 класс',
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
    grade: '5–11 класс',
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
    grade: '5–11 класс',
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
    grade: '5–11 класс',
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
    grade: '5–11 класс',
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
    grade: '5–11 класс',
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
    grade: '5–11 класс',
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
    grade: '5–11 класс',
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
      <a
        className="topbar-brand"
        href={applicationPath('/app')}
        onClick={(event) => {
          if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
          event.preventDefault()
          onNavigate('Главная')
        }}
      >
        <BrandLockup />
      </a>

      <nav className="product-navigation" aria-label="Основная навигация">
        {navigation.map(({ label, path, icon: Icon }) => {
          const active = label === activeLabel
          return (
            <a
              className={`navigation-item${active ? ' is-active' : ''}`}
              key={label}
              href={applicationPath(path)}
              aria-current={active ? 'page' : undefined}
              onClick={(event) => {
                // Обычный клик уводит роутером, а Ctrl, Cmd, средняя кнопка
                // и «открыть в новой вкладке» работают как у любой ссылки.
                if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
                event.preventDefault()
                onNavigate(label)
              }}
            >
              <Icon size={19} weight="duotone" aria-hidden="true" />
              <span className="navigation-label">{label}</span>
            </a>
          )
        })}
      </nav>

      <div className="topbar-actions">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        {user && <BalanceControl balance={account?.balance ?? null} onOpenWallet={onOpenWallet} />}
        <ProfileButton user={user} account={account} onClick={onOpenAccount} />
      </div>
    </header>
  )
}

function BalanceControl({ balance, onOpenWallet }: { balance: number | null; onOpenWallet: () => void }) {
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

function GuestSolutionsNote({ onOpenAccount, freeSolutionUsed = false }: { onOpenAccount: () => void; freeSolutionUsed?: boolean }) {
  return (
    <p className="home-guest-note">
      <button type="button" onClick={onOpenAccount}>
        {freeSolutionUsed
          ? 'Бесплатное решение использовано. Зарегистрируйся и получи 20 ₽'
          : 'Войти, чтобы сохранять решения'}
        <ArrowRight size={16} weight="bold" aria-hidden="true" />
      </button>
    </p>
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
              <span><small>{textbook.subject}</small><strong>{source === 'number' ? `№ ${task}` : task}</strong></span>
              <time>{time}</time>
              <ArrowRight size={18} weight="bold" aria-hidden="true" />
            </button>
          )
        })}
      </div> : <p className="collection-empty">Пока здесь пусто. Первое решение появится после запроса.</p>}
    </section>
  )
}

/* Личная история решений.

   Общей базы здесь больше нет. Она пополнялась только решениями по номеру
   из размеченного учебника, а индекс учебников удалён: в каталоге не
   прибавилось ни одной записи с 28 августа и не могло прибавиться. Раздел
   занимал вкладку, поиск и карточку на главной, и ничего не отдавал. */
function SolutionsPage({
  user,
  personalSolutions,
  textbooks: items,
  onOpenAccount,
  onOpenSolution,
  onStartTask,
}: {
  user: User | null
  personalSolutions: readonly PersonalSolution[]
  textbooks: readonly Textbook[]
  onOpenAccount: () => void
  onOpenSolution: (state: SolutionState) => void
  onStartTask: () => void
}) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase('ru')
  const matches = (textbook: Textbook, task: string) => `${textbook.subject} ${task}`.toLocaleLowerCase('ru').includes(normalizedQuery)
  const personalResults = personalSolutions.filter(({ textbookId, task }) => matches(getTextbook(textbookId, items), task))
  const hasSolutions = personalSolutions.length > 0

  return (
    <section className="route-page solutions-page" aria-labelledby="solutions-page-title">
      <header className="route-page-header">
        <h1 id="solutions-page-title">Мои решения</h1>
        <p>Задачи, которые ты уже решил. Открыть любую можно снова и бесплатно.</p>
      </header>

      {/* Поиск появляется, когда есть в чём искать. */}
      {user && hasSolutions && (
        <label className="route-search" htmlFor="solutions-search">
          <MagnifyingGlass size={20} weight="duotone" aria-hidden="true" />
          <span>Найти решение</span>
          <input
            id="solutions-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Предмет или слово из условия"
            autoComplete="off"
          />
        </label>
      )}

      {!user ? <GuestSolutionsNote onOpenAccount={onOpenAccount} />
        : personalResults.length > 0 ? (
          <div className="solution-list route-solution-list">
            {personalResults.map(({ textbookId, task, time, mode, source }) => {
              const textbook = getTextbook(textbookId, items)
              const Icon = textbook.icon
              return (
                <button type="button" key={`${textbookId}-${task}-${time}`} onClick={() => onOpenSolution({ textbookId, task, mode, source })}>
                  <Icon size={32} weight="duotone" aria-hidden="true" />
                  <span><small>{textbook.subject}</small><strong>{source === 'number' ? `№ ${task}` : task}</strong></span>
                  <time>{time}</time>
                  <ArrowRight size={18} weight="bold" aria-hidden="true" />
                </button>
              )
            })}
          </div>
        ) : hasSolutions ? (
          <section className="route-empty" aria-labelledby="solutions-empty-title">
            <MagnifyingGlass size={34} weight="duotone" aria-hidden="true" />
            <div>
              <h2 id="solutions-empty-title">По запросу «{query.trim()}» ничего нет</h2>
              <p>Попробуй другой предмет или слово из условия.</p>
            </div>
          </section>
        ) : (
          <section className="route-empty" aria-labelledby="solutions-empty-title">
            <Notebook size={34} weight="duotone" aria-hidden="true" />
            <div>
              <h2 id="solutions-empty-title">Решений пока нет</h2>
              <p>Отправь задачу с главной — она появится здесь и останется в истории.</p>
              <button className="route-secondary-action" type="button" onClick={onStartTask}>Решить задачу</button>
            </div>
          </section>
        )}
    </section>
  )
}

function asGeometryNotebookSpec(
  solution: HomeworkSolution,
  sourceDiagram?: GeometryNotebookPageSpec['sourceDiagram'],
): GeometryNotebookPageSpec {
  return {
    id: 'generated-' + solution.textbookId + '-' + solution.task,
    // Номер печатается только у задачи из учебника. У задачи с фотографии
    // или из своего условия номера нет: в `task` лежит начало условия, и на
    // листе получалось «№ В прямоугольном треугольнике ABC угол», обрезанное
    // краем страницы.
    ...(solution.source === 'number' ? { number: solution.task } : {}),
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
  guestOffer,
  onOpenAccount,
}: {
  solution: SolutionState | null
  generatedSolution?: HomeworkSolution
  onGoHome: () => void
  onOpenSupport: (context: SupportPrefill) => void
  /** Решение получено без аккаунта: оно лежит только в этом браузере. */
  guestOffer: boolean
  onOpenAccount: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
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
      ...(explanationLines.length > 0 ? ['Как это решается:', ...explanationLines.map((line) => '- ' + line)] : []),
      ...(source.given.length > 0 ? ['Дано:', ...source.given] : []),
      source.goal.title + ': ' + source.goal.text,
      'Решение:',
      // Копия уходит в тетрадь той же записью, что и на листе: с номерами
      // шагов и без модельной нумерации внутри строки.
      ...source.steps.map((step, index) => `${index + 1}) ${step.replace(/^\s*\d{1,2}[).]\s*/u, '')}`),
      ...(source.answer ? ['Ответ: ' + source.answer] : []),
    ].join('\n')

    /* Clipboard API есть не везде: он требует защищённого соединения и
       разрешения. Раньше кнопка в таком случае молчала — человек жал и не
       понимал, скопировалось ли. Запасной путь — скрытое поле и execCommand,
       а если и он не сработал, говорим прямо. */
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value)
      else if (!copyThroughSelection(value)) throw new Error('clipboard unavailable')
      setCopied(true)
      setCopyFailed(false)
    } catch {
      setCopied(false)
      setCopyFailed(true)
    }
  }

  /* Подпись «Скопировано» сбрасывается сама: раньше она оставалась навсегда,
     и следующее нажатие выглядело так, будто ничего не произошло. */
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  const disclaimer = (
    <p className="solution-disclaimer">Решение помогает разобраться. Проверь ответ перед сдачей.</p>
  )

  /* Разбор идёт до готовой записи, а не после неё.

     Мы продаём «сфоткал и понял», а не «сфоткал и списал»: сервис, который
     выдаёт только готовый лист, платёжные системы отказываются подключать,
     и по делу — списывание это и есть. Поэтому первым на странице стоит
     объяснение обычными словами, и только под ним лист для тетради. */
  const explanationLines = generatedSolution?.explanation ?? []
  const explanation = explanationLines.length > 0 ? (
    <section className="solution-explanation" aria-labelledby="solution-explanation-title">
      <h2 id="solution-explanation-title">Как это решается</h2>
      <ol>
        {keyed(explanationLines, (line) => line).map(({ key, item: line }) => <li key={key}>{line}</li>)}
      </ol>
    </section>
  ) : null

  // Гостю говорим правду о том, где лежит решение, и что он получит за вход.
  const guestInvite = guestOffer ? (
    <section className="solution-guest-offer" aria-labelledby="solution-guest-offer-title">
      <div>
        <h2 id="solution-guest-offer-title">Это решение хранится только в этом браузере</h2>
        <p>Зарегистрируйся — оно останется в аккаунте, а на счёт придут 20 ₽. Это ещё четыре решения.</p>
      </div>
      <button className="route-primary-action" type="button" onClick={onOpenAccount}>
        Сохранить решение
        <ArrowRight size={18} weight="bold" aria-hidden="true" />
      </button>
    </section>
  ) : null

  const actions = (
    <div className="solution-actions">
      {(notebookFixture || generatedSolution) && (
        <button className="route-primary-action" type="button" onClick={() => { void copySolution() }}>
          {copied ? 'Скопировано' : copyFailed ? 'Не скопировалось — выдели и скопируй сам' : 'Скопировать решение'}
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
          <h1 id="understanding-page-title">{solution?.source === 'number' ? 'Решение № ' + notebookFixture.number : solution?.source === 'photo' ? 'Решение по фото' : 'Решение задачи'}</h1>
          <p>Готовый лист для тетради. Проверь условие перед тем, как переписывать ответ.</p>
        </header>
        {generatedSolution && (
          <div className="solution-condition">
            <strong>Условие</strong>
            <p>{generatedSolution.condition}</p>
          </div>
        )}
        {explanation}
        <div className="solution-notebook-preview"><GeometryNotebookLayoutV1 spec={notebookFixture} /></div>
        {disclaimer}
        {guestInvite}
        {generatedSolution?.verification && <SolutionVerificationPanel verification={generatedSolution.verification} />}
        {actions}
      </section>
    )
  }

  if (generatedSolution) {
    return (
      <section className="route-page solution-view" aria-labelledby="understanding-page-title">
        <header className="route-page-header">
          <h1 id="understanding-page-title">{solution?.source === 'number' ? 'Решение № ' + generatedSolution.task : solution?.source === 'photo' ? 'Решение по фото' : 'Решение задачи'}</h1>
          <p>{generatedSolution.subject}. Готовая запись для тетради.</p>
        </header>
        <div className="solution-condition">
          <strong>Условие</strong>
          <p>{generatedSolution.condition}</p>
        </div>
        {explanation}
        {/* Решение оформлено тетрадной страницей — той же, что обещана на
            витрине: бумага, клетка, красное поле, рукописная гарнитура.
            У геометрии эту роль играет GeometryNotebookLayoutV1, здесь —
            лёгкая HTML-версия для остальных предметов. */}
        <article className="notebook-sheet" aria-label="Готовая запись для тетради">
          <span className="notebook-sheet-grid" aria-hidden="true" />
          <span className="notebook-sheet-margin" aria-hidden="true" />
          <div className="notebook-sheet-body">
            {generatedSolution.given.length > 0 && (
              <section className="notebook-sheet-given">
                <h2>Дано:</h2>
                {keyed(generatedSolution.given, (line) => line).map(({ key, item: line }) => <p key={key}>{line}</p>)}
              </section>
            )}
            <section className="notebook-sheet-goal">
              <h2>{generatedSolution.goal.title}:</h2>
              <p>{generatedSolution.goal.text}</p>
            </section>
            <span className="notebook-sheet-divider" aria-hidden="true" />
            <section className="notebook-sheet-steps">
              {/* У доказательства в тетради пишут «Доказательство»: по
                  заголовку видно, что от записи требуется. */}
              <h2>{generatedSolution.goal.title === 'Доказать' ? 'Доказательство' : 'Решение'}</h2>
              <ol>
                {keyed(generatedSolution.steps, (step) => step).map(({ key, item: step }) => (
                  // Нумерацию ставит страница, поэтому свою — из модели —
                  // с шага снимаем, чтобы не выходило «1) 1) …».
                  <li key={key}>{step.replace(/^\s*\d{1,2}[).]\s+/u, '')}</li>
                ))}
              </ol>
            </section>
            {generatedSolution.analysis && (
              <section className="notebook-sheet-analysis">
                <WrittenAnalysis analysis={generatedSolution.analysis} />
              </section>
            )}
            {generatedSolution.answer && (
              <section className="notebook-sheet-answer">
                <h2>Ответ:</h2>
                <p>{generatedSolution.answer}</p>
              </section>
            )}
          </div>
        </article>
        {disclaimer}
        {guestInvite}
        {generatedSolution.verification && <SolutionVerificationPanel verification={generatedSolution.verification} />}
        {actions}
      </section>
    )
  }

  return (
    <section className="route-page" aria-labelledby="understanding-page-title">
      <header className="route-page-header">
        <h1 id="understanding-page-title">Решение не открылось</h1>
        <p>По этому адресу решения нет — оно не сохранено в этом браузере и не привязано к твоему аккаунту.</p>
      </header>
      {/* Сюда попадают по прямой ссылке на решение, которого нет ни в этом
          браузере, ни в аккаунте: чужая ссылка, очищенное хранилище, решение
          гостя старше недели. Прежний текст звал выбрать учебник и обещал
          общую базу — обеих функций в продукте давно нет. */}
      <div className="understanding-flow is-single">
        <section><Notebook size={30} weight="duotone" aria-hidden="true" /><h2>Решение не нашлось</h2><p>Оно хранится в аккаунте того, кто его запросил. Если это твоя задача — войди тем же аккаунтом; если нет — реши её заново, это займёт около минуты.</p></section>
      </div>
      <button className="route-primary-action" type="button" onClick={onGoHome}>← На главную <House size={18} weight="bold" aria-hidden="true" /></button>
    </section>
  )
}

/* Адрес, которого в приложении нет.

   Раньше любой такой путь молча показывал главную и оставлял мусорный адрес
   в строке браузера: опечатка в ссылке выглядела как рабочая страница, а её
   потом ещё и пересылали. */
/* Копирование там, где Clipboard API недоступен: временное поле, выделение,
   execCommand. Способ устаревший, но он работает и на HTTP, и в старых
   браузерах телефона. */
function copyThroughSelection(value: string) {
  try {
    const field = document.createElement('textarea')
    field.value = value
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.append(field)
    field.select()
    const copied = document.execCommand('copy')
    field.remove()
    return copied
  } catch {
    return false
  }
}

/* Страницы нет — и сказано это тем же языком, что и всё остальное в
   продукте: тетрадной записью. Номер задачи перечёркнут красным, дальше
   «Дано», «Найти», ход и ответ. Кнопки лежат под листом, а не на нём:
   в тетради кнопок не бывает.

   Адрес показывается настоящий — по нему человек и узнаёт свою опечатку.
   Длинный обрезаем: в строку тетради он всё равно не помещается. */
function NotFoundScreen({ onGoHome }: { onGoHome: () => void }) {
  const missingPath = currentApplicationPath()
  const shownPath = missingPath.length > 48 ? `${missingPath.slice(0, 48)}…` : missingPath

  return (
    <section className="route-page not-found" aria-labelledby="not-found-title">
      {/* Заголовок страницы говорит правду голосом, а не почерком: на листе
          написано «Решение», и читалке этого мало. */}
      <h1 id="not-found-title" className="sr-only">Страница не найдена</h1>
      <article className="notebook-sheet not-found-sheet">
        <span className="notebook-sheet-grid" aria-hidden="true" />
        <span className="notebook-sheet-margin" aria-hidden="true" />
        <div className="notebook-sheet-body">
          <p className="not-found-number">
            <span className="not-found-number-strike">№ 404</span>
          </p>

          <section className="notebook-sheet-given">
            <h2>Дано:</h2>
            <p className="not-found-path">{shownPath}</p>
          </section>
          <p className="notebook-sheet-goal">
            <strong>Найти:</strong> страницу, которая была нужна
          </p>

          <span className="notebook-sheet-divider" aria-hidden="true" />

          <div className="notebook-sheet-steps">
            <h2>Решение</h2>
            <ol>
              <li>Такого адреса в Homework Copilot нет: чаще всего в нём опечатка или ссылка устарела.</li>
              <li>Задачу это не отменяет — условие приносится заново на главной.</li>
            </ol>
          </div>

          <p className="notebook-sheet-answer">
            <strong>Ответ:</strong> страницы нет, задача решается.
          </p>
        </div>
      </article>

      <div className="not-found-actions">
        <button className="route-primary-action" type="button" onClick={onGoHome}>
          <House size={18} weight="duotone" aria-hidden="true" />
          Списать задачу
        </button>
        <a className="route-secondary-action" href={applicationPath('/')}>О сервисе</a>
      </div>
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
  const [guestFreeSolutionUsed, setGuestFreeSolutionUsed] = useState(guestSolutionUsed)
  // Очередь задач. `remoteJobs` — строки из базы, общие для всех устройств;
  // `localJobs` — то, о чём эта вкладка узнала раньше базы.
  const [remoteJobs, setRemoteJobs] = useState<SolutionJob[]>([])
  const [localJobs, setLocalJobs] = useState<SolutionJob[]>([])
  const [dismissedJobKeys, setDismissedJobKeys] = useState<readonly string[]>(loadDismissedJobs)
  const [dispatchTick, setDispatchTick] = useState(0)
  const runningJobKeysRef = useRef(new Set<string>())
  const refundedJobKeysRef = useRef(new Set<string>())
  const restoredJobKeysRef = useRef(new Set<string>())
  const deviceIdRef = useRef('')
  if (!deviceIdRef.current) deviceIdRef.current = getDeviceId()
  /* Запрос этой вкладки держим ещё и в памяти. localStorage бывает полон или
     закрыт — фотография весит мегабайты, — и тогда задача, поставленная
     только что здесь же, падала как «страница закрылась раньше». */
  const pendingPayloadsRef = useRef(new Map<string, PendingSolution>())
  const [selectedSolution, setSelectedSolution] = useState<SolutionState | null>(() => currentNavigationRoute().solution)
  const [generatedSolutions, setGeneratedSolutions] = useState<HomeworkSolution[]>(loadGeneratedSolutions)
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
  // Сообщение над очередью: то, что случилось с задачей, а не с аккаунтом.
  const [queueNotice, setQueueNotice] = useState('')
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
    () => {
      const sorted = [...textbooks, ...customTextbooks].sort((left, right) => {
        if (Boolean(left.indexed) !== Boolean(right.indexed)) return left.indexed ? -1 : 1
        return left.subject.localeCompare(right.subject, 'ru-RU')
      })
      // Учебник пришёл из состояния — правка на месте испортила бы его источник.
      // eslint-disable-next-line no-map-spread
      return sorted.map((textbook) => {
        const generatedTasks = visibleGeneratedSolutions
          .filter((solution) => solution.textbookId === textbook.id && solution.source === 'number')
          .map((solution) => solution.task)
        if (generatedTasks.length === 0) return textbook
        return {
          ...textbook,
          solvedTasks: [...new Set([...textbook.solvedTasks, ...generatedTasks])],
        }
      })
    },
    [customTextbooks, visibleGeneratedSolutions],
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

  /* Очередь, которую видит ученик.

     Готовые и сорвавшиеся карточки живут шесть часов: дольше они уже не
     новость, а решение всё равно осталось в «Моих решениях». Скрытые вручную
     не показываем совсем. */
  const visibleJobs = useMemo(() => {
    const dismissed = new Set(dismissedJobKeys)
    const staleBefore = Date.now() - 6 * 60 * 60 * 1000
    return mergeJobs(remoteJobs, localJobs).filter((job) => {
      if (dismissed.has(job.idempotencyKey)) return false
      if (isActiveJob(job)) return true
      const finishedAt = Date.parse(job.finishedAt || job.updatedAt || job.createdAt)
      return !Number.isFinite(finishedAt) || finishedAt > staleBefore
    })
  }, [dismissedJobKeys, localJobs, remoteJobs])

  const hasActiveJobs = useMemo(() => visibleJobs.some(isActiveJob), [visibleJobs])

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
      const restoredPath = currentApplicationPath()
      const restoredNormalizedPath = normalizeNavigationPath(restoredPath)
      if (restoredPath !== restoredNormalizedPath) {
        const currentUrl = new URL(window.location.href)
        currentUrl.pathname = applicationPath(restoredNormalizedPath)
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

  /* Решения из базы. Зовём не только при входе, но и когда задача закрылась
     готовой: её могли решить на другом устройстве, и тогда локально её нет. */
  const restorePurchasedSolutions = useCallback(async () => {
    if (!supabaseClient || !user) return
    const { data, error } = await supabaseClient.rpc('get_my_homework_solutions')
    if (error || !data) return

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
  }, [supabaseClient, user])

  useEffect(() => {
    void restorePurchasedSolutions()
  }, [restorePurchasedSolutions])

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
        // У вошедшего ученика считается баланс, а не гостевая метка.
        forgetGuestSolution()
        setGuestFreeSolutionUsed(false)
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
      // Опрос сессии: следующая попытка нужна только если предыдущая не дала почту.
      // active снимает очистка эффекта, а не тело цикла — линтер этого не видит.
      // eslint-disable-next-line no-unmodified-loop-condition
      for (let attempt = 0; attempt < 20 && active; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        const { data } = await authClient.auth.getSession()
        session = data.session
        if (session?.user.email) break
        // eslint-disable-next-line no-await-in-loop
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

  /* Переходник между формой и очередью: форма отдаёт условие и фото,
     остальное подставляется здесь.

     Предмет теперь задаёт и хранилище решения: `textbookId` — это он же.
     Раньше сюда шёл `selectedTextbookId` из прежнего выбора учебника, и
     задача по русскому языку сохранялась под геометрией — в «Моих решениях»
     она так и подписывалась. */
  const submitFromForm = async (submission: TaskSubmission) => {
    const imageDataUrl = submission.photo ? await prepareTaskPhoto(submission.photo) : undefined
    return enqueueTask({
      // Срез обрезается по границе слова trim-ом: сервер всё равно прогоняет
      // подпись через trim, и различие в хвостовой пробел ломало сверку.
      task: submission.condition.slice(0, 60).trim() || 'Задача с фото',
      source: submission.source,
      idempotencyKey: submission.idempotencyKey,
      textbookId: findSubjectByName(submission.subject)?.id ?? selectedTextbookId,
      subject: submission.subject,
      ...(submission.condition ? { condition: submission.condition } : {}),
      ...(imageDataUrl ? { imageDataUrl } : {}),
      ...(submission.grade ? { grade: submission.grade } : {}),
    })
  }

  // Гость держит очередь на своей метке браузера: аккаунта у него нет,
  // а видеть ход решения он должен так же, как все.
  const guestJobId = useMemo(() => (supabaseClient && !user ? getGuestId() : null), [supabaseClient, user])

  const refreshJobs = useCallback(async () => {
    if (!supabaseClient || !authReady) return
    const jobs = await listSolutionJobs(supabaseClient, guestJobId)
    if (jobs) setRemoteJobs(jobs)
  }, [authReady, guestJobId, supabaseClient])

  /* Опрос очереди.

     Пока задача в работе — раз в две с половиной секунды: столько живёт
     ощущение «ничего не происходит». В покое реже: там опрос нужен только
     чтобы заметить задачу, запущенную с другого устройства. Невидимая
     вкладка не опрашивает вовсе. */
  useEffect(() => {
    if (!supabaseClient || !authReady) return
    void refreshJobs()

    const interval = hasActiveJobs ? 2500 : 15_000
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshJobs()
    }, interval)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshJobs()
    }
    window.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [authReady, hasActiveJobs, refreshJobs, supabaseClient])

  /* Резерв возвращается и после смерти функции.

     Обычную неудачу возвращает сам решатель. Но когда процесс убит по сроку,
     возвращать некому: списание в кошельке есть, возврата нет — ровно та
     дыра, из-за которой ученик оставался и без решения, и без денег.
     Поэтому о сорвавшейся задаче своего устройства просим возврат сами.
     Вызов безопасен: база возвращает деньги только если решение не выдано. */
  useEffect(() => {
    if (!supabaseClient || !user) return
    const abandoned = visibleJobs.filter((job) => (
      job.status === 'failed'
      && job.deviceId === deviceIdRef.current
      && !refundedJobKeysRef.current.has(job.idempotencyKey)
    ))
    if (abandoned.length === 0) return

    abandoned.forEach((job) => refundedJobKeysRef.current.add(job.idempotencyKey))
    const askRefund = async (idempotencyKey: string) => {
      try {
        await supabaseClient.rpc('refund_solution_credit', {
          p_idempotency_key: idempotencyKey,
          p_reason: 'Решение не получено',
        })
      } catch {
        // Резерв разгребёт ручная сверка; ученику об этом сообщать нечего.
      }
    }

    void Promise.all(abandoned.map((job) => askRefund(job.idempotencyKey)))
      .then(() => refreshAccount())
      .catch(() => undefined)
  }, [refreshAccount, supabaseClient, user, visibleJobs])

  /* Готовая задача без решения под рукой.

     Так бывает после перезахода и когда задачу решили на другом устройстве:
     строка очереди говорит «готово», а самого решения в этой вкладке нет.
     Без этого «Открыть решение» вело бы в пустоту. */
  useEffect(() => {
    if (!supabaseClient) return
    const missing = visibleJobs.filter((job) => (
      job.status === 'done'
      && !restoredJobKeysRef.current.has(job.idempotencyKey)
      && !visibleGeneratedSolutions.some(
        (solution) => solution.textbookId === job.textbookId && solution.task === job.task,
      )
    ))
    if (missing.length === 0) return

    missing.forEach((job) => restoredJobKeysRef.current.add(job.idempotencyKey))

    const restoreMissing = async () => {
      if (user) {
        await restorePurchasedSolutions()
        return
      }
      if (!guestJobId) return

      const restored = (await Promise.all(missing.map(
        (job) => fetchGuestSolution(supabaseClient, guestJobId, job.idempotencyKey),
      )))
        .map((entry) => parseStoredHomeworkSolution(entry))
        .filter((entry): entry is HomeworkSolution => entry !== null)
      if (restored.length === 0) return

      setGeneratedSolutions((current) => [
        ...restored,
        ...current.filter((local) => !restored.some(
          (remote) => remote.textbookId === local.textbookId
            && remote.task === local.task
            && remote.textbookEdition === local.textbookEdition
            && remote.conditionNormalized === local.conditionNormalized,
        )),
      ])
    }

    void restoreMissing().catch(() => undefined)
  }, [guestJobId, restorePurchasedSolutions, supabaseClient, user, visibleGeneratedSolutions, visibleJobs])

  const markLocalJob = useCallback((job: SolutionJob, patch: Partial<SolutionJob>) => {
    setLocalJobs((current) => {
      const known = current.find((entry) => entry.idempotencyKey === job.idempotencyKey) ?? job
      const next: SolutionJob = { ...known, ...patch, updatedAt: new Date().toISOString() }
      return [next, ...current.filter((entry) => entry.idempotencyKey !== job.idempotencyKey)]
    })
  }, [])

  /* Задача, о которой сервер молчит дольше своего срока.

     Обрыв связи задачу больше не хоронит — исход отмечает сам решатель. Но
     если функцию убили на полпути, отмечать некому: в кошельке останется
     списание, а в очереди — вечное «решается». Бюджет решателя 230 секунд,
     поэтому с запасом поверх него задачу своего устройства закрываем здесь,
     а деньги вернёт эффект возврата резерва. */
  useEffect(() => {
    if (!supabaseClient) return
    const silent = visibleJobs.filter((job) => {
      if (job.status !== 'running' || job.deviceId !== deviceIdRef.current) return false
      const startedAt = Date.parse(job.startedAt || job.createdAt)
      return Number.isFinite(startedAt) && Date.now() - startedAt > silentSolverLimitMs
    })
    if (silent.length === 0) return

    const reason = 'Решатель не ответил в срок. Деньги вернулись на баланс — попробуй ещё раз'
    silent.forEach((job) => markLocalJob(job, {
      status: 'failed',
      stage: 'failed',
      error: reason,
      finishedAt: new Date().toISOString(),
    }))
    void Promise.all(silent.map(
      (job) => closeSolutionJob(supabaseClient, job.idempotencyKey, 'failed', reason, guestJobId),
    ))
      .then(() => refreshJobs())
      .catch(() => undefined)
  }, [guestJobId, markLocalJob, refreshJobs, supabaseClient, visibleJobs])

  /* Отправка задачи решателю.

     Здесь и только здесь идёт сам запрос: строка очереди говорит, что решать,
     а сам запрос уходит с того устройства, где лежат фотография и сессия. */
  const runSolutionJob = useCallback(async (job: SolutionJob): Promise<SolutionState | null> => {
    const payload = findPendingSolution(job.idempotencyKey) ?? pendingPayloadsRef.current.get(job.idempotencyKey) ?? null

    if (!payload) {
      const reason = 'Задача не ушла в работу: страница закрылась раньше. Поставь её заново'
      markLocalJob(job, { status: 'failed', stage: 'failed', error: reason, finishedAt: new Date().toISOString() })
      if (supabaseClient) await closeSolutionJob(supabaseClient, job.idempotencyKey, 'failed', reason, guestJobId)
      return null
    }

    markLocalJob(job, {
      status: 'running',
      stage: job.stage === 'queued' ? 'reading' : job.stage,
      startedAt: job.startedAt || new Date().toISOString(),
    })

    const textbook = getTextbook(payload.textbookId, availableTextbooks)
    const solvingAsGuest = Boolean(supabaseClient) && !user

    try {
      let accessToken: string | undefined
      if (supabaseClient && user) {
        const { data, error } = await supabaseClient.auth.getSession()
        accessToken = data.session?.access_token
        if (error || !accessToken) throw new Error('Сессия закончилась. Войди в аккаунт ещё раз')
      }

      const generatedSolution = await requestHomeworkSolution(
        import.meta.env.VITE_HOMEWORK_API_URL || applicationPath('/api/solve'),
        {
          textbookId: payload.textbookId,
          task: payload.task,
          source: payload.source,
          subject: payload.subject || textbook.subject,
          // Пустой выбор класса передаём прямо, а не диапазоном «7-11 класс»:
          // модель должна понять, что класс не задан, и взять простейший способ.
          grade: payload.grade || 'не указан',
          textbookTitle: textbook.title,
          authors: textbook.authors,
          edition: textbook.edition,
          idempotencyKey: payload.idempotencyKey,
          ...(payload.condition ? { condition: payload.condition } : {}),
          ...(payload.imageDataUrl ? { imageDataUrl: payload.imageDataUrl } : {}),
        },
        accessToken,
        solvingAsGuest ? getGuestId() : null,
      )

      if (solvingAsGuest) {
        rememberGuestSolutionUsed()
        setGuestFreeSolutionUsed(true)
      }

      setGeneratedSolutions((current) => [
        generatedSolution,
        ...current.filter(
          (entry) => entry.textbookId !== generatedSolution.textbookId
            || entry.task !== generatedSolution.task
            || entry.source !== generatedSolution.source
            || entry.textbookEdition !== generatedSolution.textbookEdition
            || entry.conditionNormalized !== generatedSolution.conditionNormalized
            || entry.ownerId !== generatedSolution.ownerId,
        ),
      ])

      forgetPendingSolution(job.idempotencyKey)
      pendingPayloadsRef.current.delete(job.idempotencyKey)
      // Подпись задачи берётся из ответа сервера, а не из клиентского среза
      // условия: сервер прогоняет её через trim, и срез, кончавшийся пробелом,
      // уже не совпадал с сохранённым решением.
      markLocalJob(job, {
        status: 'done',
        stage: 'done',
        task: generatedSolution.task,
        error: '',
        finishedAt: new Date().toISOString(),
      })
      if (supabaseClient && user) {
        await refreshAccount()
        await restorePurchasedSolutions()
      }
      void refreshJobs()

      return {
        mode: 'ready',
        textbookId: generatedSolution.textbookId,
        task: generatedSolution.task,
        source: generatedSolution.source,
      }
    } catch (error) {
      /* Оборванная связь не отменяет решение.

         Мобильная сеть роняет долгий запрос, а решатель об этом не знает:
         он доводит задачу до конца и сохраняет ответ. Раньше вкладка на
         обрыве объявляла провал и закрывала задачу в базе — и решение,
         пришедшее двумя минутами позже, уже некуда было положить: ученик
         видел «Решение не дошло» на задаче, которая решена и оплачена.
         Теперь задача остаётся в работе, очередь опрашивает сервер, а
         готовый ответ подхватывает восстановление ниже. */
      if (error instanceof SolutionConnectionLostError) {
        markLocalJob(job, { status: 'running', error: '' })
        void refreshJobs()
        return null
      }

      const reason = error instanceof Error ? error.message : 'Не получилось подготовить решение'
      // Запрос остаётся в хранилище: по нему работает «Решить ещё раз», и
      // ученику не придётся заново набирать условие или искать фотографию.
      markLocalJob(job, { status: 'failed', stage: 'failed', error: reason, finishedAt: new Date().toISOString() })
      if (supabaseClient) await closeSolutionJob(supabaseClient, job.idempotencyKey, 'failed', reason, guestJobId)
      void refreshJobs()
      return null
    }
  }, [
    availableTextbooks,
    guestJobId,
    markLocalJob,
    refreshAccount,
    refreshJobs,
    restorePurchasedSolutions,
    supabaseClient,
    user,
  ])

  /* Кто идёт в работу следующим.

     Очередь двигается сама: как только освобождается место, берётся самая
     ранняя задача этого устройства. Чужие задачи не трогаем — иначе одна и та
     же задача уйдёт в модель дважды и спишется дважды. */
  useEffect(() => {
    const next = nextRunnableJob(visibleJobs, deviceIdRef.current, runningJobKeysRef.current, solveConcurrency)
    if (!next) return

    // Одну задачу открываем сразу, как раньше. Когда в очереди есть другие,
    // не уводим со страницы: там ещё идёт работа, за которой человек следит.
    const soleTask = visibleJobs.filter(isActiveJob).length === 1
    runningJobKeysRef.current.add(next.idempotencyKey)

    void runSolutionJob(next)
      .then((delivered) => {
        if (delivered && soleTask && currentApplicationPath() === '/app') openSolution(delivered)
      })
      .finally(() => {
        runningJobKeysRef.current.delete(next.idempotencyKey)
        setDispatchTick((tick) => tick + 1)
      })
    // `dispatchTick` перезапускает разбор очереди, когда место освободилось,
    // а список задач при этом не изменился.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatchTick, runSolutionJob, visibleJobs])

  /* Постановка задачи в очередь.

     Проверки цены и права на решение остаются здесь: узнать о нехватке денег
     нужно до того, как задача встала в очередь, а не через минуту ожидания. */
  const enqueueTask = async (submission: {
    task: string
    source: HomeworkSource
    idempotencyKey: string
    textbookId: TextbookId
    subject: string
    condition?: string
    imageDataUrl?: string
    grade?: string
  }) => {
    const textbook = getTextbook(submission.textbookId, availableTextbooks)
    const resolvedTask = submission.source === 'photo'
      ? 'photo-' + submission.idempotencyKey.replace(/[^a-z0-9-]/gi, '').slice(-44)
      : submission.task
    const solutionPrice = getSolutionPrice()

    // Первое решение выдаётся без аккаунта. Регистрацию просим только когда
    // бесплатный разбор уже израсходован: до этого человек не видел продукт
    // и не понимает, за что его просят завести аккаунт.
    const solvingAsGuest = Boolean(supabaseClient) && !user
    if (solvingAsGuest && guestFreeSolutionUsed) {
      rememberAccountTrigger()
      setAccountNotice('Бесплатное решение уже использовано. Зарегистрируйся — на счёт придут 20 ₽, это ещё четыре решения')
      setAccountOpen(true)
      return false
    }

    const previouslyGenerated = visibleGeneratedSolutions.find((solution) => (
      // Повтор отдаём только записью нынешнего движка: иначе ученик получит
      // старый формат вместо того, за чем пришёл, и без объяснения.
      isCurrentEngineSolution(solution)
      && solution.textbookId === submission.textbookId
      && solution.task === resolvedTask
      && solution.source === submission.source
      && solution.textbookEdition === textbook.edition
      && solution.sourceUrl === (textbook.sourceUrl ?? '')
      && (!submission.condition || solution.conditionNormalized === normalizeTaskCondition(submission.condition))
    ))
    if (previouslyGenerated) {
      openSolution({ mode: 'ready', textbookId: submission.textbookId, task: resolvedTask, source: submission.source })
      return true
    }

    if (supabaseClient && user && account && account.balance < solutionPrice) {
      rememberAccountTrigger()
      setAccountView('wallet')
      setAccountNotice(`На балансе меньше ${formatRubles(solutionPrice)}`)
      setAccountOpen(true)
      return false
    }

    if (submission.source === 'photo' && !submission.imageDataUrl) {
      throw new Error('Добавь фотографию задачи')
    }

    const conditionPreview = submission.condition?.trim()
      || (submission.source === 'photo' ? 'Задача с фотографии' : resolvedTask)

    setQueueNotice('')
    const pendingPayload: PendingSolution = {
      idempotencyKey: submission.idempotencyKey,
      textbookId: submission.textbookId,
      task: resolvedTask,
      source: submission.source,
      ...(submission.condition ? { condition: submission.condition } : {}),
      ...(submission.imageDataUrl ? { imageDataUrl: submission.imageDataUrl } : {}),
      ...(submission.subject ? { subject: submission.subject } : {}),
      ...(submission.grade ? { grade: submission.grade } : {}),
    }
    pendingPayloadsRef.current.set(submission.idempotencyKey, pendingPayload)
    savePendingSolution(pendingPayload)

    const queued = localSolutionJob({
      idempotencyKey: submission.idempotencyKey,
      textbookId: submission.textbookId,
      task: resolvedTask,
      source: submission.source,
      subject: submission.subject,
      grade: submission.grade ?? '',
      conditionPreview: conditionPreview.slice(0, 400),
      deviceId: deviceIdRef.current,
    })
    setLocalJobs((current) => [queued, ...current.filter((entry) => entry.idempotencyKey !== queued.idempotencyKey)])

    // Строка в базе — то, из-за чего задача переживает перезаход и видна на
    // других устройствах. Не завелась — задача всё равно решится здесь.
    if (supabaseClient) {
      const started = await startSolutionJob(
        supabaseClient,
        {
          idempotencyKey: submission.idempotencyKey,
          textbookId: submission.textbookId,
          task: resolvedTask,
          source: submission.source,
          subject: submission.subject,
          grade: submission.grade ?? '',
          conditionPreview,
        },
        guestJobId,
      )
      if (started) setRemoteJobs((current) => [started, ...current.filter((entry) => entry.id !== started.id)])
    }

    return true
  }

  const dismissJob = (job: SolutionJob) => {
    if (isActiveJob(job) && supabaseClient) {
      void closeSolutionJob(supabaseClient, job.idempotencyKey, 'canceled', 'Задача снята с очереди', guestJobId)
    }
    forgetPendingSolution(job.idempotencyKey)
    pendingPayloadsRef.current.delete(job.idempotencyKey)
    setLocalJobs((current) => current.filter((entry) => entry.idempotencyKey !== job.idempotencyKey))
    setDismissedJobKeys((current) => {
      const next = [job.idempotencyKey, ...current.filter((key) => key !== job.idempotencyKey)]
      saveDismissedJobs(next)
      return next
    })
  }

  // Повтор берёт сохранённый запрос: заново набирать условие или искать
  // фотографию после чужого сбоя — то, за что продукт и ругают.
  const retryJob = (job: SolutionJob) => {
    const payload = findPendingSolution(job.idempotencyKey) ?? pendingPayloadsRef.current.get(job.idempotencyKey) ?? null
    dismissJob(job)
    if (!payload) {
      // Запрос мог не пережить перезаход: хранилище держит шесть последних,
      // и фотографии вытесняют старые. Молча убирать карточку нельзя —
      // человек жмёт «Решить ещё раз» и не понимает, куда всё делось.
      setQueueNotice('Условие этой задачи не сохранилось. Впиши его заново — это займёт минуту')
      return
    }

    const idempotencyKey = typeof crypto.randomUUID === 'function'
      ? `solution-${crypto.randomUUID()}`
      : `solution-${Date.now()}-${Math.random().toString(16).slice(2)}`

    void enqueueTask({
      task: payload.source === 'photo' ? 'Задача с фото' : payload.task,
      source: payload.source,
      idempotencyKey,
      textbookId: payload.textbookId,
      // Предмет сохранён вместе с запросом: он был обязателен при первой
      // отправке, и повтор идёт с ним же.
      subject: payload.subject ?? getTextbook(payload.textbookId, availableTextbooks).subject,
      ...(payload.condition ? { condition: payload.condition } : {}),
      ...(payload.imageDataUrl ? { imageDataUrl: payload.imageDataUrl } : {}),
      ...(payload.grade ? { grade: payload.grade } : {}),
    })
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
              <CopyTask
                onSubmit={submitFromForm}
                signedIn={Boolean(user)}
                freeSolutionUsed={guestFreeSolutionUsed}
                defaultGrade={account ? `${account.profile.grade} класс` : ''}
              />
              {!user && <GuestSolutionsNote onOpenAccount={openAccount} freeSolutionUsed={guestFreeSolutionUsed} />}
              {(visibleJobs.length > 0 || user) && (
                <div className="home-column home-column-primary">
                  {queueNotice && <p className="solve-queue-notice" role="status">{queueNotice}</p>}
                  <SolutionQueue
                    jobs={visibleJobs}
                    deviceId={deviceIdRef.current}
                    subjectOf={(textbookId) => getTextbook(textbookId, availableTextbooks).subject}
                    onOpen={(job) => openSolution({ mode: 'ready', textbookId: job.textbookId, task: job.task, source: job.source })}
                    onRetry={retryJob}
                    onDismiss={dismissJob}
                    // Сорвавшееся решение — не «неверный ответ»: разбирать там
                    // нечего, поэтому ведём в общую поддержку.
                    onOpenSupport={() => openSupport()}
                  />
                  {user && <MySolutions items={personalSolutions} onOpenAll={() => navigate('Решения')} onOpenSolution={openSolution} />}
                </div>
              )}
            </div>
          ) : selectedSolution ? (
            <UnderstandingPage
              solution={selectedSolution}
              generatedSolution={visibleGeneratedSolutions.find(
                (solution) => solution.textbookId === selectedSolution.textbookId && solution.task === selectedSolution.task,
              )}
              onGoHome={() => navigate('Главная')}
              onOpenSupport={(context) => openSupport('wrong_solution', context)}
              guestOffer={Boolean(supabaseClient) && !user}
              onOpenAccount={openAccount}
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
              onOpenAccount={openAccount}
              onOpenSolution={openSolution}
              onStartTask={() => navigate('Главная')}
            />
          ) : (
            <CdzComingSoon onGoHome={() => navigate('Главная')} />
          )}
        </div>
        <SiteFooter onOpenSupport={() => openSupport()} />
      </div>
      {activeNavigation !== 'Главная' && <SupportLauncher onClick={() => openSupport()} />}
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

  if (pathname === '/privacy') return <><LegalPage kind="privacy" /><PrivacyNotice /></>
  if (pathname === '/terms' || pathname === '/agreement') return <><LegalPage kind="terms" /><PrivacyNotice /></>
  if (pathname === '/consent') return <><LegalPage kind="consent" /><PrivacyNotice /></>
  if (pathname === '/cookies') return <><LegalPage kind="cookies" /><PrivacyNotice /></>
  if (pathname === '/offer') return <><LegalPage kind="offer" /><PrivacyNotice /></>

  if (pathname === '/admin') {
    return <Suspense fallback={null}><AdminDashboard /></Suspense>
  }

  if (!isKnownApplicationPath(pathname)) {
    applySeoMetadata(getSeoMetadata(pathname))
    return <><NotFoundScreen onGoHome={() => window.location.assign(applicationPath('/app'))} /><PrivacyNotice /></>
  }

  return <><HomePage /><PrivacyNotice /></>
}

export default App
