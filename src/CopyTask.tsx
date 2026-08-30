import { useEffect, useRef, useState } from 'react'
import type { ClipboardEvent, FormEvent } from 'react'
import { ArrowRight, ImageSquare, X } from '@phosphor-icons/react'
import type { HomeworkSource } from './lib/homeworkContract'
import { formatRubles } from './lib/currency'
import { getSolutionPrice } from './lib/solutionPricing'

// Форма постановки задачи.
//
// Раньше здесь был выбор учебника и поиск условия по номеру. От индекса
// учебников отказались, поэтому осталось главное: условие даёт ученик —
// текстом, фотографией или тем и другим сразу.
//
// Предмет и класс необязательны. Если их не указать, модель определит сама.
// Класс влияет не только на сложность: способ решения одной и той же задачи
// в 7 и в 11 классе разный, и запись в тетради тоже.

export const solvableSubjects = [
  'Математика', 'Алгебра', 'Геометрия', 'Физика', 'Химия', 'Биология',
  'Информатика', 'Русский язык', 'Литература', 'Английский язык',
  'История', 'Обществознание', 'География', 'Астрономия',
] as const

export const solvableGrades = [
  '5 класс', '6 класс', '7 класс', '8 класс', '9 класс', '10 класс', '11 класс',
] as const

export type TaskSubmission = {
  condition: string
  photo?: File
  subject?: string
  grade?: string
  source: HomeworkSource
  idempotencyKey: string
}

export default function CopyTask({
  onSubmit,
}: {
  onSubmit: (submission: TaskSubmission) => Promise<boolean>
}) {
  const [condition, setCondition] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState('')
  const [subject, setSubject] = useState('')
  const [grade, setGrade] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submissionRef = useRef(false)

  const trimmedCondition = condition.trim()
  const canSubmit = trimmedCondition.length >= 15 || Boolean(photo)
  const maxPrice = getSolutionPrice('any', '1', 'text')

  useEffect(() => {
    if (!photo) {
      setPhotoPreview('')
      return
    }
    const url = URL.createObjectURL(photo)
    setPhotoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  const changePhoto = (file: File | null) => {
    if (!file) {
      setPhoto(null)
      return
    }
    if (!/^image\/(?:jpeg|png|webp|heic|heif)$/i.test(file.type)) {
      setError('Фото должно быть в формате JPEG, PNG или WebP')
      return
    }
    setPhoto(file)
    setError('')
  }

  // Фото можно не только выбрать файлом, но и вставить из буфера: школьник
  // чаще делает снимок экрана, чем сохраняет файл и ищет его в проводнике.
  const pastePhoto = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const item = [...event.clipboardData.items].find((entry) => entry.type.startsWith('image/'))
    const file = item?.getAsFile()
    if (!file) return
    event.preventDefault()
    changePhoto(file)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submissionRef.current || !canSubmit) return
    submissionRef.current = true
    setIsSubmitting(true)
    setError('')

    try {
      const idempotencyKey = typeof crypto.randomUUID === 'function'
        ? `solution-${crypto.randomUUID()}`
        : `solution-${Date.now()}-${Math.random().toString(16).slice(2)}`

      const submitted = await onSubmit({
        condition: trimmedCondition,
        ...(photo ? { photo } : {}),
        ...(subject ? { subject } : {}),
        ...(grade ? { grade } : {}),
        // Если текста нет вовсе, задача читается с фотографии.
        source: trimmedCondition ? 'text' : 'photo',
        idempotencyKey,
      })

      if (submitted) {
        setCondition('')
        setPhoto(null)
      }
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Не получилось отправить задачу')
    } finally {
      submissionRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <section className="copy-task" aria-labelledby="copy-task-title">
      <header className="copy-task-header">
        <h1 id="copy-task-title">Списать задачу</h1>
        <p>Впиши условие или приложи фото. Решение придёт готовым к переписыванию в тетрадь.</p>
      </header>

      <form className="copy-task-form" aria-label="Задача" onSubmit={submit}>
        <label className="task-condition-label" htmlFor="task-condition">Условие задачи</label>
        <textarea
          id="task-condition"
          className="task-condition-input"
          value={condition}
          onChange={(event) => {
            setCondition(event.target.value.slice(0, 5000))
            if (error) setError('')
          }}
          onPaste={pastePhoto}
          placeholder="Впиши условие или вставь сюда фото задачи"
          rows={4}
          aria-invalid={Boolean(error) || undefined}
          aria-errormessage={error ? 'task-entry-error' : undefined}
        />

        {photo && (
          <div className="task-photo-attached">
            {photoPreview && <img src={photoPreview} alt="Приложенное фото задачи" />}
            <div>
              <strong>{photo.name || 'Фото задачи'}</strong>
              <small>Условие прочитаем с фотографии</small>
            </div>
            <button type="button" onClick={() => changePhoto(null)} aria-label="Убрать фото">
              <X size={17} weight="bold" aria-hidden="true" />
            </button>
          </div>
        )}

        <div className="task-controls">
          <input
            id="task-photo"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            capture="environment"
            onChange={(event) => changePhoto(event.target.files?.[0] ?? null)}
          />
          <label className="task-photo-button" htmlFor="task-photo">
            <ImageSquare size={20} weight="duotone" aria-hidden="true" />
            {photo ? 'Заменить фото' : 'Добавить фото'}
          </label>

          <label className="task-select">
            <span className="sr-only">Предмет</span>
            <select value={subject} onChange={(event) => setSubject(event.target.value)}>
              <option value="">Предмет — определим сами</option>
              {solvableSubjects.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>

          <label className="task-select">
            <span className="sr-only">Класс</span>
            <select value={grade} onChange={(event) => setGrade(event.target.value)}>
              <option value="">Класс — определим сами</option>
              {solvableGrades.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>

          <button className="copy-task-submit" type="submit" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? 'Решаем…' : 'Решить'}
            {!isSubmitting && <ArrowRight size={20} weight="bold" aria-hidden="true" />}
          </button>
        </div>

        {error && <p className="task-number-error" id="task-entry-error" role="alert">{error}</p>}
        {!error && !canSubmit && (
          <p className="task-entry-helper">Впиши условие целиком или приложи фотографию задачи.</p>
        )}
        {!error && canSubmit && (
          <p className="task-entry-helper">Спишем по факту, но не больше {formatRubles(maxPrice)} за решение.</p>
        )}
      </form>
    </section>
  )
}
