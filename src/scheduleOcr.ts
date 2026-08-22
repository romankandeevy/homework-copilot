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
  { label: 'Информатика', aliases: ['информатика'] },
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

function findCanonicalSubject(value: string) {
  const lower = value.toLocaleLowerCase('ru-RU')
  return subjects.find(({ aliases }) => aliases.some((alias) => lower.includes(alias)))?.label
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
