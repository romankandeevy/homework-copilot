import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  CalendarDots,
  Check,
  ImageSquare,
  MagicWand,
  Plus,
  SpinnerGap,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { defaultLessonTimes, makeScheduleEntryId, parseScheduleText } from './scheduleOcr'
import type { ScheduleEntry, WeekdayId } from './scheduleOcr'
import './SchedulePage.css'

type OcrPhase = 'idle' | 'reading' | 'review' | 'error'

const STORAGE_KEY = 'homework-copilot:schedule-v1'

const weekdays: ReadonlyArray<{ id: WeekdayId; label: string; short: string }> = [
  { id: 'monday', label: 'Понедельник', short: 'Пн' },
  { id: 'tuesday', label: 'Вторник', short: 'Вт' },
  { id: 'wednesday', label: 'Среда', short: 'Ср' },
  { id: 'thursday', label: 'Четверг', short: 'Чт' },
  { id: 'friday', label: 'Пятница', short: 'Пт' },
  { id: 'saturday', label: 'Суббота', short: 'Сб' },
]

const starterSchedule: ScheduleEntry[] = [
  { id: 'monday-1', day: 'monday', time: '08:30', subject: 'Алгебра', room: '312' },
  { id: 'monday-2', day: 'monday', time: '09:25', subject: 'Русский язык', room: '218' },
  { id: 'monday-3', day: 'monday', time: '10:20', subject: 'Физика', room: '406' },
  { id: 'monday-4', day: 'monday', time: '11:20', subject: 'История', room: '205' },
  { id: 'tuesday-1', day: 'tuesday', time: '08:30', subject: 'Геометрия', room: '312' },
  { id: 'tuesday-2', day: 'tuesday', time: '09:25', subject: 'Литература', room: '218' },
  { id: 'tuesday-3', day: 'tuesday', time: '10:20', subject: 'Английский язык', room: '314' },
  { id: 'wednesday-1', day: 'wednesday', time: '08:30', subject: 'Биология', room: '303' },
  { id: 'wednesday-2', day: 'wednesday', time: '09:25', subject: 'Алгебра', room: '312' },
  { id: 'wednesday-3', day: 'wednesday', time: '10:20', subject: 'Информатика', room: '401' },
  { id: 'thursday-1', day: 'thursday', time: '08:30', subject: 'Русский язык', room: '218' },
  { id: 'thursday-2', day: 'thursday', time: '09:25', subject: 'География', room: '307' },
  { id: 'thursday-3', day: 'thursday', time: '10:20', subject: 'Физкультура', room: 'Зал' },
  { id: 'friday-1', day: 'friday', time: '08:30', subject: 'Химия', room: '408' },
  { id: 'friday-2', day: 'friday', time: '09:25', subject: 'Геометрия', room: '312' },
  { id: 'friday-3', day: 'friday', time: '10:20', subject: 'Обществознание', room: '205' },
]

function weekdayLabel(day: WeekdayId) {
  return weekdays.find((item) => item.id === day)?.label ?? 'День'
}

function loadSchedule() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) return starterSchedule
    const parsed = JSON.parse(stored) as ScheduleEntry[]
    const valid = parsed.filter((entry) => weekdays.some(({ id }) => id === entry.day) && typeof entry.subject === 'string')
    return valid.length > 0 ? valid : starterSchedule
  } catch {
    return starterSchedule
  }
}

function ocrStatusLabel(status: string) {
  const labels: Record<string, string> = {
    'loading tesseract core': 'Запускаем распознавание',
    'initializing tesseract': 'Настраиваем OCR',
    'loading language traineddata': 'Загружаем русский язык',
    'initializing api': 'Готовим изображение',
    'recognizing text': 'Читаем строки расписания',
  }
  return labels[status] ?? 'Обрабатываем фото'
}

function lessonWord(count: number) {
  const lastTwo = count % 100
  const last = count % 10
  if (last === 1 && lastTwo !== 11) return 'урок'
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return 'урока'
  return 'уроков'
}

