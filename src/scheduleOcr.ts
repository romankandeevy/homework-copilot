export type WeekdayId = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'

export type ScheduleEntry = {
  id: string
  day: WeekdayId
  time: string
  subject: string
  room: string
}

export type ScheduleTableCell = {
  day: WeekdayId
  time: string
  rectangle: { left: number; top: number; width: number; height: number }
}

export const defaultLessonTimes = [
  '08:30-09:15',
  '09:25-10:10',
  '10:30-11:15',
  '11:35-12:20',
  '12:30-13:15',
  '13:25-14:10',
  '14:20-15:05',
]

const dayPatterns: ReadonlyArray<{ id: WeekdayId; pattern: RegExp }> = [
  { id: 'monday', pattern: /понедельник|\bпн\b/i },
  { id: 'tuesday', pattern: /вторник|\bвт\b/i },
  { id: 'wednesday', pattern: /среда|\bср\b/i },
  { id: 'thursday', pattern: /четверг|\bчт\b/i },
  { id: 'friday', pattern: /пятница|\bпт\b/i },
  { id: 'saturday', pattern: /суббота|\bсб\b/i },
]

const subjects: ReadonlyArray<{ label: string; aliases: readonly string[] }> = [
  { label: 'Русский язык', aliases: ['русский язык', 'русский'] },
  { label: 'Английский язык', aliases: ['английский язык', 'английский', 'англ.яз', 'англ яз'] },
  { label: 'Обществознание', aliases: ['обществознание', 'общество'] },
  { label: 'Информатика', aliases: ['информатика', 'программирование'] },
  { label: 'Физкультура', aliases: ['физкультура', 'физическая культура'] },
  { label: 'Литература', aliases: ['литература'] },
  { label: 'География', aliases: ['география'] },
  { label: 'Геометрия', aliases: ['геометрия'] },
  { label: 'Биология', aliases: ['биология'] },
  { label: 'Алгебра', aliases: ['алгебра', 'алгеб'] },
  { label: 'История', aliases: ['история'] },
  { label: 'Физика', aliases: ['физика'] },
  { label: 'Химия', aliases: ['химия'] },
  { label: 'Технология', aliases: ['технология', 'труд'] },
  { label: 'Музыка', aliases: ['музыка'] },
  { label: 'ИЗО', aliases: ['изо', 'рисование'] },
  { label: 'ОБЖ', aliases: ['обж'] },
  { label: 'Вероятность и статистика', aliases: ['вероятность и статистика', 'вероятность', 'статистика'] },
]

type OcrWord = {
  x: number
  y: number
  width: number
  height: number
  confidence: number
  text: string
}

