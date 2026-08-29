import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
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
import {
  defaultLessonTimes,
  getScheduleTeacherKey,
  getScheduleTableCells,
  makeScheduleEntryId,
  normalizeLessonTimeRange,
  parseScheduleCellText,
  parseScheduleRoomDigits,
  parseScheduleTableTsv,
  parseScheduleText,
  splitLessonTimeRange,
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

const starterSchedule: ScheduleEntry[] = [
  { id: 'monday-1', day: 'monday', time: defaultLessonTimes[0], subject: 'Алгебра', room: '312' },
  { id: 'monday-2', day: 'monday', time: defaultLessonTimes[1], subject: 'Русский язык', room: '218' },
  { id: 'monday-3', day: 'monday', time: defaultLessonTimes[2], subject: 'Физика', room: '406' },
  { id: 'monday-4', day: 'monday', time: defaultLessonTimes[3], subject: 'История', room: '205' },
  { id: 'tuesday-1', day: 'tuesday', time: defaultLessonTimes[0], subject: 'Геометрия', room: '312' },
  { id: 'tuesday-2', day: 'tuesday', time: defaultLessonTimes[1], subject: 'Литература', room: '218' },
  { id: 'tuesday-3', day: 'tuesday', time: defaultLessonTimes[2], subject: 'Английский язык', room: '314' },
  { id: 'wednesday-1', day: 'wednesday', time: defaultLessonTimes[0], subject: 'Биология', room: '303' },
  { id: 'wednesday-2', day: 'wednesday', time: defaultLessonTimes[1], subject: 'Алгебра', room: '312' },
  { id: 'wednesday-3', day: 'wednesday', time: defaultLessonTimes[2], subject: 'Информатика', room: '401' },
  { id: 'thursday-1', day: 'thursday', time: defaultLessonTimes[0], subject: 'Русский язык', room: '218' },
  { id: 'thursday-2', day: 'thursday', time: defaultLessonTimes[1], subject: 'География', room: '307' },
  { id: 'thursday-3', day: 'thursday', time: defaultLessonTimes[2], subject: 'Физкультура', room: 'Зал' },
  { id: 'friday-1', day: 'friday', time: defaultLessonTimes[0], subject: 'Химия', room: '408' },
  { id: 'friday-2', day: 'friday', time: defaultLessonTimes[1], subject: 'Геометрия', room: '312' },
  { id: 'friday-3', day: 'friday', time: defaultLessonTimes[2], subject: 'Обществознание', room: '205' },
]

function loadSchedule() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) return starterSchedule
    return parseScheduleEntries(JSON.parse(stored), starterSchedule)
  } catch {
    return starterSchedule
  }
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

function nextLessonTime(times: string[]) {
  const previousEnd = splitLessonTimeRange(times.at(-1) ?? '07:35-08:20').end
  const [hours, minutes] = previousEnd.split(':').map(Number)
  const start = Math.min(hours * 60 + minutes + 10, 23 * 60 + 14)
  const end = Math.min(start + 45, 23 * 60 + 59)
  const format = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
  return `${format(start)}-${format(end)}`
}

