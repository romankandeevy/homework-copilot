import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import {
  Atom,
  ArrowRight,
  BookOpenText,
  CalendarDots,
  CaretDown,
  CaretRight,
  Check,
  CheckCircle,
  ClockCountdown,
  Flask,
  Hash,
  House,
  ImageSquare,
  LinkSimple,
  MagnifyingGlass,
  Moon,
  Notebook,
  ShoppingCartSimple,
  SpinnerGap,
  Stack,
  Sun,
  UploadSimple,
  UserCircle,
  X,
} from '@phosphor-icons/react'
import LegalPage from './LegalPage'
import NotebookCanvas from './NotebookCanvas'
import { GeometryNotebookLayoutV1 } from './notebook/GeometryNotebookLayoutV1'
import { geometryFixtures } from './notebook/fixtures'
import type { GeometryNotebookPageSpec } from './notebook/geometry/types'
import type { Database } from './lib/database.types'
import type { AccountData } from './lib/supabase'
import type { HomeworkSolution, HomeworkSource } from './lib/homeworkContract'
import { formatRubles } from './lib/currency'
import { useModalIsolation } from './lib/useModalIsolation'
import { getSolutionPrice } from './lib/solutionPricing'
import {
  loadGeneratedSolutions,
  parseStoredHomeworkSolution,
  prepareTaskPhoto,
  requestHomeworkSolution,
  saveGeneratedSolutions,
} from './lib/homeworkSolution'
import TextbookLibraryPage from './textbooks/TextbookLibraryPage'
import './App.css'

const DesignSystemPlayground = lazy(() => import('./DesignSystemPlayground'))
const AccountDialog = lazy(() => import('./account/AccountDialog'))
const SchedulePage = lazy(() => import('./SchedulePage'))

type Theme = 'light' | 'dark'
type AccountView = 'profile' | 'wallet'
type TextbookId = string
type TextbookSourceType = 'pdf' | 'epub' | 'image' | 'link' | 'official'

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
  { label: 'Главная', path: '/main', icon: House },
  { label: 'Решения', path: '/solutions', icon: Notebook },
  { label: 'ЦДЗ', path: '/cdz', icon: Stack },
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
  return path === '/' ? '/main' : path
}

const textbooks: readonly Textbook[] = [
  {
    id: 'geometry',
    subject: 'Геометрия',
    grade: '8 класс',
    title: 'Геометрия. 7-9 классы',
    authors: 'Л. С. Атанасян, В. Ф. Бутузов и др.',
    edition: 'Просвещение',
    solvedTasks: ['123'],
    icon: BookOpenText,
    sourceUrl: '/textbooks/geometry-7-9-atanasyan.pdf',
    sourceType: 'pdf',
    previewBeforeReading: true,
  },
  {
    id: 'physics',
    subject: 'Физика',
    grade: '8 класс',
    title: 'Физика. 8 класс',
    authors: 'И. М. Перышкин, А. И. Иванов',
    edition: 'Просвещение',
    solvedTasks: [],
    icon: Atom,
    sourceUrl: '/textbooks/physics-8-peryshkin-2026.pdf',
    sourceType: 'pdf',
    previewBeforeReading: true,
  },
  {
    id: 'chemistry',
    subject: 'Химия',
    grade: '8 класс',
    title: 'Химия. 8 класс. Базовый уровень',
    authors: 'О. С. Габриелян, И. Г. Остроумов, С. А. Сладков',
    edition: 'Просвещение',
    solvedTasks: [],
    icon: Flask,
    sourceUrl: '/textbooks/chemistry-8-gabrielyan-2025.pdf',
    sourceType: 'pdf',
    previewBeforeReading: true,
  },
] as const

function getTextbook(id: TextbookId, items: readonly Textbook[] = textbooks) {
  return items.find((textbook) => textbook.id === id) ?? items[0] ?? textbooks[0]
}

function getTextbookSourceTypeFromUrl(url: URL): TextbookSourceType {
  if (/\.pdf$/i.test(url.pathname)) return 'pdf'
  if (/\.epub$/i.test(url.pathname)) return 'epub'
  if (/\.(png|jpe?g|webp)$/i.test(url.pathname)) return 'image'
  return 'link'
}

