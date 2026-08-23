import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
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
  Coins,
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
  X,
} from '@phosphor-icons/react'
import { GeometryNotebookLayoutV1 } from './notebook/GeometryNotebookLayoutV1'
import { fixtures } from './fixtures'
import SchedulePage from './SchedulePage'
import './App.css'

const DesignSystemPlayground = lazy(() => import('./DesignSystemPlayground'))

type Theme = 'light' | 'dark'
type TextbookId = string

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

const navigation = [
  { label: 'Главная', icon: House },
  { label: 'Мои решения', icon: Notebook },
  { label: 'База решений', icon: Stack },
  { label: 'Разобраться', icon: Brain },
  { label: 'Расписание', icon: CalendarDots },
] as const

type NavigationLabel = (typeof navigation)[number]['label']

function navigationRoutePath(activeIndex: number) {
  const centerY = 63 + activeIndex * 62
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
    solvedTasks: ['118', '123'],
    icon: BookOpenText,
  },
  {
    id: 'algebra',
    subject: 'Алгебра',
    grade: '8 класс',
    title: 'Алгебра. 8 класс',
    authors: 'Ю. Н. Макарычев, Н. Г. Миндюк',
    edition: 'Просвещение, 2023',
    solvedTasks: ['17.2', '18.5'],
    icon: MathOperations,
  },
  {
    id: 'russian',
    subject: 'Русский язык',
    grade: '8 класс',
    title: 'Русский язык. 8 класс',
    authors: 'Т. А. Ладыженская, М. Т. Баранов',
    edition: 'Просвещение, 2023',
    solvedTasks: ['39', '42'],
    icon: TextT,
  },
] as const

const personalSolutions = [
  { textbookId: 'geometry', task: '118', time: 'Вчера, 19:42' },
  { textbookId: 'algebra', task: '17.2 и 17.4', time: 'Вчера, 17:10' },
  { textbookId: 'russian', task: '39', time: '19 августа' },
] satisfies ReadonlyArray<{ textbookId: TextbookId; task: string; time: string }>

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

function ProfileButton() {
  return (
    <button className="profile-button" type="button" aria-label="Открыть профиль">
      <span>РК</span>
      <span><strong>Рома</strong><small>8 класс</small></span>
      <CaretRight size={14} weight="bold" aria-hidden="true" />
    </button>
  )
}

