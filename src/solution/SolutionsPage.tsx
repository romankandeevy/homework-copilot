import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { ArrowRight, MagnifyingGlass, Notebook } from '@phosphor-icons/react'
import { applicationPath } from '../lib/appPath'
import type { HomeworkSolution, HomeworkSource } from '../lib/homeworkContract'
import { keyed } from '../lib/listKeys'
import { describeTask } from '../lib/taskTitle'
import type { TaskTitle } from '../lib/taskTitle'
import { SolutionCard } from './SolutionCard'
import './SolutionsPage.css'

/* «Мои решения» и их окошко на главной.

   Живут отдельно от App.tsx: 14 сентября 2026 список переделан по разбору
   владельца, у которого полсотни решений.
   - У каждой задачи название (`describeTask`), а не обрубок условия.
   - Список идёт днями, новые сверху, и показывает часть: при тысяче решений
     владелец «физически не доставал до подвала».
   - Число решённых видно и здесь, и на главной. Это факт, а не метрика:
     без серий, целей и «за неделю» (DESIGN.md). */

export type SolutionListItem = {
  textbookId: string
  task: string
  source: HomeworkSource
  solution: HomeworkSolution
}

export type OpenedSolution = {
  mode: 'ready'
  textbookId: string
  task: string
  source: HomeworkSource
}

type ListProps = {
  items: readonly SolutionListItem[]
  /** Предмет по учебнику - для старых решений, где его нет в самом решении. */
  subjectOf: (textbookId: string) => string
  onOpenSolution: (state: OpenedSolution) => void
}

/* Двадцать карточек - пять рядов на широком экране, дальше кнопка и подвал. */
const solutionsPageSize = 20
/* На главной - последние три, один ряд на широком экране. */
const homeSolutionsLimit = 3
/* `get_my_homework_solutions` отдаёт последние сто, столько же держит
   localStorage (`saveGeneratedSolutions`). Больше ста клиент не видит, и
   число от ста - «не меньше». */
const loadedSolutionsLimit = 100

type Entry = {
  key: string
  item: SolutionListItem
  subject: string
  createdAt: Date | null
  label: TaskTitle
  haystack: string
}

function entriesOf(items: readonly SolutionListItem[], subjectOf: (textbookId: string) => string): Entry[] {
  const entries: Entry[] = items.map((item) => {
    const subject = item.solution.subject || subjectOf(item.textbookId)
    const created = new Date(item.solution.createdAt)
    const createdAt = Number.isNaN(created.getTime()) ? null : created
    const label = describeTask(item.solution)
    return {
      key: '',
      item,
      subject,
      createdAt,
      label,
      // Ищется и по номеру, и по ответу: «274» и «x > 10» - то, что человек помнит.
      haystack: [subject, label.number ?? '', label.title, item.solution.condition, item.solution.answer]
        .join(' ')
        .replace(/\s+/gu, ' ')
        .toLocaleLowerCase('ru-RU'),
    }
  })
  entries.sort((left, right) => (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0))
  // Ключ не зависит от места в списке: повтор различается своим номером.
  for (const { key, item } of keyed(entries, (entry) => `${entry.item.textbookId}-${entry.item.task}-${entry.item.solution.createdAt}`)) {
    item.key = key
  }
  return entries
}

function solvedCountLabel(count: number) {
  return count >= loadedSolutionsLimit ? `не меньше ${count}` : String(count)
}

function sameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

function yesterdayOf(now: Date) {
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  return yesterday
}

const clock = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })

/* Заголовок дня. Дата видна всегда, «Сегодня» и «Вчера» - поверх неё:
   слово быстрее читается, число нужно, чтобы сверить с дневником. */
function dayTitle(date: Date | null, now: Date) {
  if (!date) return 'Дата не сохранилась'
  const formatted = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date).replace(/\s*г\.$/u, '')
  if (sameDay(date, now)) return `Сегодня, ${formatted}`
  if (sameDay(date, yesterdayOf(now))) return `Вчера, ${formatted}`
  return formatted
}

/* На главной заголовков-дней нет, поэтому у карточки время вместе с днём. */
function momentOf(date: Date | null, now: Date) {
  if (!date) return ''
  if (sameDay(date, now)) return `сегодня, ${clock.format(date)}`
  if (sameDay(date, yesterdayOf(now))) return `вчера, ${clock.format(date)}`
  return `${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(date)}, ${clock.format(date)}`
}