function createFileTextbook(file: File): Textbook {
  const title = file.name.replace(/\.[^.]+$/, '')
  const sourceType = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    ? 'pdf'
    : /\.epub$/i.test(file.name)
      ? 'epub'
      : 'image'

  return {
    id: `file-${Date.now()}`,
    subject: 'Мой учебник',
    grade: '8 класс',
    title,
    authors: 'Добавлен с устройства',
    edition: file.name,
    solvedTasks: [],
    icon: BookOpenText,
    sourceUrl: URL.createObjectURL(file),
    sourceType,
  }
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" focusable="false">
        <path className="brand-mark-h" d="M3 4H7V14H13V4H17V28H13V18H7V28H3Z" />
        <path className="brand-mark-c" d="M29 4H25.25C20.6 4 18 7.85 18 16S20.6 28 25.25 28H29V24H25.65C23.15 24 22 21.35 22 16S23.15 8 25.65 8H29Z" />
      </svg>
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

function TextbookPicker({
  selected,
  items,
  onSelect,
  onCreate,
  open,
  onOpenChange,
}: {
  selected: Textbook
  items: readonly Textbook[]
  onSelect: (id: TextbookId) => void
  onCreate: (textbook: Textbook) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const SelectedIcon = selected.icon
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [query, setQuery] = useState('')
  const [internalOpen, setInternalOpen] = useState(false)
  const [importMode, setImportMode] = useState<'link' | 'file'>('link')
  const [link, setLink] = useState('')
  const [importError, setImportError] = useState('')
  const isOpen = open ?? internalOpen
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru')
    if (!normalized) return items
    return items.filter((textbook) => `${textbook.subject} ${textbook.title} ${textbook.authors} ${textbook.grade}`.toLocaleLowerCase('ru').includes(normalized))
  }, [items, query])

  const setDialogOpen = useCallback((nextOpen: boolean) => {
    if (onOpenChange) onOpenChange(nextOpen)
    else setInternalOpen(nextOpen)
  }, [onOpenChange])
  const closeDialog = useCallback(() => {
    setDialogOpen(false)
    setQuery('')
    setImportError('')
  }, [setDialogOpen])
  const dialogRef = useModalIsolation<HTMLElement>(isOpen, closeDialog, triggerRef)

  const selectTextbook = (id: TextbookId) => {
    onSelect(id)
    closeDialog()
  }

  const addFromLink = () => {
    const value = link.trim()
    if (!value) return

    try {
      const normalizedLink = /^https?:\/\//i.test(value) ? value : `https://${value}`
      const url = new URL(normalizedLink)
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('invalid link')
      const hostname = url.hostname.replace(/^www\./, '')
      const textbook: Textbook = {
        id: `link-${Date.now()}`,
        subject: 'Мой учебник',
        grade: '8 класс',
        title: hostname,
        authors: 'Добавлен по ссылке',
        edition: url.href,
        solvedTasks: [],
        icon: BookOpenText,
        sourceUrl: url.href,
        sourceType: getTextbookSourceTypeFromUrl(url),
      }
      onCreate(textbook)
      setLink('')
      closeDialog()
    } catch {
      setImportError('Проверь ссылку на учебник')
    }
  }

  const addFromFile = (file: File | null) => {
    if (!file) return
    const allowedExtension = /\.(pdf|epub|png|jpe?g|webp)$/i.test(file.name)
    if (!allowedExtension) {
      setImportError('Подойдёт PDF, EPUB или изображение')
      return
    }
    onCreate(createFileTextbook(file))
    closeDialog()
  }

  return (
    <div className="textbook-picker">
      <button ref={triggerRef} className="textbook-picker-trigger" type="button" aria-haspopup="dialog" aria-expanded={isOpen} onClick={() => setDialogOpen(true)}>
        <SelectedIcon size={32} weight="duotone" aria-hidden="true" />
        <span>
          <small>Учебник</small>
          <strong>{selected.subject}, {selected.grade}</strong>
          <em>{selected.title} · {selected.authors}</em>
        </span>
        <span className="textbook-change">Сменить <CaretDown size={17} weight="bold" aria-hidden="true" /></span>
      </button>

      {isOpen && createPortal((
        <div className="textbook-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDialog()
        }}>
          <section ref={dialogRef} className="textbook-dialog" role="dialog" aria-modal="true" aria-labelledby="textbook-dialog-title" tabIndex={-1}>
            <header className="textbook-dialog-header">
              <div>
                <h2 id="textbook-dialog-title">Выбери учебник</h2>
                <p>Сохранённый учебник или новый по ссылке и файлу.</p>
              </div>
              <button type="button" onClick={closeDialog} aria-label="Закрыть выбор учебника"><X size={20} weight="bold" aria-hidden="true" /></button>
            </header>

            <div className="textbook-dialog-content">
              <div className="textbook-library">
                <label htmlFor="textbook-search">Сохранённые учебники</label>
                <div className="textbook-search-control">
                  <MagnifyingGlass size={19} weight="duotone" aria-hidden="true" />
                  <input
                    id="textbook-search"
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Название или автор"
                    autoComplete="off"
                    autoFocus
                  />
                </div>
                <div className="textbook-options" role="listbox" aria-label="Сохранённые учебники">
                  {filtered.map((textbook) => {
                    const Icon = textbook.icon
                    const active = textbook.id === selected.id
                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={active ? 'is-selected' : ''}
                        key={textbook.id}
                        onClick={() => selectTextbook(textbook.id)}
                      >
                        <Icon size={28} weight="duotone" aria-hidden="true" />
                        <span><strong>{textbook.subject}, {textbook.grade}</strong><small>{textbook.title} · {textbook.authors}</small></span>
                        {active && <Check size={17} weight="bold" aria-hidden="true" />}
                      </button>
                    )
                  })}
                  {filtered.length === 0 && <p className="textbook-empty">Среди сохранённых учебников ничего не найдено.</p>}
                </div>
              </div>

              <aside className="textbook-import" aria-labelledby="textbook-import-title">
                <div>
                  <h3 id="textbook-import-title">Добавить учебник</h3>
                  <p>Импортируем название и выберем его для задачи.</p>
                </div>
                <div className="textbook-import-tabs" role="tablist" aria-label="Способ добавления">
                  <button id="textbook-import-link-tab" type="button" role="tab" aria-controls="textbook-import-panel" aria-selected={importMode === 'link'} className={importMode === 'link' ? 'is-active' : ''} onClick={() => { setImportMode('link'); setImportError('') }}><LinkSimple size={18} weight="duotone" aria-hidden="true" /> Ссылка</button>
                  <button id="textbook-import-file-tab" type="button" role="tab" aria-controls="textbook-import-panel" aria-selected={importMode === 'file'} className={importMode === 'file' ? 'is-active' : ''} onClick={() => { setImportMode('file'); setImportError('') }}><UploadSimple size={18} weight="duotone" aria-hidden="true" /> Файл</button>
                </div>

                <div id="textbook-import-panel" role="tabpanel" aria-labelledby={importMode === 'link' ? 'textbook-import-link-tab' : 'textbook-import-file-tab'} tabIndex={0}>
                {importMode === 'link' ? (
                  <div className="textbook-link-import">
                    <label htmlFor="textbook-link">Ссылка на учебник</label>
                    <input id="textbook-link" type="url" value={link} onChange={(event) => { setLink(event.target.value); setImportError('') }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addFromLink() } }} placeholder="example.com/textbook.pdf" autoComplete="url" />
                    <button type="button" onClick={addFromLink} disabled={!link.trim()}>Добавить по ссылке <ArrowRight size={18} weight="bold" aria-hidden="true" /></button>
                  </div>
                ) : (
                  <div className="textbook-file-import">
                    <input id="textbook-file" type="file" accept=".pdf,.epub,image/jpeg,image/png,image/webp" onChange={(event) => addFromFile(event.target.files?.[0] ?? null)} />
                    <label htmlFor="textbook-file"><UploadSimple size={28} weight="duotone" aria-hidden="true" /><span><strong>Выбрать файл</strong><small>PDF, EPUB, JPG, PNG или WEBP</small></span></label>
                  </div>
                )}
                </div>
                {importError && <p className="textbook-import-error" role="alert">{importError}</p>}
              </aside>
            </div>
          </section>
        </div>
      ), document.body)}
    </div>
  )
}

