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
  Moon,
  Notebook,
  SpinnerGap,
  Sun,
  UserCircle,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import CopyTask from './CopyTask'
import type { TaskSubmission } from './CopyTask'
import { applicationPath, currentApplicationPath } from './lib/appPath'
import { keyed } from './lib/listKeys'
import { NotebookSheet } from './notebook/NotebookSheet'
import { solutionCopyText } from './notebook/notebookText'
import LegalPage from './LegalPage'
import PrivacyNotice from './PrivacyNotice'
import type { Database } from './lib/database.types'
import type { AccountData } from './lib/supabase'
import { homeworkSolutionForm } from './lib/homeworkContract'
import type { HomeworkSolution, HomeworkSource, SolveHomeworkRequest, SolveReceipt } from './lib/homeworkContract'
import { loadReceipts, receiptKey, receiptLabel, withReceipt } from './lib/solveReceipts'
import { formatRubles } from './lib/currency'
import { recordPendingLegalAcceptance } from './lib/legalConsent'
import { bindPendingReferral, preparePendingReferralClaim } from './lib/referrals'
import { forgetGuestSolution, getGuestId, guestSolutionUsed, rememberGuestSolutionUsed } from './lib/guestSolutions'
import { takeYandexReturn } from './lib/yandexReturn'
import { completeYandexSignIn } from './lib/yandexAuth'
import { applySeoMetadata, getSeoMetadata, legalDocumentKind } from './lib/siteMetadata'
import { estimateSolutionPrice } from './lib/solutionPricing'
import { findSubjectByName } from './lib/subjects'
import {
  isCurrentEngineSolution,
  isReviewedHomeworkSolution,
  loadGeneratedSolutions,
  parseStoredHomeworkSolution,
  requestHomeworkSolution,
  serverAcceptLimitFor,
  SolutionConnectionLostError,
  SolutionInProgressError,
  SolutionNotAcceptedError,
  saveGeneratedSolutions,
  untilAborted,
} from './lib/homeworkSolution'
import { normalizeTaskCondition } from './textbooks/taskCatalog'
import {
  findPendingSolution,
  forgetPendingSolution,
  hydratePendingSolutions,
  prunePendingSolutions,
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
  runWithJobLock,
  startSolutionJob,
} from './lib/solutionJobs'
import type { SolutionJob } from './lib/solutionJobs'
import { SolutionQueue } from './solution/SolutionQueue'
import { SolutionVerificationPanel } from './solution/SolutionVerificationPanel'
import { SolutionErrorBoundary } from './solution/SolutionErrorBoundary'
import { MySolutions, SolutionsPage } from './solution/SolutionsPage'
import { SupportCenter } from './support/SupportCenter'
import { SupportLauncher } from './support/SupportLauncher'
import { SiteFooter } from './support/SiteFooter'
import { NotFoundPage } from './NotFoundPage'
import type { SupportCategory, SupportPrefill } from './support/SupportCenter'
import './App.css'
import { featureEnabled, featureOptIn, orderedSubjects, usePublicConfig } from './lib/publicConfig'
import type { SiteBanner } from './lib/publicConfig'
import { installClientErrorReporting } from './lib/clientErrors'

/* Инструменты разработки - только в разработке, как студия роликов в
   `Root.tsx`. Объявленный на уровне модуля `lazy` сборка всё равно режет на
   чанки, и в `dist/assets` уезжали песочница дизайна (68 КБ скрипта и 50 КБ
   стилей), записи аудита и фикстуры (аудит 16 сентября, Е4). В сборке здесь
   `null`, и импорт вместе с чанком выпадает. */
const DesignSystemPlayground = import.meta.env.DEV ? lazy(() => import('./DesignSystemPlayground')) : null
const NotebookCanvas = import.meta.env.DEV ? lazy(() => import('./NotebookCanvas')) : null
const AuditSheets = import.meta.env.DEV ? lazy(() => import('./notebook/AuditSheets')) : null
const ChatPage = lazy(() => import('./chat/ChatPage'))
const AccountDialog = lazy(() => import('./account/AccountDialog'))
const ProfilePage = lazy(() => import('./account/ProfilePage'))
const BalancePage = lazy(() => import('./account/BalancePage'))
const SchedulePage = lazy(() => import('./SchedulePage'))
const AdminApp = lazy(() => import('./admin/AdminApp'))

type Theme = 'light' | 'dark'
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

/* Решение в списке. Само решение здесь целиком: карточка показывает
   условие, первые строки записи и ответ, и всё это уже сохранено рядом. */
type PersonalSolution = SolutionState & {
  time: string
  solution: HomeworkSolution
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
   Его собственный бюджет - 270 секунд (`solveTimeBudgetMs` в
   server/homeworkSolver.ts), потолок функции на Vercel - 300. Вкладка ждёт
   дольше потолка: закрыть задачу, которую функция ещё сохраняет, значит
   отказаться от решения, за которое уже заплачено моделью. */
const silentSolverLimitMs = 330_000

/* Смена раздела начинается сверху.

   Разбор 8 сентября: прокрутить главную вниз, нажать «Решения» в меню - и
   попасть сразу в подвал нового раздела. Заголовок «Мои решения» человек не
   видел вообще. Браузер сам скролл не трогает: адрес меняет `pushState`, а
   он ничего не прокручивает. Восстановление позиции по «назад» это не ломает:
   `popstate` идёт своим путём и сюда не заходит.

   Прокручиваемых мест два, и это не придирка. На широком экране страницу
   листает окно. На 980 пикселях и уже `.product-shell` становится высотой
   ровно в экран с `overflow: hidden`, а лента уезжает внутрь
   `.product-content` - то есть на телефоне, где разбор и нашёл эту находку,
   `window.scrollTo` не делает ровным счётом ничего. Поднимаем оба. */
function scrollRouteToTop(container: HTMLElement | null) {
  if (typeof window === 'undefined') return
  const reduce = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth'
  window.scrollTo({ top: 0, left: 0, behavior })
  container?.scrollTo({ top: 0, left: 0, behavior })
}

const applicationRoutes = [
  { label: 'Главная', path: '/app', icon: House },
  { label: 'Решения', path: '/solutions', icon: Notebook },
  { label: 'ИИ-чат', path: '/chat', icon: ChatsCircle },
  { label: 'Расписание', path: '/schedule', icon: CalendarDots },
] as const

// В основном меню только то, что уже работает. Раздел «ЦДЗ» удалён 16
// сентября 2026 вместе с заглушкой «Раздел пока закрыт»: ссылок на него не
// было нигде, а его адреса (`/cdz`, `/tasks`, `/textbooks`) открывают главную.
const navigation = applicationRoutes

/* Профиль и баланс - такие же адреса, как разделы (14 сентября 2026): их
   открывают по ссылке, сохраняют, листают назад и вперёд. В меню разделов
   их нет - в шапке у них свои ссылки, сумма и имя. */
const accountRoutes = [
  { label: 'Профиль', path: '/profile' },
  { label: 'Баланс', path: '/balance' },
] as const

type AccountRouteLabel = (typeof accountRoutes)[number]['label']
type NavigationLabel = (typeof applicationRoutes)[number]['label'] | AccountRouteLabel

const routeDestinations: readonly { label: NavigationLabel; path: string }[] = [...applicationRoutes, ...accountRoutes]

function isAccountRoute(label: NavigationLabel): label is AccountRouteLabel {
  return label === 'Профиль' || label === 'Баланс'
}

function currentNavigationRoute(pathname = window.location.pathname): { label: NavigationLabel; solution: SolutionState | null } {
  const path = currentApplicationPath(pathname)
  if (path === '/textbooks' || path === '/tasks' || path === '/cdz') return { label: 'Главная', solution: null }
  if (path === '/base') return { label: 'Решения', solution: null }
  // `/main` — прежний адрес рабочей главной. Ссылки на него уже разошлись,
  // поэтому он продолжает открывать приложение и лишь переписывается на `/app`.
  if (path === '/main') return { label: 'Главная', solution: null }
  const destination = routeDestinations.find((item) => item.path === path)
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
  '/chat', '/schedule', '/support', '/profile', '/balance',
])