function dayKey(date: Date | null) {
  return date ? `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}` : 'unknown'
}

function groupByDay(entries: readonly Entry[], now: Date) {
  const groups: { key: string; title: string; entries: Entry[] }[] = []
  for (const entry of entries) {
    const key = dayKey(entry.createdAt)
    const last = groups.at(-1)
    if (last?.key === key) last.entries.push(entry)
    else groups.push({ key, title: dayTitle(entry.createdAt, now), entries: [entry] })
  }
  return groups
}

function openState({ item }: Entry): OpenedSolution {
  return { mode: 'ready', textbookId: item.textbookId, task: item.task, source: item.source }
}

/* Окошко на главной: последние три, число всех и ссылка на полный список.
   До 14 сентября здесь лежала вся история - полсотни карточек под формой. */
export function MySolutions({ items, subjectOf, onOpenAll, onOpenSolution }: ListProps & { onOpenAll: () => void }) {
  const entries = useMemo(() => entriesOf(items, subjectOf), [items, subjectOf])
  const latest = entries.slice(0, homeSolutionsLimit)
  const now = new Date()

  // Ссылка, а не кнопка: её открывают в новой вкладке, как разделы в шапке.
  const openAll = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    onOpenAll()
  }

  return (
    <section className="my-solutions" aria-labelledby="my-solutions-title">
      <header className="section-heading">
        <div>
          <h2 id="my-solutions-title">Мои решения</h2>
          {entries.length > 0
            ? <p>Решено задач: <strong className="solutions-count">{solvedCountLabel(entries.length)}</strong></p>
            : <p>Задачи, которые ты решил в этом аккаунте.</p>}
        </div>
        {entries.length > 0 && (
          <a className="section-link" href={applicationPath('/solutions')} onClick={openAll}>
            Все решения <ArrowRight size={17} weight="bold" aria-hidden="true" />
          </a>
        )}
      </header>
      {latest.length > 0 ? (
        <div className="solution-cards">
          {latest.map((entry) => (
            <SolutionCard
              key={entry.key}
              solution={entry.item.solution}
              title={entry.label}
              subject={entry.subject}
              time={momentOf(entry.createdAt, now)}
              onOpen={() => onOpenSolution(openState(entry))}
            />
          ))}
        </div>
      ) : <p className="collection-empty">Пока здесь пусто. Первое решение появится после запроса.</p>}
    </section>
  )
}

/* Личная история решений.

   Общей базы здесь больше нет. Она пополнялась только решениями по номеру
   из размеченного учебника, а индекс учебников удалён: в каталоге не
   прибавилось ни одной записи с 28 августа и не могло прибавиться. Раздел
   занимал вкладку, поиск и карточку на главной, и ничего не отдавал. */