const tableWeekdays: readonly WeekdayId[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

const weekdayAliases: Record<WeekdayId, readonly string[]> = {
  monday: ['понедельник'],
  tuesday: ['вторник'],
  wednesday: ['среда'],
  thursday: ['четверг'],
  friday: ['пятница'],
  saturday: ['суббота'],
}

export function makeScheduleEntryId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `lesson-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function normalizeLine(value: string) {
  return value
    .replace(/[|¦]/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeOcrValue(value: string) {
  const latinToCyrillic: Record<string, string> = {
    a: 'а',
    b: 'в',
    c: 'с',
    e: 'е',
    h: 'н',
    k: 'к',
    m: 'м',
    n: 'л',
    o: 'о',
    p: 'р',
    r: 'г',
    t: 'т',
    x: 'х',
    y: 'у',
    6: 'б',
  }

  return Array.from(value.toLocaleLowerCase('ru-RU'))
    .map((character) => latinToCyrillic[character] ?? character)
    .join('')
    .replace(/[^а-яё0-9]/g, '')
}

function editDistance(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index)

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let previous = row[0]
    row[0] = leftIndex
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const current = row[rightIndex]
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        previous + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
      previous = current
    }
  }

  return row[right.length]
}

function findCanonicalSubject(value: string) {
  const lower = value.toLocaleLowerCase('ru-RU')
  return subjects.find(({ aliases }) => aliases.some((alias) => lower.includes(alias)))?.label
}

function findCanonicalSubjects(value: string) {
  const normalizedValue = normalizeOcrValue(value)
  const normalizedTokens = value
    .split(/\s+/)
    .map(normalizeOcrValue)
    .filter((token) => token.length >= 4)
  const found: string[] = []

  for (const subject of subjects) {
    const aliases = subject.aliases.map(normalizeOcrValue)
    const exact = aliases.some((alias) => normalizedValue.includes(alias))
    const fuzzy = aliases.some((alias) => normalizedTokens.some((token) => {
      const distance = editDistance(token, alias)
      return distance <= Math.max(1, Math.floor(Math.max(token.length, alias.length) * 0.3))
    }))

    if ((exact || fuzzy) && !found.includes(subject.label)) found.push(subject.label)
  }

  return found
}

function parseTsvWords(tsv: string) {
  return tsv
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split('\t'))
    .filter((columns) => columns.length >= 12 && columns.slice(11).join(' ').trim())
    .map<OcrWord>((columns) => ({
      x: Number(columns[6]),
      y: Number(columns[7]),
      width: Number(columns[8]),
      height: Number(columns[9]),
      confidence: Number(columns[10]),
      text: columns.slice(11).join(' ').trim(),
    }))
    .filter((word) => Number.isFinite(word.x) && Number.isFinite(word.y))
}

function wordCenterX(word: OcrWord) {
  return word.x + word.width / 2
}

function wordCenterY(word: OcrWord) {
  return word.y + word.height / 2
}

function parseTime(value: string) {
  const match = value.match(/([0-2]?\d)[:.]([0-5]\d)/)
  if (!match || Number(match[1]) > 23) return ''
  return `${match[1].padStart(2, '0')}:${match[2]}`
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function addMinutes(value: string, amount: number) {
  const total = Math.min(timeToMinutes(value) + amount, 23 * 60 + 59)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function lessonRangeFromTimes(times: string[], rowIndex: number) {
  const start = times[0]
  const end = times.find((time, index) => index > 0 && timeToMinutes(time) > timeToMinutes(start))
  if (start && end) return `${start}-${end}`
  const knownRange = start && defaultLessonTimes.find((range) => range.startsWith(`${start}-`))
  if (knownRange) return knownRange
  if (start) return `${start}-${addMinutes(start, 45)}`
  return defaultLessonTimes[rowIndex] ?? ''
}

export function normalizeLessonTimeRange(value: string, fallbackIndex = 0) {
  const times = Array.from(value.matchAll(/([0-2]?\d)[:.]([0-5]\d)/g), (match) => {
    const hours = Number(match[1])
    return hours <= 23 ? `${String(hours).padStart(2, '0')}:${match[2]}` : ''
  }).filter(Boolean)
  return lessonRangeFromTimes(times, fallbackIndex)
}

export function splitLessonTimeRange(value: string) {
  const normalized = normalizeLessonTimeRange(value)
  const [start, end] = normalized.split('-')
  return { start, end }
}

function extractRooms(value: string) {
  const rooms = Array.from(value.matchAll(/(?:^|\D)([1-9]\d{2}[а-яa-z]?)(?=\D|$)/giu), (match) => match[1])
  if (/сп\.?\s*зал|спортзал/i.test(value)) rooms.push('Спортзал')
  return Array.from(new Set(rooms)).slice(0, 2).join(' / ')
}

function estimateColumnCenters(foundCenters: Map<number, number>, count: number) {
  const points = Array.from(foundCenters, ([index, center]) => ({ index, center }))
  const meanIndex = points.reduce((sum, point) => sum + point.index, 0) / points.length
  const meanCenter = points.reduce((sum, point) => sum + point.center, 0) / points.length
  const denominator = points.reduce((sum, point) => sum + (point.index - meanIndex) ** 2, 0)
  const step = denominator > 0
    ? points.reduce((sum, point) => sum + (point.index - meanIndex) * (point.center - meanCenter), 0) / denominator
    : 160
  const origin = meanCenter - step * meanIndex
  return Array.from({ length: count }, (_, index) => foundCenters.get(index) ?? origin + step * index)
}

function median(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function getScheduleTableGeometry(tsv: string) {
  const words = parseTsvWords(tsv)
  const foundCenters = new Map<number, number>()
  const headerWords: OcrWord[] = []

  for (const word of words) {
    const normalized = normalizeOcrValue(word.text)
    const weekdayIndex = tableWeekdays.findIndex((day) => weekdayAliases[day].some((alias) => normalized.includes(normalizeOcrValue(alias))))
    if (weekdayIndex >= 0 && !foundCenters.has(weekdayIndex)) {
      foundCenters.set(weekdayIndex, wordCenterX(word))
      headerWords.push(word)
    }
  }

  if (foundCenters.size < 3 || headerWords.length < 3) return null

  const lastFoundIndex = Math.max(...foundCenters.keys())
  const dayCount = Math.min(tableWeekdays.length, Math.max(5, lastFoundIndex + 1))
  const columnCenters = estimateColumnCenters(foundCenters, dayCount)
  const columnSteps = columnCenters.slice(1).map((center, index) => center - columnCenters[index])
  const averageStep = median(columnSteps) || 160
  const columnBounds = columnCenters.map((center, index) => ({
    left: index === 0 ? center - averageStep / 2 : (columnCenters[index - 1] + center) / 2,
    right: index === columnCenters.length - 1 ? center + averageStep / 2 : (center + columnCenters[index + 1]) / 2,
  }))
  const headerCenterY = headerWords.reduce((sum, word) => sum + wordCenterY(word), 0) / headerWords.length
  const groupThreshold = Math.max(8, median(words.map(({ height }) => height).filter((height) => height > 0)) * 0.9)
  const timeCandidates = words
    .map((word) => ({ word, time: parseTime(word.text) }))
    .filter(({ word, time }) => time && wordCenterX(word) < columnBounds[0].left && wordCenterY(word) > headerCenterY + groupThreshold)
    .sort((left, right) => wordCenterY(left.word) - wordCenterY(right.word) || left.word.x - right.word.x)
  const timeGroups: Array<Array<{ word: OcrWord; time: string }>> = []

  for (const candidate of timeCandidates) {
    const lastGroup = timeGroups.at(-1)
    const lastCenter = lastGroup
      ? lastGroup.reduce((sum, item) => sum + wordCenterY(item.word), 0) / lastGroup.length
      : undefined
    if (!lastGroup || lastCenter === undefined || Math.abs(wordCenterY(candidate.word) - lastCenter) > groupThreshold) timeGroups.push([candidate])
    else lastGroup.push(candidate)
  }

  const rows = timeGroups
    .map((group, rowIndex) => {
      const times = [...group].sort((left, right) => left.word.x - right.word.x).map(({ time }) => time)
      return {
        centerY: group.reduce((sum, item) => sum + wordCenterY(item.word), 0) / group.length,
        time: lessonRangeFromTimes(times, rowIndex),
      }
    })
    .filter((row) => row.time)
    .slice(0, 12)

  if (rows.length < 2) return null

  const averageRowStep = median(rows.slice(1).map((row, index) => row.centerY - rows[index].centerY)) || 48
  // Копия, а не правка на месте: rows и rowBounds не должны стать одним объектом.
  // eslint-disable-next-line no-map-spread
  const rowBounds = rows.map((row, rowIndex) => ({
    ...row,
    top: rowIndex === 0 ? row.centerY - averageRowStep / 2 : (rows[rowIndex - 1].centerY + row.centerY) / 2,
    bottom: rowIndex === rows.length - 1 ? row.centerY + averageRowStep / 2 : (row.centerY + rows[rowIndex + 1].centerY) / 2,
  }))

  return { words, columnBounds, rowBounds }
}

export function getScheduleTableCells(tsv: string): ScheduleTableCell[] {
  const geometry = getScheduleTableGeometry(tsv)
  if (!geometry) return []

  return geometry.rowBounds.flatMap((row) => geometry.columnBounds.map((column, dayIndex) => {
    const inset = Math.max(2, Math.round(Math.min(column.right - column.left, row.bottom - row.top) * 0.07))
    return {
      day: tableWeekdays[dayIndex],
      time: row.time,
      rectangle: {
        left: Math.max(0, Math.round(column.left + inset)),
        top: Math.max(0, Math.round(row.top + inset)),
        width: Math.max(1, Math.round(column.right - column.left - inset * 2)),
        height: Math.max(1, Math.round(row.bottom - row.top - inset * 2)),
      },
    }
  }))
}

export function parseScheduleCellText(value: string) {
  const recognizedSubjects = findCanonicalSubjects(value)
  return {
    subject: recognizedSubjects.join(' / '),
    room: extractRooms(value),
  }
}

export function parseScheduleRoomDigits(value: string) {
  const rooms = (value.match(/\d+/g) ?? [])
    .map((digits) => digits.slice(-3))
    .filter((room) => room.length === 3 && Number(room) >= 100)
  return Array.from(new Set(rooms)).slice(-2).join(' / ')
}

export function getScheduleTeacherKey(value: string) {
  const match = value.match(/([А-ЯЁA-Z][А-ЯЁа-яёA-Za-z]{3,})\s+([А-ЯЁA-Z])[.\s]*([А-ЯЁA-Z])?\.?/u)
  if (!match) return ''
  const surname = normalizeOcrValue(match[1])
  const initial = normalizeOcrValue(match[2])
  return `${surname.slice(0, 4)}${initial}`
}

export function parseScheduleTableTsv(primaryTsv: string, fallbackTsv = ''): ScheduleEntry[] {
  const geometry = getScheduleTableGeometry(primaryTsv)
  if (!geometry) return []

  const primaryWords = geometry.words
  const fallbackWords = fallbackTsv ? parseTsvWords(fallbackTsv) : []
  const allWords = [...primaryWords, ...fallbackWords]
  const entries: ScheduleEntry[] = []

  geometry.rowBounds.forEach((row) => {
    geometry.columnBounds.forEach((column, dayIndex) => {
      const cellWords = allWords
        .filter((word) => {
          const centerX = wordCenterX(word)
          const centerY = wordCenterY(word)
          return centerX > column.left && centerX < column.right && centerY > row.top && centerY < row.bottom
        })
        .sort((left, right) => left.y - right.y || left.x - right.x)
      const cellText = cellWords.map((word) => word.text).join(' ')
      const parsed = parseScheduleCellText(cellText)
      if (!parsed.subject) return

      entries.push({
        id: makeScheduleEntryId(),
        day: tableWeekdays[dayIndex],
        time: row.time,
        subject: parsed.subject,
        room: parsed.room,
      })
    })
  })

  return entries
}

export function parseScheduleText(rawText: string): ScheduleEntry[] {
  const lines = rawText.split(/\r?\n/).map(normalizeLine).filter(Boolean)
  const entries: ScheduleEntry[] = []
  const lessonCounts: Record<WeekdayId, number> = {
    monday: 0,
    tuesday: 0,
    wednesday: 0,
    thursday: 0,
    friday: 0,
    saturday: 0,
  }
  let activeDay: WeekdayId = 'monday'

  for (const sourceLine of lines) {
    let line = sourceLine
    const matchedDay = dayPatterns.find(({ pattern }) => pattern.test(line))

    if (matchedDay) {
      activeDay = matchedDay.id
      line = normalizeLine(line.replace(matchedDay.pattern, ''))
      if (!line) continue
    }

    const timeMatch = line.match(/(?:^|\s)([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*[-]\s*(?:[01]?\d|2[0-3])[:.]([0-5]\d))?(?=\s|$)/)
    const explicitRoomMatch = line.match(/(?:каб(?:инет)?|ауд(?:итория)?|класс)\s*[№#:]?\s*([\p{L}\d-]{1,12})/iu)

    let room = explicitRoomMatch?.[1] ?? ''
    let subjectText = line
      .replace(/^\s*\d{1,2}\s*[).:-]\s*/, '')
      .replace(/(?:^|\s)([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*[-]\s*(?:[01]?\d|2[0-3])[:.]([0-5]\d))?(?=\s|$)/, ' ')
      .replace(/(?:каб(?:инет)?|ауд(?:итория)?|класс)\s*[№#:]?\s*[\p{L}\d-]{1,12}/iu, ' ')

    if (!room) {
      const trailingRoomMatch = subjectText.match(/\s(?:№\s*)?((?:\d{2,4}[\p{L}]?)|спортзал|зал)\s*$/iu)
      if (trailingRoomMatch) {
        room = trailingRoomMatch[1]
        subjectText = subjectText.slice(0, trailingRoomMatch.index).trim()
      }
    }

    subjectText = normalizeLine(subjectText.replace(/^[,;:.-]+|[,;:.-]+$/g, ''))
    const canonicalSubject = findCanonicalSubject(subjectText)
    const subject = canonicalSubject ?? subjectText
    const hasUsefulStructure = Boolean(timeMatch || explicitRoomMatch || canonicalSubject)
    const looksLikeHeading = /^(день|время|предмет|урок|кабинет|расписание)$/i.test(subject)

    if (!hasUsefulStructure || subject.length < 2 || looksLikeHeading) continue

    const lessonIndex = lessonCounts[activeDay]
    const time = timeMatch ? normalizeLessonTimeRange(timeMatch[0], lessonIndex) : defaultLessonTimes[lessonIndex] ?? ''
    entries.push({ id: makeScheduleEntryId(), day: activeDay, time, subject, room })
    lessonCounts[activeDay] += 1
  }

  if (entries.length > 0) return entries

  const normalizedText = normalizeLine(rawText).toLocaleLowerCase('ru-RU')
  for (const subject of subjects) {
    if (subject.aliases.some((alias) => normalizedText.includes(alias))) {
      const lessonIndex = lessonCounts.monday
      entries.push({ id: makeScheduleEntryId(), day: 'monday', time: defaultLessonTimes[lessonIndex] ?? '', subject: subject.label, room: '' })
      lessonCounts.monday += 1
    }
  }

  return entries
}
