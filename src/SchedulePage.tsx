import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  Check,
  ImageSquare,
  MagicWand,
  Plus,
  SpinnerGap,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { defaultLessonTimes, makeScheduleEntryId, parseScheduleTableTsv, parseScheduleText } from './scheduleOcr'
import type { ScheduleEntry, WeekdayId } from './scheduleOcr'
import './SchedulePage.css'

type OcrPhase = 'idle' | 'reading' | 'review' | 'error'

const STORAGE_KEY = 'homework-copilot:schedule-v1'
const TIME_STORAGE_KEY = 'homework-copilot:schedule-times-v1'
const MAX_TIME_SLOTS = 12

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

function sortTimes(times: string[]) {
  return Array.from(new Set(times.filter((time) => /^\d{2}:\d{2}$/.test(time)))).sort((left, right) => left.localeCompare(right))
}

function loadTimeSlots(entries: ScheduleEntry[]) {
  try {
    const stored = window.localStorage.getItem(TIME_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as string[]
      const slots = sortTimes([...parsed, ...entries.map(({ time }) => time)])
      if (slots.length > 0) return slots.slice(0, MAX_TIME_SLOTS)
    }
  } catch {
    // Fall back to the timetable defaults below.
  }

  return sortTimes([...defaultLessonTimes, ...entries.map(({ time }) => time)]).slice(0, MAX_TIME_SLOTS)
}

