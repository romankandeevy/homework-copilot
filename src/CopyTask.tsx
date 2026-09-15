import { useEffect, useRef, useState } from 'react'
import type { ClipboardEvent, FormEvent } from 'react'
import { ArrowRight, ImageSquare, Plus, X } from '@phosphor-icons/react'
import { maxConditionLength } from './lib/homeworkContract'
import type { HomeworkSource } from './lib/homeworkContract'
import { formatRubles } from './lib/currency'
import { prepareTaskPhoto } from './lib/homeworkSolution'
import { estimateSolutionPrice, minimumSolutionPriceKopecks } from './lib/solutionPricing'
import { findSubjectByName, solvableGrades, solvableSubjects } from './lib/subjects'
import type { SolvableSubject } from './lib/subjects'

// Форма постановки задач.
//
// Раньше здесь был выбор учебника и поиск условия по номеру. От индекса
// учебников отказались, поэтому осталось главное: условие даёт ученик —
// текстом, фотографией или тем и другим сразу.
//
// Задача теперь не одна. Домашнее задание задают не по одному предмету:
// вечером у школьника геометрия, алгебра и физика сразу, и ставить их по
// одной, дожидаясь каждой, — это три захода вместо одного. Форма стала
// списком: у каждой строки свой предмет, свой класс и своё условие или фото.
//
// 14 сентября 2026 владелец попросил сделать это «добротно»: со второй
// задачи каждая становится карточкой, её можно убрать, и проверяется она
// сама по себе, с ошибкой под собой, а не общей строкой над списком. Одна
// кнопка отправляет все, каждая уходит в общую очередь (`enqueueTask` в
// App.tsx), а та решает по две одновременно, остальные ждут.
//
// Предмет обязателен у каждой. Он перестал быть подсказкой: от него зависят
// правила, по которым решение проверяется, — «единица измерения при ответе»,
// «корень выделен в разборе по составу», «уравнение реакции уравнено». Не
// зная предмета, проверять решение нечем.
//
// Класс остаётся необязательным. Он влияет на способ решения — одна и та же
// задача в 7 и в 11 классе решается по-разному, — но без него решение
// получится, просто самым простым способом.

export type TaskSubmission = {
  condition: string
  /* Снимок приходит уже сжатым и в виде data-URL, а не файлом.
     Так цена, показанная в форме, считается ровно по тому же числу байт,
     которое уйдёт на сервер: иначе на экране одна сумма, а спишется другая. */
  imageDataUrl?: string
  subject: string
  grade?: string
  source: HomeworkSource
  idempotencyKey: string
}

/* Сколько задач уходит одним нажатием.

   Предел ставит не очередь - она сама держит две в работе, остальные ждут, -
   а хранилище запросов: браузер помнит шесть последних (`pendingSolutions.ts`),
   и седьмая вытеснила бы условие первой. После перезахода её было бы нечем
   решать. Пять задач - это вечер домашки, и одно место остаётся под повтор. */
export const maxTaskEntries = 5

/* Короче этого условие не бывает: «x+2=5» без вопроса - ещё не задача. */
const minConditionLength = 15

type EntryField = 'condition' | 'subject' | 'photo'

type TaskEntry = {
  id: string
  condition: string
  imageDataUrl: string
  photoName: string
  photoPending: boolean
  subject: string
  grade: string
  /** Своя проверка у каждой карточки: сообщение стоит под той задачей, где беда. */
  error: string
  errorField: EntryField | ''
}

type EntryProblem = { field: EntryField; message: string }

/* Почему кнопка «Добавить задачу» не добавила карточку. */
type LimitNote = '' | 'guest' | 'max'

