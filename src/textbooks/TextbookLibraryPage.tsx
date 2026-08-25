import { useEffect, useMemo, useRef, useState } from 'react'
import type { Icon } from '@phosphor-icons/react'
import {
  ArrowRight,
  ArrowSquareOut,
  BookBookmark,
  CaretLeft,
  CaretRight,
  Check,
  FilePdf,
  Hash,
  MagnifyingGlass,
  Plus,
  Stack,
  UploadSimple,
} from '@phosphor-icons/react'
import { getSolutionBatchTotal, getSolutionPrice } from '../lib/solutionPricing'
import TextbookPdfReader from './TextbookPdfReader'
import './TextbookLibraryPage.css'

type TextbookSourceType = 'pdf' | 'epub' | 'image' | 'link' | 'official'

type TextbookLibraryItem = {
  id: string
  subject: string
  grade: string
  title: string
  authors: string
  edition: string
  solvedTasks: readonly string[]
  icon: Icon
  sourceUrl?: string
  sourceType?: TextbookSourceType
  previewBeforeReading?: boolean
}

type ReaderChapter = {
  label: string
  title: string
  focus: string
  description: string
  start: number
  end: number
}

type ReaderModel = {
  badge: string
  taskCount: number
  chapters: readonly ReaderChapter[]
}

type ReaderProgress = Record<string, {
  chapterIndex: number
  selectedTasks: number[]
}>

const progressStorageKey = 'homework-copilot:textbook-reader-v1'

const readerModels: Record<string, ReaderModel> = {
  geometry: {
    badge: 'Фигуры и доказательства',
    taskCount: 240,
    chapters: [
      { label: '01', title: 'Четырёхугольники', focus: 'Свойства и признаки', description: 'Собери опорные свойства фигур, прежде чем переходить к задачам.', start: 1, end: 60 },
      { label: '02', title: 'Площадь', focus: 'Формула и разбиение', description: 'Связывай рисунок, единицы измерения и ход доказательства в одной записи.', start: 61, end: 120 },
      { label: '03', title: 'Подобие', focus: 'Отношения сторон', description: 'Ищи пары углов и пропорциональные стороны — это сокращает путь к решению.', start: 121, end: 180 },
      { label: '04', title: 'Окружность', focus: 'Углы и касательные', description: 'Проверь, какие элементы даны на чертеже, и только потом выбирай теорему.', start: 181, end: 240 },
    ],
  },
  physics: {
    badge: 'Наблюдение и расчёт',
    taskCount: 180,
    chapters: [
      { label: '01', title: 'Тепловые явления', focus: 'Температура и энергия', description: 'Отделяй известные величины от того, что нужно найти, и записывай единицы.', start: 1, end: 45 },
      { label: '02', title: 'Агрегатные состояния', focus: 'Процессы и графики', description: 'Читай график по участкам: что происходит с веществом и энергией на каждом.', start: 46, end: 90 },
      { label: '03', title: 'Электрические явления', focus: 'Цепь и закон Ома', description: 'Сначала набросай схему цепи, затем подставляй значения в формулу.', start: 91, end: 135 },
      { label: '04', title: 'Электромагнетизм', focus: 'Поле и действие тока', description: 'Сопоставляй опыт, рисунок и физическую причину, а не только термин.', start: 136, end: 180 },
    ],
  },
  chemistry: {
    badge: 'Вещества и превращения',
    taskCount: 180,
    chapters: [
      { label: '01', title: 'Вещество и язык химии', focus: 'Атомы и формулы', description: 'Сверяй символы, индексы и валентность до того, как считать массу вещества.', start: 1, end: 45 },
      { label: '02', title: 'Количество вещества', focus: 'Моль и расчёты', description: 'Отмечай данные с единицами: это помогает не потерять нужную величину.', start: 46, end: 90 },
      { label: '03', title: 'Классы соединений', focus: 'Состав и свойства', description: 'Определи класс вещества — тогда уравнение реакции становится понятнее.', start: 91, end: 135 },
      { label: '04', title: 'Реакции', focus: 'Уравнения и признаки', description: 'Сначала составь схему, затем расставь коэффициенты и проверь баланс.', start: 136, end: 180 },
    ],
  },
}

