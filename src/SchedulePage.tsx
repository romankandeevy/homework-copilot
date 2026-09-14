import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  CalendarBlank,
  CalendarMinus,
  CalendarPlus,
  Check,
  Clock,
  ImageSquare,
  MagicWand,
  Plus,
  SpinnerGap,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import {
  changeLessonRange,
  defaultLessonTimes,
  makeScheduleEntryId,
  nextLessonTime,
  normalizeLessonTimeRange,
  readScheduleSettings,
  recognizeSchedulePhoto,
  splitLessonTimeRange,
  writeScheduleRecords,
} from './scheduleOcr'
import type { ScheduleEntry, WeekdayId } from './scheduleOcr'
import type { Json } from './lib/database.types'
import { supabase } from './lib/supabase'
import { useModalIsolation } from './lib/useModalIsolation'
import './SchedulePage.css'

type OcrPhase = 'idle' | 'reading' | 'review' | 'error'

const STORAGE_KEY = 'homework-copilot:schedule-v1'
const TIME_STORAGE_KEY = 'homework-copilot:schedule-times-v1'
const MAX_TIME_SLOTS = 12

const legacyLessonTimes: Record<string, string> = {
  '08:30': defaultLessonTimes[0],
  '09:25': defaultLessonTimes[1],
  '10:20': defaultLessonTimes[2],
  '10:20-11:05': defaultLessonTimes[2],
  '11:20': defaultLessonTimes[3],
  '11:20-12:05': defaultLessonTimes[3],
  '12:15': defaultLessonTimes[4],
  '12:15-13:00': defaultLessonTimes[4],
  '13:10': defaultLessonTimes[5],
  '13:10-13:55': defaultLessonTimes[5],
  '14:05': defaultLessonTimes[6],
  '14:05-14:50': defaultLessonTimes[6],
}

function migrateLessonTime(value: string, index: number) {
  return legacyLessonTimes[value] ?? normalizeLessonTimeRange(value, index)
}

const weekdays: ReadonlyArray<{ id: WeekdayId; label: string; short: string }> = [
  { id: 'monday', label: 'Понедельник', short: 'Пн' },
  { id: 'tuesday', label: 'Вторник', short: 'Вт' },
  { id: 'wednesday', label: 'Среда', short: 'Ср' },
  { id: 'thursday', label: 'Четверг', short: 'Чт' },
  { id: 'friday', label: 'Пятница', short: 'Пт' },
  { id: 'saturday', label: 'Суббота', short: 'Сб' },
]

/* Новый ученик начинает с пустой сетки.

   Раньше здесь лежало расписание восьмого класса — Алгебра/312, Физика/406 и
   так далее. Оно показывалось как своё и при первом входе уходило в аккаунт,
   хотя человек не ввёл ни строки. Пустая таблица честнее: время уроков
   подставляется типовое, предметы вписывает сам ученик или распознавание. */
const starterSchedule: ScheduleEntry[] = []