function newEntryId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `task-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function emptyEntry(grade: string, subject = ''): TaskEntry {
  return {
    id: newEntryId(),
    condition: '',
    imageDataUrl: '',
    photoName: '',
    photoPending: false,
    subject,
    grade,
    error: '',
    errorField: '',
  }
}

/* Карточка, в которую ничего не вписали и не приложили. Лишняя пустая
   карточка ошибкой не считается: в ней нечего терять, и остальные задачи
   из-за неё не задерживаем. */
function entryIsBlank(entry: TaskEntry) {
  return !entry.condition.trim() && !entry.imageDataUrl && !entry.photoPending
}

function entryPrice(entry: TaskEntry) {
  return estimateSolutionPrice({
    conditionLength: entry.condition.trim().length,
    imageBytes: entry.imageDataUrl.length,
    subject: entry.subject,
  })
}

/* Проверка одной карточки. Сообщение стоит под той задачей, к которой
   относится: «условие слишком короткое» над списком из трёх задач не
   говорило, в какой из них дело. */
function entryProblem(entry: TaskEntry, photoEnabled: boolean): EntryProblem | null {
  if (entry.photoPending) return { field: 'photo', message: 'Фотография ещё готовится — секунду' }
  if (!entry.imageDataUrl) {
    const length = entry.condition.trim().length
    if (length === 0) {
      return { field: 'condition', message: photoEnabled ? 'Впиши условие или приложи фото' : 'Впиши условие задачи' }
    }
    if (length < minConditionLength) {
      return {
        field: 'condition',
        message: photoEnabled
          ? 'Условие слишком короткое — впиши его целиком или приложи фото'
          : 'Условие слишком короткое: впиши его целиком',
      }
    }
  }
  // Предмет задаёт правила проверки решения, поэтому без него не отправляем.
  if (!entry.subject) return { field: 'subject', message: 'Выбери предмет: по нему проверяется решение' }
  return null
}

/* Сколько задач - столько и решений: «2 задачи», «5 задач». */
function taskCountLabel(count: number) {
  const tail = count % 100 >= 11 && count % 100 <= 14
    ? 'задач'
    : ['задач', 'задача', 'задачи', 'задачи', 'задачи'][Math.min(count % 10, 4)] ?? 'задач'
  return `${count} ${tail}`
}

/* Витрина ведёт сюда с уже выбранным предметом: `/app?subject=Физика`,
   имя ровно как в `src/lib/subjects.ts`. Чужое значение молча пропускаем,
   форма остаётся как была. Предмет, выключенный в админке, тоже не
   подставляем: в списке его нет, и сервер задачу по нему отвергнет. */
function subjectFromAddress(subjects: readonly SolvableSubject[]) {
  if (typeof window === 'undefined') return ''
  const requested = new URLSearchParams(window.location.search).get('subject')
  const subject = requested ? findSubjectByName(requested) : null
  return subject && subjects.some((item) => item.name === subject.name) ? subject.name : ''
}

/* Черновик формы живёт во вкладке (sessionStorage), пока задачи не ушли.
   14 сентября 2026 нехватка денег на несколько задач стала уводить на
   страницу баланса, а вход гостя - в профиль, и форма исчезала вместе со
   всеми набранными условиями. Теперь условие, предмет и класс каждой
   карточки переживают такой переход и перезагрузку. Фото не храним: пять
   снимков не помещаются в хранилище, и карточка просит приложить его
   заново. */
const draftKey = 'homework-copilot:task-draft'

type DraftEntry = { condition: string; subject: string; grade: string; hadPhoto: boolean }

function loadDraft(subjects: readonly SolvableSubject[]): TaskEntry[] | null {
  try {
    const stored = window.sessionStorage.getItem(draftKey)
    if (!stored) return null
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return null
    const restored = parsed.slice(0, maxTaskEntries).flatMap((item): TaskEntry[] => {
      if (!item || typeof item !== 'object') return []
      const draft = item as Partial<DraftEntry>
      const condition = typeof draft.condition === 'string' ? draft.condition.slice(0, maxConditionLength) : ''
      const subject = typeof draft.subject === 'string' && subjects.some((entry) => entry.name === draft.subject) ? draft.subject : ''
      const grade = typeof draft.grade === 'string' && (solvableGrades as readonly string[]).includes(draft.grade) ? draft.grade : ''
      if (!condition.trim() && !draft.hadPhoto) return []
      return [{
        ...emptyEntry(grade, subject),
        condition,
        ...(draft.hadPhoto ? { error: 'Фото не сохранилось при переходе, приложи его заново', errorField: 'photo' as const } : {}),
      }]
    })
    return restored.length > 0 ? restored : null
  } catch {
    return null
  }
}

function saveDraft(entries: readonly TaskEntry[]) {
  try {
    const kept: DraftEntry[] = entries
      .filter((entry) => entry.condition.trim() || entry.imageDataUrl)
      .map((entry) => ({ condition: entry.condition, subject: entry.subject, grade: entry.grade, hadPhoto: Boolean(entry.imageDataUrl) }))
    if (kept.length > 0) window.sessionStorage.setItem(draftKey, JSON.stringify(kept))
    else window.sessionStorage.removeItem(draftKey)
  } catch {
    // Хранилище закрыто браузером: черновик просто не переживёт переход.
  }
}

/* Фокус переводим после отрисовки: новой карточки или соседней с убранной
   ещё нет в документе в момент нажатия. */
function afterPaint(callback: () => void) {
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(callback)
  else window.setTimeout(callback, 0)
}

export default function CopyTask({
  onSubmit,
  onRequireAccount,
  signedIn = false,
  freeSolutionUsed = false,
  defaultGrade: profileGrade = '',
  subjects = solvableSubjects,
  photoEnabled = true,
}: {
  onSubmit: (submissions: TaskSubmission[]) => Promise<boolean>
  /** Открывает вход. Гостю несколько задач сразу не положено, и объяснение ведёт сюда. */
  onRequireAccount?: () => void
  /** Гостю показываем, что первое решение он получит без регистрации. */
  signedIn?: boolean
  freeSolutionUsed?: boolean
  /** Класс из профиля: один и тот же вопрос не должен иметь двух ответов. */
  defaultGrade?: string
  /** Предметы и их порядок из админки: выключенный предмет не предлагаем. */
  subjects?: readonly SolvableSubject[]
  /** Решение по фото можно выключить из админки, сервер его тогда отвергнет. */
  photoEnabled?: boolean
}) {
  // Класс профиля подставляем, только если форма его знает: в старых
  // профилях бывает 1-4 класс, а решаем мы с пятого.
  const defaultGrade = (solvableGrades as readonly string[]).includes(profileGrade) ? profileGrade : ''
  const [entries, setEntries] = useState<TaskEntry[]>(() => {
    // Ссылка с предметом - новый вход в форму, черновик ей не мешает.
    const addressSubject = subjectFromAddress(subjects)
    return (!addressSubject && loadDraft(subjects)) || [emptyEntry(defaultGrade, addressSubject)]
  })
  const [formError, setFormError] = useState('')
  const [limitNote, setLimitNote] = useState<LimitNote>('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submissionRef = useRef(false)
  const conditionRefs = useRef(new Map<string, HTMLTextAreaElement>())
  const subjectRefs = useRef(new Map<string, HTMLSelectElement>())

  const many = entries.length > 1
  // Уйдут только непустые карточки: по ним и цена, и надпись на кнопке.
  const outgoing = entries.filter((entry) => !entryIsBlank(entry))
  const total = outgoing.reduce((sum, entry) => sum + entryPrice(entry), 0)
  /* Гость, у которого бесплатное решение ещё не потрачено: ему цену не
     показываем вовсе. Право на бесплатный разбор считает база
     (`public.claim_guest_solution`), здесь только то, что видно клиенту. */
  const showsFreeOffer = !signedIn && !freeSolutionUsed

  /* Параметр `subject` своё отработал: убираем его из адреса, иначе
     перезагрузка через час снова навязала бы предмет, который ученик уже
     сменил. Остальные параметры (`auth`, `payment`, `ref`) не трогаем - их
     разбирают другие части приложения, - как и состояние истории. */
  useEffect(() => {
    const address = new URL(window.location.href)
    if (!address.searchParams.has('subject')) return
    address.searchParams.delete('subject')
    window.history.replaceState(window.history.state, '', `${address.pathname}${address.search}${address.hash}`)
  }, [])

  // Черновик пишется на каждое изменение. Ушли задачи - форма пустеет, и
  // пустой черновик стирается сам.
  useEffect(() => {
    saveDraft(entries)
  }, [entries])

  // Поле подстраивается под объём условия, вместо того чтобы прокручиваться
  // внутри четырёх строк. Сначала сбрасываем высоту: без этого поле умеет
  // только расти и не сжимается, когда текст стёрли.
  useEffect(() => {
    for (const entry of entries) {
      const field = conditionRefs.current.get(entry.id)
      if (!field) continue
      field.style.height = 'auto'
      field.style.height = `${field.scrollHeight}px`
    }
  }, [entries])

  // Профиль подгружается после первого рендера, поэтому класс из него
  // подставляем позже — но только пока ученик не выбрал свой.
  const gradeTouchedRef = useRef(false)
  useEffect(() => {
    if (gradeTouchedRef.current || !defaultGrade) return
    setEntries((current) => current.map((entry) => (entry.grade ? entry : { ...entry, grade: defaultGrade })))
  }, [defaultGrade])

  const patchEntry = (id: string, patch: Partial<TaskEntry>) => {
    setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)))
  }

  // Правка карточки снимает её ошибку: сообщение о том, чего уже нет,
  // только сбивает.
  const editEntry = (id: string, patch: Partial<TaskEntry>) => {
    patchEntry(id, { ...patch, error: '', errorField: '' })
    if (formError) setFormError('')
  }

  /* Снимок готовится сразу при выборе, а не при отправке.

     Так цена считается по тем самым байтам, которые уйдут на сервер, и
     ожидание сжатия не превращается в паузу между нажатием «Решить» и
     первым признаком жизни. */
  const changePhoto = async (id: string, file: File | null) => {
    if (!file) {
      editEntry(id, { imageDataUrl: '', photoName: '', photoPending: false })
      return
    }
    if (!/^image\/(?:jpeg|png|webp|heic|heif)$/i.test(file.type)) {
      patchEntry(id, { error: 'Фото должно быть в формате JPEG, PNG или WebP', errorField: 'photo' })
      return
    }
    editEntry(id, { photoPending: true, photoName: file.name || 'Фото задачи' })
    try {
      const imageDataUrl = await prepareTaskPhoto(file)
      patchEntry(id, { imageDataUrl, photoPending: false })
    } catch (photoError) {
      patchEntry(id, {
        imageDataUrl: '',
        photoName: '',
        photoPending: false,
        error: photoError instanceof Error ? photoError.message : 'Не получилось приложить фотографию',
        errorField: 'photo',
      })
    }
  }

  // Фото можно не только выбрать файлом, но и вставить из буфера: школьник
  // чаще делает снимок экрана, чем сохраняет файл и ищет его в проводнике.
  const pastePhoto = (id: string, event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!photoEnabled) return
    const item = [...event.clipboardData.items].find((entry) => entry.type.startsWith('image/'))
    const file = item?.getAsFile()
    if (!file) return
    event.preventDefault()
    void changePhoto(id, file)
  }

  const addEntry = () => {
    /* Гостю одна задача: бесплатное решение одно на браузер, и считает его
       база. Вторая карточка у гостя ушла бы в очередь и упала там отказом
       через минуту, поэтому говорим сразу и на месте, куда смотрят. */
    if (!signedIn) {
      setLimitNote('guest')
      return
    }
    if (entries.length >= maxTaskEntries) {
      setLimitNote('max')
      return
    }
    const previous = entries[entries.length - 1]
    const entry = emptyEntry(previous?.grade ?? defaultGrade)
    setEntries((current) => [...current, entry])
    setLimitNote('')
    setFormError('')
    // Фокус уходит в новую карточку: иначе после нажатия ничего не
    // происходит на том месте, куда смотрит ученик.
    afterPaint(() => conditionRefs.current.get(entry.id)?.focus())
  }

  const removeEntry = (id: string) => {
    const index = entries.findIndex((entry) => entry.id === id)
    const neighbour = entries[index - 1] ?? entries[index + 1]
    setEntries((current) => (current.length > 1 ? current.filter((entry) => entry.id !== id) : current))
    setLimitNote('')
    setFormError('')
    // Фокус не пропадает вместе с карточкой, иначе он падает в начало страницы.
    if (neighbour) afterPaint(() => conditionRefs.current.get(neighbour.id)?.focus())
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submissionRef.current || isSubmitting) return
    setFormError('')
    setLimitNote('')

    // Кнопка не гаснет на пустой форме: по погасшей кнопке всё равно жмут,
    // ничего не происходит и почему — не сказано. Вместо этого каждая
    // карточка говорит, чего в ней не хватает, а курсор встаёт в первую.
    // Пусты все - спрашиваем с первой, лишние пустые просто не уходят.
    const checked = outgoing.length > 0 ? outgoing : entries.slice(0, 1)
    const problems = new Map<string, EntryProblem>()
    for (const entry of checked) {
      const problem = entryProblem(entry, photoEnabled)
      if (problem) problems.set(entry.id, problem)
    }
    setEntries((current) => current.map((entry) => {
      const problem = problems.get(entry.id)
      return { ...entry, error: problem?.message ?? '', errorField: problem?.field ?? '' }
    }))

    const firstInvalid = checked.find((entry) => problems.has(entry.id))
    if (firstInvalid) {
      const field = problems.get(firstInvalid.id)?.field
      if (field === 'subject') subjectRefs.current.get(firstInvalid.id)?.focus()
      else if (field === 'condition') conditionRefs.current.get(firstInvalid.id)?.focus()
      return
    }

    // Форма могла собрать несколько карточек, пока ученик был в аккаунте,
    // а потом он вышел. Гостю по-прежнему одна задача.
    if (!signedIn && checked.length > 1) {
      setLimitNote('guest')
      return
    }

    submissionRef.current = true
    setIsSubmitting(true)

    try {
      const submitted = await onSubmit(checked.map((entry) => {
        const condition = entry.condition.trim()
        return {
          condition,
          ...(entry.imageDataUrl ? { imageDataUrl: entry.imageDataUrl } : {}),
          subject: entry.subject,
          ...(entry.grade ? { grade: entry.grade } : {}),
          /* Есть фотография - значит задача с фотографии, что бы ученик ни
             вписал рядом. Текст при этом не пропадает: он уходит пометкой
             («реши только б)»), но условием не становится - условие на
             снимке. Раньше источником считался текст, если он вообще был,
             и подпись из шести слов ехала в промпт «проверенным условием». */
          source: entry.imageDataUrl ? 'photo' : 'text',
          idempotencyKey: typeof crypto.randomUUID === 'function'
            ? `solution-${crypto.randomUUID()}`
            : `solution-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        }
      }))

      if (submitted) setEntries([emptyEntry(defaultGrade)])
    } catch (submissionError) {
      setFormError(submissionError instanceof Error ? submissionError.message : 'Не получилось отправить задачу')
    } finally {
      submissionRef.current = false
      setIsSubmitting(false)
    }
  }

  /* Цена - на самой кнопке.

     До 14 сентября под формой стояла строка «Цена зависит от задачи:
     длинное условие и фотография дороже…» мелким серым кеглем. Владелец:
     «тупо не нужна, мешается, не прочитать». Точная цена этой задачи на
     кнопке оговорки не требует и видна до отправки - ровно там, куда
     нажимают. Пока задачи нет, на кнопке просто «Решить», а «от 4 ₽» с
     оговоркой стоит в шапке карточки. */
  const submitLabel = isSubmitting
    ? 'Решаем…'
    : showsFreeOffer
      ? 'Решить бесплатно'
      : outgoing.length === 0
        ? 'Решить'
        : outgoing.length === 1
          ? `Решить за ${formatRubles(total)}`
          : `Решить ${taskCountLabel(outgoing.length)} за ${formatRubles(total)}`

  return (
    <section className="copy-task" aria-labelledby="copy-task-title">
      <header className="copy-task-header">
        <div className="copy-task-heading">
          {/* Заголовок и оговорка в подвале говорили противоположное:
              «Списать задачу» 72-м кеглем - и «решения помогают разобраться,
              а не заменяют работу» самым мелким на сайте. Продукт продаётся
              как «сфоткал и понял» (AGENTS.md, `homeworkContract.ts`), и
              заголовок теперь говорит то же, что и всё остальное. */}
          <h1 id="copy-task-title">Решить задачу</h1>
          <p>Сначала разбор обычными словами, потом готовая запись для тетради.</p>
        </div>

        {/* Цена стоит до ввода, а не после: узнать про оплату уже после того,
            как условие набрано, читается как подвох. Пока задачи нет, честно
            писать «от» и сразу говорить, от чего зависит: одного числа без
            оговорки быть не должно (CLAUDE.md). Как только задача вписана,
            здесь и на кнопке её точная цена.

            Но у того, кто ещё не вошёл и не потратил бесплатное решение,
            платить нечем и незачем: разбор 8 сентября нашёл здесь «от 4 ₽»
            выше зелёного «первое решение бесплатно», то есть глаз ловил цену
            раньше, чем узнавал, что первая задача ничего не стоит. Такому
            человеку здесь стоит только обещание, а на кнопке - «бесплатно». */}
        {showsFreeOffer ? (
          <p className="copy-task-price is-free">
            <strong>Бесплатно</strong>
            <span>первая задача, без регистрации</span>
          </p>
        ) : (
          <p className="copy-task-price">
            <strong>{total > 0 ? formatRubles(total) : `от ${formatRubles(minimumSolutionPriceKopecks)}`}</strong>
            <span>{outgoing.length > 1 ? `за ${taskCountLabel(outgoing.length)}` : 'за решение'}</span>
            {total === 0 && <small>Цена зависит от длины условия, фото и предмета</small>}
          </p>
        )}
      </header>

      <form className="copy-task-form" aria-label="Задачи" onSubmit={submit}>
        {/* Пока идёт запрос, поля выключены: иначе клик обратно в условие до
            того, как сервер ответил и форма очистилась, дописывает новый
            ввод к ещё не сброшенному старому тексту - задача уходит на
            решение задвоенной. */}
        <fieldset className="task-entries-fieldset" disabled={isSubmitting}>
        <ol className="task-entries">
          {entries.map((entry, index) => {
            const number = index + 1
            const errorId = `task-entry-error-${entry.id}`
            const describedBy = entry.error ? errorId : undefined
            return (
              <li className={`task-entry${many ? ' is-card' : ''}${entry.error ? ' has-error' : ''}`} key={entry.id}>
                {many && (
                  <div className="task-entry-head">
                    <span className="task-entry-number">Задача {number}</span>
                    {!entryIsBlank(entry) && !showsFreeOffer && (
                      <span className="task-entry-price">{formatRubles(entryPrice(entry))}</span>
                    )}
                    <button
                      type="button"
                      className="task-entry-remove"
                      onClick={() => removeEntry(entry.id)}
                      aria-label={`Убрать задачу ${number}`}
                    >
                      <X size={18} weight="bold" aria-hidden="true" />
                    </button>
                  </div>
                )}

                {/* Со второй задачи над полем уже стоит «Задача 2», и видимая
                    подпись «Условие» под ней повторяла бы очевидное. Для
                    читалки подпись остаётся - с номером, чтобы поля не
                    назывались одинаково. */}
                <label className={`task-condition-label${many ? ' sr-only' : ''}`} htmlFor={`task-condition-${entry.id}`}>
                  {many ? `Условие задачи ${number}` : 'Условие задачи'}
                </label>
                <textarea
                  id={`task-condition-${entry.id}`}
                  className="task-condition-input"
                  ref={(field) => {
                    if (field) conditionRefs.current.set(entry.id, field)
                    else conditionRefs.current.delete(entry.id)
                  }}
                  value={entry.condition}
                  onChange={(event) => editEntry(entry.id, { condition: event.target.value.slice(0, maxConditionLength) })}
                  onPaste={(event) => pastePhoto(entry.id, event)}
                  placeholder={entry.imageDataUrl
                    ? 'Можно уточнить, что решать: «только пункт б»'
                    : photoEnabled ? 'Впиши условие или вставь сюда фото задачи' : 'Впиши условие задачи'}
                  rows={many ? 3 : 4}
                  aria-invalid={entry.errorField === 'condition' || undefined}
                  aria-describedby={describedBy}
                />

                {(entry.imageDataUrl || entry.photoPending) && (
                  <div className="task-photo-attached">
                    {entry.imageDataUrl && <img src={entry.imageDataUrl} alt="Приложенное фото задачи" />}
                    <div>
                      <strong>{entry.photoName}</strong>
                      <small>{entry.photoPending ? 'Готовим снимок…' : 'Условие прочитаем с фотографии'}</small>
                    </div>
                    <button type="button" onClick={() => void changePhoto(entry.id, null)} aria-label="Убрать фото">
                      <X size={17} weight="bold" aria-hidden="true" />
                    </button>
                  </div>
                )}

                <div className="task-controls">
                  {photoEnabled && (
                    <>
                      <input
                        id={`task-photo-${entry.id}`}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                        capture="environment"
                        onChange={(event) => void changePhoto(entry.id, event.target.files?.[0] ?? null)}
                      />
                      <label className="task-photo-button" htmlFor={`task-photo-${entry.id}`}>
                        <ImageSquare size={20} weight="regular" aria-hidden="true" />
                        {entry.imageDataUrl ? 'Заменить фото' : 'Добавить фото'}
                      </label>
                    </>
                  )}

                  {/* Подписи короткие: «Предмет — определим сами» не влезает в
                      селект на телефоне и обрезается ровно на том слове, ради
                      которого подпись и написана. */}
                  <label className={`task-select${entry.errorField === 'subject' ? ' is-missing' : ''}`}>
                    <span className="sr-only">Предмет</span>
                    <select
                      ref={(field) => {
                        if (field) subjectRefs.current.set(entry.id, field)
                        else subjectRefs.current.delete(entry.id)
                      }}
                      value={entry.subject}
                      aria-invalid={entry.errorField === 'subject' || undefined}
                      aria-describedby={describedBy}
                      onChange={(event) => editEntry(entry.id, { subject: event.target.value })}
                    >
                      <option value="">Выбери предмет</option>
                      {subjects.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
                    </select>
                  </label>

                  <label className="task-select">
                    <span className="sr-only">Класс</span>
                    <select
                      value={entry.grade}
                      onChange={(event) => {
                        gradeTouchedRef.current = true
                        patchEntry(entry.id, { grade: event.target.value })
                      }}
                    >
                      <option value="">Класс: любой</option>
                      {solvableGrades.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label>

                  {/* «Решить» - в этой же строке, сразу за фото, предметом и
                      классом. 14 сентября владелец поправил место дважды:
                      сперва кнопка «уехала далеко от поля», потом, растянутая
                      во всю ширину под строкой, «заняла полблока». Кнопка одна
                      на все задачи и стоит в строке последней карточки. */}
                  {index === entries.length - 1 && (
                    <button className="copy-task-submit" type="submit" disabled={isSubmitting}>
                      <span>{submitLabel}</span>
                      {!isSubmitting && <ArrowRight size={20} weight="bold" aria-hidden="true" />}
                    </button>
                  )}
                </div>

                {entry.error && <p className="task-entry-error" id={errorId} role="alert">{entry.error}</p>}
              </li>
            )
          })}
        </ol>
        </fieldset>

        {/* Под строкой с «Решить» - ошибка формы и тихая «Добавить задачу»
            по левому краю: правый нижний угол экрана занимает плавающая
            поддержка. Надпись начинается с глагола: «Ещё задача» не
            говорила, добавит она строку к уже набранной или сбросит её и
            начнёт заново. */}
        <div className="task-actions">
          {formError && <p className="task-form-error" role="alert">{formError}</p>}

          <button type="button" className="task-add" onClick={addEntry} disabled={isSubmitting}>
            <Plus size={18} weight="bold" aria-hidden="true" />
            Добавить задачу
          </button>

          {limitNote && (
            <p className="task-limit-note" role="status">
              <span>
                {limitNote === 'guest'
                  ? 'Несколько задач сразу решаются в аккаунте. Без него бесплатно решается одна.'
                  : `За один раз уходит не больше ${taskCountLabel(maxTaskEntries)}. Следующие добавишь, когда эти встанут в очередь.`}
              </span>
              {limitNote === 'guest' && onRequireAccount && (
                <button type="button" onClick={onRequireAccount}>Войти</button>
              )}
            </p>
          )}
        </div>
      </form>
    </section>
  )
}
