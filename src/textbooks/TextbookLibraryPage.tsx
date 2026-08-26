import { useEffect, useMemo, useRef, useState } from 'react'
import type { Icon } from '@phosphor-icons/react'
import {
  ArrowRight,
  BookBookmark,
  CaretLeft,
  CaretRight,
  Check,
  MagnifyingGlass,
  ShoppingCartSimple,
  X,
} from '@phosphor-icons/react'
import { getSolutionPrice } from '../lib/solutionPricing'
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
    badge: 'Полный индекс учебника',
    taskCount: 1431,
    chapters: [
      { label: '01', title: '№ 1–200', focus: 'Страницы 9–55', description: 'Точные номера и условия из выбранного PDF.', start: 1, end: 200 },
      { label: '02', title: '№ 201–400', focus: 'Продолжение учебника', description: 'Перед решением условие сверяется с исходной страницей.', start: 201, end: 400 },
      { label: '03', title: '№ 401–600', focus: 'Продолжение учебника', description: 'Чертёж показывается вместе с условием, когда он есть в задаче.', start: 401, end: 600 },
      { label: '04', title: '№ 601–800', focus: 'Продолжение учебника', description: 'Каждый номер привязан к странице исходного издания.', start: 601, end: 800 },
      { label: '05', title: '№ 801–1000', focus: 'Продолжение учебника', description: 'Выбери номер и подтверди условие до списания.', start: 801, end: 1000 },
      { label: '06', title: '№ 1001–1200', focus: 'Продолжение учебника', description: 'Условие берётся из индекса, а не придумывается по номеру.', start: 1001, end: 1200 },
      { label: '07', title: '№ 1201–1400', focus: 'Продолжение учебника', description: 'Скан остаётся источником для формул и чертежей.', start: 1201, end: 1400 },
      { label: '08', title: '№ 1401–1431', focus: 'Конец задачника', description: 'Последние задачи полного издания.', start: 1401, end: 1431 },
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
    { label: '01', title: 'Начало работы', focus: 'Номера и заметки', description: 'Выбери номера из этого издания — они останутся в корзине до оплаты.', start: 1, end: 40 },
    { label: '02', title: 'Практика', focus: 'Разбор по шагам', description: 'Собери нужные задачи в корзину и оплати их вместе.', start: 41, end: 80 },
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
  onCheckTask,
}: {
  items: readonly TextbookLibraryItem[]
  selectedTextbookId: string
  onSelectTextbook: (id: string) => void
  onCheckTask: (textbookId: string, task: string) => void
}) {
  const selectedTextbook = items.find((textbook) => textbook.id === selectedTextbookId) ?? items[0]
  const [progressByBook, setProgressByBook] = useState<ReaderProgress>(getInitialProgress)
  const [query, setQuery] = useState('')
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
  const cartItems = items.flatMap((textbook) => {
    const taskCount = getReaderModel(textbook).taskCount
    return (progressByBook[textbook.id]?.selectedTasks ?? [])
      .filter((task) => task <= taskCount)
      .map((task) => ({ textbook, task, price: getSolutionPrice(textbook.id, task) }))
  })
  const totalPrice = cartItems.reduce((total, item) => total + item.price, 0)

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
    updateProgress((current) => {
      const selected = new Set(current.selectedTasks)
      if (selected.has(task)) selected.delete(task)
      else selected.add(task)
      return { ...current, selectedTasks: [...selected].sort((left, right) => left - right) }
    })
  }

  const toggleChapterTasks = () => {
    updateProgress((current) => {
      const selected = new Set(current.selectedTasks)
      if (allChapterTasksSelected) chapterTasks.forEach((task) => selected.delete(task))
      else chapterTasks.forEach((task) => selected.add(task))
      return { ...current, selectedTasks: [...selected].sort((left, right) => left - right) }
    })
  }

  const clearTasks = () => {
    updateProgress((current) => ({ ...current, selectedTasks: [] }))
  }

  const removeCartItem = (textbookId: string, task: number) => {
    setProgressByBook((current) => {
      const progress = current[textbookId]
      if (!progress) return current
      return { ...current, [textbookId]: { ...progress, selectedTasks: progress.selectedTasks.filter((item) => item !== task) } }
    })
  }

  const clearCart = () => {
    setProgressByBook((current) => Object.fromEntries(
      Object.entries(current).map(([textbookId, progress]) => [textbookId, { ...progress, selectedTasks: [] }]),
    ))
  }

  const changeChapter = (nextIndex: number) => {
    setQuery('')
    if (typeof taskListRef.current?.scrollTo === 'function') taskListRef.current.scrollTo({ top: 0 })
    updateProgress((current) => ({ ...current, chapterIndex: Math.max(0, Math.min(nextIndex, reader.chapters.length - 1)) }))
  }

  return (
    <section className="textbook-reader-page" aria-labelledby="textbook-reader-title" data-subject={selectedTextbook.id}>
      <header className="textbook-reader-header">
        <div>
          <span className="textbook-reader-eyebrow"><BookBookmark size={18} weight="duotone" aria-hidden="true" /> Задачи · 8 класс</span>
          <h1 id="textbook-reader-title">Выбери задачи</h1>
          <p>Выбери номер. Перед решением сверим его условие с выбранным изданием.</p>
        </div>
      </header>

      <div className="textbook-reader-layout">
        <aside className="textbook-reader-rail" aria-label="Предметы и список задач">
          <section className="textbook-book-switcher" aria-labelledby="textbook-book-switcher-title">
            <div className="textbook-rail-heading">
              <span id="textbook-book-switcher-title">Предмет</span>
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
                    onClick={() => { setQuery(''); onSelectTextbook(textbook.id) }}
                  >
                    <Icon size={21} weight="duotone" aria-hidden="true" />
                    <span><strong>{textbook.subject}</strong><small>{textbook.grade}</small></span>
                    {active && <Check size={16} weight="bold" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
          </section>

          <nav className="textbook-chapter-nav" aria-label="Разделы задач">
            <button type="button" aria-label="Предыдущая глава" disabled={chapterIndex === 0} onClick={() => changeChapter(chapterIndex - 1)}><CaretLeft size={19} weight="bold" aria-hidden="true" /></button>
            <div>
              {reader.chapters.map((item, index) => (
                <button type="button" key={item.label} className={index === chapterIndex ? 'is-active' : ''} aria-current={index === chapterIndex ? 'page' : undefined} onClick={() => changeChapter(index)}><span>{item.label}</span><strong>{item.title}</strong></button>
              ))}
            </div>
            <button type="button" aria-label="Следующая глава" disabled={chapterIndex === reader.chapters.length - 1} onClick={() => changeChapter(chapterIndex + 1)}><CaretRight size={19} weight="bold" aria-hidden="true" /></button>
          </nav>

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
              {selectedTasks.length > 0 && <button type="button" onClick={clearTasks}>Убрать выбранные</button>}
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

        <aside className="textbook-cart" aria-labelledby="textbook-cart-title">
          <div className="textbook-cart-heading">
            <span id="textbook-cart-title"><ShoppingCartSimple size={19} weight="duotone" aria-hidden="true" /> Выбранные</span>
            <small>{cartItems.length} {taskPlural(cartItems.length)}</small>
          </div>
          {cartItems.length > 0 ? (
            <>
              <ol className="textbook-cart-list" aria-label="Задачи в корзине">
                {cartItems.map(({ textbook, task, price }) => (
                  <li key={`${textbook.id}-${task}`}>
                    <span><strong>{textbook.subject}</strong><small>Задача № {task}</small></span>
                    <strong>{price} ₽</strong>
                    <button type="button" aria-label={`Убрать из выбранных: ${textbook.subject}, задача № ${task}`} onClick={() => removeCartItem(textbook.id, task)}>
                      <X size={16} weight="bold" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
              <button className="textbook-cart-clear" type="button" onClick={clearCart}>Очистить выбранные</button>
            </>
          ) : (
            <p className="textbook-cart-empty">Пока ничего не выбрано.</p>
          )}
          <div className="textbook-cart-summary">
            <span>После подтверждения</span>
            <strong>{totalPrice} ₽</strong>
          </div>
          <button className="textbook-cart-submit" type="button" disabled={cartItems.length === 0} onClick={() => {
            const first = cartItems[0]
            if (first) onCheckTask(first.textbook.id, String(first.task))
          }}>
            Проверить условие
            <ArrowRight size={18} weight="bold" aria-hidden="true" />
          </button>
        </aside>
      </div>
    </section>
  )
}