function loadStoredRecords(): unknown {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

function loadSchedule() {
  const stored = loadStoredRecords()
  return stored ? parseScheduleEntries(stored, starterSchedule) : starterSchedule
}

function loadSaturday() {
  return readScheduleSettings(loadStoredRecords()).saturday
}

function parseScheduleEntries(value: unknown, fallback: ScheduleEntry[]) {
  if (!Array.isArray(value)) return fallback
  return value
    .filter((entry): entry is ScheduleEntry => Boolean(
      entry
      && typeof entry === 'object'
      && 'day' in entry
      && weekdays.some(({ id }) => id === entry.day)
      && 'subject' in entry
      && typeof entry.subject === 'string'
      && 'room' in entry
      && typeof entry.room === 'string'
      && 'time' in entry
      && typeof entry.time === 'string',
    ))
    // Копия: разобранные записи не должны делить объект с сохранённым слепком.
    // eslint-disable-next-line no-map-spread
    .map((entry, index) => ({ ...entry, time: migrateLessonTime(entry.time, index) }))
}

function sortTimes(times: string[]) {
  return Array.from(new Set(times.map((time, index) => normalizeLessonTimeRange(time, index)).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right))
}

function loadTimeSlots(entries: ScheduleEntry[]) {
  try {
    const stored = window.localStorage.getItem(TIME_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as string[]
      const slots = sortTimes([...parsed.map(migrateLessonTime), ...entries.map(({ time }) => time)])
        .filter((time) => time !== '15:00-15:45' || entries.some((entry) => entry.time === time))
      if (slots.length > 0) return slots.slice(0, MAX_TIME_SLOTS)
    }
  } catch {
    // Fall back to the timetable defaults below.
  }

  return sortTimes([...defaultLessonTimes, ...entries.map(({ time }) => time)]).slice(0, MAX_TIME_SLOTS)
}

function displayLessonTime(value: string) {
  const { start, end } = splitLessonTimeRange(value)
  return `${start.replace(/^0/, '')}-${end.replace(/^0/, '')}`
}

function lessonWord(count: number) {
  const lastTwo = count % 100
  const last = count % 10
  if (last === 1 && lastTwo !== 11) return 'урок'
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return 'урока'
  return 'уроков'
}

/* Время урока - обычное текстовое поле, а не `type="time"`.

   14 сентября 2026 владелец не понял этот блок: «время урока... какая-то
   иконка часов». Системное поле времени каждый браузер рисует по-своему: где-то
   со значком часов, где-то с AM/PM, которые в узкой колонке обрезались до
   «08:30 A». Теперь запись всегда 24-часовая, поле выглядит полем, а «8.30»,
   «8 30» и «830» понимаются одинаково. Правка применяется, когда поле
   отпустили: на полпути «8:3» не должно переставлять строки таблицы. */
function LessonTimeField({ value, label, onCommit }: { value: string; label: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    setDraft(null)
    if (draft.trim() && draft !== value) onCommit(draft)
  }

  return (
    <input
      className="schedule-time-input"
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      maxLength={5}
      value={draft ?? value}
      aria-label={label}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  )
}

/* Класс приходит из профиля и может не прийти вовсе. Подставлять восьмой
   за того, кто про себя ничего не сообщал, нельзя: подпись «8 класс» над
   пустой сеткой - выдуманный факт о человеке. */
function SchedulePage({ userId = null, grade = null }: { userId?: string | null; grade?: number | null }) {
  const reduceMotion = useReducedMotion()
  const [entries, setEntries] = useState<ScheduleEntry[]>(loadSchedule)
  const [timeSlots, setTimeSlots] = useState<string[]>(() => loadTimeSlots(loadSchedule()))
  const [withSaturday, setWithSaturday] = useState(loadSaturday)
  const [ocrPhase, setOcrPhase] = useState<OcrPhase>('idle')
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrMessage, setOcrMessage] = useState('Готовим изображение')
  const [ocrError, setOcrError] = useState('')
  const [ocrRows, setOcrRows] = useState<ScheduleEntry[]>([])
  const [ocrRawText, setOcrRawText] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [importRevision, setImportRevision] = useState(0)
  const [activeDay, setActiveDay] = useState<WeekdayId>('monday')
  const [persistenceReady, setPersistenceReady] = useState(!userId)
  const [saveState, setSaveState] = useState<'local' | 'loading' | 'saving' | 'saved' | 'error'>(userId ? 'loading' : 'local')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const ocrRunRef = useRef(0)

  const entriesByCell = useMemo(() => new Map(entries.map((entry) => [`${entry.day}:${entry.time}`, entry])), [entries])
  /* Суббота - такой же день, как остальные, но её можно убрать: не все
     учатся по субботам, а без неё таблица шире (14 сентября 2026). Уроки
     убранной субботы не стираются - вернёшь день, и они на месте. */
  const visibleDays = withSaturday ? weekdays : weekdays.filter(({ id }) => id !== 'saturday')
  const shownDay = visibleDays.some(({ id }) => id === activeDay) ? activeDay : visibleDays[0].id

  const closeOcr = useCallback(() => {
    ocrRunRef.current += 1
    setOcrPhase('idle')
    setOcrRows([])
    setOcrRawText('')
    setOcrError('')
    setOcrProgress(0)
    setPreviewUrl('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])
  const ocrDialogRef = useModalIsolation<HTMLElement>(ocrPhase !== 'idle', closeOcr)

  useEffect(() => {
    let cancelled = false
    const client = supabase

    if (!userId || !client) {
      setPersistenceReady(true)
      setSaveState('local')
      return
    }

    setPersistenceReady(false)
    setSaveState('loading')
    const loadAccountSchedule = async () => {
      const { data, error } = await client
        .from('user_schedules')
        .select('entries, time_slots')
        .eq('user_id', userId)
        .maybeSingle()

      if (cancelled) return
      if (error) {
        setPersistenceReady(true)
        setSaveState('error')
        return
      }

      if (data) {
        const nextEntries = parseScheduleEntries(data.entries, [])
        const nextTimes = Array.isArray(data.time_slots)
          ? sortTimes(data.time_slots.filter((value): value is string => typeof value === 'string')).slice(0, MAX_TIME_SLOTS)
          : []
        setEntries(nextEntries)
        setTimeSlots(nextTimes.length > 0 ? nextTimes : loadTimeSlots(nextEntries))
        setWithSaturday(readScheduleSettings(data.entries).saturday)
      } else {
        const { error: createError } = await client.from('user_schedules').insert({
          user_id: userId,
          entries: writeScheduleRecords(entries, { saturday: withSaturday }) as unknown as Json,
          time_slots: timeSlots as unknown as Json,
        })
        if (cancelled) return
        if (createError) {
          setPersistenceReady(true)
          setSaveState('error')
          return
        }
      }

      setPersistenceReady(true)
      setSaveState('saved')
    }

    void loadAccountSchedule()
    return () => { cancelled = true }
    // The account change is the only event that should rehydrate the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  useEffect(() => {
    const client = supabase
    const records = writeScheduleRecords(entries, { saturday: withSaturday })
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
      window.localStorage.setItem(TIME_STORAGE_KEY, JSON.stringify(timeSlots))
    } catch {
      // Хранилище браузера закрыто (приватный режим): аккаунт ниже всё равно сохранит.
    }

    if (!userId || !client || !persistenceReady) return
    setSaveState('saving')
    const timer = window.setTimeout(() => {
      void client.from('user_schedules').upsert({
        user_id: userId,
        entries: records as unknown as Json,
        time_slots: timeSlots as unknown as Json,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' }).then(({ error }) => setSaveState(error ? 'error' : 'saved'))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [entries, timeSlots, withSaturday, userId, persistenceReady])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

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

  const updateTimeSlot = (index: number, edge: 'start' | 'end', value: string) => {
    const previous = timeSlots[index]
    const next = changeLessonRange(previous, edge, value)
    if (!next || next === previous || timeSlots.includes(next)) return
    setTimeSlots((current) => current.map((time) => time === previous ? next : time).sort((left, right) => left.localeCompare(right)))
    setEntries((current) => current.map((entry) => entry.time === previous ? { ...entry, time: next } : entry))
  }

  const removeEntry = (id: string) => setEntries((current) => current.filter((entry) => entry.id !== id))

  const toggleSaturday = () => {
    if (withSaturday && activeDay === 'saturday') setActiveDay('friday')
    setWithSaturday((current) => !current)
  }

  const recognizeSchedule = async (file: File) => {
    const runId = ocrRunRef.current + 1
    ocrRunRef.current = runId
    const isCancelled = () => ocrRunRef.current !== runId
    setPreviewUrl(URL.createObjectURL(file))
    setOcrPhase('reading')
    setOcrProgress(0.03)
    setOcrMessage('Открываем фото')
    setOcrError('')

    try {
      const result = await recognizeSchedulePhoto(file, {
        // Воркер и wasm-ядро берём со своего домена, а не со стороннего CDN:
        // иначе компрометация CDN означала бы выполнение произвольного кода
        // в браузере ученика, а блокировка CDN — отказ распознавания.
        // Языковые модели остаются внешними — это данные, а не исполняемый код.
        assetBase: `${import.meta.env.BASE_URL.replace(/\/$/, '')}/tesseract`,
        isCancelled,
        onProgress: (progress, message) => {
          if (isCancelled()) return
          setOcrProgress(progress)
          setOcrMessage(message)
        },
      })
      if (!result || isCancelled()) return
      setOcrRawText(result.rawText)

      if (result.entries.every((entry) => !entry.subject.trim())) {
        setOcrError('Не удалось найти строки с уроками. Сфотографируй таблицу целиком, ровно и при хорошем свете.')
        setOcrPhase('error')
        return
      }

      setOcrRows(result.entries)
      setOcrProgress(1)
      setOcrPhase('review')
    } catch {
      if (isCancelled()) return
      setOcrError('Распознавание не запустилось. Проверь интернет и попробуй ещё раз: при первом запуске загружается русская модель.')
      setOcrPhase('error')
    }
  }

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void recognizeSchedule(file)
  }

  const ocrTimes = sortTimes(ocrRows.map(({ time }) => time))
  const ocrHasSaturday = ocrRows.some((entry) => entry.day === 'saturday' && Boolean(entry.subject.trim() || entry.room.trim()))
  // В проверке видны все дни недели, а не только найденные: пропущенный
  // распознаванием урок можно вписать сразу, не дожидаясь таблицы.
  const reviewDays = weekdays.filter(({ id }) => id !== 'saturday' || withSaturday || ocrHasSaturday)
  const ocrEntriesByCell = new Map(ocrRows.map((entry) => [`${entry.day}:${entry.time}`, entry]))
  const recognizedLessonCount = ocrRows.filter((entry) => entry.subject.trim()).length

  const updateOcrCell = (day: WeekdayId, time: string, field: 'subject' | 'room', value: string) => {
    setOcrRows((current) => {
      const existing = current.find((entry) => entry.day === day && entry.time === time)
      if (existing) return current.map((entry) => entry.id === existing.id ? { ...entry, [field]: value } : entry)
      return [...current, { id: makeScheduleEntryId(), day, time, subject: field === 'subject' ? value : '', room: field === 'room' ? value : '' }]
    })
  }

  const updateOcrTime = (time: string, edge: 'start' | 'end', value: string) => {
    const next = changeLessonRange(time, edge, value)
    if (!next || next === time || ocrTimes.includes(next)) return
    setOcrRows((current) => current.map((entry) => entry.time === time ? { ...entry, time: next } : entry))
  }

  const removeOcrRow = (time: string) => setOcrRows((current) => current.filter((entry) => entry.time !== time))

  const addOcrTimeSlot = () => {
    const next = nextLessonTime(ocrTimes)
    setOcrRows((current) => [
      ...current,
      ...reviewDays.map((day) => ({ id: makeScheduleEntryId(), day: day.id, time: next, subject: '', room: '' })),
    ])
  }

  const applyOcrRows = () => {
    const lessons = ocrRows.filter((entry) => entry.subject.trim())
    // Заменяются только дни, в которых нашёлся хоть один урок: снимок половины
    // недели не стирает вторую половину.
    const scannedDays = new Set(lessons.map(({ day }) => day))
    const kept = entries.filter((entry) => !scannedDays.has(entry.day))
    setEntries([
      ...kept,
      // Копия: записи уходят в состояние React, править их на месте нельзя.
      // eslint-disable-next-line no-map-spread
      ...lessons.map((entry) => ({ ...entry, subject: entry.subject.trim(), room: entry.room.trim() })),
    ])
    const scannedTimes = sortTimes(ocrRows.map(({ time }) => time))
    if (scannedTimes.length > 0) setTimeSlots(sortTimes([...scannedTimes, ...kept.map(({ time }) => time)]).slice(0, MAX_TIME_SLOTS))
    if (scannedDays.has('saturday')) setWithSaturday(true)
    setImportRevision((current) => current + 1)
    closeOcr()
  }

  const saveStatus = saveState === 'loading'
    ? 'Загружаем расписание из аккаунта'
    : saveState === 'error'
      ? 'Не получилось сохранить в аккаунте'
      : saveState === 'local'
        ? 'Только в этом браузере: войди, чтобы расписание осталось при смене телефона'
        : ''

  return (
    <div className="schedule-page">
      <motion.header
        className="schedule-heading"
        aria-labelledby="schedule-title"
        initial={reduceMotion ? false : { opacity: 0.78, clipPath: 'inset(0 0 18% 0)' }}
        animate={{ opacity: 1, clipPath: 'inset(0 0 0% 0)' }}
        transition={{ duration: reduceMotion ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="schedule-heading-copy">
          <div className="schedule-title-line">
            <h1 id="schedule-title">Расписание</h1>
            {grade ? <span>{grade} класс</span> : null}
          </div>
          <p>
            <span className="schedule-desktop-hint">Вся неделя перед глазами. Нажми на ячейку, чтобы изменить урок.</span>
            {/* «Без горизонтальной прокрутки» продавало отсутствие бага как
                достоинство. Здесь пишем, что делать, а не чего не случится. */}
            <span className="schedule-mobile-hint">Выбери день и впиши уроки. Или сфотографируй расписание - разберём само.</span>
          </p>
        </div>
        <div className="schedule-actions">
          <motion.label className="schedule-scan-button" whileTap={reduceMotion ? undefined : { scale: 0.98 }}>
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment" aria-label="Загрузить фото расписания" onChange={onFileChange} />
            <ImageSquare size={19} weight="duotone" aria-hidden="true" />
            Распознать фото
          </motion.label>
        </div>
      </motion.header>

      <section
        className="schedule-workspace"
        aria-label="Расписание на неделю"
        style={{ '--schedule-days': visibleDays.length } as CSSProperties}
      >
        <header className="schedule-toolbar">
          {/* «Сохранено в аккаунте» снято 14 сентября 2026: владельцу это и
              так очевидно, надпись была лишней. Строка говорит только то,
              что требует внимания: загрузку, ошибку и то, что у гостя
              расписание живёт лишь в этом браузере. «Сохраняется в этом
              браузере» - предупреждение, а не успех: сменишь телефон или
              почистишь кэш, и расписания нет. Галочки здесь нет вовсе. */}
          {saveStatus && (
            <div className={`schedule-save-state${saveState === 'error' ? ' is-error' : ''}${saveState === 'local' ? ' is-local' : ''}`} role="status">
              {saveState === 'loading'
                ? <SpinnerGap className="schedule-save-spinner" size={16} weight="bold" aria-hidden="true" />
                : <WarningCircle size={16} weight="fill" aria-hidden="true" />}
              <span>{saveStatus}</span>
            </div>
          )}
          <div className="schedule-toolbar-end">
            <span className="schedule-toolbar-meta">{timeSlots.length} {lessonWord(timeSlots.length)} · {visibleDays.length} дней</span>
            <button type="button" className="schedule-saturday-toggle" onClick={toggleSaturday}>
              {withSaturday
                ? <CalendarMinus size={17} weight="duotone" aria-hidden="true" />
                : <CalendarPlus size={17} weight="duotone" aria-hidden="true" />}
              {withSaturday ? 'Убрать субботу' : 'Вернуть субботу'}
            </button>
          </div>
        </header>

        {/* Пустая сетка притворялась заполненной: семь одинаковых строк
            «Предмет / Кабинет» первые полсекунды читаются как расписание,
            которое у человека уже есть. Пока не вписан ни один урок, сетку
            предваряет прямая надпись о том, что она пустая, и то, с чего
            начать. Исчезает сама, как только появился первый урок. */}
        {entries.length === 0 && (
          <div className="schedule-blank" role="status">
            <CalendarBlank size={26} weight="duotone" aria-hidden="true" />
            <div>
              <strong>Расписание пустое</strong>
              <p>
                Строки ниже - заготовка на неделю: время звонков типовое, предметов ещё нет.
                Впиши уроки в ячейки или сними расписание на камеру - разберём и подставим.
              </p>
            </div>
          </div>
        )}

        <div className="schedule-table-scroll" tabIndex={0} aria-label="Таблица расписания, на узком экране листается по горизонтали">
          <table className="schedule-week-table">
            <caption className="sr-only">Учебное расписание на неделю</caption>
            <colgroup>
              <col className="schedule-time-column" />
              {visibleDays.map((day) => <col key={day.id} />)}
            </colgroup>
            <thead>
              <tr>
                {/* Подпись объясняет и значок, и поведение: время одно на
                    все дни, поправил здесь - поменялось во всей неделе. */}
                <th scope="col" className="schedule-time-heading">
                  <span><Clock size={16} weight="duotone" aria-hidden="true" />Время урока</span>
                  <small>одно на все дни</small>
                </th>
                {visibleDays.map((day) => (
                  <th scope="col" key={day.id}>
                    <span>{day.short}</span>
                    <strong>{day.label}</strong>
                  </th>
                ))}
              </tr>
            </thead>
            <motion.tbody
              key={importRevision}
              initial={importRevision > 0 && !reduceMotion ? { opacity: 0.72 } : false}
              animate={{ opacity: 1 }}
              transition={{ duration: reduceMotion ? 0 : 0.28 }}
            >
              {timeSlots.map((time, rowIndex) => (
                <tr key={time}>
                  <th scope="row">
                    <span className="schedule-lesson-number">{rowIndex + 1} урок</span>
                    <div className="schedule-time-range" role="group" aria-label={`Время урока ${rowIndex + 1}: ${displayLessonTime(time)}`}>
                      <LessonTimeField value={splitLessonTimeRange(time).start} label={`Начало урока ${rowIndex + 1} в недельной таблице`} onCommit={(value) => updateTimeSlot(rowIndex, 'start', value)} />
                      <i aria-hidden="true" />
                      <LessonTimeField value={splitLessonTimeRange(time).end} label={`Конец урока ${rowIndex + 1} в недельной таблице`} onCommit={(value) => updateTimeSlot(rowIndex, 'end', value)} />
                    </div>
                  </th>
                  {visibleDays.map((day) => {
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
                              aria-label={`Предмет, ${day.label.toLocaleLowerCase('ru-RU')}, урок ${rowIndex + 1} в недельной таблице`}
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
                                aria-label={`Кабинет, ${day.label.toLocaleLowerCase('ru-RU')}, урок ${rowIndex + 1} в недельной таблице`}
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
            </motion.tbody>
          </table>
        </div>

        <div className="schedule-mobile-board">
          <div className="schedule-day-tabs" role="tablist" aria-label="День недели">
            {visibleDays.map((day, dayIndex) => (
              <button
                type="button"
                role="tab"
                id={`schedule-day-${day.id}`}
                aria-controls="schedule-day-panel"
                aria-selected={shownDay === day.id}
                className={shownDay === day.id ? 'is-active' : ''}
                key={day.id}
                onClick={() => setActiveDay(day.id)}
                onKeyDown={(event) => {
                  const nextIndex = event.key === 'ArrowRight'
                    ? (dayIndex + 1) % visibleDays.length
                    : event.key === 'ArrowLeft'
                      ? (dayIndex + visibleDays.length - 1) % visibleDays.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? visibleDays.length - 1
                          : null

                  if (nextIndex === null) return
                  event.preventDefault()
                  const nextDay = visibleDays[nextIndex]
                  setActiveDay(nextDay.id)
                  document.getElementById(`schedule-day-${nextDay.id}`)?.focus()
                }}
                tabIndex={shownDay === day.id ? 0 : -1}
              >
                <span>{day.short}</span>
                <strong>{day.label}</strong>
              </button>
            ))}
          </div>

          <p className="schedule-day-note">
            <Clock size={16} weight="duotone" aria-hidden="true" />
            <span>Время урока общее для всей недели. Поправишь его здесь, и оно изменится во всех днях.</span>
          </p>

          <div
            className="schedule-day-panel"
            id="schedule-day-panel"
            role="tabpanel"
            aria-labelledby={`schedule-day-${shownDay}`}
          >
            {timeSlots.map((time, rowIndex) => {
              const day = weekdays.find(({ id }) => id === shownDay) ?? weekdays[0]
              const entry = entriesByCell.get(`${shownDay}:${time}`)
              return (
                <div className="schedule-mobile-lesson" key={time}>
                  <div className="schedule-mobile-time">
                    <span className="schedule-lesson-number">{rowIndex + 1} урок</span>
                    <div className="schedule-time-range" role="group" aria-label={`Время урока ${rowIndex + 1}: ${displayLessonTime(time)}`}>
                      <LessonTimeField value={splitLessonTimeRange(time).start} label={`Начало урока ${rowIndex + 1}`} onCommit={(value) => updateTimeSlot(rowIndex, 'start', value)} />
                      <i aria-hidden="true" />
                      <LessonTimeField value={splitLessonTimeRange(time).end} label={`Конец урока ${rowIndex + 1}`} onCommit={(value) => updateTimeSlot(rowIndex, 'end', value)} />
                    </div>
                  </div>
                  <div className={`schedule-cell-editor${entry?.subject.trim() || entry?.room.trim() ? ' has-content' : ''}`}>
                    <label>
                      <span className="sr-only">Предмет, {day.label.toLocaleLowerCase('ru-RU')}, урок {rowIndex + 1}</span>
                      <input
                        value={entry?.subject ?? ''}
                        maxLength={50}
                        placeholder="Предмет"
                        aria-label={`Предмет, ${day.label.toLocaleLowerCase('ru-RU')}, урок ${rowIndex + 1}`}
                        onChange={(event) => updateCell(shownDay, time, 'subject', event.target.value)}
                      />
                    </label>
                    <div>
                      <label>
                        <span className="sr-only">Кабинет, {day.label.toLocaleLowerCase('ru-RU')}, урок {rowIndex + 1}</span>
                        <input
                          value={entry?.room ?? ''}
                          maxLength={16}
                          placeholder="Кабинет"
                          aria-label={`Кабинет, ${day.label.toLocaleLowerCase('ru-RU')}, урок ${rowIndex + 1}`}
                          onChange={(event) => updateCell(shownDay, time, 'room', event.target.value)}
                        />
                      </label>
                      {entry && (
                        <button type="button" aria-label={`Удалить ${entry.subject || 'урок'}: ${day.label.toLocaleLowerCase('ru-RU')}, ${time}`} onClick={() => removeEntry(entry.id)}>
                          <Trash size={16} weight="duotone" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <footer className="schedule-board-footer">
          <MagicWand size={21} weight="duotone" aria-hidden="true" />
          <p><strong>Есть фото?</strong> OCR соберёт таблицу, а ты проверишь её перед добавлением.</p>
        </footer>
      </section>

      {createPortal(<AnimatePresence>
        {ocrPhase !== 'idle' && (
        <motion.div
          className="schedule-ocr-backdrop"
          role="presentation"
          initial={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeOcr()
          }}
        >
          <motion.section
            ref={ocrDialogRef}
            className="schedule-ocr-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="schedule-ocr-title"
            tabIndex={-1}
            initial={reduceMotion ? false : { y: 18, opacity: 0.72, clipPath: 'inset(0 0 12% 0 round 16px)' }}
            animate={{ y: 0, opacity: 1, clipPath: 'inset(0 0 0% 0 round 16px)' }}
            exit={reduceMotion ? { opacity: 0 } : { y: 10, opacity: 0, clipPath: 'inset(0 0 8% 0 round 16px)' }}
            transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <header>
              <div>
                <h2 id="schedule-ocr-title">{ocrPhase === 'review' ? 'Проверь расписание' : 'Читаем фото'}</h2>
                <p>{ocrPhase === 'review' ? 'Исправь предметы, кабинеты и время перед добавлением.' : 'Находим сетку, затем читаем каждую ячейку отдельно.'}</p>
              </div>
              <button type="button" aria-label="Закрыть распознавание" onClick={closeOcr}><X size={20} weight="bold" aria-hidden="true" /></button>
            </header>

            <AnimatePresence mode="wait" initial={false}>
            {ocrPhase === 'reading' && (
              <motion.div className="schedule-ocr-reading" key="reading" initial={{ opacity: 0.75 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {previewUrl && <img src={previewUrl} alt="Загруженное расписание" />}
                <div className="schedule-ocr-progress-copy" aria-live="polite">
                  <SpinnerGap size={28} weight="bold" aria-hidden="true" />
                  <strong>{ocrMessage}</strong>
                  <span>{Math.round(ocrProgress * 100)}%</span>
                </div>
                <div className="schedule-ocr-progress" aria-hidden="true"><span style={{ transform: `scaleX(${ocrProgress})` }} /></div>
                <p>Первый запуск может занять чуть дольше: загружается русская OCR-модель. Само фото никуда не отправляется: его читает браузер.</p>
              </motion.div>
            )}

            {ocrPhase === 'error' && (
              <motion.div className="schedule-ocr-error" key="error" role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <WarningCircle size={34} weight="duotone" aria-hidden="true" />
                <strong>Не получилось распознать</strong>
                <p>{ocrError}</p>
                <button type="button" onClick={() => fileInputRef.current?.click()}>Выбрать другое фото</button>
              </motion.div>
            )}

            {ocrPhase === 'review' && (
              <motion.div className="schedule-ocr-review" key="review" initial={{ opacity: 0.72 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="schedule-ocr-review-scroll">
                  <p className="schedule-ocr-review-intro">
                    Нашли {recognizedLessonCount} {lessonWord(recognizedLessonCount)}. Пустые клетки можно заполнить, лишние строки убрать.
                    В расписание попадёт только то, что здесь видно.
                  </p>
                  <div className="schedule-ocr-grid-scroll" tabIndex={0} aria-label="Проверка распознанного расписания">
                    <table className="schedule-ocr-grid" style={{ '--schedule-days': reviewDays.length } as CSSProperties}>
                      <thead>
                        <tr>
                          <th scope="col">Время урока</th>
                          {reviewDays.map((day) => <th scope="col" key={day.id}>{day.label}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {ocrTimes.map((time, rowIndex) => (
                          <tr key={time}>
                            <th scope="row">
                              <div className="schedule-ocr-row-head">
                                <span className="schedule-lesson-number">{rowIndex + 1} урок</span>
                                <button type="button" className="schedule-ocr-row-remove" aria-label={`Убрать ${rowIndex + 1} урок из распознанного`} onClick={() => removeOcrRow(time)}>
                                  <Trash size={16} weight="duotone" aria-hidden="true" />
                                </button>
                              </div>
                              <div className="schedule-time-range" role="group" aria-label={`Время распознанного урока ${rowIndex + 1}`}>
                                <LessonTimeField value={splitLessonTimeRange(time).start} label={`Начало распознанного урока ${rowIndex + 1}`} onCommit={(value) => updateOcrTime(time, 'start', value)} />
                                <i aria-hidden="true" />
                                <LessonTimeField value={splitLessonTimeRange(time).end} label={`Конец распознанного урока ${rowIndex + 1}`} onCommit={(value) => updateOcrTime(time, 'end', value)} />
                              </div>
                            </th>
                            {reviewDays.map((day) => {
                              const entry = ocrEntriesByCell.get(`${day.id}:${time}`)
                              return (
                                <td key={day.id}>
                                  <label>
                                    <span className="sr-only">Предмет, {day.label.toLocaleLowerCase('ru-RU')}, строка {rowIndex + 1}</span>
                                    <input value={entry?.subject ?? ''} placeholder="Предмет" aria-label={`Распознанный предмет, ${day.label.toLocaleLowerCase('ru-RU')}, урок ${rowIndex + 1}`} onChange={(event) => updateOcrCell(day.id, time, 'subject', event.target.value)} />
                                  </label>
                                  <label>
                                    <span className="sr-only">Кабинет, {day.label.toLocaleLowerCase('ru-RU')}, строка {rowIndex + 1}</span>
                                    <input value={entry?.room ?? ''} placeholder={entry?.subject ? 'Кабинет' : ''} aria-label={`Распознанный кабинет, ${day.label.toLocaleLowerCase('ru-RU')}, урок ${rowIndex + 1}`} onChange={(event) => updateOcrCell(day.id, time, 'room', event.target.value)} />
                                  </label>
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <button className="schedule-ocr-add-row" type="button" onClick={addOcrTimeSlot}>
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
                  <button type="button" disabled={recognizedLessonCount === 0} onClick={applyOcrRows}>
                    <Check size={18} weight="bold" aria-hidden="true" /> Подтвердить и добавить
                  </button>
                </footer>
              </motion.div>
            )}
            </AnimatePresence>
          </motion.section>
        </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  )
}

export default SchedulePage