function isKnownApplicationPath(pathname: string) {
  return knownApplicationPaths.has(pathname) || /^\/solutions\/[^/]+\/[^/]+$/i.test(pathname)
}

function normalizeNavigationPath(pathname: string) {
  const path = currentApplicationPath(pathname)
  if (path === '/textbooks' || path === '/tasks' || path === '/cdz') return '/app'
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
    grade: '5-11 класс',
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
    grade: '5-11 класс',
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
    grade: '5-11 класс',
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
    grade: '5-11 класс',
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
    grade: '5-11 класс',
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
    grade: '5-11 класс',
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
    grade: '5-11 класс',
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
    grade: '5-11 класс',
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
    grade: '5-11 класс',
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
    grade: '5-11 класс',
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
    grade: '5-11 класс',
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
    grade: '5-11 класс',
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
    grade: '5-11 класс',
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
    grade: '5-11 класс',
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
      <Icon size={20} weight="regular" aria-hidden="true" />
    </button>
  )
}

/* Обычный клик уводит роутером, а Ctrl, Cmd, средняя кнопка и «открыть в
   новой вкладке» работают как у любой ссылки. */
function isPlainLeftClick(event: { defaultPrevented: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number }) {
  return !(event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
}

/* Имя вошедшего в шапке - ссылка на `/profile`, как пункт меню: с 14
   сентября 2026 профиль - страница, её открывают в новой вкладке и
   сохраняют. У гостя это по-прежнему кнопка: окно входа открывается на
   месте, и человек не теряет раздел, в котором был. */
function ProfileButton({ user, account, active = false, onClick, compact = false }: { user: User | null; account: AccountData | null; active?: boolean; onClick: () => void; compact?: boolean }) {
  const name = account?.profile.full_name || (user ? user.email?.split('@')[0] : 'Войти') || 'Ученик'
  // Класс не выдумываем: Google его не передаёт, и пока ученик не выбрал, его нет.
  const grade = account?.profile.grade
  const subtitle = user ? (grade ? `${grade} класс` : account ? 'Класс не выбран' : '') : 'Аккаунт'
  const className = `profile-button${compact ? ' is-compact' : ''}`
  const content = (
    <>
      {/* Линейный, как значки разделов рядом (14 сентября 2026): двухцветный
          на тёмной плашке остался последним «мультяшным» в шапке. */}
      <span><UserCircle size={20} weight="regular" aria-hidden="true" /></span>
      {!compact && <span><strong>{name}</strong><small>{subtitle}</small></span>}
      {!compact && <CaretRight size={14} weight="bold" aria-hidden="true" />}
    </>
  )

  if (!user) {
    return <button className={className} type="button" aria-label="Войти или зарегистрироваться" onClick={onClick}>{content}</button>
  }

  return (
    <a
      className={className}
      href={applicationPath('/profile')}
      aria-label={`Профиль: ${name}${subtitle ? `, ${subtitle}` : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={(event) => {
        if (!isPlainLeftClick(event)) return
        event.preventDefault()
        onClick()
      }}
    >
      {content}
    </a>
  )
}

const noHiddenLabels: readonly NavigationLabel[] = []

/* Объявление из админки («ведутся работы»). Закрытое объявление с тем же
   текстом больше не показывается: новый текст - новое объявление. */
function SiteBannerStrip({ banner }: { banner: SiteBanner }) {
  const storageKey = `homework-copilot:banner-closed:${banner.text}`
  const [closed, setClosed] = useState(() => {
    try {
      return window.localStorage.getItem(storageKey) === '1'
    } catch {
      return false
    }
  })
  if (closed) return null
  const internal = banner.link.startsWith('/')
  return (
    <div className={`site-banner is-${banner.tone}`} role={banner.tone === 'danger' ? 'alert' : 'status'}>
      <p>
        {banner.text}
        {banner.link && <> <a href={banner.link} {...(internal ? {} : { target: '_blank', rel: 'noreferrer' })}>Подробнее</a></>}
      </p>
      <button
        type="button"
        aria-label="Скрыть объявление"
        onClick={() => {
          setClosed(true)
          try {
            window.localStorage.setItem(storageKey, '1')
          } catch {
            // Не запомнится - покажем при следующем заходе.
          }
        }}
      >
        <X size={16} weight="bold" aria-hidden="true" />
      </button>
    </div>
  )
}

function FeatureOffNotice({ title, onGoHome }: { title: string; onGoHome: () => void }) {
  return (
    <section className="route-page feature-off" aria-labelledby="feature-off-title">
      <header className="route-page-header">
        <h1 id="feature-off-title">{title}</h1>
        <p>Раздел скоро вернётся. Решение задач работает как обычно.</p>
      </header>
      <button className="route-primary-action" type="button" onClick={onGoHome}>
        На главную <ArrowRight size={18} weight="bold" aria-hidden="true" />
      </button>
    </section>
  )
}

/* «Помогло / не помогло» под разбором. Оценка идёт в метрики качества по
   предметам в админке; на «не помогло» просим одну фразу - что было
   непонятно, иначе оценка ничего не объясняет. */
function SolutionRating({ client, solutionKey, subject, guestId }: {
  client: SupabaseClient<Database>
  solutionKey: string
  subject: string
  guestId: string | null
}) {
  const storageKey = `homework-copilot:rated:${solutionKey}`
  const [value, setValue] = useState<boolean | null>(() => {
    try {
      const stored = window.localStorage.getItem(storageKey)
      return stored === '1' ? true : stored === '0' ? false : null
    } catch {
      return null
    }
  })
  const [comment, setComment] = useState('')
  const [askComment, setAskComment] = useState(false)
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const send = async (helpful: boolean, text = '') => {
    if (sending) return
    setSending(true)
    setError('')
    const { error: rateError } = await client.rpc('rate_homework_solution', {
      p_solution_key: solutionKey,
      p_subject: subject,
      p_helpful: helpful,
      p_comment: text.trim() || null,
      p_guest_id: guestId,
    })
    setSending(false)
    if (rateError) {
      setError('Оценка не сохранилась. Попробуй ещё раз')
      return
    }
    setValue(helpful)
    try {
      window.localStorage.setItem(storageKey, helpful ? '1' : '0')
    } catch {
      // Не запомнится - кнопки просто останутся активными.
    }
    if (!helpful && !text) {
      setAskComment(true)
      setStatus('')
    } else {
      setAskComment(false)
      setStatus('Спасибо, учтём.')
    }
  }

  return (
    <section className="solution-rating" aria-labelledby="solution-rating-title">
      <h2 id="solution-rating-title">Разбор помог разобраться?</h2>
      <div className="solution-rating-actions">
        <button type="button" className={value === true ? 'is-selected' : ''} aria-pressed={value === true} disabled={sending} onClick={() => { void send(true) }}>Помог</button>
        <button type="button" className={value === false ? 'is-selected' : ''} aria-pressed={value === false} disabled={sending} onClick={() => { void send(false) }}>Не помог</button>
      </div>
      {askComment && (
        <form className="solution-rating-comment" onSubmit={(event) => { event.preventDefault(); void send(false, comment) }}>
          <label>
            <span>Что осталось непонятным?</span>
            <textarea value={comment} onChange={(event) => setComment(event.target.value.slice(0, 500))} rows={2} maxLength={500} />
          </label>
          <button type="submit" disabled={sending || !comment.trim()}>Отправить</button>
        </form>
      )}
      {status && <p className="solution-rating-status" role="status">{status}</p>}
      {error && <p className="solution-rating-status is-error" role="alert">{error}</p>}
    </section>
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
  hiddenLabels = noHiddenLabels,
}: {
  theme: Theme
  activeLabel: NavigationLabel
  onNavigate: (label: NavigationLabel) => void
  onToggleTheme: () => void
  user: User | null
  account: AccountData | null
  onOpenAccount: () => void
  onOpenWallet: () => void
  /** Разделы, выключенные флагами из админки. */
  hiddenLabels?: readonly NavigationLabel[]
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
        {navigation.filter(({ label }) => !hiddenLabels.includes(label)).map(({ label, path, icon: Icon }) => {
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
              {/* Значки разделов линейные, одного размера и веса с кнопкой
                  темы. 14 сентября владелец назвал прежние двухцветные
                  «мультяшными»: второй тон заливки спорил с подписью. */}
              <Icon size={20} weight="regular" aria-hidden="true" />
              <span className="navigation-label">{label}</span>
            </a>
          )
        })}
      </nav>

      <div className="topbar-actions">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        {user && <BalanceControl balance={account?.balance ?? null} active={activeLabel === 'Баланс'} onOpenWallet={onOpenWallet} />}
        <ProfileButton user={user} account={account} active={activeLabel === 'Профиль'} onClick={onOpenAccount} />
      </div>
    </header>
  )
}

/* Цена задачи из очереди - та же формула, что в форме до нажатия «Решить». */
function pendingSolutionPrice(payload: { condition?: string; imageDataUrl?: string; subject?: string }) {
  return estimateSolutionPrice({
    conditionLength: payload.condition?.trim().length ?? 0,
    imageBytes: payload.imageDataUrl?.length ?? 0,
    subject: payload.subject ?? '',
  })
}

/* Сумма в шапке - ссылка на `/balance`. До 14 сентября 2026 рядом с ней
   стояло «Открыть →»: читалось как отдельная кнопка, хотя это был текст, а
   открывало баланс нажатие на всё целиком. Владелец назвал это абсурдом.
   «Пополнить» здесь тоже нет: оно обещало оплату, которой у обычного
   аккаунта нет, - пополнение живёт на странице баланса и появляется,
   только когда оплату включил сервер. */
function BalanceControl({ balance, active, onOpenWallet }: { balance: number | null; active: boolean; onOpenWallet: () => void }) {
  return (
    <a
      className="balance-control"
      href={applicationPath('/balance')}
      aria-current={active ? 'page' : undefined}
      onClick={(event) => {
        if (!isPlainLeftClick(event)) return
        event.preventDefault()
        onOpenWallet()
      }}
    >
      <small>Баланс</small>
      <strong>{formatRubles(balance ?? 0)}</strong>
    </a>
  )
}

/* Приветствие по часам ученика: «Добрый день» в одиннадцать вечера читалось
   как заглушка (аудит 16 сентября, Г9). Ночью - просто «Привет»: «Доброй
   ночи» по-русски прощаются. */
function greetingFor(hour: number) {
  if (hour >= 5 && hour < 12) return 'Доброе утро'
  if (hour >= 12 && hour < 18) return 'Добрый день'
  if (hour >= 18 && hour < 23) return 'Добрый вечер'
  return 'Привет'
}

function PageHeader({ account }: { account: AccountData | null }) {
  const firstName = account?.profile.full_name.trim().split(/\s+/)[0]
  const greeting = greetingFor(new Date().getHours())
  const formattedDate = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
  const dateLabel = formattedDate.charAt(0).toLocaleUpperCase('ru') + formattedDate.slice(1)

  return (
    <header className="page-header">
      <div className="page-heading">
        <p className="page-greeting">{firstName ? `${greeting}, ${firstName}` : greeting}</p>
        <span>{dateLabel}</span>
      </div>
    </header>
  )
}

function GuestSolutionsNote({ onOpenAccount, freeSolutionUsed = false }: { onOpenAccount: () => void; freeSolutionUsed?: boolean }) {
  return (
    <p className="home-guest-note">
      <button type="button" onClick={onOpenAccount}>
        {freeSolutionUsed
          ? 'Бесплатное решение использовано. Зарегистрируйся — новому аккаунту 20 ₽, один раз на устройство'
          : 'Войти, чтобы сохранять решения'}
        <ArrowRight size={16} weight="bold" aria-hidden="true" />
      </button>
    </p>
  )
}

/* «Мои решения» и их окошко на главной - в `src/solution/SolutionsPage.tsx`. */

function UnderstandingPage({
  solution,
  generatedSolution,
  onGoHome,
  onOpenSupport,
  guestOffer,
  onOpenAccount,
  ratingClient = null,
  ratingGuestId = null,
  receipt = null,
}: {
  solution: SolutionState | null
  generatedSolution?: HomeworkSolution
  /** Сколько шло решение и сколько списано; есть в той вкладке, что его заказала. */
  receipt?: SolveReceipt | null
  onGoHome: () => void
  onOpenSupport: (context: SupportPrefill) => void
  /** Решение получено без аккаунта: оно лежит только в этом браузере. */
  guestOffer: boolean
  onOpenAccount: () => void
  /** Клиент для оценки «помогло / не помогло»; null - оценка выключена флагом. */
  ratingClient?: SupabaseClient<Database> | null
  ratingGuestId?: string | null
}) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  // Исходный чертёж из скана учебника больше не подгружается: сканов нет,
  // а чертёж строится движком по условию.


  const copySolution = async () => {
    const source = generatedSolution
    if (!source) return

    const value = solutionCopyText(source)

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

  /* Развёрнутый ответ - образец, а не текст для сдачи: одинаковое
     сочинение у половины класса учитель заметит сразу. Решебники
     помечают такие ответы так же. */
  const essayAnswer = Boolean(generatedSolution)
    && homeworkSolutionForm(generatedSolution?.subject ?? '', generatedSolution?.taskType) === 'essay'
  const disclaimer = (
    <p className="solution-disclaimer">
      {essayAnswer
        ? 'Это образец ответа: перепиши его своими словами. Проверь факты перед сдачей.'
        : 'Решение помогает разобраться. Проверь ответ перед сдачей.'}
    </p>
  )

  /* Разбор идёт до готовой записи, а не после неё.

     Мы продаём «сфоткал и понял», а не «сфоткал и списал»: сервис, который
     выдаёт только готовый лист, платёжные системы отказываются подключать,
     и по делу — списывание это и есть. Поэтому первым на странице стоит
     объяснение обычными словами, и только под ним лист для тетради. */
  const explanationLines = generatedSolution?.explanation ?? []
  const explanation = explanationLines.length > 0 ? (
    <section className="solution-explanation" aria-labelledby="solution-explanation-title">
      {/* Заголовок обещает разбор темы, а не пересказ решения: ниже стоят
          правило и откуда оно, признак такой задачи, частая ошибка и
          способ проверить себя. «Как это решается» обещало ход решения -
          и ученик читал в разборе то же самое, что в тетрадной записи. */}
      <h2 id="solution-explanation-title">Что нужно понять</h2>
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
        <p>Зарегистрируйся — оно останется в аккаунте, а новому аккаунту придут 20 ₽, один раз на устройство. Это пять задач по минимальной цене.</p>
      </div>
      <button className="route-primary-action" type="button" onClick={onOpenAccount}>
        Сохранить решение
        <ArrowRight size={18} weight="bold" aria-hidden="true" />
      </button>
    </section>
  ) : null

  /* Аудит 16 сентября, Г5: главная кнопка ведёт к следующей задаче - на
     `/app` к форме, а не к копированию. Цикл «решил - решаю следующую» и
     есть работа ученика. У гостя главная кнопка страницы - «Сохранить
     решение» в приглашении, и вторую такую же рядом не ставим. */
  const actions = (
    <div className="solution-actions">
      <button className={guestOffer ? 'route-secondary-action' : 'route-primary-action'} type="button" onClick={onGoHome}>
        Решить следующую задачу <ArrowRight size={18} weight="bold" aria-hidden="true" />
      </button>
      {generatedSolution && (
        <button className="route-secondary-action" type="button" onClick={() => { void copySolution() }}>
          {copied ? 'Скопировано' : copyFailed ? 'Не скопировалось - выдели и скопируй сам' : 'Скопировать решение'}
          <Check size={18} weight="bold" aria-hidden="true" />
        </button>
      )}
      <button className="route-secondary-action" type="button" onClick={() => { if (generatedSolution) { const textbook = getTextbook(generatedSolution.textbookId); onOpenSupport({ wrongSolution: { textbookId: generatedSolution.textbookId, textbookTitle: generatedSolution.textbookTitle, subject: generatedSolution.subject, grade: textbook.grade, edition: generatedSolution.textbookEdition, source: generatedSolution.source, task: generatedSolution.task, condition: generatedSolution.condition, given: generatedSolution.given, goal: generatedSolution.goal, steps: generatedSolution.steps, ...(generatedSolution.answer ? { answer: generatedSolution.answer } : {}), sourceUrl: generatedSolution.sourceUrl, ...(generatedSolution.sourcePage ? { sourcePage: generatedSolution.sourcePage } : {}) } }) } }}>
        Сообщить об ошибке <WarningCircle size={18} weight="duotone" aria-hidden="true" />
      </button>
    </div>
  )

  if (generatedSolution) {
    return (
      <section className="route-page solution-view" aria-labelledby="understanding-page-title">
        <header className="route-page-header">
          <h1 id="understanding-page-title">{solution?.source === 'number' ? 'Решение № ' + generatedSolution.task : solution?.source === 'photo' ? 'Решение по фото' : 'Решение задачи'}</h1>
          <p>{generatedSolution.subject}. Готовая запись для тетради.</p>
          {receiptLabel(receipt) && <p className="solution-receipt">{receiptLabel(receipt)}</p>}
        </header>
        <div className="solution-condition">
          <strong>Условие</strong>
          <p>{generatedSolution.condition}</p>
        </div>
        {explanation}
        <NotebookSheet solution={generatedSolution} />
        {disclaimer}
        {guestInvite}
        {generatedSolution.verification && <SolutionVerificationPanel verification={generatedSolution.verification} />}
        {ratingClient && (
          <SolutionRating
            client={ratingClient}
            solutionKey={`${generatedSolution.textbookId}:${generatedSolution.task}`}
            subject={generatedSolution.subject}
            guestId={ratingGuestId}
          />
        )}
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
      <button className="route-primary-action" type="button" onClick={onGoHome}>На главную <House size={18} weight="bold" aria-hidden="true" /></button>
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
  // Свежие строки базы для сторожа приёма: он живёт в таймере, а не в рендере.
  const remoteJobsRef = useRef<SolutionJob[]>([])
  useEffect(() => {
    remoteJobsRef.current = remoteJobs
  }, [remoteJobs])
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
  /* Запросы, не влезшие в localStorage, лежат в IndexedDB и читаются
     асинхронно. Очередь не отправляет ничего, пока они не дочитаны. */
  const [pendingSolutionsReady, setPendingSolutionsReady] = useState(false)
  useEffect(() => {
    let active = true
    void hydratePendingSolutions()
      .catch(() => undefined)
      .finally(() => {
        if (active) setPendingSolutionsReady(true)
      })
    return () => {
      active = false
    }
  }, [])
  const [selectedSolution, setSelectedSolution] = useState<SolutionState | null>(() => currentNavigationRoute().solution)
  const [generatedSolutions, setGeneratedSolutions] = useState<HomeworkSolution[]>(loadGeneratedSolutions)
  const [solveReceipts, setSolveReceipts] = useState<Record<string, SolveReceipt>>(loadReceipts)
  const [supabaseClient, setSupabaseClient] = useState<SupabaseClient<Database> | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [account, setAccount] = useState<AccountData | null>(null)
  const [authReady, setAuthReady] = useState(!authIsConfigured)
  const [accountReady, setAccountReady] = useState(!authIsConfigured)
  // `signin` приходит с витрины: там «Войти» должен открывать окно аккаунта,
  // а не высаживать человека на рабочую главную с просьбой поискать вход.
  const [accountOpen, setAccountOpen] = useState(() => ['reset', 'verified', 'confirm', 'signin', 'yandex'].includes(new URLSearchParams(window.location.search).get('auth') ?? ''))
  // Страница аккаунта, на которой гостю уже показали вход: закрыл окно -
  // само оно больше не откроется, и после выхода тоже.
  const accountRouteSignInShownRef = useRef<NavigationLabel | null>(null)
  const [passwordRecovery, setPasswordRecovery] = useState(() => new URLSearchParams(window.location.search).get('auth') === 'reset')
  // Аккаунт без единой отметки о согласии: окно согласия его не отпускает.
  const [legalGateUserId, setLegalGateUserId] = useState<string | null>(null)
  const legalAcceptanceRequired = Boolean(user) && legalGateUserId === user?.id
  const [accountNotice, setAccountNotice] = useState('')
  /* Сообщение над балансом, после которого ученику пора к задачам: пополнил
     или узнал о нехватке. Хранится текстом этого сообщения - сменилось
     сообщение, пропала и кнопка «Вернуться к задачам» (аудит 16 сентября, Г2). */
  const [tasksReturnNotice, setTasksReturnNotice] = useState('')
  // Сообщение над очередью: то, что случилось с задачей, а не с аккаунтом.
  const [queueNotice, setQueueNotice] = useState('')
  const [supportOpen, setSupportOpen] = useState(() => currentApplicationPath() === '/support')
  const [supportCategory, setSupportCategory] = useState<SupportCategory>('general')
  const [supportContext, setSupportContext] = useState<SupportPrefill | undefined>(undefined)
  const emailConfirmationStarted = useRef(false)
  const yandexReturnStarted = useRef(false)
  const accountTriggerRef = useRef<HTMLElement | null>(null)
  /* Вход начался из формы решения («бесплатное уже использовано»). Тогда
     после входа человек остаётся у формы, а не уезжает в профиль: 14
     сентября 2026 он там терял набранное условие и видел устаревшее
     «Зарегистрируйся». */
  const accountFromSolveRef = useRef(false)
  const supportReturnPathRef = useRef(currentApplicationPath() === '/support' ? '/app' : currentApplicationPath())
  /* На узком экране ленту разделов листает не окно, а `.product-content`. */
  const routeScrollRef = useRef<HTMLDivElement>(null)
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
          solution,
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
      setSupportOpen(restoredPath === '/support')
    }

    window.addEventListener('popstate', restoreNavigation)
    return () => window.removeEventListener('popstate', restoreNavigation)
  }, [])

  useEffect(() => {
    const route = supportOpen
      ? '/support'
      : selectedSolution
        ? `/solutions/${encodeURIComponent(selectedSolution.textbookId)}/${encodeURIComponent(selectedSolution.task)}`
        : routeDestinations.find((item) => item.label === activeNavigation)?.path ?? '/app'
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

  /* Сначала записываем согласие, ждущее в sessionStorage (Google с вкладки
     «Регистрация»), потом смотрим, есть ли у аккаунта хоть одна отметка.
     Нет ни одной - значит, аккаунт создан без согласия: «Продолжить с
     Google» на вкладке «Вход» его не спрашивал. Такой аккаунт дальше окна
     согласия не пускаем. Сбой запроса никого не запирает: проверка
     повторится при следующей загрузке. */
  useEffect(() => {
    if (!supabaseClient || !user) return
    const client = supabaseClient
    const userId = user.id
    let active = true
    void (async () => {
      await recordPendingLegalAcceptance(client, user.email)
      const { data, error } = await client.from('legal_acceptances').select('id').eq('user_id', userId).limit(1)
      if (!active || error) return
      setLegalGateUserId(data.length === 0 ? userId : null)
    })()
    return () => { active = false }
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
        sessionStorage.removeItem('homework-copilot:verification-email')
        sessionStorage.removeItem('homework-copilot:verification-kind')
        sessionStorage.removeItem('homework-copilot:verification-sent-at')
        if (['verified', 'confirm', 'yandex'].includes(new URLSearchParams(window.location.search).get('auth') ?? '')) setAccountOpen(true)
      }
      if (event === 'SIGNED_OUT') {
        if (sessionStorage.getItem('homework-copilot:verification-email')) setAccountOpen(true)
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

  /* Возврат из Яндекс ID. Код из адреса уже забрал src/main.tsx, здесь он
     меняется на сессию. Окно аккаунта открыто всё это время: новый аккаунт
     без согласия остановит окно согласия, остальные увидят профиль. Флаг
     `active` здесь не нужен: сессию выдаёт Supabase, и повторный заход
     эффекта (StrictMode) возврат уже не найдёт. */
  useEffect(() => {
    if (!supabaseClient || yandexReturnStarted.current) return
    const pending = takeYandexReturn()
    if (!pending) return
    yandexReturnStarted.current = true
    setAccountOpen(true)
    setAccountNotice('Завершаем вход через Яндекс ID…')
    void completeYandexSignIn(supabaseClient, pending).then((message) => {
      const cleanUrl = new URL(window.location.href)
      cleanUrl.searchParams.delete('auth')
      window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`)
      setAccountNotice(message)
    })
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

  /* Возврат из Робокассы: `/app?payment=success&InvId=…`. Адрес только
     говорит, какой заказ спросить: деньги зачисляет уведомление Result или
     сверка, а не эта вкладка. Баланс в окне обновит подписка на кошелёк. */
  const paymentReturnHandled = useRef(false)
  const paymentUserId = user?.id ?? null
  useEffect(() => {
    if (!paymentUserId || paymentReturnHandled.current || !new URLSearchParams(window.location.search).has('payment')) return
    paymentReturnHandled.current = true
    let active = true

    const followPayment = async () => {
      const { loadPaymentStatus, readPaymentReturn, withoutPaymentReturn } = await import('./lib/payments')
      const paymentReturn = readPaymentReturn(window.location.search)
      /* Адреса возврата зарегистрированы у Робокассы и остаются прежними
         (`/app?payment=…`), а после разбора показывается страница баланса:
         с 14 сентября 2026 это `/balance`, а не окно. Запись возврата в
         истории заменяется - «назад» не вернёт на технический адрес. */
      const cleanUrl = new URL(withoutPaymentReturn(window.location.href), window.location.origin)
      if (paymentReturn) cleanUrl.pathname = applicationPath('/balance')
      window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`)
      if (!paymentReturn || !active) return
      setSelectedSolution(null)
      setActiveNavigation('Баланс')
      scrollRouteToTop(routeScrollRef.current)
      if (paymentReturn.outcome === 'fail' || !paymentReturn.invId) {
        setAccountNotice(paymentReturn.outcome === 'fail'
          ? 'Оплата не завершена. Если деньги всё же списались, баланс пополнится сам в течение нескольких минут'
          : 'Баланс пополнится, как только Робокасса подтвердит платёж')
        return
      }
      setAccountNotice('Проверяем платёж…')
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const status = await loadPaymentStatus(paymentReturn.invId)
          if (!active) return
          if (status.status === 'paid') {
            const paidNotice = `Баланс пополнен на ${formatRubles(status.amountKopecks)}`
            setAccountNotice(paidNotice)
            setTasksReturnNotice(paidNotice)
            return
          }
          if (status.status !== 'pending') {
            setAccountNotice('Платёж не прошёл. Если деньги всё же списались, напиши в поддержку')
            return
          }
        } catch {
          // Сбой проверки - не повод пугать: ниже тот же спокойный ответ.
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => window.setTimeout(resolve, 5000))
        if (!active) return
      }
      setAccountNotice('Платёж ещё обрабатывается. Баланс пополнится сам, как только Робокасса его подтвердит')
    }

    void followPayment()
    return () => { active = false }
  }, [paymentUserId])

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
      // Запрос supabase-js ленивый: без then он не уходит вовсе. До 12
      // сентября здесь стоял голый void, и пульс не записал ни одного события.
      void supabaseClient.rpc('track_my_activity', { p_event: event, p_path: currentPath() }).then(() => undefined, () => undefined)
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
  const openSignIn = () => {
    rememberAccountTrigger()
    accountFromSolveRef.current = false
    setAccountNotice('')
    setAccountOpen(true)
  }
  /* С 14 сентября 2026 профиль и баланс - страницы `/profile` и `/balance`.
     Окном остались вход и регистрация гостя, согласие с документами и новый
     пароль. Всё, что звало профиль или кошелёк (шапка, чат, нехватка денег,
     возврат с оплаты), ведёт на страницы; гостю вместо них - вход. */
  const openAccount = () => {
    if (!user) {
      openSignIn()
      return
    }
    navigate('Профиль')
  }
  const openWallet = () => {
    if (!user) {
      openSignIn()
      return
    }
    navigate('Баланс')
  }
  const openAccountPage = (page: 'profile' | 'balance') => navigate(page === 'profile' ? 'Профиль' : 'Баланс')

  /* Вход завершился, пока окно было открыто: профиля в окне больше нет, и
     окно закрывается. Если потоку есть что сказать («Почта подтверждена»,
     «Пароль обновлён», итог входа через Яндекс ID), это показывает страница
     профиля - раньше те же слова стояли над профилем в окне. Без сообщения
     человек остаётся там, где входил. */
  useEffect(() => {
    if (!accountOpen || !user || passwordRecovery) return
    setAccountOpen(false)
    const cleanUrl = new URL(window.location.href)
    cleanUrl.searchParams.delete('auth')
    window.history.replaceState(window.history.state, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`)
    if (!accountNotice) return
    if (accountFromSolveRef.current) {
      // Объяснение про бесплатное решение своё отработало: остаёмся у формы.
      accountFromSolveRef.current = false
      setAccountNotice('')
      return
    }
    if (currentApplicationPath() !== '/profile') window.history.pushState({}, '', applicationPath('/profile'))
    setSelectedSolution(null)
    setActiveNavigation('Профиль')
    scrollRouteToTop(routeScrollRef.current)
  }, [accountNotice, accountOpen, passwordRecovery, user])

  /* Гость, открывший `/profile` или `/balance`, видит вход. Один раз на
     заход в страницу: закрыл окно - остаётся объяснение с кнопкой «Войти»;
     вышедшему из аккаунта окно само не выскакивает. */
  const accountRouteActive = isAccountRoute(activeNavigation)
  useEffect(() => {
    if (!accountRouteActive) {
      accountRouteSignInShownRef.current = null
      return
    }
    if (!authReady || !supabaseClient || accountRouteSignInShownRef.current === activeNavigation) return
    accountRouteSignInShownRef.current = activeNavigation
    if (!user) setAccountOpen(true)
  }, [accountRouteActive, activeNavigation, authReady, supabaseClient, user])
  const closeAccount = useCallback(() => {
    setAccountOpen(false)
    setAccountNotice('')
    setPasswordRecovery(false)
    const cleanUrl = new URL(window.location.href)
    cleanUrl.searchParams.delete('auth')
    window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`)
  }, [])
  // Окно согласия не закрывается мимо: принять документы или выйти.
  const keepLegalGateOpen = useCallback(() => undefined, [])
  const finishPasswordRecovery = useCallback(() => {
    setPasswordRecovery(false)
    setAccountNotice('Пароль обновлён')
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
    const destination = routeDestinations.find((item) => item.label === label)
    if (!destination) return
    const path = solution
      ? `/solutions/${encodeURIComponent(solution.textbookId)}/${encodeURIComponent(solution.task)}`
      : destination.path
    if (currentApplicationPath() !== path) window.history.pushState({}, '', applicationPath(path))
    setSelectedSolution(solution)
    setActiveNavigation(label)
    // Сообщение над профилем или балансом относится к переходу, которым туда
    // попали, и в следующий раздел не переезжает.
    setAccountNotice('')
    scrollRouteToTop(routeScrollRef.current)
  }
  const openSolution = (state: SolutionState) => navigate('Решения', state)

  /* Переходник между формой и очередью: форма отдаёт условие и фото,
     остальное подставляется здесь.

     Предмет теперь задаёт и хранилище решения: `textbookId` — это он же.
     Раньше сюда шёл `selectedTextbookId` из прежнего выбора учебника, и
     задача по русскому языку сохранялась под геометрией — в «Моих решениях»
     она так и подписывалась. */
  /* Форма отдаёт список задач: домашнее задание редко состоит из одной.

     Ставим их по очереди, а не разом: очередь и так решает по одной, а
     последовательная постановка сохраняет порядок, в котором ученик их
     набирал, и не устраивает залп из пяти резервов оплаты сразу. Если
     где-то посередине не хватило денег, поставленные раньше остаются - о
     том, что встало, скажет очередь. */
  /* Уже стоит в очереди этого устройства и ещё не оплачено: деньги
     резервируются, когда задачу принял сервер, а до того баланс её не видит. */
  const queuedUnpaidKopecks = () => visibleJobs
    .filter((job) => job.deviceId === deviceIdRef.current && job.status === 'queued')
    .reduce((sum, job) => {
      const payload = findPendingSolution(job.idempotencyKey) ?? pendingPayloadsRef.current.get(job.idempotencyKey)
      return sum + (payload ? pendingSolutionPrice(payload) : 0)
    }, 0)

  const openBalanceShortfall = (required: number, balance: number) => {
    navigate('Баланс')
    const shortfallNotice = `Не хватает на решение: нужно ${formatRubles(required)}, на балансе ${formatRubles(balance)}. Условия задач сохранены на главной, вернись к ним после пополнения`
    setAccountNotice(shortfallNotice)
    setTasksReturnNotice(shortfallNotice)
  }
  /* Сервер отказал по деньгам уже в очереди: запрос задачи сохранён, и после
     пополнения карточка на главной решит её заново. */
  const openTopUpForJob = (job: SolutionJob) => {
    if (!user) {
      openWallet()
      return
    }
    navigate('Баланс')
    const topUpNotice = `${job.error.replace(/[.\s]+$/u, '')}. Задача ждёт на главной: после пополнения нажми «Решить ещё раз»`
    setAccountNotice(topUpNotice)
    setTasksReturnNotice(topUpNotice)
  }

  const submitFromForm = async (submissions: TaskSubmission[]) => {
    /* Гостю положено одно бесплатное решение (`claim_guest_solution`), и
       форма это уже говорит. Здесь страховка: вторая задача гостя - или
       новая, пока бесплатная ещё решается, - встала бы в очередь и через
       минуту упала бы отказом базы. Лучше сказать сразу. */
    if (supabaseClient && !user && !guestFreeSolutionUsed) {
      const freeTaskRunning = visibleJobs.some((job) => isActiveJob(job) && job.deviceId === deviceIdRef.current)
      if (submissions.length > 1 || freeTaskRunning) {
        rememberAccountTrigger()
        accountFromSolveRef.current = true
        setAccountNotice(freeTaskRunning
          ? 'Бесплатная задача уже решается. Следующие решаются в аккаунте: новому аккаунту 20 ₽, один раз на устройство'
          : 'Без аккаунта бесплатно решается одна задача. Несколько сразу решаются в аккаунте: новому аккаунту 20 ₽, один раз на устройство')
        setAccountOpen(true)
        return false
      }
    }
    // Нехватку видно сразу за все задачи формы: иначе часть встала бы в
    // очередь, а остальные пропали бы вместе с очищенной формой.
    if (supabaseClient && user && account) {
      const required = queuedUnpaidKopecks() + submissions.reduce((sum, submission) => sum + pendingSolutionPrice(submission), 0)
      if (account.balance < required) {
        openBalanceShortfall(required, account.balance)
        return false
      }
    }
    let queued = false
    for (const submission of submissions) {
      // eslint-disable-next-line no-await-in-loop
      const accepted = await enqueueTask({
        // Срез обрезается по границе слова trim-ом: сервер всё равно прогоняет
        // подпись через trim, и различие в хвостовой пробел ломало сверку.
        task: submission.condition.slice(0, 60).trim() || 'Задача с фото',
        source: submission.source,
        idempotencyKey: submission.idempotencyKey,
        textbookId: findSubjectByName(submission.subject)?.id ?? selectedTextbookId,
        subject: submission.subject,
        ...(submission.condition ? { condition: submission.condition } : {}),
        ...(submission.imageDataUrl ? { imageDataUrl: submission.imageDataUrl } : {}),
        ...(submission.grade ? { grade: submission.grade } : {}),
      })
      if (!accepted) return queued
      queued = true
    }
    return queued
  }

  // Гость держит очередь на своей метке браузера: аккаунта у него нет,
  // а видеть ход решения он должен так же, как все.
  const guestJobId = useMemo(() => (supabaseClient && !user ? getGuestId() : null), [supabaseClient, user])
  // Предметы, флаги и баннер из админки.
  const publicConfig = usePublicConfig(supabaseClient, guestJobId)
  const availableSubjects = useMemo(() => orderedSubjects(publicConfig), [publicConfig])
  const chatEnabled = featureEnabled(publicConfig, 'ai_chat')
  const scheduleEnabled = featureEnabled(publicConfig, 'schedule')
  const hiddenNavigation = useMemo(() => [
    ...(chatEnabled ? [] : ['ИИ-чат' as const]),
    ...(scheduleEnabled ? [] : ['Расписание' as const]),
  ], [chatEnabled, scheduleEnabled])

  useEffect(() => {
    if (supabaseClient) installClientErrorReporting(supabaseClient)
  }, [supabaseClient])

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
     Вызов безопасен: база возвращает деньги только если решение не выдано.

     Смотрим строку базы, а не местную отметку: с 16 сентября возврат из
     браузера проходит только за задачу, закрытую в базе (аудит, Б12), а
     местный провал вкладка ставит раньше, чем закрытие дойдёт до базы. */
  useEffect(() => {
    if (!supabaseClient || !user) return
    const abandoned = remoteJobs.filter((job) => (
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
  }, [refreshAccount, remoteJobs, supabaseClient, user])

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
     списание, а в очереди — вечное «решается». Потолок функции 300 секунд,
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
  const sendSolutionJob = useCallback(async (job: SolutionJob, payload: PendingSolution): Promise<SolutionState | null> => {
    const textbook = getTextbook(payload.textbookId, availableTextbooks)
    const solvingAsGuest = Boolean(supabaseClient) && !user

    const solveRequest: SolveHomeworkRequest = {
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
      /* У задачи с фотографии текст ученика - пометка, а не условие:
         условие на снимке. Как `condition` эта пометка однажды поехала
         в промпт «проверенным условием», и модель разобрала подпись
         «Решить задачу 1 про образование воды» вместо самой задачи. */
      ...(payload.condition
        ? (payload.source === 'photo' ? { note: payload.condition } : { condition: payload.condition })
        : {}),
      ...(payload.imageDataUrl ? { imageDataUrl: payload.imageDataUrl } : {}),
    }
    const body = JSON.stringify(solveRequest)
    // Расписку сервер даёт, прочитав тело целиком: тяжёлому фото - дольше.
    const acceptLimitMs = serverAcceptLimitFor(body.length)

    /* Сторож приёма.

       Получив задачу, сервер сразу ставит ей стадию в очереди - это его
       расписка. Нет расписки через `serverAcceptLimitFor` - запрос до него не
       дошёл, и держать его дальше незачем: решатель не считает, денег не
       резервировал. Обрываем сами и говорим ученику правду вместо «Читаем»
       на двадцать минут. Строка, которой в базе нет, расписки дать не может -
       такую задачу не трогаем. */
    const serverKnows = (row: SolutionJob | undefined) => !row || row.startedAt !== '' || row.status !== 'queued'
    const remoteRow = () => remoteJobsRef.current.find((entry) => entry.idempotencyKey === job.idempotencyKey)
    const abort = new AbortController()
    const watchdog = window.setTimeout(async () => {
      if (!supabaseClient) return
      // Опрос мог отстать на пару секунд: перед обрывом смотрим в базу сами.
      const fresh = await listSolutionJobs(supabaseClient, guestJobId)
      if (fresh) setRemoteJobs(fresh)
      const row = (fresh ?? remoteJobsRef.current).find((entry) => entry.idempotencyKey === job.idempotencyKey)
      if (!serverKnows(row)) abort.abort(new SolutionNotAcceptedError(acceptLimitMs))
    }, acceptLimitMs)

    try {
      let accessToken: string | undefined
      if (supabaseClient && user) {
        const { data, error } = await untilAborted(supabaseClient.auth.getSession(), abort.signal)
        accessToken = data.session?.access_token
        if (error && !accessToken) throw new Error('Не получилось проверить вход: нет связи с сервером. Проверь интернет и нажми «Решить ещё раз»')
        if (!accessToken) throw new Error('Сессия закончилась. Войди в аккаунт ещё раз')
      }

      const { solution: generatedSolution, receipt } = await requestHomeworkSolution(
        import.meta.env.VITE_HOMEWORK_API_URL || applicationPath('/api/solve'),
        solveRequest,
        accessToken,
        solvingAsGuest ? getGuestId() : null,
        abort.signal,
        body,
      )

      if (receipt) {
        const key = receiptKey(generatedSolution.textbookId, generatedSolution.task, generatedSolution.source)
        setSolveReceipts((current) => withReceipt(current, key, receipt))
      }

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
         готовый ответ подхватывает восстановление ниже.

         Ответ «эту задачу уже решает другой запрос» - то же самое, и
         расписку тут ждать не нужно: её дал тот запрос. */
      if (error instanceof SolutionInProgressError
        || (error instanceof SolutionConnectionLostError && serverKnows(remoteRow()))) {
        markLocalJob(job, { status: 'running', error: '' })
        void refreshJobs()
        return null
      }

      /* Связь оборвалась, а расписки сервера нет - значит, задача до него не
         дошла. Ждать здесь нечего: это не «решение продолжает готовиться»,
         а сеть, которая не пропустила запрос. */
      const reason = error instanceof SolutionConnectionLostError
        ? 'Задача не дошла до сервера решений: соединение оборвалось. Попробуй ещё раз или смени сеть'
        : error instanceof SolutionNotAcceptedError
          ? error.message
          : error instanceof Error ? error.message : 'Не получилось подготовить решение'
      // Запрос остаётся в хранилище: по нему работает «Решить ещё раз», и
      // ученику не придётся заново набирать условие или искать фотографию.
      markLocalJob(job, { status: 'failed', stage: 'failed', error: reason, finishedAt: new Date().toISOString() })
      if (supabaseClient) await closeSolutionJob(supabaseClient, job.idempotencyKey, 'failed', reason, guestJobId)
      void refreshJobs()
      return null
    } finally {
      window.clearTimeout(watchdog)
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

    /* Замок на ключ: вторая вкладка этого браузера ту же задачу не шлёт.
       Не достался - задача остаётся «в работе» здесь и дальше идёт по опросу
       базы; закрывать её нельзя, её решает соседняя вкладка. */
    const locked = await runWithJobLock(job.idempotencyKey, () => sendSolutionJob(job, payload))
    return locked.acquired ? locked.value : null
  }, [guestJobId, markLocalJob, sendSolutionJob, supabaseClient])

  /* Сорвавшаяся задача не держит фото дольше срока, решённая и снятая - вовсе
     (аудит 16 сентября, В11). */
  useEffect(() => {
    if (!pendingSolutionsReady) return
    prunePendingSolutions(remoteJobs)
  }, [pendingSolutionsReady, remoteJobs])

  /* Гость, перезагрузивший страницу посреди бесплатного решения, должен
     помнить, что оно израсходовано: метку ставил ответ, который умер вместе
     со старой вкладкой, и вторая задача получала отказ базы уже в очереди. */
  useEffect(() => {
    if (!supabaseClient || user || guestFreeSolutionUsed) return
    // Только решённая: сорвавшаяся возвращает попытку, а идущую и так
    // стережёт `submitFromForm`.
    const spent = remoteJobs.some((job) => job.status === 'done')
    if (!spent) return
    rememberGuestSolutionUsed()
    setGuestFreeSolutionUsed(true)
  }, [guestFreeSolutionUsed, remoteJobs, supabaseClient, user])

  /* Кто идёт в работу следующим.

     Очередь двигается сама: как только освобождается место, берётся самая
     ранняя задача этого устройства. Чужие задачи не трогаем — иначе одна и та
     же задача уйдёт в модель дважды и спишется дважды. */
  useEffect(() => {
    // Пока запросы не дочитаны из IndexedDB, задачу с фото нечем отправить.
    if (!pendingSolutionsReady) return
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
  }, [dispatchTick, pendingSolutionsReady, runSolutionJob, visibleJobs])

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
    /* Имя задачи для фотографии - «photo-» и ключ запроса без приставки
       «solution-». Прежде хвост в 44 знака резался от всего ключа, а он
       ровно на знак длиннее: в базу и в адрес страницы уходило
       «photo-olution-<uuid>» с откушенной буквой. */
    /* Задача текстом подписывается так же - «text-» и ключ (аудит 16
       сентября, Б1). Прежде подписью были первые 60 знаков условия, и две
       задачи с общим началом («Решите неравенство ...: 2x > 4» и «... 3x < 9»)
       считались одной: вторая открывала решение первой, а новое решение
       затирало оплаченное. Старые решения с подписью-срезом остаются
       открываемыми: адрес и поиск по подписи для них прежние. */
    const keyTail = submission.idempotencyKey.replace(/^solution-/, '').replace(/[^a-z0-9-]/gi, '').slice(-44)
    const resolvedTask = submission.source === 'photo'
      ? 'photo-' + keyTail
      : submission.source === 'text' ? 'text-' + keyTail : submission.task
    // Цена этой задачи, а не пол цены: длинное условие, фото и счётный
    // предмет дороже, и пол пропускал задачу, на которую денег уже нет.
    const solutionPrice = pendingSolutionPrice(submission)

    // Первое решение выдаётся без аккаунта. Регистрацию просим только когда
    // бесплатный разбор уже израсходован: до этого человек не видел продукт
    // и не понимает, за что его просят завести аккаунт.
    const solvingAsGuest = Boolean(supabaseClient) && !user
    if (solvingAsGuest && guestFreeSolutionUsed) {
      rememberAccountTrigger()
      accountFromSolveRef.current = true
      setAccountNotice('Бесплатное решение уже использовано. Зарегистрируйся — новому аккаунту 20 ₽, один раз на устройство: это пять задач по минимальной цене')
      setAccountOpen(true)
      return false
    }

    const previouslyGenerated = visibleGeneratedSolutions.find((solution) => (
      // Повтор отдаём только записью нынешнего движка: иначе ученик получит
      // старый формат вместо того, за чем пришёл, и без объяснения.
      isCurrentEngineSolution(solution)
      && solution.textbookId === submission.textbookId
      // У текста подпись теперь своя у каждой постановки: то же условие
      // узнаётся по самому условию, а не по подписи.
      && (submission.source === 'text' ? Boolean(submission.condition) : solution.task === resolvedTask)
      && solution.source === submission.source
      && solution.textbookEdition === textbook.edition
      && solution.sourceUrl === (textbook.sourceUrl ?? '')
      && (!submission.condition || solution.conditionNormalized === normalizeTaskCondition(submission.condition))
    ))
    if (previouslyGenerated) {
      openSolution({ mode: 'ready', textbookId: submission.textbookId, task: previouslyGenerated.task, source: submission.source })
      return true
    }

    const requiredKopecks = queuedUnpaidKopecks() + solutionPrice
    if (supabaseClient && user && account && account.balance < requiredKopecks) {
      openBalanceShortfall(requiredKopecks, account.balance)
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

  // Бан со сроком: после срока доступ открыт, даже если cron ещё не снял строку.
  if (user && account?.control?.is_banned && (!account.control.banned_until || new Date(account.control.banned_until).getTime() > Date.now())) {
    return <AccountBlockedScreen reason={account.control.ban_reason} onSignOut={signOutBlockedAccount} />
  }

  return (
    <main className="product-shell">
      <ProductTopbar theme={theme} activeLabel={activeNavigation} onNavigate={navigate} onToggleTheme={toggleTheme} user={user} account={account} onOpenAccount={openAccount} onOpenWallet={openWallet} hiddenLabels={hiddenNavigation} />
      <div className="product-content" ref={routeScrollRef}>
        {publicConfig.banner.enabled && <SiteBannerStrip banner={publicConfig.banner} />}
        <div className="product-route">
          {activeNavigation === 'Главная' && <PageHeader account={account} />}
          {activeNavigation === 'Главная' ? (
            <div className="home-content">
              <CopyTask
                onSubmit={submitFromForm}
                onRequireAccount={openAccount}
                // Без Supabase гостевых правил нет (как у `solvingAsGuest`):
                // бесплатное решение там не считается, и задач можно несколько.
                signedIn={Boolean(user) || !authIsConfigured}
                freeSolutionUsed={guestFreeSolutionUsed}
                defaultGrade={account?.profile.grade ? `${account.profile.grade} класс` : ''}
                subjects={availableSubjects}
                photoEnabled={featureEnabled(publicConfig, 'photo_input')}
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
                    onTopUp={openTopUpForJob}
                    receiptOf={(job) => solveReceipts[receiptKey(job.textbookId, job.task, job.source)] ?? null}
                  />
                  {user && (
                    <MySolutions
                      items={personalSolutions}
                      subjectOf={(textbookId) => getTextbook(textbookId, availableTextbooks).subject}
                      onOpenAll={() => navigate('Решения')}
                      onOpenSolution={openSolution}
                    />
                  )}
                </div>
              )}
            </div>
          ) : selectedSolution ? (
            <SolutionErrorBoundary key={`${selectedSolution.textbookId}/${selectedSolution.task}`} onGoHome={() => navigate('Главная')}>
            <UnderstandingPage
              solution={selectedSolution}
              generatedSolution={visibleGeneratedSolutions.find(
                (solution) => solution.textbookId === selectedSolution.textbookId && solution.task === selectedSolution.task,
              )}
              receipt={solveReceipts[receiptKey(selectedSolution.textbookId, selectedSolution.task, selectedSolution.source)] ?? null}
              onGoHome={() => navigate('Главная')}
              onOpenSupport={(context) => openSupport('wrong_solution', context)}
              guestOffer={Boolean(supabaseClient) && !user}
              onOpenAccount={openAccount}
              ratingClient={featureEnabled(publicConfig, 'solution_rating') ? supabaseClient : null}
              ratingGuestId={user ? null : guestJobId}
            />
            </SolutionErrorBoundary>
          ) : isAccountRoute(activeNavigation) ? (
            <Suspense fallback={<div className="route-loading" role="status">Загружаем аккаунт…</div>}>
              {activeNavigation === 'Профиль' ? (
                <ProfilePage
                  user={user}
                  account={account}
                  notice={accountNotice}
                  theme={theme}
                  onToggleTheme={toggleTheme}
                  onReloadAccount={refreshAccount}
                  onNavigate={openAccountPage}
                  onSignIn={openSignIn}
                  onSignedOut={() => navigate('Главная')}
                />
              ) : (
                <BalancePage
                  user={user}
                  account={account}
                  notice={accountNotice}
                  promoEnabled={featureEnabled(publicConfig, 'promo_codes')}
                  onReloadAccount={refreshAccount}
                  onNavigate={openAccountPage}
                  onSignIn={openSignIn}
                  onBackToTasks={accountNotice && accountNotice === tasksReturnNotice ? () => navigate('Главная') : undefined}
                  onOpenSupport={() => openSupport()}
                />
              )}
            </Suspense>
          ) : activeNavigation === 'ИИ-чат' ? (
            chatEnabled
              ? <Suspense fallback={<div className="route-loading" role="status">Загружаем чат…</div>}><ChatPage userId={user?.id ?? null} onRequireAuth={openAccount} onOpenWallet={openWallet} /></Suspense>
              : <FeatureOffNotice title="ИИ-чат временно выключен" onGoHome={() => navigate('Главная')} />
          ) : activeNavigation === 'Расписание' ? (
            scheduleEnabled
              ? <Suspense fallback={<div className="route-loading" role="status">Загружаем расписание…</div>}><SchedulePage userId={user?.id ?? null} grade={account?.profile.grade ?? null} /></Suspense>
              : <FeatureOffNotice title="Расписание временно выключено" onGoHome={() => navigate('Главная')} />
          ) : (
            <SolutionsPage
              signedIn={Boolean(user)}
              items={personalSolutions}
              subjectOf={(textbookId) => getTextbook(textbookId, availableTextbooks).subject}
              onOpenAccount={openAccount}
              onOpenSolution={openSolution}
              onStartTask={() => navigate('Главная')}
            />
          )}
        </div>
        {/* Подвал тот же, что на витрине и в документах: 14 сентября
            владелец увидел в разделах два разных подвала. */}
        <SiteFooter onOpenSupport={() => openSupport()} />
      </div>
      {/* Плавающая поддержка - на каждой странице и в одном углу, включая
          главную. Форма «Решить» оставляет этот угол свободным сама. */}
      <SupportLauncher onClick={() => openSupport()} />
      {supportOpen && createPortal(
        <SupportCenter user={user} supabaseClient={supabaseClient} initialCategory={supportCategory} initialContext={supportContext} onRequireAuth={openAccount} onClose={closeSupport} />,
        document.body,
      )}
      {/* Окно - только вход гостя, согласие и новый пароль: вошедшему профиль
          и баланс показывают страницы (14 сентября 2026). */}
      {(legalAcceptanceRequired || (accountOpen && (!user || passwordRecovery))) && (
        <Suspense fallback={null}>
          <AccountDialog
            user={user}
            passwordRecovery={passwordRecovery}
            notice={accountNotice}
            onClose={legalAcceptanceRequired ? keepLegalGateOpen : closeAccount}
            returnFocusRef={accountTriggerRef}
            legalAcceptanceRequired={legalAcceptanceRequired}
            onLegalAccepted={() => setLegalGateUserId(null)}
            onPasswordUpdated={finishPasswordRecovery}
            authMethods={{ yandex: featureOptIn(publicConfig, 'auth_yandex'), phone: featureOptIn(publicConfig, 'auth_phone') }}
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
  if (import.meta.env.DEV && NotebookCanvas && AuditSheets && DesignSystemPlayground) {
    if (params.get('canvas') === '1') {
      return <Suspense fallback={null}><NotebookCanvas /></Suspense>
    }

    // Записи аудита 15 сентября по всем предметам одним списком: по ним
    // сверяется оформление листа без вызова модели.
    if (params.get('sheets') === '1') {
      return <Suspense fallback={null}><AuditSheets /></Suspense>
    }

    if (params.get('design-system') === '1') {
      return <Suspense fallback={null}><DesignSystemPlayground /></Suspense>
    }
  }

  /* Документы живут под /docs/ с 14 сентября 2026. Прежние адреса (/terms,
     /agreement, /privacy и остальные) уже разошлись в письмах и отметках
     согласия, поэтому открывают тот же документ, а адрес переписывается на
     новый - как `/main` на `/app`. Переписывается до отрисовки: подвал
     отмечает открытый документ по текущему адресу. Запрос и якорь
     (`#section-8`) едут вместе с адресом. */
  const legalKind = legalDocumentKind(pathname)
  if (legalKind) {
    const documentPath = `/docs/${legalKind}`
    if (pathname !== documentPath) {
      window.history.replaceState(window.history.state, '', `${applicationPath(documentPath)}${window.location.search}${window.location.hash}`)
    }
    return <><LegalPage kind={legalKind} /><PrivacyNotice /></>
  }

  if (pathname === '/admin') {
    return <Suspense fallback={null}><AdminApp /></Suspense>
  }

  if (!isKnownApplicationPath(pathname)) {
    applySeoMetadata(getSeoMetadata(pathname))
    return <><NotFoundPage /><PrivacyNotice /></>
  }

  return <><HomePage /><PrivacyNotice /></>
}

export default App