function displayLessonTime(value: string) {
  const { start, end } = splitLessonTimeRange(value)
  return `${start.replace(/^0/, '')}-${end.replace(/^0/, '')}`
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

async function prepareOcrImages(file: File) {
  if (typeof createImageBitmap !== 'function') return { tableImage: file, detailImage: file, detailRatio: 1 }

  const bitmap = await createImageBitmap(file)
  const draw = (preferredScale: number, maxDimension: number, contrast: number) => {
    const scale = Math.min(preferredScale, maxDimension / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return null
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.filter = contrast === 1 ? 'none' : `grayscale(1) contrast(${contrast})`
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas
  }

  const tableImage = draw(bitmap.width < 1800 ? 2.2 : 1, 3200, 1.3)
  const detailImage = draw(bitmap.width < 1800 ? 4 : 1, 5600, 1)
  bitmap.close()
  if (!tableImage || !detailImage) return { tableImage: file, detailImage: file, detailRatio: 1 }
  return { tableImage, detailImage, detailRatio: detailImage.width / tableImage.width }
}

function scaleRectangle(rectangle: { left: number; top: number; width: number; height: number }, ratio: number) {
  return {
    left: Math.round(rectangle.left * ratio),
    top: Math.round(rectangle.top * ratio),
    width: Math.max(1, Math.round(rectangle.width * ratio)),
    height: Math.max(1, Math.round(rectangle.height * ratio)),
  }
}

function SchedulePage({ userId = null, grade = 8 }: { userId?: string | null; grade?: number }) {
  const reduceMotion = useReducedMotion()
  const [entries, setEntries] = useState<ScheduleEntry[]>(loadSchedule)
  const [timeSlots, setTimeSlots] = useState<string[]>(() => loadTimeSlots(loadSchedule()))
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
      } else {
        const { error: createError } = await client.from('user_schedules').insert({
          user_id: userId,
          entries: entries as unknown as Json,
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
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
    window.localStorage.setItem(TIME_STORAGE_KEY, JSON.stringify(timeSlots))

    if (!userId || !client || !persistenceReady) return
    setSaveState('saving')
    const timer = window.setTimeout(() => {
      void client.from('user_schedules').upsert({
        user_id: userId,
        entries: entries as unknown as Json,
        time_slots: timeSlots as unknown as Json,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' }).then(({ error }) => setSaveState(error ? 'error' : 'saved'))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [entries, timeSlots, userId, persistenceReady])

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
    const currentRange = splitLessonTimeRange(previous)
    const next = `${edge === 'start' ? value : currentRange.start}-${edge === 'end' ? value : currentRange.end}`
    const normalized = normalizeLessonTimeRange(next, index)
    const normalizedParts = splitLessonTimeRange(normalized)
    if (!value || normalizedParts.start >= normalizedParts.end || (normalized !== previous && timeSlots.includes(normalized))) return
    setTimeSlots((current) => current.map((time, timeIndex) => timeIndex === index ? normalized : time).sort((left, right) => left.localeCompare(right)))
    setEntries((current) => current.map((entry) => entry.time === previous ? { ...entry, time: normalized } : entry))
  }

  const removeEntry = (id: string) => setEntries((current) => current.filter((entry) => entry.id !== id))

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
      const { tableImage, detailImage, detailRatio } = await prepareOcrImages(file)
      let pass: 'loading' | 'table' | 'cells' = 'loading'
      let cellProgress = 0
      let cellCount = 1
      // Воркер и wasm-ядро берём со своего домена, а не со стороннего CDN:
      // иначе компрометация CDN означала бы выполнение произвольного кода
      // в браузере ученика, а блокировка CDN — отказ распознавания.
      // Языковые модели остаются внешними — это данные, а не исполняемый код.
      const assetBase = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/tesseract`
      const worker = await createWorker(['rus', 'eng'], undefined, {
        workerPath: `${assetBase}/worker.min.js`,
        corePath: `${assetBase}/core`,
        logger: ({ progress, status }) => {
          if (ocrRunRef.current !== runId) return
          if (status === 'recognizing text' && pass === 'table') {
            setOcrProgress(0.15 + (progress || 0) * 0.5)
            setOcrMessage('Разбираем строки и колонки')
          } else if (status === 'recognizing text' && pass === 'cells') {
            setOcrProgress(0.62 + ((cellProgress + (progress || 0)) / cellCount) * 0.34)
            setOcrMessage(`Читаем ячейку ${Math.min(cellProgress + 1, cellCount)} из ${cellCount}`)
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
        const { data } = await worker.recognize(tableImage, {}, { text: true, tsv: true })
        if (ocrRunRef.current !== runId) return
        const primaryTsv = data.tsv ?? ''
        const tableCells = getScheduleTableCells(primaryTsv)
        const primaryEntries = parseScheduleTableTsv(primaryTsv)
        let parsed: ScheduleEntry[]

        if (tableCells.length > 0) {
          pass = 'cells'
          cellCount = tableCells.length * 3
          const primaryByCell = new Map(primaryEntries.map((entry) => [`${entry.day}:${entry.time}`, entry]))
          const rawTextByCell = new Map<string, string>()
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })
          parsed = []

          for (const cell of tableCells) {
            if (ocrRunRef.current !== runId) return
            const detailRectangle = scaleRectangle(cell.rectangle, detailRatio)
            const { data: cellData } = await worker.recognize(detailImage, { rectangle: detailRectangle }, { text: true })
            const detail = parseScheduleCellText(cellData.text)
            rawTextByCell.set(`${cell.day}:${cell.time}`, cellData.text)
            const fallback = primaryByCell.get(`${cell.day}:${cell.time}`)
            parsed.push({
              id: makeScheduleEntryId(),
              day: cell.day,
              time: cell.time,
              subject: detail.subject || fallback?.subject || '',
              room: detail.room || fallback?.room || '',
            })
            cellProgress += 1
          }

          const unresolvedCells = parsed.filter((entry) => !entry.subject)
          await worker.setParameters({
            tessedit_pageseg_mode: PSM.SPARSE_TEXT,
            tessedit_char_whitelist: '',
          })

          for (const entry of unresolvedCells) {
            if (ocrRunRef.current !== runId) return
            const sourceCell = tableCells.find((cell) => cell.day === entry.day && cell.time === entry.time)
            if (!sourceCell) continue
            const detailRectangle = scaleRectangle(sourceCell.rectangle, detailRatio)
            const { data: retryData } = await worker.recognize(detailImage, { rectangle: detailRectangle }, { text: true })
            const retry = parseScheduleCellText(retryData.text)
            if (retry.subject) entry.subject = retry.subject
            if (retry.room) entry.room = retry.room
            const cellKey = `${entry.day}:${entry.time}`
            rawTextByCell.set(cellKey, `${rawTextByCell.get(cellKey) ?? ''}\n${retryData.text}`)
            cellProgress += 1
          }

          const occupiedCells = parsed.filter((entry) => entry.subject)
          await worker.setParameters({
            tessedit_pageseg_mode: PSM.SPARSE_TEXT,
            tessedit_char_whitelist: '0123456789',
          })

          for (const entry of occupiedCells) {
            if (ocrRunRef.current !== runId) return
            const sourceCell = tableCells.find((cell) => cell.day === entry.day && cell.time === entry.time)
            if (!sourceCell) continue
            const detailRectangle = scaleRectangle(sourceCell.rectangle, detailRatio)
            const lowerHalf = {
              ...detailRectangle,
              top: Math.round(detailRectangle.top + detailRectangle.height * 0.44),
              height: Math.max(1, Math.round(detailRectangle.height * 0.56)),
            }
            const { data: roomData } = await worker.recognize(detailImage, { rectangle: lowerHalf }, { text: true })
            const room = parseScheduleRoomDigits(roomData.text)
            if (room) entry.room = room
            cellProgress += 1
          }

          const roomVotes = new Map<string, Map<string, number>>()
          for (const entry of parsed) {
            const teacherKey = getScheduleTeacherKey(rawTextByCell.get(`${entry.day}:${entry.time}`) ?? '')
            if (!teacherKey || !entry.room || entry.room.includes('/')) continue
            const votes = roomVotes.get(teacherKey) ?? new Map<string, number>()
            votes.set(entry.room, (votes.get(entry.room) ?? 0) + 1)
            roomVotes.set(teacherKey, votes)
          }

          for (const entry of parsed) {
            const teacherKey = getScheduleTeacherKey(rawTextByCell.get(`${entry.day}:${entry.time}`) ?? '')
            const votes = teacherKey ? roomVotes.get(teacherKey) : undefined
            if (!votes) continue
            const inferredRoom = [...votes].sort((left, right) => right[1] - left[1])[0]?.[0]
            if (inferredRoom) entry.room = inferredRoom
          }

          const roomFrequency = new Map<string, number>()
          for (const { room } of parsed) {
            if (/^\d{3}$/.test(room)) roomFrequency.set(room, (roomFrequency.get(room) ?? 0) + 1)
          }
          for (const entry of parsed) {
            if (!/^[7-9]\d{2}$/.test(entry.room)) continue
            const suffix = entry.room.slice(1)
            const candidate = [...roomFrequency]
              .filter(([room]) => /^[1-6]\d{2}$/.test(room) && room.endsWith(suffix))
              .sort((left, right) => right[1] - left[1])[0]?.[0]
            if (candidate) entry.room = candidate
          }

          const stableRoomSubjects = new Set(['Русский язык', 'Литература', 'История', 'Физика', 'Алгебра', 'Геометрия', 'География', 'Биология'])
          const subjectRooms = new Map<string, Set<string>>()
          for (const entry of parsed) {
            if (!stableRoomSubjects.has(entry.subject) || !entry.room || entry.room.includes('/')) continue
            const rooms = subjectRooms.get(entry.subject) ?? new Set<string>()
            rooms.add(entry.room)
            subjectRooms.set(entry.subject, rooms)
          }
          for (const entry of parsed) {
            const rooms = subjectRooms.get(entry.subject)
            if (!entry.room && rooms?.size === 1) entry.room = [...rooms][0]
            if (!entry.room && entry.subject === 'Физкультура') entry.room = 'Спортзал'
          }
        } else {
          parsed = parseScheduleText(data.text)
        }

        setOcrRawText(data.text.trim())

        if (parsed.every((entry) => !entry.subject.trim())) {
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

  const updateOcrTime = (time: string, edge: 'start' | 'end', value: string) => {
    const currentRange = splitLessonTimeRange(time)
    const next = normalizeLessonTimeRange(`${edge === 'start' ? value : currentRange.start}-${edge === 'end' ? value : currentRange.end}`)
    setOcrRows((current) => current.map((entry) => entry.time === time ? { ...entry, time: next } : entry))
  }

  const addOcrTimeSlot = () => {
    const times = sortTimes(ocrRows.map(({ time }) => time))
    const next = nextLessonTime(times)
    const activeDays = weekdays.filter((day) => ocrRows.some((entry) => entry.day === day.id))
    const days = activeDays.length > 0 ? activeDays : weekdays.slice(0, 5)
    setOcrRows((current) => [
      ...current,
      ...days.map((day) => ({ id: makeScheduleEntryId(), day: day.id, time: next, subject: '', room: '' })),
    ])
  }

  const applyOcrRows = () => {
    const scannedDays = new Set(ocrRows.map(({ day }) => day))
    const scannedTimes = sortTimes(ocrRows.map(({ time }) => time))
    setEntries((current) => [
      ...current.filter((entry) => !scannedDays.has(entry.day)),
      ...ocrRows.filter((entry) => entry.subject.trim()).map((entry) => ({ ...entry, subject: entry.subject.trim(), room: entry.room.trim() })),
    ])
    if (scannedTimes.length > 0) setTimeSlots(scannedTimes.slice(0, MAX_TIME_SLOTS))
    setImportRevision((current) => current + 1)
    closeOcr()
  }

  const ocrTimes = sortTimes(ocrRows.map(({ time }) => time))
  const ocrDays = weekdays.filter((day) => ocrRows.some((entry) => entry.day === day.id))
  const ocrEntriesByCell = new Map(ocrRows.map((entry) => [`${entry.day}:${entry.time}`, entry]))
  const recognizedLessonCount = ocrRows.filter((entry) => entry.subject.trim()).length

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
            <h2 id="schedule-title">Расписание</h2>
            <span>{grade} класс</span>
          </div>
          <p>
            <span className="schedule-desktop-hint">Вся неделя перед глазами. Нажми на ячейку, чтобы изменить урок.</span>
            <span className="schedule-mobile-hint">Выбери день и редактируй уроки без горизонтальной прокрутки.</span>
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

      <section className="schedule-workspace" aria-labelledby="schedule-editor-title">
        <header className="schedule-toolbar">
          <div className={`schedule-save-state${saveState === 'error' ? ' is-error' : ''}`}>
            {saveState === 'loading' || saveState === 'saving'
              ? <SpinnerGap className="schedule-save-spinner" size={16} weight="bold" aria-hidden="true" />
              : saveState === 'error'
                ? <WarningCircle size={16} weight="fill" aria-hidden="true" />
                : <Check size={16} weight="bold" aria-hidden="true" />}
            <span id="schedule-editor-title">
              {saveState === 'loading' ? 'Загружаем расписание из аккаунта' : saveState === 'saving' ? 'Сохраняем в аккаунте' : saveState === 'saved' ? 'Сохранено в аккаунте' : saveState === 'error' ? 'Не получилось сохранить в аккаунте' : 'Сохраняется в этом браузере'}
            </span>
          </div>
          <span className="schedule-toolbar-meta">{timeSlots.length} уроков · {weekdays.length} дней</span>
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
            <motion.tbody
              key={importRevision}
              initial={importRevision > 0 && !reduceMotion ? { opacity: 0.72 } : false}
              animate={{ opacity: 1 }}
              transition={{ duration: reduceMotion ? 0 : 0.28 }}
            >
              {timeSlots.map((time, rowIndex) => (
                <tr key={time}>
                  <th scope="row">
                    <span>{String(rowIndex + 1).padStart(2, '0')}</span>
                    <div className="schedule-time-range" aria-label={`Время урока ${rowIndex + 1}: ${displayLessonTime(time)}`}>
                      <input type="time" value={splitLessonTimeRange(time).start} aria-label={`Начало урока ${rowIndex + 1} в недельной таблице`} onChange={(event) => updateTimeSlot(rowIndex, 'start', event.target.value)} />
                      <i aria-hidden="true" />
                      <input type="time" value={splitLessonTimeRange(time).end} aria-label={`Конец урока ${rowIndex + 1} в недельной таблице`} onChange={(event) => updateTimeSlot(rowIndex, 'end', event.target.value)} />
                    </div>
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
            {weekdays.map((day) => (
              <button
                type="button"
                role="tab"
                id={`schedule-day-${day.id}`}
                aria-controls="schedule-day-panel"
                aria-selected={activeDay === day.id}
                className={activeDay === day.id ? 'is-active' : ''}
                key={day.id}
                onClick={() => setActiveDay(day.id)}
                onKeyDown={(event) => {
                  const currentIndex = weekdays.findIndex(({ id }) => id === day.id)
                  const nextIndex = event.key === 'ArrowRight'
                    ? (currentIndex + 1) % weekdays.length
                    : event.key === 'ArrowLeft'
                      ? (currentIndex + weekdays.length - 1) % weekdays.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? weekdays.length - 1
                          : null

                  if (nextIndex === null) return
                  event.preventDefault()
                  const nextDay = weekdays[nextIndex]!
                  setActiveDay(nextDay.id)
                  document.getElementById(`schedule-day-${nextDay.id}`)?.focus()
                }}
                tabIndex={activeDay === day.id ? 0 : -1}
              >
                <span>{day.short}</span>
                <strong>{day.label}</strong>
              </button>
            ))}
          </div>

          <div
            className="schedule-day-panel"
            id="schedule-day-panel"
            role="tabpanel"
            aria-labelledby={`schedule-day-${activeDay}`}
          >
            {timeSlots.map((time, rowIndex) => {
              const day = weekdays.find(({ id }) => id === activeDay) ?? weekdays[0]
              const entry = entriesByCell.get(`${activeDay}:${time}`)
              const hasContent = Boolean(entry?.subject.trim() || entry?.room.trim())
              return (
                <div className="schedule-mobile-lesson" key={time}>
                  <div className="schedule-mobile-time">
                    <span>{String(rowIndex + 1).padStart(2, '0')}</span>
                    <div className="schedule-time-range" aria-label={`Время урока ${rowIndex + 1}: ${displayLessonTime(time)}`}>
                      <input type="time" value={splitLessonTimeRange(time).start} aria-label={`Начало урока ${rowIndex + 1}`} onChange={(event) => updateTimeSlot(rowIndex, 'start', event.target.value)} />
                      <i aria-hidden="true" />
                      <input type="time" value={splitLessonTimeRange(time).end} aria-label={`Конец урока ${rowIndex + 1}`} onChange={(event) => updateTimeSlot(rowIndex, 'end', event.target.value)} />
                    </div>
                  </div>
                  <div className={`schedule-cell-editor${hasContent ? ' has-content' : ''}`}>
                    <label>
                      <span className="sr-only">Предмет, {day.label.toLocaleLowerCase('ru-RU')}, урок {rowIndex + 1}</span>
                      <input
                        value={entry?.subject ?? ''}
                        maxLength={50}
                        placeholder="Предмет"
                        aria-label={`Предмет, ${day.label.toLocaleLowerCase('ru-RU')}, урок ${rowIndex + 1}`}
                        onChange={(event) => updateCell(activeDay, time, 'subject', event.target.value)}
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
                          onChange={(event) => updateCell(activeDay, time, 'room', event.target.value)}
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
                <p>Первый запуск может занять чуть дольше: загружается русская OCR-модель.</p>
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
                  <p className="schedule-ocr-review-intro">Нашли {recognizedLessonCount} {lessonWord(recognizedLessonCount)}. Пустые ячейки можно заполнить вручную.</p>
                  <div className="schedule-ocr-grid-scroll" tabIndex={0} aria-label="Проверка распознанного расписания">
                    <table className="schedule-ocr-grid">
                      <thead>
                        <tr>
                          <th scope="col">Время</th>
                          {ocrDays.map((day) => <th scope="col" key={day.id}>{day.label}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {ocrTimes.map((time, rowIndex) => (
                          <tr key={time}>
                            <th scope="row">
                              <span>{String(rowIndex + 1).padStart(2, '0')}</span>
                              <div className="schedule-time-range">
                                <input type="time" value={splitLessonTimeRange(time).start} aria-label={`Начало распознанного урока ${rowIndex + 1}`} onChange={(event) => updateOcrTime(time, 'start', event.target.value)} />
                                <i aria-hidden="true" />
                                <input type="time" value={splitLessonTimeRange(time).end} aria-label={`Конец распознанного урока ${rowIndex + 1}`} onChange={(event) => updateOcrTime(time, 'end', event.target.value)} />
                              </div>
                            </th>
                            {ocrDays.map((day) => {
                              const entry = ocrEntriesByCell.get(`${day.id}:${time}`)
                              if (!entry) return <td key={day.id} />
                              return (
                                <td key={day.id}>
                                  <label>
                                    <span className="sr-only">Предмет, {day.label.toLocaleLowerCase('ru-RU')}, строка {rowIndex + 1}</span>
                                    <input value={entry.subject} placeholder="Предмет" aria-label={`Распознанный предмет, ${day.label.toLocaleLowerCase('ru-RU')}, урок ${rowIndex + 1}`} onChange={(event) => updateOcrRow(entry.id, 'subject', event.target.value)} />
                                  </label>
                                  <label>
                                    <span className="sr-only">Кабинет, {day.label.toLocaleLowerCase('ru-RU')}, строка {rowIndex + 1}</span>
                                    <input value={entry.room} placeholder={entry.subject ? 'Кабинет' : ''} aria-label={`Распознанный кабинет, ${day.label.toLocaleLowerCase('ru-RU')}, урок ${rowIndex + 1}`} onChange={(event) => updateOcrRow(entry.id, 'room', event.target.value)} />
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
                  <button type="button" disabled={ocrRows.every((entry) => !entry.subject.trim())} onClick={applyOcrRows}>
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