export function SolutionsPage({
  signedIn,
  items,
  subjectOf,
  onOpenAccount,
  onOpenSolution,
  onStartTask,
}: ListProps & {
  signedIn: boolean
  onOpenAccount: () => void
  onStartTask: () => void
}) {
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(solutionsPageSize)
  const listRef = useRef<HTMLDivElement>(null)
  const focusFrom = useRef<number | null>(null)
  const idPrefix = useId()
  const entries = useMemo(() => entriesOf(items, subjectOf), [items, subjectOf])
  const normalizedQuery = query.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru-RU')
  const filtered = normalizedQuery ? entries.filter((entry) => entry.haystack.includes(normalizedQuery)) : entries
  const shown = filtered.slice(0, visible)
  const remaining = filtered.length - shown.length
  const filtering = Boolean(normalizedQuery)
  const groups = groupByDay(shown, new Date())

  /* После «Показать ещё» фокус - на первой новой карточке. Иначе на
     последней странице кнопка исчезает и фокус падает в начало документа. */
  useEffect(() => {
    if (focusFrom.current === null) return
    const cards = listRef.current?.querySelectorAll<HTMLButtonElement>('.solution-card')
    cards?.[focusFrom.current]?.focus()
    focusFrom.current = null
  }, [visible])

  const resetPaging = () => setVisible(solutionsPageSize)
  const showMore = () => {
    focusFrom.current = shown.length
    setVisible((current) => current + solutionsPageSize)
  }
  const clearFilters = () => {
    setQuery('')
    resetPaging()
  }

  const hasSolutions = signedIn && entries.length > 0

  return (
    <section className="route-page solutions-page" aria-labelledby="solutions-page-title">
      <header className="route-page-header">
        <h1 id="solutions-page-title">Мои решения</h1>
        {hasSolutions
          ? <p>Решено задач: <strong className="solutions-count">{solvedCountLabel(entries.length)}</strong>. Открыть любую можно снова и бесплатно.</p>
          : <p>Задачи, которые ты уже решил. Открыть любую можно снова и бесплатно.</p>}
      </header>

      {/* Поиск появляется, когда есть в чём искать. */}
      {hasSolutions && (
        <div className="solutions-toolbar">
          <label className="route-search" htmlFor="solutions-search">
            <MagnifyingGlass size={20} weight="duotone" aria-hidden="true" />
            <span>Найти решение</span>
            <input
              id="solutions-search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                resetPaging()
              }}
              placeholder="Номер, слово из условия или ответ"
              autoComplete="off"
            />
          </label>
        </div>
      )}
      {hasSolutions && filtering && filtered.length > 0 && (
        <p className="solutions-found" role="status">Найдено: {filtered.length}</p>
      )}

      {/* Самый частый экран нового человека. До 8 сентября здесь стояли
          заголовок, подзаголовок и мелкая строка-ссылка - и семьсот пикселей
          пустоты под ними: страница читалась как недогрузившаяся. Теперь то
          же, что и у пустой истории вошедшего: карточка со значком,
          объяснением и действием. */}
      {!signedIn ? (
        <section className="route-empty" aria-labelledby="solutions-empty-title">
          <Notebook size={34} weight="duotone" aria-hidden="true" />
          <div>
            <h2 id="solutions-empty-title">Здесь будут твои решения</h2>
            <p>
              Первую задачу можно решить без аккаунта. Чтобы решения сохранялись и открывались
              снова бесплатно, нужен вход - новому аккаунту заодно придут 20 ₽, один раз на устройство.
            </p>
            <div className="route-empty-actions">
              <button className="route-secondary-action" type="button" onClick={onStartTask}>Решить задачу</button>
              <button className="route-quiet-action" type="button" onClick={onOpenAccount}>
                Войти
                <ArrowRight size={16} weight="bold" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>
      ) : entries.length === 0 ? (
        <section className="route-empty" aria-labelledby="solutions-empty-title">
          <Notebook size={34} weight="duotone" aria-hidden="true" />
          <div>
            <h2 id="solutions-empty-title">Решений пока нет</h2>
            <p>Отправь задачу с главной, и она появится здесь. Открыть её снова можно бесплатно.</p>
            <button className="route-secondary-action" type="button" onClick={onStartTask}>Решить задачу</button>
          </div>
        </section>
      ) : filtered.length === 0 ? (
        <section className="route-empty" aria-labelledby="solutions-empty-title">
          <MagnifyingGlass size={34} weight="duotone" aria-hidden="true" />
          <div>
            <h2 id="solutions-empty-title">По запросу «{query.trim()}» ничего нет</h2>
            <p>Попробуй номер, другое слово из условия или ответ.</p>
            <button className="route-secondary-action" type="button" onClick={clearFilters}>Показать все решения</button>
          </div>
        </section>
      ) : (
        <div className="solutions-days" ref={listRef}>
          {groups.map((group) => (
            <section key={group.key} className="solutions-day" aria-labelledby={`${idPrefix}-${group.key}`}>
              <h2 id={`${idPrefix}-${group.key}`} className="solutions-day-title">{group.title}</h2>
              <div className="solution-cards">
                {group.entries.map((entry) => (
                  <SolutionCard
                    key={entry.key}
                    solution={entry.item.solution}
                    title={entry.label}
                    subject={entry.subject}
                    time={entry.createdAt ? clock.format(entry.createdAt) : ''}
                    onOpen={() => onOpenSolution(openState(entry))}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {hasSolutions && remaining > 0 && (
        <div className="solutions-more">
          <button className="route-secondary-action" type="button" onClick={showMore}>
            Показать ещё {Math.min(remaining, solutionsPageSize)}
          </button>
          <p>Показано {shown.length} из {filtered.length}</p>
        </div>
      )}
    </section>
  )
}