const fallbackModel: ReaderModel = {
  badge: 'Мой учебник',
  taskCount: 120,
  chapters: [
    { label: '01', title: 'Начало работы', focus: 'Номера и заметки', description: 'Выбери номера из этого издания — они останутся в очереди, пока ты не запустишь решение.', start: 1, end: 40 },
    { label: '02', title: 'Практика', focus: 'Разбор по шагам', description: 'Собери задачи в одну очередь, чтобы не терять контекст между номерами.', start: 41, end: 80 },
    { label: '03', title: 'Повторение', focus: 'Проверка ответа', description: 'Перед отправкой сверь номер и условие с тем изданием, которое читаешь.', start: 81, end: 120 },
  ],
}

function getReaderModel(textbook: TextbookLibraryItem) {
  return readerModels[textbook.id] ?? fallbackModel
}

function getInitialProgress(): ReaderProgress {
  try {
    const rawValue = window.localStorage.getItem(progressStorageKey)
    if (!rawValue) return {}
    const parsed = JSON.parse(rawValue) as ReaderProgress
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(Object.entries(parsed).flatMap(([id, value]) => {
      if (!value || typeof value !== 'object') return []
      const chapterIndex = Number.isInteger(value.chapterIndex) && value.chapterIndex >= 0 ? value.chapterIndex : 0
      const selectedTasks = Array.isArray(value.selectedTasks)
        ? value.selectedTasks.filter((task): task is number => Number.isInteger(task) && task > 0).slice(0, 60)
        : []
      return [[id, { chapterIndex, selectedTasks }]]
    }))
  } catch {
    return {}
  }
}