function SchedulePage() {
  const [entries, setEntries] = useState<ScheduleEntry[]>(loadSchedule)
  const [activeDay, setActiveDay] = useState<WeekdayId>('monday')
  const [ocrPhase, setOcrPhase] = useState<OcrPhase>('idle')
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrMessage, setOcrMessage] = useState('Готовим изображение')
  const [ocrError, setOcrError] = useState('')
  const [ocrRows, setOcrRows] = useState<ScheduleEntry[]>([])
  const [ocrRawText, setOcrRawText] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const ocrRunRef = useRef(0)

  const dayEntries = useMemo(
    () => entries.filter((entry) => entry.day === activeDay).sort((a, b) => a.time.localeCompare(b.time)),
    [activeDay, entries],
  )

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  }, [entries])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  useEffect(() => {
    if (ocrPhase === 'idle') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeOcr()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const updateEntry = (id: string, field: 'time' | 'subject' | 'room', value: string) => {
    setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, [field]: value } : entry))
  }

  const addEntry = (day = activeDay) => {
    const dayCount = entries.filter((entry) => entry.day === day).length
    setEntries((current) => [...current, {
      id: makeScheduleEntryId(),
      day,
      time: defaultLessonTimes[dayCount] ?? '',
      subject: '',
      room: '',
    }])
    setActiveDay(day)
  }

  const removeEntry = (id: string) => setEntries((current) => current.filter((entry) => entry.id !== id))

  const closeOcr = () => {
    ocrRunRef.current += 1
    setOcrPhase('idle')
    setOcrRows([])
    setOcrRawText('')
    setOcrError('')
    setOcrProgress(0)
    setPreviewUrl('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const recognizeSchedule = async (file: File) => {
    const runId = ocrRunRef.current + 1
    ocrRunRef.current = runId
    setPreviewUrl(URL.createObjectURL(file))
    setOcrPhase('reading')
    setOcrProgress(0.03)
    setOcrMessage('Открываем фото')
    setOcrError('')

    try {
      const { createWorker, PSM } = await import('tesseract.js')
      const worker = await createWorker(['rus', 'eng'], undefined, {
        logger: ({ progress, status }) => {
          if (ocrRunRef.current !== runId) return
          setOcrProgress(Math.max(0.03, progress || 0))
          setOcrMessage(ocrStatusLabel(status))
        },
      })

      try {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        })
        const { data } = await worker.recognize(file)
        if (ocrRunRef.current !== runId) return
        const parsed = parseScheduleText(data.text)
        setOcrRawText(data.text.trim())

        if (parsed.length === 0) {
          setOcrError('Не удалось найти строки с уроками. Попробуй более ровное и светлое фото.')
          setOcrPhase('error')
          return
        }

        setOcrRows(parsed)
        setOcrProgress(1)
        setOcrPhase('review')
      } finally {
        await worker.terminate()
      }
    } catch (error) {
      if (ocrRunRef.current !== runId) return
      setOcrError(error instanceof Error ? error.message : 'OCR не запустился. Попробуй ещё раз.')
      setOcrPhase('error')
    }
  }

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void recognizeSchedule(file)
  }

  const updateOcrRow = (id: string, field: 'day' | 'time' | 'subject' | 'room', value: string) => {
    setOcrRows((current) => current.map((entry) => entry.id === id ? { ...entry, [field]: value } as ScheduleEntry : entry))
  }

  const applyOcrRows = () => {
    const scannedDays = new Set(ocrRows.map(({ day }) => day))
    setEntries((current) => [
      ...current.filter((entry) => !scannedDays.has(entry.day)),
      ...ocrRows.filter((entry) => entry.subject.trim()).map((entry) => ({ ...entry, subject: entry.subject.trim(), room: entry.room.trim() })),
    ])
    setActiveDay(ocrRows[0]?.day ?? 'monday')
    closeOcr()
  }

  return (
    <div className="schedule-page">
      <section className="schedule-hero" aria-labelledby="schedule-title">
        <div className="schedule-title-group">
          <span className="schedule-kicker"><CalendarDots size={16} weight="fill" aria-hidden="true" /> Учебная неделя</span>
          <h2 id="schedule-title">Расписание</h2>
          <p>Предмет, время и кабинет. Заполни вручную или загрузи фото, чтобы OCR собрал всё сам.</p>
        </div>
        <div className="schedule-actions">
          <label className="schedule-scan-button">
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment" aria-label="Загрузить фото расписания" onChange={onFileChange} />
            <ImageSquare size={21} weight="duotone" aria-hidden="true" />
            Распознать фото
          </label>
          <button className="schedule-add-button" type="button" onClick={() => addEntry()}>
            <Plus size={20} weight="bold" aria-hidden="true" />
            Добавить урок
          </button>
        </div>
      </section>

      <section className="schedule-board" aria-labelledby="schedule-editor-title">
        <header className="schedule-board-header">
          <div>
            <span>Моё расписание</span>
            <h3 id="schedule-editor-title">{weekdayLabel(activeDay)}</h3>
          </div>
          <p><Check size={16} weight="bold" aria-hidden="true" /> Сохраняется на этом устройстве</p>
        </header>

        <div className="schedule-day-tabs" role="tablist" aria-label="Дни недели">
          {weekdays.map((day) => {
            const count = entries.filter((entry) => entry.day === day.id).length
            const active = day.id === activeDay
            return (
              <button
                className={active ? 'is-active' : ''}
                type="button"
                role="tab"
                aria-selected={active}
                key={day.id}
                onClick={() => setActiveDay(day.id)}
              >
                <span>{day.short}</span>
                <strong>{day.label}</strong>
                <small>{count}</small>
              </button>
            )
          })}
        </div>

        <div className="schedule-table" role="table" aria-label={`Расписание на ${weekdayLabel(activeDay).toLocaleLowerCase('ru-RU')}`}>
          <div className="schedule-table-head" role="row">
            <span role="columnheader">№</span>
            <span role="columnheader">Время</span>
            <span role="columnheader">Предмет</span>
            <span role="columnheader">Кабинет</span>
            <span className="sr-only" role="columnheader">Действия</span>
          </div>

          {dayEntries.length > 0 ? dayEntries.map((entry, index) => (
            <div className="schedule-table-row" role="row" key={entry.id}>
              <span className="schedule-lesson-number" role="cell">{String(index + 1).padStart(2, '0')}</span>
              <label className="schedule-time-cell" role="cell">
                <span className="sr-only">Время, урок {index + 1}</span>
                <input type="time" value={entry.time} aria-label={`Время, урок ${index + 1}`} onChange={(event) => updateEntry(entry.id, 'time', event.target.value)} />
              </label>
              <label className="schedule-subject-cell" role="cell">
                <span className="sr-only">Предмет, урок {index + 1}</span>
                <input value={entry.subject} maxLength={50} placeholder="Название предмета" aria-label={`Предмет, урок ${index + 1}`} onChange={(event) => updateEntry(entry.id, 'subject', event.target.value)} />
              </label>
              <label className="schedule-room-cell" role="cell">
                <span className="sr-only">Кабинет, урок {index + 1}</span>
                <input value={entry.room} maxLength={16} placeholder="—" aria-label={`Кабинет, урок ${index + 1}`} onChange={(event) => updateEntry(entry.id, 'room', event.target.value)} />
              </label>
              <button className="schedule-remove-button" type="button" aria-label={`Удалить урок ${index + 1}`} onClick={() => removeEntry(entry.id)}>
                <Trash size={18} weight="duotone" aria-hidden="true" />
              </button>
            </div>
          )) : (
            <div className="schedule-empty">
              <CalendarDots size={32} weight="duotone" aria-hidden="true" />
              <strong>В этот день уроков пока нет</strong>
              <button type="button" onClick={() => addEntry()}><Plus size={18} weight="bold" aria-hidden="true" /> Добавить первый</button>
            </div>
          )}
        </div>

        {dayEntries.length > 0 && (
          <button className="schedule-add-row" type="button" onClick={() => addEntry()}>
            <Plus size={18} weight="bold" aria-hidden="true" /> Добавить урок в {weekdayLabel(activeDay).toLocaleLowerCase('ru-RU')}
          </button>
        )}
      </section>

      <aside className="schedule-ocr-note" aria-label="Как работает распознавание">
        <MagicWand size={28} weight="duotone" aria-hidden="true" />
        <div>
          <strong>Фото превращается в таблицу</strong>
          <p>OCR работает в браузере. Проверь найденные строки, затем меняй любое поле прямо в расписании.</p>
        </div>
        <span>Фото → OCR → правка</span>
      </aside>

      {ocrPhase !== 'idle' && (
        <div className="schedule-ocr-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) closeOcr()
        }}>
          <section className="schedule-ocr-dialog" role="dialog" aria-modal="true" aria-labelledby="schedule-ocr-title">
            <header>
              <div>
                <span>Распознавание расписания</span>
                <h2 id="schedule-ocr-title">{ocrPhase === 'review' ? 'Проверь строки' : 'Читаем фото'}</h2>
              </div>
              <button type="button" aria-label="Закрыть распознавание" onClick={closeOcr}><X size={20} weight="bold" aria-hidden="true" /></button>
            </header>

            {ocrPhase === 'reading' && (
              <div className="schedule-ocr-reading">
                {previewUrl && <img src={previewUrl} alt="Загруженное расписание" />}
                <div className="schedule-ocr-progress-copy" aria-live="polite">
                  <SpinnerGap size={28} weight="bold" aria-hidden="true" />
                  <strong>{ocrMessage}</strong>
                  <span>{Math.round(ocrProgress * 100)}%</span>
                </div>
                <div className="schedule-ocr-progress" aria-hidden="true"><span style={{ width: `${Math.round(ocrProgress * 100)}%` }} /></div>
                <p>Первый запуск может занять чуть дольше: загружается русская OCR-модель.</p>
              </div>
            )}

            {ocrPhase === 'error' && (
              <div className="schedule-ocr-error" role="alert">
                <WarningCircle size={34} weight="duotone" aria-hidden="true" />
                <strong>Не получилось распознать</strong>
                <p>{ocrError}</p>
                <button type="button" onClick={() => fileInputRef.current?.click()}>Выбрать другое фото</button>
              </div>
            )}

            {ocrPhase === 'review' && (
              <div className="schedule-ocr-review">
                <p className="schedule-ocr-review-intro">Нашли {ocrRows.length} {lessonWord(ocrRows.length)}. Исправь ошибки перед добавлением.</p>
                <div className="schedule-ocr-rows">
                  {ocrRows.map((entry, index) => (
                    <div className="schedule-ocr-row" key={entry.id}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <label>
                        <span className="sr-only">День, строка {index + 1}</span>
                        <select value={entry.day} aria-label={`День, строка ${index + 1}`} onChange={(event) => updateOcrRow(entry.id, 'day', event.target.value)}>
                          {weekdays.map((day) => <option value={day.id} key={day.id}>{day.short}</option>)}
                        </select>
                      </label>
                      <label>
                        <span className="sr-only">Время, строка {index + 1}</span>
                        <input type="time" value={entry.time} aria-label={`Время, строка ${index + 1}`} onChange={(event) => updateOcrRow(entry.id, 'time', event.target.value)} />
                      </label>
                      <label>
                        <span className="sr-only">Предмет, строка {index + 1}</span>
                        <input value={entry.subject} placeholder="Предмет" aria-label={`Предмет, строка ${index + 1}`} onChange={(event) => updateOcrRow(entry.id, 'subject', event.target.value)} />
                      </label>
                      <label>
                        <span className="sr-only">Кабинет, строка {index + 1}</span>
                        <input value={entry.room} placeholder="Каб." aria-label={`Кабинет, строка ${index + 1}`} onChange={(event) => updateOcrRow(entry.id, 'room', event.target.value)} />
                      </label>
                      <button type="button" aria-label={`Удалить распознанную строку ${index + 1}`} onClick={() => setOcrRows((current) => current.filter((row) => row.id !== entry.id))}>
                        <Trash size={17} weight="duotone" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>

                <button className="schedule-ocr-add-row" type="button" onClick={() => setOcrRows((current) => [...current, { id: makeScheduleEntryId(), day: current.at(-1)?.day ?? 'monday', time: defaultLessonTimes[current.length] ?? '', subject: '', room: '' }])}>
                  <Plus size={17} weight="bold" aria-hidden="true" /> Добавить строку
                </button>

                {ocrRawText && (
                  <details>
                    <summary>Текст, который увидел OCR</summary>
                    <pre>{ocrRawText}</pre>
                  </details>
                )}

                <footer>
                  <button type="button" onClick={closeOcr}>Отмена</button>
                  <button type="button" disabled={ocrRows.every((entry) => !entry.subject.trim())} onClick={applyOcrRows}>
                    <Check size={18} weight="bold" aria-hidden="true" /> Добавить в расписание
                  </button>
                </footer>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

export default SchedulePage