function TaskConditionPreview({ textbookId, taskNumber }: { textbookId: TextbookId; taskNumber: string }) {
  const task = textbookId === 'geometry'
    ? geometryFixtures.find((fixture) => fixture.number === taskNumber)
    : undefined

  if (!task) return null

  const isMedian = task.diagram.kind === 'median-triangle'
  const isRight = task.diagram.kind === 'right-triangle'

  return (
    <section className="task-condition-preview" aria-labelledby="task-condition-title">
      <div className="task-condition-copy">
        <span id="task-condition-title">Условие задачи № {task.number}</span>
        <p>{task.condition}</p>
      </div>
      <svg className="task-condition-diagram" viewBox="0 0 156 116" role="img" aria-label={task.diagram.description}>
        <path d={isRight ? 'M32 91V24L128 91Z' : 'M22 92L78 20L134 92Z'} />
        {isMedian && <path d="M78 20V92" />}
        {isRight && <path d="M32 76H47V91" />}
        {!isMedian && !isRight && <>
          <path d="M42 67l8 6M108 73l8-6" />
          <path d="M68 34q10 10 20 0" />
          <text x="78" y="53" textAnchor="middle">40°</text>
        </>}
        <text x={isRight ? 24 : 12} y={isRight ? 105 : 107}>A</text>
        <text x={isRight ? 25 : 74} y={isRight ? 18 : 15}>B</text>
        <text x="137" y="107">C</text>
        {isMedian && <text x="74" y="108">M</text>}
      </svg>
    </section>
  )
}