function taskRange(start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

function taskPlural(count: number) {
  const lastTwo = count % 100
  if (lastTwo >= 11 && lastTwo <= 14) return 'задач'
  const last = count % 10
  if (last === 1) return 'задача'
  if (last >= 2 && last <= 4) return 'задачи'
  return 'задач'
}

export default function TextbookLibraryPage({
  items,
  selectedTextbookId,
  onSelectTextbook,
  onSolveTasks,
  onAddTextbookFile,
  onOpenWallet,
}: {
  items: readonly TextbookLibraryItem[]
  selectedTextbookId: string
  onSelectTextbook: (id: string) => void
  onSolveTasks: (textbookId: string, taskNumbers: readonly string[]) => Promise<number>
  onAddTextbookFile: (file: File) => void
  onOpenWallet: () => void
}) {
  const selectedTextbook = items.find((textbook) => textbook.id === selectedTextbookId) ?? items[0]
  const [progressByBook, setProgressByBook] = useState<ReaderProgress>(getInitialProgress)
  const [query, setQuery] = useState('')
  const [isSolving, setIsSolving] = useState(false)
  const [batchNotice, setBatchNotice] = useState('')
  const [sourceError, setSourceError] = useState('')
  const [openedSourceBookId, setOpenedSourceBookId] = useState<string | null>(null)
  const taskListRef = useRef<HTMLOListElement>(null)

  const reader = selectedTextbook ? getReaderModel(selectedTextbook) : fallbackModel
  const progress = selectedTextbook ? progressByBook[selectedTextbook.id] ?? { chapterIndex: 0, selectedTasks: [] } : { chapterIndex: 0, selectedTasks: [] }
  const chapterIndex = Math.min(progress.chapterIndex, reader.chapters.length - 1)
  const chapter = reader.chapters[chapterIndex] ?? reader.chapters[0]
  const chapterTasks = useMemo(() => taskRange(chapter.start, chapter.end), [chapter.end, chapter.start])
  const selectedTasks = progress.selectedTasks.filter((task) => task <= reader.taskCount)
  const normalizedQuery = query.trim().replace(/^№\s*/, '')
  const visibleTasks = useMemo(() => {
    if (!normalizedQuery) return chapterTasks
    return chapterTasks.filter((task) => String(task).includes(normalizedQuery))
  }, [chapterTasks, normalizedQuery])
  const selectedInChapter = chapterTasks.filter((task) => selectedTasks.includes(task)).length
  const allChapterTasksSelected = selectedInChapter === chapterTasks.length
  const totalPrice = getSolutionBatchTotal(selectedTextbook?.id ?? '', selectedTasks)

  useEffect(() => {
    try {
      window.localStorage.setItem(progressStorageKey, JSON.stringify(progressByBook))
    } catch {
      // The reader remains usable when browser storage is blocked.
    }
  }, [progressByBook])

  if (!selectedTextbook) return null

  const updateProgress = (updater: (current: ReaderProgress[string]) => ReaderProgress[string]) => {
    setProgressByBook((current) => {
      const existing = current[selectedTextbook.id] ?? { chapterIndex: 0, selectedTasks: [] }
      return { ...current, [selectedTextbook.id]: updater(existing) }
    })
  }

  const toggleTask = (task: number) => {
    setBatchNotice('')
    updateProgress((current) => {
      const selected = new Set(current.selectedTasks)
      if (selected.has(task)) selected.delete(task)
      else selected.add(task)
      return { ...current, selectedTasks: [...selected].sort((left, right) => left - right) }
    })
  }

  const toggleChapterTasks = () => {
    setBatchNotice('')
    updateProgress((current) => {
      const selected = new Set(current.selectedTasks)
      if (allChapterTasksSelected) chapterTasks.forEach((task) => selected.delete(task))
      else chapterTasks.forEach((task) => selected.add(task))
      return { ...current, selectedTasks: [...selected].sort((left, right) => left - right) }
    })
  }

  const clearTasks = () => {
    setBatchNotice('')
    updateProgress((current) => ({ ...current, selectedTasks: [] }))
  }

  const changeChapter = (nextIndex: number) => {
    setBatchNotice('')
    setQuery('')
    if (typeof taskListRef.current?.scrollTo === 'function') taskListRef.current.scrollTo({ top: 0 })
    updateProgress((current) => ({ ...current, chapterIndex: Math.max(0, Math.min(nextIndex, reader.chapters.length - 1)) }))
  }

  const addSourceFile = (file: File | null, input: HTMLInputElement) => {
    input.value = ''
    if (!file) return
    if (!/\.(pdf|epub|png|jpe?g|webp)$/i.test(file.name)) {
      setSourceError('Подойдёт PDF, EPUB или изображение учебника.')
      return
    }
    setSourceError('')
    onAddTextbookFile(file)
  }

  const solveSelected = async () => {
    if (selectedTasks.length === 0 || isSolving) return
    setIsSolving(true)
    setBatchNotice('')
    const orderedTasks = selectedTasks.map(String)
    const queuedCount = await onSolveTasks(selectedTextbook.id, orderedTasks)
    setIsSolving(false)

    if (queuedCount === 0) {
      setBatchNotice('Войди в аккаунт и проверь баланс, чтобы запустить очередь.')
      return
    }

    updateProgress((current) => ({ ...current, selectedTasks: current.selectedTasks.slice(queuedCount) }))
    setBatchNotice(queuedCount === orderedTasks.length
      ? `В очередь добавлено: ${queuedCount}.`
      : `В очередь добавлено: ${queuedCount}. Остальные оставлены в выборе.`)
  }

  const hasReadableSource = Boolean(selectedTextbook.sourceUrl && (
    selectedTextbook.sourceType === 'pdf'
    || selectedTextbook.sourceType === 'image'
  ))
  const showsSourcePreview = Boolean(selectedTextbook.previewBeforeReading && selectedTextbook.sourceUrl && openedSourceBookId !== selectedTextbook.id)
  const hasOfficialSource = Boolean(selectedTextbook.sourceUrl && selectedTextbook.sourceType === 'official')

  return (
    <section className="textbook-reader-page" aria-labelledby="textbook-reader-title" data-subject={selectedTextbook.id}>
      <header className="textbook-reader-header">
        <div>
          <span className="textbook-reader-eyebrow"><BookBookmark size={18} weight="duotone" aria-hidden="true" /> Учебники · 8 класс</span>
          <h1 id="textbook-reader-title">Учебник без лишнего шума</h1>
          <p>Выбери предмет, отметь номера и отправь их в одну очередь.</p>
        </div>
        <label className="textbook-reader-add" htmlFor="textbook-reader-file"><UploadSimple size={18} weight="bold" aria-hidden="true" /> Загрузить учебник</label>
        <input id="textbook-reader-file" className="textbook-reader-file-input" type="file" accept=".pdf,.epub,image/jpeg,image/png,image/webp" onChange={(event) => addSourceFile(event.target.files?.[0] ?? null, event.currentTarget)} />
      </header>

      <div className="textbook-reader-layout">
        <aside className="textbook-reader-rail" aria-label="Учебники и список задач">
          <section className="textbook-book-switcher" aria-labelledby="textbook-book-switcher-title">
            <div className="textbook-rail-heading">
              <span id="textbook-book-switcher-title">Учебники</span>
              <small>{items.length} · 8 класс</small>
            </div>
            <div className="textbook-book-options">
              {items.map((textbook) => {
                const Icon = textbook.icon
                const active = textbook.id === selectedTextbook.id
                return (
                  <button
                    type="button"
                    key={textbook.id}
                    aria-pressed={active}
                    className={active ? 'is-active' : ''}
                    onClick={() => { setBatchNotice(''); setSourceError(''); setQuery(''); setOpenedSourceBookId(null); onSelectTextbook(textbook.id) }}
                  >
                    <Icon size={21} weight="duotone" aria-hidden="true" />
                    <span><strong>{textbook.subject} · {textbook.grade}</strong><small>{textbook.authors}</small></span>
                    {active && <Check size={16} weight="bold" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
          </section>

          <section className="textbook-task-index" aria-labelledby="textbook-task-index-title">
            <div className="textbook-rail-heading textbook-task-heading">
              <span id="textbook-task-index-title">Глава {chapter.label}: {chapter.title}</span>
              <small>№ {chapter.start}–{chapter.end}</small>
            </div>
            <label className="textbook-task-search" htmlFor="textbook-task-search">
              <MagnifyingGlass size={17} weight="duotone" aria-hidden="true" />
              <span>Найти задачу в выбранной главе</span>
              <input id="textbook-task-search" inputMode="numeric" value={query} onChange={(event) => setQuery(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Номер в главе" autoComplete="off" />
            </label>
            <div className="textbook-task-index-actions">
              <button type="button" onClick={toggleChapterTasks}>{allChapterTasksSelected ? `Снять ${chapterTasks.length}` : `Выбрать все ${chapterTasks.length}`}</button>
              <small>{selectedInChapter} выбрано в главе</small>
              {selectedTasks.length > 0 && <button type="button" onClick={clearTasks}>Сбросить всё</button>}
            </div>
            <ol ref={taskListRef} className="textbook-task-list" aria-label={`Номера задач главы ${chapter.label}`}>
              {visibleTasks.map((task) => {
                const selected = selectedTasks.includes(task)
                const price = getSolutionPrice(selectedTextbook.id, task)
                return (
                  <li key={task}>
                    <button type="button" aria-label={`Задача № ${task} · ${price} ₽`} aria-pressed={selected} className={selected ? 'is-selected' : ''} onClick={() => toggleTask(task)}>
                      <span className="textbook-task-mark" aria-hidden="true">{selected ? <Check size={13} weight="bold" /> : null}</span>
                      <span>№ {task}</span>
                      <strong>{price} ₽</strong>
                    </button>
                  </li>
                )
              })}
              {visibleTasks.length === 0 && <li className="textbook-task-empty">Такого номера нет в выбранной главе.</li>}
            </ol>
            <p className="textbook-task-index-note">Первые задания главы — 5 ₽, средние — 10 ₽, сложные — 15 ₽.</p>
          </section>
        </aside>

        <section className="textbook-reader-stage" aria-labelledby="textbook-stage-title">
          <div className="textbook-stage-toolbar">
            <span className="textbook-stage-status"><Stack size={17} weight="duotone" aria-hidden="true" /> {reader.badge}</span>
            <span>{selectedTextbook.grade} · {selectedTextbook.edition}</span>
          </div>

          {showsSourcePreview ? (
            <div className="textbook-reader-book" key={`${selectedTextbook.id}-${chapterIndex}`}>
              <article className="textbook-reader-cover">
                <span className="textbook-cover-grade">{selectedTextbook.grade}</span>
                <div className="textbook-cover-art" aria-hidden="true"><span /><span /><span /></div>
                <div>
                  <p>{selectedTextbook.subject}</p>
                  <h2>{selectedTextbook.title}</h2>
                  <small>{selectedTextbook.authors}</small>
                </div>
                <span className="textbook-cover-code">HC / {selectedTextbook.id.slice(0, 3).toUpperCase()}</span>
              </article>

              <article className="textbook-reader-page-sheet">
                <span className="textbook-page-kicker">Глава {chapter.label} · {chapter.focus}</span>
                <h2 id="textbook-stage-title">{chapter.title}</h2>
                <p>{chapter.description}</p>
                <div className="textbook-reader-open-book">
                  <FilePdf size={22} weight="duotone" aria-hidden="true" />
                  <div>
                    <strong>Оригинал учебника</strong>
                    <span>Читай и листай PDF прямо здесь.</span>
                  </div>
                  <button className="textbook-reader-source-action" type="button" onClick={() => setOpenedSourceBookId(selectedTextbook.id)}>Открыть учебник <ArrowRight size={17} weight="bold" aria-hidden="true" /></button>
                </div>
                <footer><span>Задачи № {chapter.start}–{chapter.end}</span><span>8 класс</span></footer>
              </article>
            </div>
          ) : hasReadableSource ? (
            <div className={`textbook-reader-source is-${selectedTextbook.sourceType}`}>
              <div className="textbook-reader-source-header">
                <h2 id="textbook-stage-title">{selectedTextbook.title}</h2>
                {selectedTextbook.previewBeforeReading && <button type="button" onClick={() => setOpenedSourceBookId(null)}><CaretLeft size={17} weight="bold" aria-hidden="true" /> К превью</button>}
              </div>
              {selectedTextbook.sourceType === 'image' ? (
                <img src={selectedTextbook.sourceUrl} alt={`Страница учебника «${selectedTextbook.title}»`} />
              ) : (
                <TextbookPdfReader sourceUrl={selectedTextbook.sourceUrl!} title={selectedTextbook.title} />
              )}
              <div className="textbook-reader-source-actions">
                <a href={selectedTextbook.sourceUrl} target="_blank" rel="noreferrer"><ArrowSquareOut size={17} weight="bold" aria-hidden="true" /> Открыть отдельно</a>
              </div>
            </div>
          ) : hasOfficialSource ? (
            <section className="textbook-reader-preview" aria-labelledby="textbook-stage-title">
              <FilePdf size={32} weight="duotone" aria-hidden="true" />
              <div>
                <span>Глава {chapter.label} · {chapter.focus}</span>
                <h2 id="textbook-stage-title">{chapter.title}</h2>
                <p>{chapter.description}</p>
                <p className="textbook-reader-preview-help">Электронный учебник откроется у издателя.</p>
                <a className="textbook-reader-source-action" href={selectedTextbook.sourceUrl} target="_blank" rel="noreferrer"><ArrowSquareOut size={17} weight="bold" aria-hidden="true" /> Открыть учебник</a>
              </div>
            </section>
          ) : selectedTextbook.sourceUrl ? (
            <section className="textbook-reader-source-empty" aria-labelledby="textbook-stage-title">
              <BookBookmark size={32} weight="duotone" aria-hidden="true" />
              <div>
                <span>Учебник по ссылке</span>
                <h2 id="textbook-stage-title">{selectedTextbook.title}</h2>
                <p>Открой источник в отдельной вкладке.</p>
                <a className="textbook-reader-source-action" href={selectedTextbook.sourceUrl} target="_blank" rel="noreferrer"><ArrowSquareOut size={17} weight="bold" aria-hidden="true" /> Открыть учебник</a>
              </div>
            </section>
          ) : (
            <section className="textbook-reader-source-empty" aria-labelledby="textbook-stage-title">
              <BookBookmark size={32} weight="duotone" aria-hidden="true" />
              <div>
                <span>Учебник не добавлен</span>
                <h2 id="textbook-stage-title">Загрузи свой PDF</h2>
                <p>PDF можно читать и листать прямо здесь.</p>
                <label className="textbook-reader-source-action" htmlFor="textbook-reader-file"><Plus size={17} weight="bold" aria-hidden="true" /> Добавить PDF</label>
              </div>
            </section>
          )}
          {sourceError && <p className="textbook-reader-source-error" role="alert">{sourceError}</p>}

          <nav className="textbook-chapter-nav" aria-label="Оглавление учебника">
            <button type="button" aria-label="Предыдущая глава" disabled={chapterIndex === 0} onClick={() => changeChapter(chapterIndex - 1)}><CaretLeft size={19} weight="bold" aria-hidden="true" /></button>
            <div>
              {reader.chapters.map((item, index) => (
                <button type="button" key={item.label} className={index === chapterIndex ? 'is-active' : ''} aria-current={index === chapterIndex ? 'page' : undefined} onClick={() => changeChapter(index)}><span>{item.label}</span><strong>{item.title}</strong></button>
              ))}
            </div>
            <button type="button" aria-label="Следующая глава" disabled={chapterIndex === reader.chapters.length - 1} onClick={() => changeChapter(chapterIndex + 1)}><CaretRight size={19} weight="bold" aria-hidden="true" /></button>
          </nav>
        </section>

        <aside className="textbook-queue" aria-labelledby="textbook-queue-title">
          <div className="textbook-queue-heading">
            <span id="textbook-queue-title"><Hash size={19} weight="duotone" aria-hidden="true" /> Очередь</span>
            <small>{selectedTasks.length} выбрано</small>
          </div>
          {selectedTasks.length > 0 ? (
            <ol className="textbook-queue-list">
              {selectedTasks.map((task) => <li key={task}><span>№ {task}</span><strong>{getSolutionPrice(selectedTextbook.id, task)} ₽</strong></li>)}
            </ol>
          ) : (
            <p className="textbook-queue-empty">Отметь одну или несколько задач из выбранной главы.</p>
          )}
          <div className="textbook-queue-summary">
            <span>Цена зависит от сложности: 5–15 ₽</span>
            <strong>{selectedTasks.length} {taskPlural(selectedTasks.length)} · {totalPrice} ₽</strong>
          </div>
          <button className="textbook-queue-topup" type="button" onClick={onOpenWallet}>Пополнить баланс <ArrowRight size={17} weight="bold" aria-hidden="true" /></button>
          <button className="textbook-queue-submit" type="button" disabled={selectedTasks.length === 0 || isSolving} onClick={() => { void solveSelected() }}>
            {isSolving ? 'Добавляем…' : `Решить выбранные${selectedTasks.length ? ` · ${selectedTasks.length}` : ''}`}
            {!isSolving && <ArrowRight size={18} weight="bold" aria-hidden="true" />}
          </button>
          {batchNotice && <p className="textbook-queue-notice" role="status" aria-live="polite">{batchNotice}</p>}
        </aside>
      </div>
    </section>
  )
}
