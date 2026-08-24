import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import {
  ArrowRight,
  BookOpenText,
  Brain,
  CalendarDots,
  CaretDown,
  CaretRight,
  Check,
  CheckCircle,
  ClockCountdown,
  Hash,
  House,
  ImageSquare,
  LinkSimple,
  MagnifyingGlass,
  MathOperations,
  Moon,
  Notebook,
  Plus,
  SpinnerGap,
  Stack,
  Sun,
  TextT,
  UploadSimple,
  UserCircle,
  X,
} from '@phosphor-icons/react'
import LegalPage from './LegalPage'
import NotebookCanvas from './NotebookCanvas'
import { GeometryNotebookLayoutV1 } from './notebook/GeometryNotebookLayoutV1'
import { geometryFixtures } from './notebook/fixtures'
import type { Database } from './lib/database.types'
import type { AccountData } from './lib/supabase'
import { getInitials } from './lib/account'
import { formatRubles } from './lib/currency'
import { useModalIsolation } from './lib/useModalIsolation'
import { AccountAvatar } from './account/AccountAvatar'
import { getAvatarPresetId } from './account/avatarPresets'
import './App.css'

const DesignSystemPlayground = lazy(() => import('./DesignSystemPlayground'))
const AccountDialog = lazy(() => import('./account/AccountDialog'))
const SchedulePage = lazy(() => import('./SchedulePage'))

type Theme = 'light' | 'dark'
type AccountView = 'profile' | 'wallet'
type TextbookId = string

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
}

type SolutionState = {
  mode: 'processing' | 'ready'
  textbookId: TextbookId
  task: string
  source: 'number' | 'photo'
}

type PersonalSolution = SolutionState & {
  time: string
}

const themeStorageKey = 'homework-copilot:theme'

const navigation = [
  { label: 'Главная', icon: House },
  { label: 'Мои решения', icon: Notebook },
  { label: 'База решений', icon: Stack },
  { label: 'Разобраться', icon: Brain },
  { label: 'Расписание', icon: CalendarDots },
] as const

type NavigationLabel = (typeof navigation)[number]['label']
const navigationItemStep = 62

function navigationRoutePath(activeIndex: number) {
  const centerY = 63 + activeIndex * navigationItemStep
  const topY = centerY - 24
  const bottomY = centerY + 24
  const returnY = bottomY + 24
  const tailY = Math.max(returnY, 340)
  const entryCurve = activeIndex === 0
    ? `C46 18 64 18 64 ${topY}`
    : 'C34 18 40 24 40 34'
  const approachY = activeIndex === 0 ? topY : topY - 24
  const entryBend = activeIndex === 0
    ? `C64 ${topY} 64 ${topY} 64 ${topY}`
    : `C40 ${topY - 12} 64 ${topY - 12} 64 ${topY}`

  return `M-1 18 H24 ${entryCurve} V${approachY} ${entryBend} V${bottomY} C64 ${bottomY + 12} 40 ${bottomY + 12} 40 ${returnY} V${tailY} C40 ${tailY + 10} 32 ${tailY + 20} 16 ${tailY + 20} H-1`
}

const textbooks: readonly Textbook[] = [
  {
    id: 'geometry',
    subject: 'Геометрия',
    grade: '8 класс',
    title: 'Геометрия. 7-9 классы',
    authors: 'Л. С. Атанасян, В. Ф. Бутузов',
    edition: 'Просвещение, 2023',
    solvedTasks: ['123'],
    icon: BookOpenText,
  },
  {
    id: 'algebra',
    subject: 'Алгебра',
    grade: '8 класс',
    title: 'Алгебра. 8 класс',
    authors: 'Ю. Н. Макарычев, Н. Г. Миндюк',
    edition: 'Просвещение, 2023',
    solvedTasks: [],
    icon: MathOperations,
  },
  {
    id: 'russian',
    subject: 'Русский язык',
    grade: '8 класс',
    title: 'Русский язык. 8 класс',
    authors: 'Т. А. Ладыженская, М. Т. Баранов',
    edition: 'Просвещение, 2023',
    solvedTasks: [],
    icon: TextT,
  },
] as const

function getTextbook(id: TextbookId, items: readonly Textbook[] = textbooks) {
  return items.find((textbook) => textbook.id === id) ?? items[0] ?? textbooks[0]
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
      <span className="profile-avatar-small">
        {account?.avatarUrl
          ? <img src={account.avatarUrl} alt="" />
          : user
            ? <AccountAvatar preset={getAvatarPresetId(account?.profile.avatar_path)} initials={getInitials(name, user.email)} />
            : <UserCircle size={21} weight="duotone" aria-hidden="true" />}
      </span>
      {!compact && <span><strong>{name}</strong><small>{subtitle}</small></span>}
      {!compact && <CaretRight size={14} weight="bold" aria-hidden="true" />}
    </button>
  )
}