function ProductSidebar({
  theme,
  activeLabel,
  onNavigate,
  onToggleTheme,
}: {
  theme: Theme
  activeLabel: NavigationLabel
  onNavigate: (label: NavigationLabel) => void
  onToggleTheme: () => void
}) {
  const activeIndex = navigation.findIndex(({ label }) => label === activeLabel)

  return (
    <aside className="product-sidebar" aria-label="Основная навигация">
      <div className="sidebar-brand"><BrandLockup /></div>

      <nav className="product-navigation">
        <svg className="navigation-route" viewBox="0 0 112 384" preserveAspectRatio="none" aria-hidden="true">
          <path d={navigationRoutePath(activeIndex)} />
        </svg>
        {navigation.map(({ label, icon: Icon }) => {
          const active = label === activeLabel
          return (
            <button className={`navigation-item${active ? ' is-active' : ''}`} type="button" key={label} aria-current={active ? 'page' : undefined} onClick={() => onNavigate(label)}>
              <span className="navigation-icon"><Icon size={32} weight="duotone" aria-hidden="true" /></span>
              <span>{label}</span>
            </button>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <ProfileButton />
      </div>
    </aside>
  )
}

function BalanceControl() {
  return (
    <div className="balance-control" aria-label="Баланс: 4 решения">
      <Coins size={22} weight="duotone" aria-hidden="true" />
      <span><small>Баланс</small><strong>4 решения</strong></span>
      <button type="button" aria-label="Пополнить баланс"><Plus size={17} weight="bold" aria-hidden="true" /></button>
    </div>
  )
}

function PageHeader({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  return (
    <header className="page-header">
      <div className="mobile-brand"><BrandLockup /></div>
      <div className="page-heading">
        <h1>Добрый день, Рома</h1>
        <span>Пятница, 21 августа</span>
      </div>
      <div className="header-actions">
        <span className="mobile-theme-toggle"><ThemeToggle theme={theme} onToggle={onToggleTheme} /></span>
        <BalanceControl />
      </div>
    </header>
  )
}

function TextbookPicker({
  selected,
  items,
  onSelect,
  onCreate,
}: {
  selected: Textbook
  items: readonly Textbook[]
  onSelect: (id: TextbookId) => void
  onCreate: (textbook: Textbook) => void
}) {
  const SelectedIcon = selected.icon
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [importMode, setImportMode] = useState<'link' | 'file'>('link')
  const [link, setLink] = useState('')
  const [importError, setImportError] = useState('')
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru')
    if (!normalized) return items
    return items.filter((textbook) => `${textbook.subject} ${textbook.title} ${textbook.authors} ${textbook.grade}`.toLocaleLowerCase('ru').includes(normalized))
  }, [items, query])

  useEffect(() => {
    if (!isOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [isOpen])

  const closeDialog = () => {
    setIsOpen(false)
    setQuery('')
    setImportError('')
  }

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
      <button className="textbook-picker-trigger" type="button" aria-haspopup="dialog" aria-expanded={isOpen} onClick={() => setIsOpen(true)}>
        <SelectedIcon size={32} weight="duotone" aria-hidden="true" />
        <span>
          <small>Учебник</small>
          <strong>{selected.subject}, {selected.grade}</strong>
          <em>{selected.title} · {selected.authors}</em>
        </span>
        <span className="textbook-change">Сменить <CaretDown size={17} weight="bold" aria-hidden="true" /></span>
      </button>

      {isOpen && (
        <div className="textbook-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDialog()
        }} onKeyDown={(event) => {
          if (event.key === 'Escape') closeDialog()
        }}>
          <section className="textbook-dialog" role="dialog" aria-modal="true" aria-labelledby="textbook-dialog-title">
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
                  <button type="button" role="tab" aria-selected={importMode === 'link'} className={importMode === 'link' ? 'is-active' : ''} onClick={() => { setImportMode('link'); setImportError('') }}><LinkSimple size={18} weight="duotone" aria-hidden="true" /> Ссылка</button>
                  <button type="button" role="tab" aria-selected={importMode === 'file'} className={importMode === 'file' ? 'is-active' : ''} onClick={() => { setImportMode('file'); setImportError('') }}><UploadSimple size={18} weight="duotone" aria-hidden="true" /> Файл</button>
                </div>

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
                {importError && <p className="textbook-import-error" role="alert">{importError}</p>}
              </aside>
            </div>
          </section>
        </div>
      )}
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
}: {
  taskNumber: string
  textbook: Textbook
  textbooks: readonly Textbook[]
  onTaskNumberChange: (value: string) => void
  onTextbookChange: (id: TextbookId) => void
  onCreateTextbook: (textbook: Textbook) => void
  onSubmit: (task: string, ready: boolean, source: 'number' | 'photo') => void
}) {
  const [error, setError] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const normalizedTask = taskNumber.trim()
  const readyInBase = textbook.solvedTasks.includes(normalizedTask)
  const canSubmit = Boolean(normalizedTask || photo)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (photo) {
      setError('')
      onSubmit(photo.name, false, 'photo')
      return
    }
    if (!/^\d{1,4}$/.test(normalizedTask)) {
      setError('Номер задачи: от 1 до 4 цифр')
      return
    }
    setError('')
    onSubmit(normalizedTask, readyInBase, 'number')
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
        <h2 id="copy-task-title">Списать задачу</h2>
        <p>Выбери учебник, введи номер или добавь фото задачи.</p>
      </div>

      <form className="copy-task-form" aria-label="Списать задачу" onSubmit={submit}>
        <TextbookPicker selected={textbook} items={textbooks} onSelect={onTextbookChange} onCreate={onCreateTextbook} />

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

          <button className="copy-task-submit" type="submit" disabled={!canSubmit}>
            {photo ? 'Списать по фото' : readyInBase && normalizedTask ? 'Открыть готовое' : 'Списать'}
            <ArrowRight size={20} weight="bold" aria-hidden="true" />
          </button>
        </div>

        {error && <p className="task-number-error" id="task-entry-error" role="alert">{error}</p>}
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

function SolutionStatus({ state, textbooks: items }: { state: SolutionState; textbooks: readonly Textbook[] }) {
  const textbook = getTextbook(state.textbookId, items)

  if (state.mode === 'ready') {
    return (
      <section className="ready-solution" aria-labelledby="ready-solution-title">
        <CheckCircle size={38} weight="duotone" aria-hidden="true" />
        <div>
          <h2 id="ready-solution-title">№ {state.task} уже готова</h2>
          <p>{textbook.subject}. {textbook.title}. Решение найдено в общей базе, ждать не нужно.</p>
        </div>
        <button type="button">Открыть решение <ArrowRight size={18} weight="bold" aria-hidden="true" /></button>
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
        <time>03:42</time>
      </header>

      <div className="solution-progress" aria-label="Решение готовится">
        <SpinnerGap className="solution-loader-orbit" size={36} weight="bold" aria-label="Решаем задачу" />
        <span className="solution-progress-copy"><strong>Решаем задачу</strong><small>Затем оформим ответ как в тетради</small></span>
        <span className="solution-progress-value">44%</span>
      </div>

      <div className="solution-progress-track" aria-hidden="true"><span /></div>

      <ol className="system-stages" aria-label="Этапы подготовки">
        <li className="is-done"><span><Check size={14} weight="bold" /></span><strong>Условие найдено</strong></li>
        <li className="is-current"><span><SpinnerGap size={14} weight="bold" /></span><strong>Решение</strong></li>
        <li><span /><strong>Оформление</strong></li>
      </ol>
    </section>
  )
}

function MyTextbooks({ items, selectedId, onSelect }: { items: readonly Textbook[]; selectedId: TextbookId; onSelect: (id: TextbookId) => void }) {
  return (
    <section className="textbooks-section" aria-labelledby="textbooks-title">
      <header className="section-heading">
        <div><h2 id="textbooks-title">Мои учебники</h2><p>Выбор сохраняется. На главной останется последний учебник.</p></div>
        <button className="section-action" type="button"><Plus size={17} weight="bold" aria-hidden="true" /> Добавить</button>
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

function MySolutions() {
  return (
    <section className="my-solutions" aria-labelledby="my-solutions-title">
      <header className="section-heading">
        <div><h2 id="my-solutions-title">Мои решения</h2><p>Только задачи, которые ты уже открывал или заказывал.</p></div>
        <button className="section-link" type="button">Все мои решения <ArrowRight size={17} weight="bold" aria-hidden="true" /></button>
      </header>
      <div className="solution-list">
        {personalSolutions.map(({ textbookId, task, time }) => {
          const textbook = getTextbook(textbookId)
          const Icon = textbook.icon
          return (
            <button type="button" key={`${textbookId}-${task}`}>
              <Icon size={32} weight="duotone" aria-hidden="true" />
              <span><small>{textbook.subject} · {textbook.title}</small><strong>№ {task}</strong></span>
              <time>{time}</time>
              <ArrowRight size={18} weight="bold" aria-hidden="true" />
            </button>
          )
        })}
      </div>
    </section>
  )
}

function BaseShortcut() {
  return (
    <section className="base-shortcut" aria-labelledby="base-shortcut-title">
      <Stack size={36} weight="duotone" aria-hidden="true" />
      <div>
        <h2 id="base-shortcut-title">База решений</h2>
        <p>Общие готовые решения по всем добавленным учебникам. Их можно открыть сразу.</p>
      </div>
      <button type="button">Открыть базу <ArrowRight size={18} weight="bold" aria-hidden="true" /></button>
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

function ComingSoon({ section }: { section: NavigationLabel }) {
  return (
    <section className="coming-soon" aria-labelledby="coming-soon-title">
      <span>{section}</span>
      <h2 id="coming-soon-title">Скоро</h2>
      <p>Этот раздел появится позже.</p>
    </section>
  )
}

function HomePage() {
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  const [activeNavigation, setActiveNavigation] = useState<NavigationLabel>('Главная')
  const [taskNumber, setTaskNumber] = useState('')
  const [selectedTextbookId, setSelectedTextbookId] = useState<TextbookId>('geometry')
  const [customTextbooks, setCustomTextbooks] = useState<Textbook[]>([])
  const [solutionState, setSolutionState] = useState<SolutionState>({ mode: 'processing', textbookId: 'geometry', task: '118', source: 'number' })
  const availableTextbooks = useMemo(() => [...textbooks, ...customTextbooks], [customTextbooks])
  const selectedTextbook = getTextbook(selectedTextbookId, availableTextbooks)
  const activeNavigationIndex = navigation.findIndex(({ label }) => label === activeNavigation)
  const shellStyle = { '--active-navigation-offset': `${activeNavigationIndex * 3.875}rem` } as CSSProperties

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
  }, [theme])

  const toggleTheme = () => setTheme((current) => current === 'light' ? 'dark' : 'light')
  const submitTask = (task: string, ready: boolean, source: 'number' | 'photo') => {
    setSolutionState({ mode: ready ? 'ready' : 'processing', textbookId: selectedTextbookId, task, source })
  }
  const createTextbook = (textbook: Textbook) => {
    setCustomTextbooks((current) => [...current, textbook])
    setSelectedTextbookId(textbook.id)
  }

  return (
    <main className="product-shell" style={shellStyle}>
      <ProductSidebar theme={theme} activeLabel={activeNavigation} onNavigate={setActiveNavigation} onToggleTheme={toggleTheme} />
      <div className="product-seam" aria-hidden="true"><span /></div>
      <div className="product-content">
        <PageHeader theme={theme} onToggleTheme={toggleTheme} />
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
            />
            <div className="home-grid">
              <div className="home-column home-column-primary">
                <SolutionStatus state={solutionState} textbooks={availableTextbooks} />
                <MySolutions />
              </div>
              <div className="home-column home-column-secondary">
                <MyTextbooks items={availableTextbooks} selectedId={selectedTextbookId} onSelect={setSelectedTextbookId} />
                <BaseShortcut />
              </div>
            </div>
          </div>
        ) : activeNavigation === 'Расписание' ? <SchedulePage /> : <ComingSoon section={activeNavigation} />}
      </div>
      <MobileNavigation activeLabel={activeNavigation} onNavigate={setActiveNavigation} />
    </main>
  )
}

function App() {
  const params = new URLSearchParams(window.location.search)

  if (params.get('canvas') === '1') {
    return <main className="canvas-mode"><GeometryNotebookLayoutV1 spec={fixtures[0]} /></main>
  }

  if (params.get('design-system') === '1') {
    return <Suspense fallback={null}><DesignSystemPlayground /></Suspense>
  }

  return <HomePage />
}

export default App