function nextLessonTime(times: string[]) {
  const lastTime = times.at(-1) ?? '07:35'
  const [hours, minutes] = lastTime.split(':').map(Number)
  const next = Math.min(hours * 60 + minutes + 55, 23 * 60 + 59)
  return `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`
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

async function prepareOcrImage(file: File) {
  if (typeof createImageBitmap !== 'function') return file

  const bitmap = await createImageBitmap(file)
  const preferredScale = bitmap.width < 1800 ? 2.2 : 1
  const scale = Math.min(preferredScale, 3200 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')

  if (!context) {
    bitmap.close()
    return file
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.filter = 'grayscale(1) contrast(1.3)'
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas
}

function SchedulePage() {
  const [entries, setEntries] = useState<ScheduleEntry[]>(loadSchedule)
  const [timeSlots, setTimeSlots] = useState<string[]>(() => loadTimeSlots(loadSchedule()))
  const [ocrPhase, setOcrPhase] = useState<OcrPhase>('idle')
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrMessage, setOcrMessage] = useState('Готовим изображение')
  const [ocrError, setOcrError] = useState('')
  const [ocrRows, setOcrRows] = useState<ScheduleEntry[]>([])
  const [ocrRawText, setOcrRawText] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const ocrRunRef = useRef(0)

  const entriesByCell = useMemo(() => new Map(entries.map((entry) => [`${entry.day}:${entry.time}`, entry])), [entries])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  }, [entries])

  useEffect(() => {
    window.localStorage.setItem(TIME_STORAGE_KEY, JSON.stringify(timeSlots))
  }, [timeSlots])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  useEffect(() => {
    if (ocrPhase === 'idle') return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [ocrPhase])

  useEffect(() => {
    if (ocrPhase === 'idle') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeOcr()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const updateCell = (day: WeekdayId, time: string, field: 'subject' | 'room', value: string) => {
    setEntries((current) => {
      const existing = current.find((entry) => entry.day === day && entry.time === time)
      if (existing) return current.map((entry) => entry.id === existing.id ? { ...entry, [field]: value } : entry)
      return [...current, {
        id: makeScheduleEntryId(),
        day,
        time,
        subject: field === 'subject' ? value : '',
        room: field === 'room' ? value : '',
      }]
    })
  }

  const updateTimeSlot = (index: number, value: string) => {
    const previous = timeSlots[index]
    if (!value || (value !== previous && timeSlots.includes(value))) return
    setTimeSlots((current) => current.map((time, timeIndex) => timeIndex === index ? value : time).sort((left, right) => left.localeCompare(right)))
    setEntries((current) => current.map((entry) => entry.time === previous ? { ...entry, time: value } : entry))
  }

  const addTimeSlot = () => {
    if (timeSlots.length >= MAX_TIME_SLOTS) return
    const nextTime = nextLessonTime(timeSlots)
    if (!timeSlots.includes(nextTime)) setTimeSlots((current) => [...current, nextTime])
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
      const image = await prepareOcrImage(file)
      let pass: 'loading' | 'table' | 'details' = 'loading'
      const worker = await createWorker(['rus', 'eng'], undefined, {
        logger: ({ progress, status }) => {
          if (ocrRunRef.current !== runId) return
          if (status === 'recognizing text' && pass === 'table') {
            setOcrProgress(0.15 + (progress || 0) * 0.5)
            setOcrMessage('Разбираем строки и колонки')
          } else if (status === 'recognizing text' && pass === 'details') {
            setOcrProgress(0.68 + (progress || 0) * 0.28)
            setOcrMessage('Проверяем предметы и кабинеты')
          } else {
            setOcrProgress(Math.max(0.03, (progress || 0) * 0.12))
            setOcrMessage(ocrStatusLabel(status))
          }
        },
      })

      try {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.AUTO,
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        })
        pass = 'table'
        const { data } = await worker.recognize(image, {}, { text: true, tsv: true })
        if (ocrRunRef.current !== runId) return
        const primaryTsv = data.tsv ?? ''
        let parsed = parseScheduleTableTsv(primaryTsv)

        if (parsed.length > 0) {
          pass = 'details'
          setOcrProgress(0.68)
          setOcrMessage('Проверяем предметы и кабинеты')
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
          const { data: detailData } = await worker.recognize(image, {}, { text: true, tsv: true })
          if (ocrRunRef.current !== runId) return
          parsed = parseScheduleTableTsv(primaryTsv, detailData.tsv ?? '')
        } else {
          parsed = parseScheduleText(data.text)
        }

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
    const scannedTimes = sortTimes(ocrRows.map(({ time }) => time))
    setEntries((current) => [
      ...current.filter((entry) => !scannedDays.has(entry.day)),
      ...ocrRows.filter((entry) => entry.subject.trim()).map((entry) => ({ ...entry, subject: entry.subject.trim(), room: entry.room.trim() })),
    ])
    if (scannedTimes.length > 0) setTimeSlots(scannedTimes.slice(0, MAX_TIME_SLOTS))
    closeOcr()
  }

  return (
    <div className="schedule-page">
      <header className="schedule-heading" aria-labelledby="schedule-title">
        <div className="schedule-title-line">
          <h2 id="schedule-title">Расписание</h2>
          <span>8 класс</span>
        </div>
        <p>Нажми на ячейку, чтобы вписать предмет и кабинет.</p>
      </header>

      <section className="schedule-workspace" aria-labelledby="schedule-editor-title">
        <header className="schedule-toolbar">
          <div className="schedule-save-state">
            <Check size={16} weight="bold" aria-hidden="true" />
            <span id="schedule-editor-title">Всё сохраняется на этом устройстве</span>
          </div>
          <div className="schedule-actions">
            <label className="schedule-scan-button">
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" aria-label="Загрузить фото расписания" onChange={onFileChange} />
              <ImageSquare size={19} weight="duotone" aria-hidden="true" />
              Распознать фото
            </label>
            <button className="schedule-add-button" type="button" disabled={timeSlots.length >= MAX_TIME_SLOTS} onClick={addTimeSlot}>
              <Plus size={19} weight="bold" aria-hidden="true" />
              Добавить урок
            </button>
          </div>
        </header>

        <div className="schedule-table-scroll" tabIndex={0} aria-label="Таблица расписания, на узком экране листается по горизонтали">
          <table className="schedule-week-table">
            <caption className="sr-only">Учебное расписание на неделю</caption>
            <colgroup>
              <col className="schedule-time-column" />
              {weekdays.map((day) => <col key={day.id} />)}
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Время</th>
                {weekdays.map((day) => (
                  <th scope="col" key={day.id}>
                    <span>{day.short}</span>
                    <strong>{day.label}</strong>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timeSlots.map((time, rowIndex) => (
                <tr key={time}>
                  <th scope="row">
                    <span>{String(rowIndex + 1).padStart(2, '0')}</span>
                    <input type="time" value={time} aria-label={`Время урока ${rowIndex + 1}`} onChange={(event) => updateTimeSlot(rowIndex, event.target.value)} />
                  </th>
                  {weekdays.map((day) => {
                    const entry = entriesByCell.get(`${day.id}:${time}`)
                    const hasContent = Boolean(entry?.subject.trim() || entry?.room.trim())
                    return (
                      <td key={day.id}>
                        <div className={`schedule-cell-editor${hasContent ? ' has-content' : ''}`}>
                          <label>
                            <span className="sr-only">Предмет, {day.label.toLocaleLowerCase('ru-RU')}, урок {rowIndex + 1}</span>
                            <input
                              value={entry?.subject ?? ''}
                              maxLength={50}
                              aria-label={`Предмет, ${day.label.toLocaleLowerCase('ru-RU')}, урок ${rowIndex + 1}`}
                              onChange={(event) => updateCell(day.id, time, 'subject', event.target.value)}
                            />
                          </label>
                          <div>
                            <label>
                              <span className="sr-only">Кабинет, {day.label.toLocaleLowerCase('ru-RU')}, урок {rowIndex + 1}</span>
                              <input
                                value={entry?.room ?? ''}
                                maxLength={16}
                                placeholder={hasContent ? 'Кабинет' : ''}
                                aria-label={`Кабинет, ${day.label.toLocaleLowerCase('ru-RU')}, урок ${rowIndex + 1}`}
                                onChange={(event) => updateCell(day.id, time, 'room', event.target.value)}
                              />
                            </label>
                            {entry && (
                              <button type="button" aria-label={`Удалить ${entry.subject || 'урок'}: ${day.label.toLocaleLowerCase('ru-RU')}, ${time}`} onClick={() => removeEntry(entry.id)}>
                                <Trash size={16} weight="duotone" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="schedule-board-footer">
          <MagicWand size={21} weight="duotone" aria-hidden="true" />
          <p><strong>Есть фото?</strong> OCR соберёт таблицу, а ты проверишь её перед добавлением.</p>
        </footer>
      </section>

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
                <div className="schedule-ocr-progress" aria-hidden="true"><span style={{ transform: `scaleX(${ocrProgress})` }} /></div>
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
                <div className="schedule-ocr-review-scroll">
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
                </div>

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
