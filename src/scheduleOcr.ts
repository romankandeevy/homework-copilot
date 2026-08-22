export type WeekdayId = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'

export type ScheduleEntry = {
  id: string
  day: WeekdayId
  time: string
  subject: string
  room: string
}

export const defaultLessonTimes = ['08:30', '09:25', '10:20', '11:20', '12:15', '13:10', '14:05', '15:00']

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
  { label: 'Английский язык', aliases: ['английский язык', 'английский'] },
  { label: 'Обществознание', aliases: ['обществознание', 'общество'] },
  { label: 'Информатика', aliases: ['информатика', 'программирование'] },
  { label: 'Физкультура', aliases: ['физкультура', 'физическая культура'] },
  { label: 'Литература', aliases: ['литература'] },
  { label: 'География', aliases: ['география'] },
  { label: 'Геометрия', aliases: ['геометрия'] },
  { label: 'Биология', aliases: ['биология'] },
  { label: 'Алгебра', aliases: ['алгебра'] },
  { label: 'История', aliases: ['история'] },
  { label: 'Физика', aliases: ['физика'] },
  { label: 'Химия', aliases: ['химия'] },
  { label: 'Технология', aliases: ['технология', 'труд'] },
  { label: 'Музыка', aliases: ['музыка'] },
  { label: 'ИЗО', aliases: ['изо', 'рисование'] },
  { label: 'ОБЖ', aliases: ['обж'] },
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
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : ''
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

export function parseScheduleTableTsv(primaryTsv: string, fallbackTsv = ''): ScheduleEntry[] {
  const primaryWords = parseTsvWords(primaryTsv)
  const fallbackWords = fallbackTsv ? parseTsvWords(fallbackTsv) : []
  const foundCenters = new Map<number, number>()
  const headerWords: OcrWord[] = []

  for (const word of primaryWords) {
    const normalized = normalizeOcrValue(word.text)
    const weekdayIndex = tableWeekdays.findIndex((day) => weekdayAliases[day].some((alias) => normalized.includes(normalizeOcrValue(alias))))
    if (weekdayIndex >= 0 && !foundCenters.has(weekdayIndex)) {
      foundCenters.set(weekdayIndex, wordCenterX(word))
      headerWords.push(word)
    }
  }

  if (foundCenters.size < 3 || headerWords.length < 3) return []

  const lastFoundIndex = Math.max(...foundCenters.keys())
  const dayCount = Math.max(5, lastFoundIndex + 1)
  const columnCenters = estimateColumnCenters(foundCenters, dayCount)
  const averageStep = columnCenters.slice(1).reduce((sum, center, index) => sum + center - columnCenters[index], 0) / Math.max(1, columnCenters.length - 1)
  const columnBounds = columnCenters.map((center, index) => ({
    left: index === 0 ? center - averageStep / 2 : (columnCenters[index - 1] + center) / 2,
    right: index === columnCenters.length - 1 ? center + averageStep / 2 : (center + columnCenters[index + 1]) / 2,
  }))
  const headerCenterY = headerWords.reduce((sum, word) => sum + wordCenterY(word), 0) / headerWords.length

  const timeCandidates = primaryWords
    .map((word) => ({ word, time: parseTime(word.text) }))
    .filter(({ word, time }) => time && wordCenterX(word) < columnBounds[0].left && wordCenterY(word) > headerCenterY + 8)
    .sort((left, right) => wordCenterY(left.word) - wordCenterY(right.word) || left.word.x - right.word.x)

  const timeGroups: Array<Array<{ word: OcrWord; time: string }>> = []
  for (const candidate of timeCandidates) {
    const lastGroup = timeGroups.at(-1)
    const lastCenter = lastGroup
      ? lastGroup.reduce((sum, item) => sum + wordCenterY(item.word), 0) / lastGroup.length
      : undefined
    if (!lastGroup || lastCenter === undefined || Math.abs(wordCenterY(candidate.word) - lastCenter) > 8) timeGroups.push([candidate])
    else lastGroup.push(candidate)
  }

  const rows = timeGroups
    .map((group) => {
      const sorted = [...group].sort((left, right) => left.word.x - right.word.x)
      return {
        centerY: group.reduce((sum, item) => sum + wordCenterY(item.word), 0) / group.length,
        time: sorted[0]?.time ?? '',
      }
    })
    .filter((row) => row.time)
    .slice(0, 12)

  if (rows.length < 2) return []

  const averageRowStep = rows.slice(1).reduce((sum, row, index) => sum + row.centerY - rows[index].centerY, 0) / Math.max(1, rows.length - 1)
  const allWords = [...primaryWords, ...fallbackWords]
  const entries: ScheduleEntry[] = []

  rows.forEach((row, rowIndex) => {
    const top = rowIndex === 0 ? row.centerY - averageRowStep / 2 : (rows[rowIndex - 1].centerY + row.centerY) / 2
    const bottom = rowIndex === rows.length - 1 ? row.centerY + averageRowStep / 2 : (row.centerY + rows[rowIndex + 1].centerY) / 2

    columnBounds.forEach((column, dayIndex) => {
      const cellWords = allWords
        .filter((word) => {
          const centerX = wordCenterX(word)
          const centerY = wordCenterY(word)
          return centerX > column.left && centerX < column.right && centerY > top && centerY < bottom
        })
        .sort((left, right) => left.y - right.y || left.x - right.x)
      const cellText = cellWords.map((word) => word.text).join(' ')
      const recognizedSubjects = findCanonicalSubjects(cellText)

      if (recognizedSubjects.length === 0) return

      entries.push({
        id: makeScheduleEntryId(),
        day: tableWeekdays[dayIndex],
        time: row.time,
        subject: recognizedSubjects.join(' / '),
        room: extractRooms(cellText),
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
    const time = timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : defaultLessonTimes[lessonIndex] ?? ''
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