function CopyTask({
  taskNumber,
  textbook,
  textbooks,
  onTaskNumberChange,
  onTextbookChange,
  onCreateTextbook,
  onSubmit,
  textbookPickerOpen,
  onTextbookPickerOpenChange,
}: {
  taskNumber: string
  textbook: Textbook
  textbooks: readonly Textbook[]
  onTaskNumberChange: (value: string) => void
  onTextbookChange: (id: TextbookId) => void
  onCreateTextbook: (textbook: Textbook) => void
  onSubmit: (task: string, ready: boolean, source: HomeworkSource, idempotencyKey: string, photo?: File) => Promise<boolean>
  textbookPickerOpen: boolean
  onTextbookPickerOpenChange: (open: boolean) => void
}) {
  const [error, setError] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const submissionRef = useRef(false)
  const normalizedTask = taskNumber.trim()
  const readyInBase = textbook.solvedTasks.includes(normalizedTask)
  const canSubmit = Boolean(normalizedTask || photo)
  const solutionPrice = photo ? 15 : normalizedTask ? getSolutionPrice(textbook.id, normalizedTask) : 5

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submissionRef.current) return
    const submissionKey = typeof crypto.randomUUID === 'function'
      ? `solution-${crypto.randomUUID()}`
      : `solution-${Date.now()}-${Math.random().toString(16).slice(2)}`

    if (photo) {
      setError('')
      submissionRef.current = true
      setIsSubmitting(true)
      try {
        await onSubmit(photo.name, false, 'photo', submissionKey, photo)
      } catch (submissionError) {
        setError(submissionError instanceof Error ? submissionError.message : 'Не получилось отправить фотографию задачи')
      } finally {
        submissionRef.current = false
        setIsSubmitting(false)
      }
      return
    }
    if (!/^\d{1,4}$/.test(normalizedTask)) {
      setError('Номер задачи: от 1 до 4 цифр')
      return
    }
    setError('')
    submissionRef.current = true
    setIsSubmitting(true)
    try {
      await onSubmit(normalizedTask, readyInBase, 'number', submissionKey)
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Не получилось отправить задачу')
    } finally {
      submissionRef.current = false
      setIsSubmitting(false)
    }
  }

  const changeTaskNumber = (value: string) => {
    const nextValue = value.slice(0, 4)
    if (!/^\d*$/.test(nextValue)) {
      setError('Номер задачи: от 1 до 4 цифр')
      return
    }
    if (error) setError('')
    if (nextValue) {
      setPhoto(null)
      if (photoInputRef.current) photoInputRef.current.value = ''
    }
    onTaskNumberChange(nextValue)
  }

  const changePhoto = (file: File | null) => {
    if (!file) return
    if (file.type && !file.type.startsWith('image/')) {
      setError('Выбери файл с фотографией')
      return
    }
    setError('')
    setPhoto(file)
    onTaskNumberChange('')
  }

  const removePhoto = () => {
    setPhoto(null)
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  return (
    <section className="copy-task" aria-labelledby="copy-task-title">
      <div className="copy-task-copy">
        <h1 id="copy-task-title">Списать задачу</h1>
        <p>Выбери учебник, введи номер или добавь фото задачи.</p>
      </div>

      <form className="copy-task-form" aria-label="Списать задачу" onSubmit={submit}>
        <TextbookPicker selected={textbook} items={textbooks} onSelect={onTextbookChange} onCreate={onCreateTextbook} open={textbookPickerOpen} onOpenChange={onTextbookPickerOpenChange} />

        {normalizedTask && !photo && <TaskConditionPreview textbookId={textbook.id} taskNumber={normalizedTask} />}

        <div className="task-entry-row">
          <div className="task-number-field">
            <label htmlFor="task-number">Номер задачи</label>
            <div className={`task-number-control${error && !photo ? ' is-error' : ''}`}>
              <Hash size={22} weight="duotone" aria-hidden="true" />
              <input
                id="task-number"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={taskNumber}
                onChange={(event) => changeTaskNumber(event.target.value)}
                placeholder="№"
                autoComplete="off"
                aria-invalid={Boolean(error && !photo)}
                aria-errormessage={error ? 'task-entry-error' : undefined}
                aria-describedby={!error && !canSubmit ? 'task-entry-helper' : undefined}
              />
            </div>
          </div>

          <div className="photo-task-field">
            <span>Или фото задачи</span>
            <div className={`photo-task-control${photo ? ' has-photo' : ''}`}>
              <input
                ref={photoInputRef}
                id="task-photo"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                capture="environment"
                onChange={(event) => changePhoto(event.target.files?.[0] ?? null)}
              />
              <label htmlFor="task-photo">
                <ImageSquare size={24} weight="duotone" aria-hidden="true" />
                <span>
                  <strong>{photo ? photo.name : 'Добавить фото'}</strong>
                  <small>{photo ? 'Нажми, чтобы заменить' : 'С камеры или из файлов'}</small>
                </span>
              </label>
              {photo && (
                <button type="button" onClick={removePhoto} aria-label="Удалить фото">
                  <X size={17} weight="bold" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          <button className="copy-task-submit" type="submit" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? 'Подожди…' : photo ? `Списать по фото за ${solutionPrice} ₽` : readyInBase && normalizedTask ? `Открыть готовое за ${solutionPrice} ₽` : `Списать за ${solutionPrice} ₽`}
            {!isSubmitting && <ArrowRight size={20} weight="bold" aria-hidden="true" />}
          </button>
        </div>

        {error && <p className="task-number-error" id="task-entry-error" role="alert">{error}</p>}
        {!error && !canSubmit && <p className="task-entry-helper" id="task-entry-helper">Введи номер задачи или добавь фото.</p>}
        {!error && (normalizedTask || photo) && (
            <p className={`base-match${readyInBase ? ' is-ready' : ''}`} aria-live="polite">
              {photo
                ? <><CheckCircle size={18} weight="duotone" aria-hidden="true" /> Фото выбрано. Распознаем условие и подготовим решение.</>
                : readyInBase
                ? <><CheckCircle size={18} weight="duotone" aria-hidden="true" /> Уже есть в общей базе. Откроется сразу.</>
                : <><ClockCountdown size={18} weight="duotone" aria-hidden="true" /> В базе пока нет. Обычно решение занимает несколько секунд.</>}
            </p>
        )}
      </form>
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
          <p>{textbook.subject}. {textbook.title}. {state.source === 'photo' ? 'Условие распознано, готовый ответ можно переписать.' : 'Решение найдено в общей базе, ждать не нужно.'}</p>
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
          <p>{textbook.subject}. {textbook.title}. {state.source === 'photo' ? 'Распознаём условие и готовим решение.' : 'Готовое решение появится автоматически.'}</p>
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
      description="Здесь будут только твои учебники, открытые ответы и задачи, которые ты заказывал."
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
      description="Общие готовые решения по всем добавленным учебникам. Их можно открыть сразу."
      actionLabel="Открыть базу"
      onAction={onOpenBase}
    />
  )
}

function SolutionsPage({
  user,
  personalSolutions,
  textbooks: items,
  onOpenAccount,
  onOpenSolution,
  onOpenSharedSolution,
}: {
  user: User | null
  personalSolutions: readonly PersonalSolution[]
  textbooks: readonly Textbook[]
  onOpenAccount: () => void
  onOpenSolution: (state: SolutionState) => void
  onOpenSharedSolution: (textbookId: TextbookId, task: string) => void
}) {
  const [query, setQuery] = useState('')
  const [activeSection, setActiveSection] = useState<'personal' | 'shared'>(user ? 'personal' : 'shared')
  const entries = useMemo(() => items.flatMap((textbook) => textbook.solvedTasks.map((task) => ({ textbook, task }))), [items])
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
          <header className="solutions-directory-heading"><h2 id="shared-solutions-title">База решений</h2><span>{results.length}</span></header>
          {results.length > 0 ? <div className="solution-list route-solution-list">
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

function wrapNotebookLine(line: string, maxLength = 43) {
  if (line.length <= maxLength) return [line]
  const words = line.split(/\s+/).filter(Boolean)
  const wrapped: string[] = []
  let current = ''

  for (const word of words) {
    if (current && (current + ' ' + word).length > maxLength) {
      wrapped.push(current)
      current = word
    } else {
      current = current ? current + ' ' + word : word
    }
  }
  if (current) wrapped.push(current)
  return wrapped.length > 0 ? wrapped : [line]
}

function asGeometryNotebookSpec(solution: HomeworkSolution): GeometryNotebookPageSpec {
  return {
    id: 'generated-' + solution.textbookId + '-' + solution.task,
    number: solution.source === 'photo' ? 'фото' : solution.task,
    condition: solution.condition,
    given: solution.given.slice(0, 3),
    goal: solution.goal,
    diagram: solution.diagram,
    solution: solution.steps.flatMap((step) => wrapNotebookLine(step)),
    ...(solution.answer ? { answer: solution.answer } : {}),
  }
}

function UnderstandingPage({
  solution,
  generatedSolution,
  onGoToCdz,
}: {
  solution: SolutionState | null
  generatedSolution?: HomeworkSolution
  onGoToCdz: () => void
}) {
  const [copied, setCopied] = useState(false)
  const notebookFixture = solution?.textbookId === 'geometry'
    ? generatedSolution
      ? asGeometryNotebookSpec(generatedSolution)
      : geometryFixtures.find((fixture) => fixture.number === solution.task)
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
      <button className="route-secondary-action" type="button" onClick={onGoToCdz}>
        К ЦДЗ <ArrowRight size={18} weight="bold" aria-hidden="true" />
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
          {generatedSolution.answer && (
            <section className="written-solution-section written-solution-answer">
              <h2>Ответ</h2>
              <p>{generatedSolution.answer}</p>
            </section>
          )}
        </article>
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
      <button className="route-primary-action" type="button" onClick={onGoToCdz}>К ЦДЗ <ArrowRight size={18} weight="bold" aria-hidden="true" /></button>
    </section>
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
  const [taskNumber, setTaskNumber] = useState('')
  const [selectedTextbookId, setSelectedTextbookId] = useState<TextbookId>(() => {
    try {
      return window.localStorage.getItem(selectedTextbookStorageKey) || 'geometry'
    } catch {
      return 'geometry'
    }
  })
  const [customTextbooks, setCustomTextbooks] = useState<Textbook[]>([])
  const [solutionState, setSolutionState] = useState<SolutionState | null>(null)
  const [selectedSolution, setSelectedSolution] = useState<SolutionState | null>(() => currentNavigationRoute().solution)
  const [generatedSolutions, setGeneratedSolutions] = useState<HomeworkSolution[]>(loadGeneratedSolutions)
  const [sharedSolutions, setSharedSolutions] = useState<SharedHomeworkSolution[]>([])
  const [textbookPickerOpen, setTextbookPickerOpen] = useState(false)
  const [supabaseClient, setSupabaseClient] = useState<SupabaseClient<Database> | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [account, setAccount] = useState<AccountData | null>(null)
  const [authReady, setAuthReady] = useState(!authIsConfigured)
  const [accountReady, setAccountReady] = useState(!authIsConfigured)
  const [accountOpen, setAccountOpen] = useState(() => ['reset', 'verified', 'confirm'].includes(new URLSearchParams(window.location.search).get('auth') ?? ''))
  const [accountView, setAccountView] = useState<AccountView>('profile')
  const [passwordRecovery, setPasswordRecovery] = useState(() => new URLSearchParams(window.location.search).get('auth') === 'reset')
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState(() => sessionStorage.getItem('homework-copilot:google-verification-email') ?? '')
  const [accountNotice, setAccountNotice] = useState('')
  const googleVerificationStarted = useRef(false)
  const emailConfirmationStarted = useRef(false)
  const accountTriggerRef = useRef<HTMLElement | null>(null)
  const textbookObjectUrlsRef = useRef<string[]>([])
  const visibleGeneratedSolutions = useMemo(
    () => generatedSolutions.filter((solution) => !solution.ownerId || solution.ownerId === user?.id),
    [generatedSolutions, user?.id],
  )
  const availableTextbooks = useMemo(
    () => [...textbooks, ...customTextbooks].map((textbook) => {
      const sharedTasks = sharedSolutions
        .filter((solution) => solution.textbook_id === textbook.id)
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
  const selectedTextbook = getTextbook(selectedTextbookId, availableTextbooks)

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
    }

    window.addEventListener('popstate', restoreNavigation)
    return () => window.removeEventListener('popstate', restoreNavigation)
  }, [])

  useEffect(() => {
    const pageTitle = selectedSolution ? `Решение № ${selectedSolution.task}` : activeNavigation
    document.title = pageTitle === 'Главная' ? 'Homework Copilot' : `${pageTitle} — Homework Copilot`
  }, [activeNavigation, selectedSolution])

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

    const { data, error } = await supabaseClient
      .from('homework_solution_catalog')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)

    if (!error && data) setSharedSolutions(data)
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
      const { data, error } = await supabaseClient
        .from('homework_solutions')
        .select('solution, created_at')
        .order('created_at', { ascending: false })
        .limit(100)

      if (!active || error || !data) return

      const restored = data
        .map(({ solution }) => parseStoredHomeworkSolution(solution, user.id))
        .filter((solution): solution is HomeworkSolution => solution !== null)

      setGeneratedSolutions((current) => [
        ...restored,
        ...current.filter((local) => !restored.some(
          (remote) => remote.textbookId === local.textbookId
            && remote.task === local.task
            && remote.ownerId === local.ownerId,
        )),
      ])
    }

    void restorePurchasedSolutions()
    return () => { active = false }
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

  const submitTask = async (
    task: string,
    ready: boolean,
    source: HomeworkSource,
    idempotencyKey: string,
    photo?: File,
    textbookId = selectedTextbookId,
    openWhenReady = true,
  ) => {
    const textbook = getTextbook(textbookId, availableTextbooks)
    const resolvedTask = source === 'photo'
      ? 'photo-' + idempotencyKey.replace(/[^a-z0-9-]/gi, '').slice(-44)
      : task
    const solutionPrice = getSolutionPrice(textbookId, task, source)

    if (supabaseClient && !user) {
      rememberAccountTrigger()
      setAccountNotice('Войди или зарегистрируйся, чтобы сохранить решение и списать его с баланса')
      setAccountOpen(true)
      return false
    }

    const previouslyGenerated = visibleGeneratedSolutions.find(
      (solution) => solution.textbookId === textbookId && solution.task === resolvedTask,
    )
    if (previouslyGenerated) {
      const nextState: SolutionState = { mode: 'ready', textbookId, task: resolvedTask, source }
      setSolutionState(nextState)
      if (openWhenReady) openSolution(nextState)
      return true
    }

    if (supabaseClient && user && account && account.balance < solutionPrice) {
      rememberAccountTrigger()
      setAccountView('wallet')
      setAccountNotice(`На балансе меньше ${solutionPrice} ₽`)
      setAccountOpen(true)
      return false
    }

    const approvedFixture = source === 'number' && textbookId === 'geometry'
      ? geometryFixtures.find((fixture) => fixture.number === resolvedTask)
      : undefined
    const processingState: SolutionState = { mode: 'processing', textbookId, task: resolvedTask, source }
    const readyState: SolutionState = { ...processingState, mode: 'ready' }

    if ((ready || approvedFixture) && !(supabaseClient && user)) {
      if (supabaseClient && user) {
        const { error: spendError } = await supabaseClient.rpc('spend_solution_credit', {
          p_description: `Решение задачи № ${task} · ${solutionPrice} ₽`,
          p_idempotency_key: idempotencyKey,
          p_source: source,
          p_task_number: source === 'number' ? Number(task) : null,
          p_textbook_id: textbookId,
        })
        if (spendError) {
          rememberAccountTrigger()
          setAccountNotice(spendError.message.includes('insufficient balance')
            ? `На балансе меньше ${solutionPrice} ₽`
            : `Не получилось списать ${solutionPrice} ₽ с баланса`)
          setAccountOpen(true)
          return false
        }
        await refreshAccount()
      }

      if (approvedFixture && user) {
        const savedFixture: HomeworkSolution = {
          textbookId,
          task: resolvedTask,
          source,
          subject: textbook.subject,
          textbookTitle: textbook.title,
          condition: approvedFixture.condition,
          given: [...approvedFixture.given],
          goal: approvedFixture.goal,
          steps: [...approvedFixture.solution],
          answer: approvedFixture.answer ?? '',
          diagram: {
            ...approvedFixture.diagram,
            vertices: [...approvedFixture.diagram.vertices],
          },
          sourceVerified: true,
          createdAt: new Date().toISOString(),
          ownerId: user.id,
        }
        setGeneratedSolutions((current) => [
          savedFixture,
          ...current.filter((entry) => entry.textbookId !== textbookId || entry.task !== resolvedTask || entry.ownerId !== user.id),
        ])
      }

      setSolutionState(readyState)
      if (!ready && openWhenReady) openSolution(readyState)
      return true
    }

    setSolutionState(processingState)

    try {
      const imageDataUrl = source === 'photo' && photo ? await prepareTaskPhoto(photo) : undefined
      if (source === 'photo' && !imageDataUrl) throw new Error('Добавь фотографию задачи')

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
          subject: textbook.subject,
          grade: textbook.grade,
          textbookTitle: textbook.title,
          authors: textbook.authors,
          edition: textbook.edition,
          idempotencyKey,
          ...(imageDataUrl ? { imageDataUrl } : {}),
        },
        accessToken,
      )

      setGeneratedSolutions((current) => [
        generatedSolution,
        ...current.filter(
          (entry) => entry.textbookId !== textbookId
            || entry.task !== resolvedTask
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

  const createTextbook = (textbook: Textbook) => {
    if (textbook.sourceUrl?.startsWith('blob:')) textbookObjectUrlsRef.current.push(textbook.sourceUrl)
    setCustomTextbooks((current) => [...current, textbook])
    setSelectedTextbookId(textbook.id)
  }
  const purchaseTextbookTasks = async (textbookId: TextbookId, taskNumbers: readonly string[]) => {
    const textbook = getTextbook(textbookId, availableTextbooks)
    let purchasedCount = 0
    for (const task of taskNumbers) {
      const idempotencyKey = typeof crypto.randomUUID === 'function'
        ? `textbook-${crypto.randomUUID()}`
        : `textbook-${Date.now()}-${task}-${Math.random().toString(16).slice(2)}`
      const accepted = await submitTask(task, textbook.solvedTasks.includes(task), 'number', idempotencyKey, undefined, textbookId, false)
      if (!accepted) break
      purchasedCount += 1
    }
    return purchasedCount
  }
  const openSharedSolution = (textbookId: TextbookId, task: string) => {
    const idempotencyKey = typeof crypto.randomUUID === 'function'
      ? `shared-${crypto.randomUUID()}`
      : `shared-${Date.now()}-${task}-${Math.random().toString(16).slice(2)}`
    void submitTask(task, true, 'number', idempotencyKey, undefined, textbookId)
  }

  if (!authReady || (user && !accountReady)) {
    return (
      <main className="session-loading-screen" aria-label="Загружаем аккаунт" aria-busy="true">
        <BrandLockup />
        <SpinnerGap size={24} weight="bold" aria-hidden="true" />
      </main>
    )
  }

  return (
    <main className="product-shell">
      <ProductTopbar theme={theme} activeLabel={activeNavigation} onNavigate={navigate} onToggleTheme={toggleTheme} user={user} account={account} onOpenAccount={openAccount} onOpenWallet={openWallet} />
      <div className="product-content">
        {activeNavigation === 'Главная' && <PageHeader account={account} />}
        {activeNavigation === 'Главная' ? (
          <div className="home-content">
            <CopyTask
              taskNumber={taskNumber}
              textbook={selectedTextbook}
              textbooks={availableTextbooks}
              onTaskNumberChange={setTaskNumber}
              onTextbookChange={setSelectedTextbookId}
              onCreateTextbook={createTextbook}
              onSubmit={submitTask}
              textbookPickerOpen={textbookPickerOpen}
              onTextbookPickerOpenChange={setTextbookPickerOpen}
            />
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
            onGoToCdz={() => navigate('ЦДЗ')}
          />
        ) : activeNavigation === 'Расписание' ? (
          <Suspense fallback={<div className="route-loading" role="status">Загружаем расписание…</div>}><SchedulePage userId={user?.id ?? null} grade={account?.profile.grade ?? 8} /></Suspense>
        ) : activeNavigation === 'Решения' ? (
          <SolutionsPage user={user} personalSolutions={personalSolutions} textbooks={availableTextbooks} onOpenAccount={openAccount} onOpenSolution={openSolution} onOpenSharedSolution={openSharedSolution} />
        ) : (
          <TextbookLibraryPage
            items={availableTextbooks}
            selectedTextbookId={selectedTextbookId}
            onSelectTextbook={setSelectedTextbookId}
            onSolveTasks={purchaseTextbookTasks}
            onOpenWallet={openWallet}
            balance={account?.balance ?? null}
          />
        )}
      </div>
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
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'

  if (pathname === '/privacy') return <LegalPage kind="privacy" />
  if (pathname === '/terms') return <LegalPage kind="terms" />

  if (params.get('canvas') === '1') {
    return <NotebookCanvas />
  }

  if (params.get('design-system') === '1') {
    return <Suspense fallback={null}><DesignSystemPlayground /></Suspense>
  }

  return <HomePage />
}

export default App
