import { useEffect, useRef, useState } from 'react'
import type { ClipboardEvent, FormEvent } from 'react'
import { ArrowRight, ImageSquare, Plus, X } from '@phosphor-icons/react'
import { maxConditionLength } from './lib/homeworkContract'
import type { HomeworkSource } from './lib/homeworkContract'
import { formatRubles } from './lib/currency'
import { prepareTaskPhoto } from './lib/homeworkSolution'
import { estimateSolutionPrice, minimumSolutionPriceKopecks } from './lib/solutionPricing'
import { solvableGrades, solvableSubjects } from './lib/subjects'

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

type TaskEntry = {
  id: string
  condition: string
  imageDataUrl: string
  photoName: string
  photoPending: boolean
  subject: string
  grade: string
}

function newEntryId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `task-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function emptyEntry(grade: string): TaskEntry {
  return {
    id: newEntryId(),
    condition: '',
    imageDataUrl: '',
    photoName: '',
    photoPending: false,
    subject: '',
    grade,
  }
}

function entryIsFilled(entry: TaskEntry) {
  return entry.condition.trim().length >= 15 || Boolean(entry.imageDataUrl)
}

function entryPrice(entry: TaskEntry) {
  return estimateSolutionPrice({
    conditionLength: entry.condition.trim().length,
    imageBytes: entry.imageDataUrl.length,
    subject: entry.subject,
  })
}

/* Сколько задач - столько и решений: «2 задачи», «5 задач». */
function taskCountLabel(count: number) {
  const tail = count % 100 >= 11 && count % 100 <= 14
    ? 'задач'
    : ['задач', 'задача', 'задачи', 'задачи', 'задачи'][Math.min(count % 10, 4)] ?? 'задач'
  return `${count} ${tail}`
}

export default function CopyTask({
  onSubmit,
  signedIn = false,
  freeSolutionUsed = false,
  defaultGrade = '',
}: {
  onSubmit: (submissions: TaskSubmission[]) => Promise<boolean>
  /** Гостю показываем, что первое решение он получит без регистрации. */
  signedIn?: boolean
  freeSolutionUsed?: boolean
  /** Класс из профиля: один и тот же вопрос не должен иметь двух ответов. */
  defaultGrade?: string
}) {
  const [entries, setEntries] = useState<TaskEntry[]>(() => [emptyEntry(defaultGrade)])
  const [error, setError] = useState('')
  const [invalidEntryId, setInvalidEntryId] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submissionRef = useRef(false)
  const conditionRefs = useRef(new Map<string, HTMLTextAreaElement>())
  const subjectRefs = useRef(new Map<string, HTMLSelectElement>())

  const filled = entries.filter(entryIsFilled)
  const total = filled.reduce((sum, entry) => sum + entryPrice(entry), 0)
  const photoPending = entries.some((entry) => entry.photoPending)

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

  /* Снимок готовится сразу при выборе, а не при отправке.

     Так цена считается по тем самым байтам, которые уйдут на сервер, и
     ожидание сжатия не превращается в паузу между нажатием «Решить» и
     первым признаком жизни. */
  const changePhoto = async (id: string, file: File | null) => {
    if (!file) {
      patchEntry(id, { imageDataUrl: '', photoName: '', photoPending: false })
      return
    }
    if (!/^image\/(?:jpeg|png|webp|heic|heif)$/i.test(file.type)) {
      setError('Фото должно быть в формате JPEG, PNG или WebP')
      return
    }
    patchEntry(id, { photoPending: true, photoName: file.name || 'Фото задачи' })
    setError('')
    try {
      const imageDataUrl = await prepareTaskPhoto(file)
      patchEntry(id, { imageDataUrl, photoPending: false })
    } catch (photoError) {
      patchEntry(id, { imageDataUrl: '', photoName: '', photoPending: false })
      setError(photoError instanceof Error ? photoError.message : 'Не получилось приложить фотографию')
    }
  }

  // Фото можно не только выбрать файлом, но и вставить из буфера: школьник
  // чаще делает снимок экрана, чем сохраняет файл и ищет его в проводнике.
  const pastePhoto = (id: string, event: ClipboardEvent<HTMLTextAreaElement>) => {
    const item = [...event.clipboardData.items].find((entry) => entry.type.startsWith('image/'))
    const file = item?.getAsFile()
    if (!file) return
    event.preventDefault()
    void changePhoto(id, file)
  }

  const addEntry = () => {
    const previous = entries[entries.length - 1]
    const entry = emptyEntry(previous?.grade ?? defaultGrade)
    setEntries((current) => [...current, entry])
    setError('')
    // Фокус уходит в новую карточку: иначе после нажатия ничего не
    // происходит на том месте, куда смотрит ученик.
    window.requestAnimationFrame(() => conditionRefs.current.get(entry.id)?.focus())
  }

  const removeEntry = (id: string) => {
    setEntries((current) => (current.length > 1 ? current.filter((entry) => entry.id !== id) : current))
    setError('')
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submissionRef.current || isSubmitting) return

    // Кнопка не гаснет на пустой форме: по погасшей кнопке всё равно жмут,
    // ничего не происходит и почему — не сказано. Вместо этого возвращаем
    // курсор в поле и говорим, чего не хватает.
    if (filled.length === 0) {
      const first = entries[0]
      setInvalidEntryId(first.id)
      setError(first.condition.trim()
        ? 'Условие слишком короткое — впиши его целиком или приложи фото'
        : 'Впиши условие или приложи фото')
      conditionRefs.current.get(first.id)?.focus()
      return
    }

    if (photoPending) {
      setError('Фотография ещё готовится — секунду')
      return
    }

    // Предмет задаёт правила проверки решения, поэтому без него не отправляем.
    const withoutSubject = filled.find((entry) => !entry.subject)
    if (withoutSubject) {
      setInvalidEntryId(withoutSubject.id)
      setError(filled.length > 1
        ? 'У каждой задачи свой предмет: по нему проверяется решение'
        : 'Выбери предмет: по нему проверяется решение')
      subjectRefs.current.get(withoutSubject.id)?.focus()
      return
    }

    submissionRef.current = true
    setIsSubmitting(true)
    setError('')
    setInvalidEntryId('')

    try {
      const submitted = await onSubmit(filled.map((entry) => {
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
      setError(submissionError instanceof Error ? submissionError.message : 'Не получилось отправить задачу')
    } finally {
      submissionRef.current = false
      setIsSubmitting(false)
    }
  }

  const many = entries.length > 1
  /* Гость, у которого бесплатное решение ещё не потрачено: ему цену в шапке
     не показываем. Право на бесплатный разбор считает база
     (`public.claim_guest_solution`), здесь только то, что видно клиенту. */
  const showsFreeOffer = !signedIn && !freeSolutionUsed

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
            как условие набрано, читается как подвох. Точная сумма зависит от
            задачи, поэтому до ввода честно писать «от», а не среднее.

            Но у того, кто ещё не вошёл и не потратил бесплатное решение,
            платить нечем и незачем: разбор 8 сентября нашёл здесь «от 4 ₽»
            выше зелёного «первое решение бесплатно», то есть глаз ловил цену
            раньше, чем узнавал, что первая задача ничего не стоит. Такому
            человеку в шапке стоит только обещание, а цена ждёт под формой -
            там же, где строка про то, от чего она зависит. */}
        {showsFreeOffer ? (
          <p className="copy-task-price is-free">
            <strong>Бесплатно</strong>
            <span>первая задача, без регистрации</span>
          </p>
        ) : (
          <p className="copy-task-price">
            <strong>{total > 0 ? formatRubles(total) : `от ${formatRubles(minimumSolutionPriceKopecks)}`}</strong>
            <span>{total > 0 ? (many ? `за ${taskCountLabel(filled.length)}` : 'за решение') : 'за решение'}</span>
            {!signedIn && (
              <em>Зарегистрируйся: на счёт придут 20 ₽ — это ещё пять решений</em>
            )}
          </p>
        )}
      </header>

      <form className="copy-task-form" aria-label="Задачи" onSubmit={submit}>
        <ol className="task-entries">
          {entries.map((entry, index) => (
            <li className="task-entry" key={entry.id}>
              {many && (
                <div className="task-entry-head">
                  <span className="task-entry-number">Задача {index + 1}</span>
                  {entryIsFilled(entry) && (
                    <span className="task-entry-price">{formatRubles(entryPrice(entry))}</span>
                  )}
                  <button
                    type="button"
                    className="task-entry-remove"
                    onClick={() => removeEntry(entry.id)}
                    aria-label={`Убрать задачу ${index + 1}`}
                  >
                    <X size={16} weight="bold" aria-hidden="true" />
                  </button>
                </div>
              )}

              <label className="task-condition-label" htmlFor={`task-condition-${entry.id}`}>
                {many ? 'Условие' : 'Условие задачи'}
              </label>
              <textarea
                id={`task-condition-${entry.id}`}
                className="task-condition-input"
                ref={(field) => {
                  if (field) conditionRefs.current.set(entry.id, field)
                  else conditionRefs.current.delete(entry.id)
                }}
                value={entry.condition}
                onChange={(event) => {
                  patchEntry(entry.id, { condition: event.target.value.slice(0, maxConditionLength) })
                  if (error) setError('')
                }}
                onPaste={(event) => pastePhoto(entry.id, event)}
                placeholder={entry.imageDataUrl
                  ? 'Можно уточнить, что решать: «только пункт б»'
                  : 'Впиши условие или вставь сюда фото задачи'}
                rows={many ? 3 : 4}
                aria-invalid={(invalidEntryId === entry.id && Boolean(error)) || undefined}
                aria-errormessage={error ? 'task-entry-error' : undefined}
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
                <input
                  id={`task-photo-${entry.id}`}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  capture="environment"
                  onChange={(event) => void changePhoto(entry.id, event.target.files?.[0] ?? null)}
                />
                <label className="task-photo-button" htmlFor={`task-photo-${entry.id}`}>
                  <ImageSquare size={20} weight="duotone" aria-hidden="true" />
                  {entry.imageDataUrl ? 'Заменить фото' : 'Добавить фото'}
                </label>

                {/* Подписи короткие: «Предмет — определим сами» не влезает в
                    селект на телефоне и обрезается ровно на том слове, ради
                    которого подпись и написана. */}
                <label className={`task-select${!entry.subject && invalidEntryId === entry.id && error ? ' is-missing' : ''}`}>
                  <span className="sr-only">Предмет</span>
                  <select
                    ref={(field) => {
                      if (field) subjectRefs.current.set(entry.id, field)
                      else subjectRefs.current.delete(entry.id)
                    }}
                    value={entry.subject}
                    aria-invalid={(!entry.subject && invalidEntryId === entry.id && Boolean(error)) || undefined}
                    onChange={(event) => { patchEntry(entry.id, { subject: event.target.value }); if (error) setError('') }}
                  >
                    <option value="">Выбери предмет</option>
                    {solvableSubjects.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
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
              </div>
            </li>
          ))}
        </ol>

        <div className="task-actions">
          {/* Домашнее задание редко состоит из одной задачи, и уж точно не
              из одного предмета: у каждой строки свой предмет и своя цена.

              Надпись начинается с глагола: «Ещё задача» не говорила, добавит
              она строку к уже набранной или сбросит её и начнёт заново. */}
          <button type="button" className="task-add" onClick={addEntry}>
            <Plus size={18} weight="bold" aria-hidden="true" />
            Добавить задачу
          </button>

          <button className="copy-task-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? 'Решаем…'
              : many && filled.length > 1
                ? `Решить ${taskCountLabel(filled.length)}`
                : 'Решить'}
            {!isSubmitting && <ArrowRight size={20} weight="bold" aria-hidden="true" />}
          </button>
        </div>

        {error
          ? <p className="task-number-error" id="task-entry-error" role="alert">{error}</p>
          : (
            <p className="task-entry-helper">
              {filled.length > 1
                ? `Спишется ${formatRubles(total)} за ${taskCountLabel(filled.length)}. Не решится — деньги вернутся на баланс.`
                : showsFreeOffer
                  ? `Первая задача бесплатна. Дальше от ${formatRubles(minimumSolutionPriceKopecks)}: цена зависит от задачи — длинное условие и фотография дороже.`
                  : 'Цена зависит от задачи: длинное условие и фотография дороже. Не решится — деньги вернутся на баланс.'}
            </p>
          )}
      </form>
    </section>
  )
}