function ProductSidebar({
  theme,
  activeLabel,
  onNavigate,
  onToggleTheme,
  user,
  account,
  onOpenAccount,
}: {
  theme: Theme
  activeLabel: NavigationLabel
  onNavigate: (label: NavigationLabel) => void
  onToggleTheme: () => void
  user: User | null
  account: AccountData | null
  onOpenAccount: () => void
}) {
  const activeIndex = navigation.findIndex(({ label }) => label === activeLabel)

  return (
    <aside className="product-sidebar" aria-label="Основная навигация">
      <div className="sidebar-brand">
        <BrandLockup />
      </div>

      <nav className="product-navigation">
        <svg className="navigation-route" viewBox="0 0 112 384" preserveAspectRatio="none" aria-hidden="true">
          <path d={navigationRoutePath(activeIndex)} />
        </svg>
        {navigation.map(({ label, icon: Icon }) => {
          const active = label === activeLabel
          return (
            <button className={`navigation-item${active ? ' is-active' : ''}`} type="button" key={label} aria-current={active ? 'page' : undefined} onClick={() => onNavigate(label)}>
              <span className="navigation-icon"><Icon size={32} weight="duotone" aria-hidden="true" /></span>
              <span className="navigation-label">{label}</span>
            </button>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <ProfileButton user={user} account={account} onClick={onOpenAccount} />
      </div>
    </aside>
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

function PageHeader({ theme, onToggleTheme, user, account, onOpenWallet }: { theme: Theme; onToggleTheme: () => void; user: User | null; account: AccountData | null; onOpenWallet: () => void }) {
  const firstName = account?.profile.full_name.trim().split(/\s+/)[0]
  const formattedDate = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
  const dateLabel = formattedDate.charAt(0).toLocaleUpperCase('ru') + formattedDate.slice(1)

  return (
    <header className="page-header">
      <div className="mobile-brand"><BrandLockup /></div>
      <div className="page-heading">
        <p className="page-greeting">{firstName ? `Добрый день, ${firstName}` : 'Добрый день'}</p>
        <span>{dateLabel}</span>
      </div>
      <div className="header-actions">
        <span className="mobile-theme-toggle"><ThemeToggle theme={theme} onToggle={onToggleTheme} /></span>
        <BalanceControl user={user} balance={account?.balance ?? null} onOpenWallet={onOpenWallet} />
      </div>
    </header>
  )
}

function InternalUtilityHeader({ theme, onToggleTheme, user, account, onOpenWallet }: { theme: Theme; onToggleTheme: () => void; user: User | null; account: AccountData | null; onOpenWallet: () => void }) {
  return (
    <header className="internal-utility-header">
      <div className="mobile-brand"><BrandLockup /></div>
      <div className="header-actions">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <BalanceControl user={user} balance={account?.balance ?? null} onOpenWallet={onOpenWallet} />
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
        subject: 'Новый учебник',
        grade: '8 класс',
        title: hostname,
        authors: 'Добавлен по ссылке',
        edition: url.href,
        solvedTasks: [],
        icon: BookOpenText,
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
    const title = file.name.replace(/\.[^.]+$/, '')
    onCreate({
      id: `file-${Date.now()}`,
      subject: 'Новый учебник',
      grade: '8 класс',
      title,
      authors: 'Добавлен из файла',
      edition: file.name,
      solvedTasks: [],
      icon: BookOpenText,
    })
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
  onSubmit: (task: string, ready: boolean, source: 'number' | 'photo', idempotencyKey: string) => Promise<boolean>
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
      await onSubmit(photo.name, false, 'photo', submissionKey)
      submissionRef.current = false
      setIsSubmitting(false)
      return
    }
    if (!/^\d{1,4}$/.test(normalizedTask)) {
      setError('Номер задачи: от 1 до 4 цифр')
      return
    }
    setError('')
    submissionRef.current = true
    setIsSubmitting(true)
    await onSubmit(normalizedTask, readyInBase, 'number', submissionKey)
    submissionRef.current = false
    setIsSubmitting(false)
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
            {isSubmitting ? 'Подожди…' : photo ? 'Списать по фото за 1 рубль' : readyInBase && normalizedTask ? 'Открыть готовое за 1 рубль' : 'Списать за 1 рубль'}
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
                : <><ClockCountdown size={18} weight="duotone" aria-hidden="true" /> В базе пока нет. Подготовим примерно за 5 минут.</>}
            </p>
        )}
      </form>
    </section>
  )
}

function SolutionStatus({ state, textbooks: items, onOpenSolution }: { state: SolutionState; textbooks: readonly Textbook[]; onOpenSolution: (state: SolutionState) => void }) {
  const textbook = getTextbook(state.textbookId, items)

  if (state.mode === 'ready') {
    return (
      <section className="ready-solution" aria-labelledby="ready-solution-title">
        <CheckCircle size={38} weight="duotone" aria-hidden="true" />
        <div>
          <h2 id="ready-solution-title">№ {state.task} уже готова</h2>
          <p>{textbook.subject}. {textbook.title}. Решение найдено в общей базе, ждать не нужно.</p>
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
        <span className="solution-eta">Обычно до 5 минут</span>
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

function GuestWorkspace({ onOpenAccount }: { onOpenAccount: () => void }) {
  return (
    <section className="guest-workspace" aria-labelledby="guest-workspace-title">
      <span className="guest-workspace-icon" aria-hidden="true"><Notebook size={34} weight="duotone" /></span>
      <div>
        <h2 id="guest-workspace-title">Твои решения появятся после входа</h2>
        <p>Здесь будут только твои учебники, открытые ответы и задачи, которые ты заказывал.</p>
      </div>
      <button type="button" onClick={onOpenAccount}>Войти <ArrowRight size={18} weight="bold" aria-hidden="true" /></button>
    </section>
  )
}

function MyTextbooks({ items, selectedId, onSelect, onAdd }: { items: readonly Textbook[]; selectedId: TextbookId; onSelect: (id: TextbookId) => void; onAdd: () => void }) {
  return (
    <section className="textbooks-section" aria-labelledby="textbooks-title">
      <header className="section-heading">
        <div><h2 id="textbooks-title">Мои учебники</h2><p>Выбор сохраняется. На главной останется последний учебник.</p></div>
        <button className="section-action" type="button" onClick={onAdd}><Plus size={17} weight="bold" aria-hidden="true" /> Добавить</button>
      </header>
      <div className="textbook-list">
        {items.map((textbook) => {
          const Icon = textbook.icon
          const selected = textbook.id === selectedId
          return (
            <button type="button" key={textbook.id} className={selected ? 'is-selected' : ''} aria-pressed={selected} onClick={() => onSelect(textbook.id)}>
              <Icon size={32} weight="duotone" aria-hidden="true" />
              <span><small>{textbook.subject}, {textbook.grade}</small><strong>{textbook.title}</strong><em>{textbook.authors}</em></span>
              {selected ? <Check size={18} weight="bold" aria-hidden="true" /> : <CaretRight size={18} weight="bold" aria-hidden="true" />}
            </button>
          )
        })}
      </div>
    </section>
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
    <section className="base-shortcut" aria-labelledby="base-shortcut-title">
      <Stack size={36} weight="duotone" aria-hidden="true" />
      <div>
        <h2 id="base-shortcut-title">База решений</h2>
        <p>Общие готовые решения по всем добавленным учебникам. Их можно открыть сразу.</p>
      </div>
      <button type="button" onClick={onOpenBase}>Открыть базу <ArrowRight size={18} weight="bold" aria-hidden="true" /></button>
    </section>
  )
}

function MobileNavigation({ activeLabel, onNavigate }: { activeLabel: NavigationLabel; onNavigate: (label: NavigationLabel) => void }) {
  return (
    <nav className="mobile-navigation" aria-label="Основная навигация">
      {navigation.map(({ label, icon: Icon }) => {
        const active = label === activeLabel
        return (
          <button className={active ? 'is-active' : ''} type="button" key={label} aria-label={label} aria-current={active ? 'page' : undefined} onClick={() => onNavigate(label)}>
            <Icon size={24} weight="duotone" aria-hidden="true" />
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function MySolutionsPage({ user, items, onOpenAccount, onOpenSolution }: { user: User | null; items: readonly PersonalSolution[]; onOpenAccount: () => void; onOpenSolution: (state: SolutionState) => void }) {
  return (
    <section className="route-page" aria-labelledby="my-solutions-page-title">
      <header className="route-page-header">
        <h1 id="my-solutions-page-title">Мои решения</h1>
        <p>Здесь видны только задачи, которые ты открыл или запросил в этом сеансе.</p>
      </header>
      {!user ? <GuestWorkspace onOpenAccount={onOpenAccount} /> : items.length > 0 ? (
        <div className="solution-list route-solution-list">
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
        </div>
      ) : <section className="route-empty" aria-labelledby="solutions-empty-title"><Notebook size={34} weight="duotone" aria-hidden="true" /><div><h2 id="solutions-empty-title">Решений пока нет</h2><p>Открой готовый ответ или отправь новую задачу, и она появится здесь.</p></div></section>}
    </section>
  )
}

function SolutionBasePage({ items, onOpenSolution }: { items: readonly Textbook[]; onOpenSolution: (state: SolutionState) => void }) {
  const [query, setQuery] = useState('')
  const entries = useMemo(() => items.flatMap((textbook) => textbook.solvedTasks.map((task) => ({ textbook, task }))), [items])
  const normalizedQuery = query.trim().toLocaleLowerCase('ru')
  const results = entries.filter(({ textbook, task }) => `${textbook.subject} ${textbook.title} ${task}`.toLocaleLowerCase('ru').includes(normalizedQuery))

  return (
    <section className="route-page" aria-labelledby="solution-base-page-title">
      <header className="route-page-header">
        <h1 id="solution-base-page-title">База решений</h1>
        <p>Готовые ответы из общей базы. Если совпадение есть, его можно открыть сразу.</p>
      </header>
      <label className="route-search" htmlFor="solution-base-search"><MagnifyingGlass size={20} weight="duotone" aria-hidden="true" /><span>Найти в базе</span><input id="solution-base-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Предмет или номер задачи" autoComplete="off" /></label>
      {results.length > 0 ? <div className="solution-list route-solution-list">
        {results.map(({ textbook, task }) => {
          const Icon = textbook.icon
          return (
            <button type="button" key={`${textbook.id}-${task}`} onClick={() => onOpenSolution({ mode: 'ready', textbookId: textbook.id, task, source: 'number' })}>
              <Icon size={32} weight="duotone" aria-hidden="true" />
              <span><small>{textbook.subject}, {textbook.grade}</small><strong>№ {task}</strong></span>
              <span className="solution-availability"><CheckCircle size={17} weight="duotone" aria-hidden="true" /> Готово</span>
              <ArrowRight size={18} weight="bold" aria-hidden="true" />
            </button>
          )
        })}
      </div> : <section className="route-empty" aria-labelledby="base-empty-title"><MagnifyingGlass size={34} weight="duotone" aria-hidden="true" /><div><h2 id="base-empty-title">Совпадений нет</h2><p>Попробуй другой номер или отправь задачу с главной страницы.</p></div></section>}
    </section>
  )
}

function UnderstandingPage({ solution, onGoHome }: { solution: SolutionState | null; onGoHome: () => void }) {
  const notebookFixture = solution?.textbookId === 'geometry'
    ? geometryFixtures.find((fixture) => fixture.number === solution.task)
    : undefined

  if (notebookFixture) {
    return (
      <section className="route-page solution-view" aria-labelledby="understanding-page-title">
        <header className="route-page-header">
          <h1 id="understanding-page-title">Решение № {notebookFixture.number}</h1>
          <p>Готовый лист для тетради. Проверь условие перед тем, как переписывать ответ.</p>
        </header>
        <div className="solution-notebook-preview"><GeometryNotebookLayoutV1 spec={notebookFixture} /></div>
      </section>
    )
  }

  return (
    <section className="route-page" aria-labelledby="understanding-page-title">
      <header className="route-page-header">
        <h1 id="understanding-page-title">Разобраться</h1>
        <p>Открой готовое решение, чтобы увидеть условие, ход решения и ответ в одном месте.</p>
      </header>
      <div className="understanding-flow">
        <section><BookOpenText size={30} weight="duotone" aria-hidden="true" /><h2>Выбери учебник</h2><p>Номер задачи проверяется только внутри конкретного учебника.</p></section>
        <section><Hash size={30} weight="duotone" aria-hidden="true" /><h2>Укажи задачу</h2><p>Если ответ уже есть в базе, его можно открыть без ожидания.</p></section>
        <section><Notebook size={30} weight="duotone" aria-hidden="true" /><h2>Проверь ответ</h2><p>Готовое решение оформлено так, чтобы его было удобно переписать в тетрадь.</p></section>
      </div>
      <button className="route-primary-action" type="button" onClick={onGoHome}>Перейти к задаче <ArrowRight size={18} weight="bold" aria-hidden="true" /></button>
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
  const [activeNavigation, setActiveNavigation] = useState<NavigationLabel>('Главная')
  const [taskNumber, setTaskNumber] = useState('')
  const [selectedTextbookId, setSelectedTextbookId] = useState<TextbookId>('geometry')
  const [customTextbooks, setCustomTextbooks] = useState<Textbook[]>([])
  const [solutionState, setSolutionState] = useState<SolutionState | null>(null)
  const [selectedSolution, setSelectedSolution] = useState<SolutionState | null>(null)
  const [personalSolutions, setPersonalSolutions] = useState<PersonalSolution[]>([])
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
  const availableTextbooks = useMemo(() => [...textbooks, ...customTextbooks], [customTextbooks])
  const selectedTextbook = getTextbook(selectedTextbookId, availableTextbooks)
  const activeNavigationIndex = navigation.findIndex(({ label }) => label === activeNavigation)
  const shellStyle = {
    '--navigation-item-height': `${navigationItemStep}px`,
    '--active-navigation-offset': `${activeNavigationIndex * navigationItemStep}px`,
  } as CSSProperties

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
  const submitTask = async (task: string, ready: boolean, source: 'number' | 'photo', idempotencyKey: string) => {
    if (supabaseClient && !user) {
      rememberAccountTrigger()
      setAccountNotice('Войди или зарегистрируйся, чтобы сохранить решение и списать его с баланса')
      setAccountOpen(true)
      return false
    }

    if (supabaseClient && user) {
      const { error: spendError } = await supabaseClient.rpc('spend_solution_credit', {
        p_description: source === 'photo' ? 'Решение задачи по фото' : `Решение задачи № ${task}`,
        p_idempotency_key: idempotencyKey,
      })
      if (spendError) {
        rememberAccountTrigger()
        setAccountNotice(spendError.message.includes('insufficient balance') ? 'На балансе меньше 1 ₽' : 'Не получилось списать 1 ₽ с баланса')
        setAccountOpen(true)
        return false
      }
      await refreshAccount()
    }

    const nextState: SolutionState = { mode: ready ? 'ready' : 'processing', textbookId: selectedTextbookId, task, source }
    setSolutionState(nextState)
    if (user) {
      setPersonalSolutions((current) => [
        { ...nextState, time: 'Только что' },
        ...current.filter((entry) => entry.textbookId !== nextState.textbookId || entry.task !== nextState.task),
      ])
    }
    return true
  }
  const createTextbook = (textbook: Textbook) => {
    setCustomTextbooks((current) => [...current, textbook])
    setSelectedTextbookId(textbook.id)
  }
  const openTextbookPicker = () => {
    setActiveNavigation('Главная')
    setTextbookPickerOpen(true)
  }
  const openSolution = (state: SolutionState) => {
    setSelectedSolution(state)
    setActiveNavigation('Разобраться')
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
    <main className="product-shell" style={shellStyle}>
      <ProductSidebar theme={theme} activeLabel={activeNavigation} onNavigate={setActiveNavigation} onToggleTheme={toggleTheme} user={user} account={account} onOpenAccount={openAccount} />
      <div className="product-seam" aria-hidden="true"><span /></div>
      <div className="product-content">
        {activeNavigation === 'Главная'
          ? <PageHeader theme={theme} onToggleTheme={toggleTheme} user={user} account={account} onOpenWallet={openWallet} />
          : <InternalUtilityHeader theme={theme} onToggleTheme={toggleTheme} user={user} account={account} onOpenWallet={openWallet} />}
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
                {user ? <MySolutions items={personalSolutions} onOpenAll={() => setActiveNavigation('Мои решения')} onOpenSolution={openSolution} /> : <GuestWorkspace onOpenAccount={openAccount} />}
              </div>
              <div className="home-column home-column-secondary">
                {user && <MyTextbooks items={availableTextbooks} selectedId={selectedTextbookId} onSelect={setSelectedTextbookId} onAdd={openTextbookPicker} />}
                <BaseShortcut onOpenBase={() => setActiveNavigation('База решений')} />
              </div>
            </div>
          </div>
        ) : activeNavigation === 'Расписание' ? (
          <Suspense fallback={<div className="route-loading" role="status">Загружаем расписание…</div>}><SchedulePage userId={user?.id ?? null} grade={account?.profile.grade ?? 8} /></Suspense>
        ) : activeNavigation === 'Мои решения' ? (
          <MySolutionsPage user={user} items={personalSolutions} onOpenAccount={openAccount} onOpenSolution={openSolution} />
        ) : activeNavigation === 'База решений' ? (
          <SolutionBasePage items={availableTextbooks} onOpenSolution={openSolution} />
        ) : <UnderstandingPage solution={selectedSolution} onGoHome={() => setActiveNavigation('Главная')} />}
      </div>
      <MobileNavigation activeLabel={activeNavigation} onNavigate={setActiveNavigation} />
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
