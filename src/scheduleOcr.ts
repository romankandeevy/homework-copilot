import { solvableSubjects } from './lib/subjects'

/* Расписание: модель данных, разбор распознанного текста и подготовка снимка.

   Всё здесь работает в браузере ученика. Фотография расписания на сервер не
   уходит - так записано в политике данных (src/LegalPage.tsx): tesseract.js
   читает снимок локально, из сети грузятся только языковые данные. */

export type WeekdayId = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'

export type ScheduleEntry = {
  id: string
  day: WeekdayId
  time: string
  subject: string
  room: string
}

export type ScheduleRectangle = { left: number; top: number; width: number; height: number }

export type ScheduleTableCell = {
  day: WeekdayId
  time: string
  rectangle: ScheduleRectangle
}

/** Линии таблицы, найденные на снимке: координаты по вертикали и горизонтали. */
export type ScheduleTableLines = { horizontal: number[]; vertical: number[] }

export const scheduleWeekdays: readonly WeekdayId[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

export const defaultLessonTimes = [
  '08:30-09:15',
  '09:25-10:10',
  '10:30-11:15',
  '11:35-12:20',
  '12:30-13:15',
  '13:25-14:10',
  '14:20-15:05',
]

export function makeScheduleEntryId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `lesson-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/* ---------- Хранение ----------

   Субботу можно убрать (14 сентября 2026, владелец: «не все учатся по
   субботам, а без неё таблица шире»). Выбор хранится там же, где само
   расписание, - отдельной записью в том же массиве `entries`, в браузере и в
   аккаунте одинаково. Схема базы не меняется, а прежний разбор такую запись
   просто отбрасывает: у неё нет дня, предмета и времени. Поэтому старые
   данные читаются как есть, а без записи суббота на месте. */

type ScheduleSettingsRecord = { kind: 'settings'; saturday: boolean }

function isSettingsRecord(value: unknown): value is ScheduleSettingsRecord {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as { kind?: unknown }).kind === 'settings'
    && typeof (value as { saturday?: unknown }).saturday === 'boolean',
  )
}

export function readScheduleSettings(stored: unknown) {
  const record = Array.isArray(stored) ? stored.find(isSettingsRecord) : undefined
  return { saturday: record ? record.saturday : true }
}

export function writeScheduleRecords(entries: readonly ScheduleEntry[], settings: { saturday: boolean }): unknown[] {
  const records: unknown[] = [...entries]
  if (!settings.saturday) records.push({ kind: 'settings', saturday: false } satisfies ScheduleSettingsRecord)
  return records
}

/* ---------- Буквы ----------

   Распознавание путает кириллицу с похожей латиницей («Anre6pa» вместо
   «Алгебра») и цифрами. Перед сравнением всё сводится к строчной кириллице.
   Таблицы собраны из отдельных строк, чтобы в одном слове исходника не
   встречались два алфавита: это проверяет scripts/check-mixed-alphabets.mjs. */

const latinLookalikes: Readonly<Record<string, string>> = {
  a: 'а', b: 'в', c: 'с', e: 'е', g: 'д', h: 'н', k: 'к', m: 'м', n: 'п', o: 'о', p: 'р', r: 'г', t: 'т', u: 'и', x: 'х', y: 'у',
}

const digitLetterLookalikes: Readonly<Record<string, string>> = { 0: 'о', 3: 'з', 4: 'ч', 6: 'б', 8: 'в' }

const letterDigitLookalikes: Readonly<Record<string, string>> = {
  O: '0', o: '0', I: '1', l: '1', '|': '1', 'О': '0', 'о': '0', 'З': '3', 'з': '3', 'б': '6',
}

/** Класс символов «цифра или то, что распознавание принимает за цифру». */
const digitLike = '[0-9OoIl|\\u041e\\u043e\\u0417\\u0437\\u0431]'

function isLetter(character: string | undefined) {
  return character !== undefined && /\p{L}/u.test(character)
}

function foldLetters(value: string) {
  const characters = Array.from(value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е'))
  return characters.map((character, index) => {
    const latin = latinLookalikes[character]
    if (latin) return latin
    const digit = digitLetterLookalikes[character]
    if (digit && (isLetter(characters[index - 1]) || isLetter(characters[index + 1]))) return digit
    return character
  }).join('')
}

/** Слова строки в виде, пригодном для сравнения: строчная кириллица без знаков. */
export function normalizeScheduleWords(value: string) {
  return foldLetters(value).split(/[^\p{L}]+/u).filter(Boolean)
}

function foldPhrase(value: string) {
  return normalizeScheduleWords(value).join('')
}

function fixDigits(value: string) {
  return Array.from(value, (character) => letterDigitLookalikes[character] ?? character).join('')
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

/** Сколько ошибок распознавания прощается слову такой длины. */
function allowedDistance(length: number) {
  if (length <= 4) return 0
  if (length <= 6) return 1
  if (length <= 9) return 2
  if (length <= 14) return 3
  return 4
}

/* ---------- Время ---------- */

function toMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function fromMinutes(total: number) {
  const bounded = Math.max(0, Math.min(total, 23 * 60 + 59))
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`
}

function clock(hours: number, minutes: number) {
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) return ''
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** Уроки идут днём: всё, что вне 7-21 часа, в распознанном тексте - не звонок. */
function isSchoolClock(value: string) {
  const hours = Number(value.slice(0, 2))
  return hours >= 7 && hours <= 21
}

/**
 * Время из поля ввода: «8.30», «8:30», «8 30», «830», «0830», «8» - всё
 * становится «08:30». Пустая строка - если это не время.
 */
export function parseClockTime(value: string) {
  const compact = fixDigits(value.trim()).replace(/\s+/g, ' ')
  const separated = compact.match(/^(\d{1,2}) ?[:.,;ч -] ?(\d{2})$/u)
  if (separated) return clock(Number(separated[1]), Number(separated[2]))
  const digits = compact.match(/^(\d{3,4})$/)
  if (digits) return clock(Number(digits[1].slice(0, -2)), Number(digits[1].slice(-2)))
  const hoursOnly = compact.match(/^(\d{1,2})$/)
  if (hoursOnly) return clock(Number(hoursOnly[1]), 0)
  return ''
}

type TimeMatch = { index: number; length: number; time: string }

// Пробел допускается только у двоеточия: «7. 14:20» - это седьмой урок в
// 14:20, а не 07:14. Время, за которым идёт ещё «:цифра», - часть чего-то
// большего («1.08:30»), и тогда поиск сдвигается к настоящему времени.
const separatedTimePattern = new RegExp(`(?<![0-9])(${digitLike}{1,2})(?: ?: ?|[.,;])(${digitLike}{2})(?![0-9]|[:.][0-9])`, 'gu')
const spacedTimePattern = /(?<![0-9:.])([0-9]{1,2}) ([0-9]{2})(?![0-9:.])/g
const compactRangePattern = /(?<![0-9])([0-9]{3,4}) ?[-–—] ?([0-9]{3,4})(?![0-9])/g

function findTimes(text: string, schoolOnly: boolean): TimeMatch[] {
  const matches: TimeMatch[] = []
  const overlaps = (index: number, length: number) => matches.some((match) => index < match.index + match.length && match.index < index + length)

  for (const match of text.matchAll(separatedTimePattern)) {
    const time = clock(Number(fixDigits(match[1])), Number(fixDigits(match[2])))
    if (!time || (schoolOnly && !isSchoolClock(time))) continue
    matches.push({ index: match.index, length: match[0].length, time })
  }

  // «830-915»: без разделителей время узнаётся только парой, иначе это кабинет.
  for (const match of text.matchAll(compactRangePattern)) {
    if (overlaps(match.index, match[0].length)) continue
    const start = parseClockTime(match[1])
    const end = parseClockTime(match[2])
    const length = start && end ? toMinutes(end) - toMinutes(start) : 0
    if (length < 20 || length > 120 || (schoolOnly && !isSchoolClock(start))) continue
    matches.push({ index: match.index, length: match[0].length, time: start }, { index: match.index + match[0].length - match[2].length, length: match[2].length, time: end })
  }

  // «8 30»: пробел вместо двоеточия. Звонки кратны пяти минутам, а в
  // школьные часы попадает не каждое число, - так «312 45» не станет временем.
  for (const match of text.matchAll(spacedTimePattern)) {
    if (overlaps(match.index, match[0].length)) continue
    const time = clock(Number(match[1]), Number(match[2]))
    if (!time || !isSchoolClock(time) || Number(match[2]) % 5 !== 0) continue
    matches.push({ index: match.index, length: match[0].length, time })
  }

  return matches.sort((left, right) => left.index - right.index)
}

/** Все времена в строке в порядке записи. */
export function extractLessonTimes(text: string) {
  return findTimes(text, true).map(({ time }) => time)
}

function lessonRangeFromTimes(times: string[], rowIndex: number) {
  const start = times[0]
  const end = start ? times.find((time, index) => {
    if (index === 0) return false
    const length = toMinutes(time) - toMinutes(start)
    return length > 0 && length <= 120
  }) : undefined
  if (start && end) return `${start}-${end}`
  const knownRange = start && defaultLessonTimes.find((range) => range.startsWith(`${start}-`))
  if (knownRange) return knownRange
  if (start) return `${start}-${fromMinutes(toMinutes(start) + 45)}`
  return defaultLessonTimes[rowIndex] ?? ''
}

export function normalizeLessonTimeRange(value: string, fallbackIndex = 0) {
  return lessonRangeFromTimes(findTimes(value, false).map(({ time }) => time), fallbackIndex)
}

export function splitLessonTimeRange(value: string) {
  const normalized = normalizeLessonTimeRange(value)
  const [start, end] = normalized.split('-')
  return { start, end }
}

/**
 * Правка начала или конца урока. Начало, сдвинутое за конец, тянет конец за
 * собой с той же длиной урока; конец раньше начала не принимается.
 */
export function changeLessonRange(range: string, edge: 'start' | 'end', value: string) {
  const { start, end } = splitLessonTimeRange(range)
  const next = parseClockTime(value)
  if (!next) return null
  if (edge === 'end') return toMinutes(next) > toMinutes(start) ? `${start}-${next}` : null
  if (toMinutes(next) < toMinutes(end)) return `${next}-${end}`
  const shiftedEnd = toMinutes(next) + Math.max(5, toMinutes(end) - toMinutes(start))
  return shiftedEnd <= 23 * 60 + 59 ? `${next}-${fromMinutes(shiftedEnd)}` : null
}

/** Время следующего урока: через десять минут после конца последнего. */
export function nextLessonTime(times: readonly string[]) {
  const previousEnd = splitLessonTimeRange(times.at(-1) ?? '07:35-08:20').end
  const start = Math.min(toMinutes(previousEnd) + 10, 23 * 60 + 14)
  return `${fromMinutes(start)}-${fromMinutes(start + 45)}`
}

/* ---------- Предметы ----------

   Названия сверяются со списком предметов продукта (src/lib/subjects.ts) и
   школьными предметами, которых в нём нет. Сокращения из бумажных и
   электронных расписаний сравниваются точно, полные названия - по расстоянию
   правки, обрезанные («информ.», «литер.») - по началу слова. */

const subjectShortForms: Readonly<Record<string, readonly string[]>> = {
  'Математика': ['мат', 'матем', 'мат-ка', 'матем-ка'],
  'Алгебра': ['алг', 'алгеб'],
  'Геометрия': ['геом', 'геометр'],
  'Физика': ['физ'],
  'Химия': ['хим'],
  'Биология': ['био', 'биол'],
  'Информатика': ['инф', 'информ', 'информ-ка', 'икт'],
  'Русский язык': ['рус', 'русск', 'рус яз', 'русск яз', 'р яз', 'рус я', 'русяз'],
  'Литература': ['лит', 'лит-ра', 'литер', 'литра', 'лит-а'],
  'Английский язык': ['англ', 'англ яз', 'анг яз', 'анг', 'english'],
  'История': ['ист'],
  'Обществознание': ['общ', 'обществ', 'общ-во', 'общество', 'обществозн'],
  'География': ['геогр', 'геогр-я'],
  'Астрономия': ['астр', 'астрон'],
}

const extraSubjects: ReadonlyArray<{ label: string; names?: readonly string[]; short?: readonly string[] }> = [
  { label: 'Физкультура', names: ['Физкультура', 'Физическая культура'], short: ['физ-ра', 'физра', 'физк', 'физ-к', 'физкульт', 'ф-ра', 'физ культ'] },
  { label: 'Иностранный язык', short: ['ин яз', 'иняз', 'иностр', 'иностр яз'] },
  { label: 'Немецкий язык', short: ['нем', 'нем яз'] },
  { label: 'Французский язык', short: ['франц', 'фр яз', 'франц яз'] },
  { label: 'Китайский язык', short: ['кит яз'] },
  { label: 'Испанский язык', short: ['исп яз'] },
  { label: 'Технология', short: ['техн', 'технол'] },
  { label: 'Труд', names: ['Труд', 'Труд (технология)'] },
  { label: 'Музыка', short: ['муз'] },
  { label: 'ИЗО', names: ['Изобразительное искусство'], short: ['изо', 'изобраз'] },
  { label: 'ОБЖ', names: ['Основы безопасности жизнедеятельности'], short: ['обж'] },
  { label: 'ОБЗР', names: ['Основы безопасности и защиты Родины'], short: ['обзр'] },
  { label: 'Вероятность и статистика', names: ['Вероятность и статистика', 'Теория вероятностей'], short: ['вис', 'вер и стат', 'вер-ть и стат', 'вероятн', 'теор вер', 'статистика'] },
  { label: 'Разговоры о важном', short: ['разговоры', 'разг о важном'] },
  { label: 'Мои горизонты', names: ['Россия мои горизонты', 'Мои горизонты'], short: ['профминимум'] },
  { label: 'Классный час', short: ['кл час', 'клчас', 'кл ч'] },
  { label: 'Родной язык', short: ['родн яз', 'род яз'] },
  { label: 'Родная литература', short: ['родн лит', 'род лит'] },
  { label: 'ОДНКНР', short: ['однкнр'] },
  { label: 'МХК', names: ['Мировая художественная культура'], short: ['мхк'] },
  { label: 'Индивидуальный проект', short: ['инд проект', 'инд пр'] },
  { label: 'Функциональная грамотность', short: ['функц грамотность', 'функц грам'] },
  { label: 'Проектная деятельность', short: ['проектн деят'] },
  { label: 'Внеурочная деятельность', short: ['внеур', 'внеурочка'] },
  { label: 'Элективный курс', short: ['электив', 'элект курс'] },
  { label: 'Черчение' },
  { label: 'Экономика', short: ['экон'] },
  { label: 'Право' },
  { label: 'Естествознание', short: ['естеств'] },
  { label: 'Окружающий мир', short: ['окр мир', 'окруж мир'] },
  { label: 'Литературное чтение', short: ['лит чтение', 'чтение'] },
]

type SubjectRule = { label: string; names: string[]; short: string[] }

function prepareSubjectRule(label: string, names: readonly string[], short: readonly string[]): SubjectRule {
  // «Русский», «Английский» без «язык» - тоже полное название.
  const firstWords = label.endsWith(' язык') ? [label.split(' ')[0]] : []
  return {
    label,
    names: [label, ...names, ...firstWords].map(foldPhrase),
    short: short.map(foldPhrase),
  }
}

const subjectRules: readonly SubjectRule[] = [
  ...solvableSubjects.map(({ name }) => prepareSubjectRule(name, [], subjectShortForms[name] ?? [])),
  ...extraSubjects.map(({ label, names = [], short = [] }) => prepareSubjectRule(label, names, short)),
]

type SubjectCandidate = { label: string; score: number }

function matchSubjectText(joined: string): SubjectCandidate | null {
  if (joined.length < 2) return null
  let best: SubjectCandidate | null = null
  let prefix: { label: string; length: number } | null = null

  for (const rule of subjectRules) {
    if (rule.short.includes(joined) || rule.names.includes(joined)) return { label: rule.label, score: 0 }
    for (const name of rule.names) {
      const allowed = allowedDistance(name.length)
      if (allowed > 0 && Math.abs(name.length - joined.length) <= allowed) {
        const distance = editDistance(joined, name)
        if (distance <= allowed && (!best || distance / name.length < best.score)) best = { label: rule.label, score: distance / name.length }
      }
      // Обрезанное название: «информ», «литер». Если начало подходит к
      // нескольким предметам, берётся самый короткий: «лите» - это литература.
      if (joined.length >= 4 && joined.length < name.length && name.startsWith(joined) && (!prefix || name.length < prefix.length)) {
        prefix = { label: rule.label, length: name.length }
      }
    }
  }

  if (best) return best
  return prefix ? { label: prefix.label, score: 0.2 } : null
}

type SubjectMatch = SubjectCandidate & { start: number; end: number }

function matchSubjectsInWords(words: readonly string[]) {
  const candidates: SubjectMatch[] = []
  for (let start = 0; start < words.length; start += 1) {
    for (let size = 1; size <= 4 && start + size <= words.length; size += 1) {
      const match = matchSubjectText(words.slice(start, start + size).join(''))
      if (match) candidates.push({ label: match.label, score: match.score, start, end: start + size })
    }
  }

  candidates.sort((left, right) => left.score - right.score || (right.end - right.start) - (left.end - left.start) || left.start - right.start)
  const used = new Set<number>()
  const found: SubjectMatch[] = []
  for (const candidate of candidates) {
    const indexes = Array.from({ length: candidate.end - candidate.start }, (_, offset) => candidate.start + offset)
    if (indexes.some((index) => used.has(index)) || found.some(({ label }) => label === candidate.label)) continue
    indexes.forEach((index) => used.add(index))
    found.push(candidate)
  }
  return found.sort((left, right) => left.start - right.start)
}

/** Предметы в тексте в порядке записи. */
export function findScheduleSubjects(value: string) {
  return matchSubjectsInWords(normalizeScheduleWords(stripTeacherNames(value))).map(({ label }) => label)
}

/* Фамилия учителя с инициалами («Иванова Н.П.») - не предмет и не мусор,
   который надо сопоставлять с предметами. Слово, которое само похоже на
   предмет, не трогаем: «Алгебра И.» - это всё-таки алгебра. */
const teacherPatterns = [
  /\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?\s+\p{Lu}\.\s?(?:\p{Lu}\.?)?/gu,
  /\p{Lu}\.\s?\p{Lu}\.\s?\p{Lu}\p{Ll}+/gu,
]

function stripTeacherNames(value: string) {
  return teacherPatterns.reduce((text, pattern) => text.replace(pattern, (match) => {
    const words = normalizeScheduleWords(match).filter((word) => word.length > 1)
    return words.some((word) => matchSubjectText(word)) ? match : ' '
  }), value)
}

const vowelPattern = /[аеёиоуыэюя]/giu

/** Похоже ли на слова, а не на шум распознавания. */
function looksLikeWords(value: string) {
  const compact = value.replace(/\s+/g, '')
  const cyrillic = compact.match(/\p{Script=Cyrillic}/gu)?.length ?? 0
  if (cyrillic < 4 || cyrillic / compact.length < 0.75) return false
  return value.split(/\s+/).some((word) => {
    const letters = word.match(/\p{Script=Cyrillic}/gu)?.join('') ?? ''
    if (letters.length < 4) return false
    const vowels = letters.match(vowelPattern)?.length ?? 0
    return vowels > 0
      && vowels < letters.length
      && !/[^аеёиоуыэюя]{5,}/iu.test(letters)
      && !/(.)\1\1/u.test(letters)
  })
}

function capitalize(value: string) {
  return value ? value[0].toLocaleUpperCase('ru-RU') + value.slice(1) : value
}

/* ---------- Кабинеты ---------- */

const namedRooms: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'Спортзал', pattern: /спорт\.?\s?зал|с\/з(?:ал)?(?!\p{L})/iu },
  { label: 'Актовый зал', pattern: /акт(?:\.|овый)\s?зал/iu },
  { label: 'Бассейн', pattern: /бассейн/iu },
]

const explicitRoomPattern = /(?:каб(?:инет)?|ауд(?:итория)?)\.?\s*[№#:]?\s*(\d{1,3}(?:[-.]\d{1,2})?\p{L}?)(?!\d)/giu
const bareRoomPattern = /(?<![\d\p{L}])(\d{2,3}\p{Ll}?)(?![\d\p{L}])/gu
const roomLikeToken = /(?<![\p{L}\d])[\dOoIl|ОоЗз]{2,4}(?![\p{L}\d])/gu

function withoutTimes(value: string) {
  let text = value
  for (const match of findTimes(value, false).reverse()) {
    text = `${text.slice(0, match.index)} ${text.slice(match.index + match.length)}`
  }
  return text
}

export function extractRooms(value: string) {
  const text = withoutTimes(value).replace(roomLikeToken, (token) => ((token.match(/\d/g)?.length ?? 0) >= 2 ? fixDigits(token) : token))
  const rooms: string[] = []
  const rest = text.replace(explicitRoomPattern, (_, room: string) => {
    rooms.push(room)
    return ' '
  })
  for (const { label, pattern } of namedRooms) if (pattern.test(rest)) rooms.push(label)
  for (const match of rest.matchAll(bareRoomPattern)) rooms.push(match[1])
  return Array.from(new Set(rooms)).slice(0, 2).join(' / ')
}

function cleanSubjectText(value: string) {
  return stripTeacherNames(withoutTimes(value))
    .replace(explicitRoomPattern, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^\p{L}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s-]+|[\s-]+$/g, '')
}

/**
 * Клетка таблицы: предмет и кабинет. Незнакомое название принимается, только
 * если распознавание в нём уверено и текст похож на слова, - иначе клетка
 * остаётся пустой, а не заполняется шумом.
 */
export function parseScheduleCellText(value: string, confidence = 100) {
  const subjects = findScheduleSubjects(value).slice(0, 2)
  let subject = subjects.join(' / ')
  if (!subject && confidence >= 65) {
    const cleaned = cleanSubjectText(value)
    if (cleaned.length <= 40 && looksLikeWords(cleaned)) subject = capitalize(cleaned)
  }
  return { subject, room: subject ? extractRooms(value) : '' }
}

/* ---------- Дни недели ---------- */

const weekdayNames: Readonly<Record<WeekdayId, { full: string; short: readonly string[] }>> = {
  monday: { full: 'понедельник', short: ['пн', 'пон', 'понед'] },
  tuesday: { full: 'вторник', short: ['вт', 'вто', 'втор'] },
  wednesday: { full: 'среда', short: ['ср', 'сред'] },
  thursday: { full: 'четверг', short: ['чт', 'чет', 'четв'] },
  friday: { full: 'пятница', short: ['пт', 'пят', 'пятн'] },
  saturday: { full: 'суббота', short: ['сб', 'суб', 'субб'] },
}

/** День недели по слову с учётом ошибок распознавания: латиница вместо кириллицы, «4т», «Понедельннк». */
export function matchWeekday(value: string): WeekdayId | null {
  const joined = foldPhrase(value)
  if (joined.length < 2) return null
  for (const day of scheduleWeekdays) {
    const { full, short } = weekdayNames[day]
    if (joined === full || short.includes(joined)) return day
    if (joined.length >= 5 && full.startsWith(joined)) return day
  }
  for (const day of scheduleWeekdays) {
    const { full } = weekdayNames[day]
    const allowed = full.length >= 7 ? 2 : 1
    if (Math.abs(full.length - joined.length) <= allowed && editDistance(joined, full) <= allowed) return day
  }
  return null
}

/* ---------- Расписание списком ---------- */

const breakPattern = /перемен|обед|завтрак|полдник|динамическ/iu
const headingWords = new Set(['день', 'время', 'предмет', 'предметы', 'урок', 'уроки', 'кабинет', 'расписание', 'звонки', 'класс', 'учитель', 'неделя'])

function normalizeLine(value: string) {
  return value
    .replace(/[|¦]/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Расписание, записанное строками: «Понедельник», затем «1. 8:30-9:15 Алгебра
 * каб. 312». Строка дня с несколькими предметами без времени - это строка
 * таблицы, где дни стоят слева: предметы идут подряд, урок за уроком.
 */
export function parseScheduleText(rawText: string): ScheduleEntry[] {
  const lines = rawText.split(/\r?\n/).map(normalizeLine).filter(Boolean)
  const entries: ScheduleEntry[] = []
  const nextIndex: Record<WeekdayId, number> = { monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 0 }
  let activeDay: WeekdayId = 'monday'

  const push = (day: WeekdayId, lessonIndex: number, times: string[], subject: string, room: string) => {
    const time = lessonRangeFromTimes(times, lessonIndex)
    if (!time || entries.some((entry) => entry.day === day && entry.time === time)) return
    entries.push({ id: makeScheduleEntryId(), day, time, subject, room })
    nextIndex[day] = Math.max(nextIndex[day], lessonIndex + 1)
  }

  for (const sourceLine of lines) {
    let line = sourceLine
    const tokens = line.split(' ')
    const dayTokenIndex = tokens.slice(0, 2).findIndex((token) => matchWeekday(token))
    let lineDay: WeekdayId | null = null
    if (dayTokenIndex >= 0) {
      lineDay = matchWeekday(tokens[dayTokenIndex])
      // Дата рядом с днём («Пн 15.09») - не время урока.
      line = normalizeLine(tokens.slice(dayTokenIndex + 1).join(' ').replace(/^[,.:\s-]*\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?/u, ''))
    }
    if (lineDay) activeDay = lineDay
    if (!line || breakPattern.test(line)) continue

    const lessonNumber = line.match(/^(\d{1,2})\s*(?:[).:-]|-?й\b|урок)?\s+(?=\D)/u)
    const numberedIndex = lessonNumber && Number(lessonNumber[1]) >= 1 && Number(lessonNumber[1]) <= 12 ? Number(lessonNumber[1]) - 1 : null
    if (lessonNumber) line = line.slice(lessonNumber[0].length)

    const times = extractLessonTimes(line)
    const matches = matchSubjectsInWords(normalizeScheduleWords(stripTeacherNames(withoutTimes(line))))
    const room = extractRooms(line)
    const onlyHeadings = normalizeScheduleWords(line).every((word) => headingWords.has(word))
    if (onlyHeadings) continue

    if (times.length === 0 && matches.length >= 2 && !line.includes('/')) {
      for (const match of matches) push(activeDay, nextIndex[activeDay], [], match.label, '')
      continue
    }

    let subject = matches.slice(0, 2).map(({ label }) => label).join(' / ')
    if (!subject && (times.length > 0 || numberedIndex !== null)) {
      const cleaned = cleanSubjectText(line)
      if (cleaned.length <= 40 && looksLikeWords(cleaned) && !headingWords.has(foldPhrase(cleaned))) subject = capitalize(cleaned)
    }
    if (!subject) continue
    push(activeDay, numberedIndex ?? nextIndex[activeDay], times, subject, room)
  }

  return entries
}

/* ---------- Таблица на снимке ---------- */

type OcrWord = {
  x: number
  y: number
  width: number
  height: number
  text: string
  line: string
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
      text: columns.slice(11).join(' ').trim(),
      line: `${columns[1]}:${columns[2]}:${columns[3]}:${columns[4]}`,
    }))
    .filter((word) => [word.x, word.y, word.width, word.height].every(Number.isFinite))
}

function transposeWord(word: OcrWord): OcrWord {
  return { x: word.y, y: word.x, width: word.height, height: word.width, text: word.text, line: word.line }
}

const centerX = (word: OcrWord) => word.x + word.width / 2
const centerY = (word: OcrWord) => word.y + word.height / 2

function median(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
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

type ColumnBand = { day: WeekdayId; left: number; right: number }
type RowBand = { time: string; top: number; bottom: number }

/** Полосы между соседними линиями, достаточно широкие, чтобы быть клеткой. */
function bandsBetween(lines: readonly number[], minimum: number) {
  const sorted = [...lines].sort((left, right) => left - right)
  return sorted.slice(1)
    .map((end, index) => ({ start: sorted[index], end }))
    .filter(({ start, end }) => end - start >= minimum)
}

function columnsFromHeaders(dayWords: ReadonlyArray<{ word: OcrWord; dayIndex: number }>, vertical: readonly number[]): ColumnBand[] {
  const lineBands = bandsBetween(vertical, 12)
  if (lineBands.length >= 2) {
    const assigned = new Map<number, number>()
    for (const { word, dayIndex } of dayWords) {
      const bandIndex = lineBands.findIndex(({ start, end }) => centerX(word) > start && centerX(word) < end)
      if (bandIndex >= 0 && !assigned.has(bandIndex)) assigned.set(bandIndex, dayIndex)
    }
    if (assigned.size >= 2) {
      // Заголовок, который не прочитался, восстанавливается по соседям:
      // между «Вт» и «Чт» стоит среда.
      const known = [...assigned].sort((left, right) => left[0] - right[0])
      const offset = known[0][1] - known[0][0]
      if (known.every(([band, day]) => day - band === offset)) {
        const widths = known.map(([band]) => lineBands[band].end - lineBands[band].start)
        const typical = median(widths)
        return lineBands
          .map((band, index) => ({ band, dayIndex: index + offset }))
          .filter(({ band, dayIndex }) => dayIndex >= 0 && dayIndex < scheduleWeekdays.length && (band.end - band.start) > typical * 0.55 && (band.end - band.start) < typical * 1.8)
          .map(({ band, dayIndex }) => ({ day: scheduleWeekdays[dayIndex], left: band.start, right: band.end }))
      }
      return known.map(([band, day]) => ({ day: scheduleWeekdays[day], left: lineBands[band].start, right: lineBands[band].end }))
    }
  }

  const foundCenters = new Map(dayWords.map(({ word, dayIndex }) => [dayIndex, centerX(word)]))
  const lastFoundIndex = Math.max(...foundCenters.keys())
  const firstFoundIndex = Math.min(...foundCenters.keys())
  const dayCount = Math.min(scheduleWeekdays.length, Math.max(5, lastFoundIndex + 1))
  const centers = estimateColumnCenters(foundCenters, dayCount)
  const steps = centers.slice(1).map((center, index) => center - centers[index])
  const step = median(steps) || 160
  return centers
    .map((center, index) => ({
      day: scheduleWeekdays[index],
      left: index === 0 ? center - step / 2 : (centers[index - 1] + center) / 2,
      right: index === centers.length - 1 ? center + step / 2 : (center + centers[index + 1]) / 2,
    }))
    .filter((_, index) => index >= Math.min(firstFoundIndex, 0))
}

type TimeLine = { center: number; times: string[]; number: number | null; height: number }

/* Строки текста в столбце времени. В повёрнутой таблице строка распознавания
   идёт поперёк уроков и склеила бы все звонки в одну, поэтому там каждое
   слово - отдельная строка. */
function readTimeLines(words: readonly OcrWord[], headerBottom: number, timeColumnRight: number, byWord: boolean) {
  const lines = new Map<string, OcrWord[]>()
  words.forEach((word, index) => {
    if (centerX(word) >= timeColumnRight || centerY(word) <= headerBottom) return
    const key = byWord ? String(index) : word.line
    const line = lines.get(key) ?? []
    line.push(word)
    lines.set(key, line)
  })
  return [...lines.values()]
    .map<TimeLine>((lineWords) => {
      const text = [...lineWords].sort((left, right) => left.x - right.x).map((word) => word.text).join(' ')
      const times = findTimes(text, true)
      const number = text.match(/^\s*(\d{1,2})(?:\)|\.(?!\d)|\s*урок|\s*$|\s+(?=\d))/u)
      // «8 30» начинается с числа, но это время, а не номер урока.
      const numberIsTime = times.length > 0 && times[0].index === text.search(/\d/)
      return {
        center: lineWords.reduce((sum, word) => sum + centerY(word), 0) / lineWords.length,
        times: times.map(({ time }) => time),
        number: number && !numberIsTime && Number(number[1]) >= 1 && Number(number[1]) <= 12 ? Number(number[1]) : null,
        height: median(lineWords.map(({ height }) => height)),
      }
    })
    .filter((line) => line.times.length > 0 || line.number !== null)
    .sort((left, right) => left.center - right.center)
}

/** Звонки строка за строкой: время не может идти назад или повторяться. */
function orderedRowTimes(rows: RowBand[]) {
  for (let index = 1; index < rows.length; index += 1) {
    const previous = splitLessonTimeRange(rows[index - 1].time)
    const current = splitLessonTimeRange(rows[index].time)
    if (toMinutes(current.start) <= toMinutes(previous.start)) {
      rows[index].time = `${fromMinutes(toMinutes(previous.end) + 10)}-${fromMinutes(toMinutes(previous.end) + 55)}`
    }
  }
  return rows
}

function rowsFromTimeLines(timeLines: readonly TimeLine[], horizontal: readonly number[], headerBottom: number, contentWords: readonly OcrWord[]): RowBand[] {
  const lineBands = bandsBetween(horizontal.filter((line) => line >= headerBottom - 4), 16)
  if (lineBands.length >= 2) {
    const rows = lineBands
      .map((band, index) => {
        const inside = timeLines.filter(({ center }) => center > band.start && center < band.end)
        const times = inside.flatMap((line) => line.times)
        const number = inside.find((line) => line.number !== null)?.number ?? null
        const hasContent = inside.length > 0 || contentWords.some((word) => centerY(word) > band.start && centerY(word) < band.end)
        return { band, index, times, number, hasContent }
      })
      .filter(({ hasContent }) => hasContent)
    if (rows.length >= 2) {
      return orderedRowTimes(rows.slice(0, 12).map(({ band, times, number }, rowIndex) => ({
        time: lessonRangeFromTimes(times, (number ?? rowIndex + 1) - 1),
        top: band.start,
        bottom: band.end,
      })))
    }
  }

  // Без линий строки собираются по времени слева. Начало и конец урока часто
  // стоят в клетке друг под другом - такие две строки текста это один урок.
  const groups: TimeLine[][] = []
  for (const line of timeLines) {
    const last = groups.at(-1)
    const previous = last?.at(-1)
    // Конец урока отстоит от начала на длину урока (25-47 минут, пара - около
    // 90), а начало следующей строки - ещё и на перемену, от 50 минут.
    const gap = previous && previous.times.length === 1 && line.times.length === 1 ? toMinutes(line.times[0]) - toMinutes(previous.times[0]) : 0
    const stacked = last !== undefined && previous !== undefined
      && last.length === 1
      && line.number === null
      && line.center - previous.center < Math.max(previous.height, line.height) * 2
      && ((gap >= 25 && gap <= 47) || (gap >= 80 && gap <= 95))
    if (last && stacked) last.push(line)
    else groups.push([line])
  }

  const timed = groups.filter((group) => group.some((line) => line.times.length > 0))
  const chosen = timed.length >= 2 ? timed : groups.filter((group) => group.some((line) => line.number !== null))
  if (chosen.length < 2) return []

  const rows = chosen.slice(0, 12).map((group, rowIndex) => {
    const number = group.find((line) => line.number !== null)?.number ?? null
    return {
      center: group.reduce((sum, line) => sum + line.center, 0) / group.length,
      time: lessonRangeFromTimes(group.flatMap((line) => line.times), (number ?? rowIndex + 1) - 1),
    }
  })
  const step = median(rows.slice(1).map((row, index) => row.center - rows[index].center)) || 48
  return orderedRowTimes(rows.map((row, index) => ({
    time: row.time,
    top: index === 0 ? row.center - step / 2 : (rows[index - 1].center + row.center) / 2,
    bottom: index === rows.length - 1 ? row.center + step / 2 : (row.center + rows[index + 1].center) / 2,
  })))
}

type TableGeometry = { columns: ColumnBand[]; rows: RowBand[]; words: OcrWord[]; transposed: boolean }

/**
 * Сетка таблицы по словам распознавания: столбцы - по заголовкам дней, строки -
 * по времени или номеру урока слева. Если на снимке найдены линии таблицы,
 * клетки берутся по ним. Дни могут стоять и слева, строками: тогда таблица
 * разбирается повёрнутой.
 */
function getScheduleTableGeometry(tsv: string, lines?: ScheduleTableLines): TableGeometry | null {
  const sourceWords = parseTsvWords(tsv)
  const firstDayWords = new Map<number, OcrWord>()
  for (const word of sourceWords) {
    const day = matchWeekday(word.text)
    const dayIndex = day ? scheduleWeekdays.indexOf(day) : -1
    if (dayIndex >= 0 && !firstDayWords.has(dayIndex)) firstDayWords.set(dayIndex, word)
  }
  const hasLines = Boolean(lines && lines.vertical.length >= 3 && lines.horizontal.length >= 3)
  if (firstDayWords.size < (hasLines ? 2 : 3)) return null

  const dayCenters = [...firstDayWords.values()]
  const spreadX = Math.max(...dayCenters.map(centerX)) - Math.min(...dayCenters.map(centerX))
  const spreadY = Math.max(...dayCenters.map(centerY)) - Math.min(...dayCenters.map(centerY))
  const transposed = spreadY > spreadX
  const words = transposed ? sourceWords.map(transposeWord) : sourceWords
  const horizontal = (transposed ? lines?.vertical : lines?.horizontal) ?? []
  const vertical = (transposed ? lines?.horizontal : lines?.vertical) ?? []

  const dayWords = [...firstDayWords].map(([dayIndex, word]) => ({ dayIndex, word: transposed ? transposeWord(word) : word }))
  const columns = columnsFromHeaders(dayWords, vertical)
  if (columns.length < 2) return null

  const headerBottom = Math.max(...dayWords.map(({ word }) => word.y + word.height))
  const timeColumnRight = Math.min(...columns.map(({ left }) => left))
  const timeLines = readTimeLines(words, headerBottom, timeColumnRight, transposed)
  const contentWords = words.filter((word) => centerX(word) > timeColumnRight && centerY(word) > headerBottom)
  const rows = rowsFromTimeLines(timeLines, horizontal, headerBottom, contentWords)
  if (rows.length < 2) return null

  return { columns, rows, words, transposed }
}

function cellRectangle(column: ColumnBand, row: RowBand, transposed: boolean): ScheduleRectangle {
  const inset = Math.max(2, Math.round(Math.min(column.right - column.left, row.bottom - row.top) * 0.06))
  const rectangle = {
    left: Math.max(0, Math.round(column.left + inset)),
    top: Math.max(0, Math.round(row.top + inset)),
    width: Math.max(1, Math.round(column.right - column.left - inset * 2)),
    height: Math.max(1, Math.round(row.bottom - row.top - inset * 2)),
  }
  return transposed
    ? { left: rectangle.top, top: rectangle.left, width: rectangle.height, height: rectangle.width }
    : rectangle
}

export function getScheduleTableCells(tsv: string, lines?: ScheduleTableLines): ScheduleTableCell[] {
  const geometry = getScheduleTableGeometry(tsv, lines)
  if (!geometry) return []
  return geometry.rows.flatMap((row) => geometry.columns.map((column) => ({
    day: column.day,
    time: row.time,
    rectangle: cellRectangle(column, row, geometry.transposed),
  })))
}

/** Предметы по словам первого прохода - запасной ответ, если клетка не прочиталась отдельно. */
export function parseScheduleTableTsv(tsv: string, lines?: ScheduleTableLines): ScheduleEntry[] {
  const geometry = getScheduleTableGeometry(tsv, lines)
  if (!geometry) return []

  const entries: ScheduleEntry[] = []
  for (const row of geometry.rows) {
    for (const column of geometry.columns) {
      const cellText = geometry.words
        .filter((word) => centerX(word) > column.left && centerX(word) < column.right && centerY(word) > row.top && centerY(word) < row.bottom)
        .sort((left, right) => left.y - right.y || left.x - right.x)
        .map(({ text }) => text)
        .join(' ')
      const parsed = parseScheduleCellText(cellText, 0)
      if (parsed.subject) entries.push({ id: makeScheduleEntryId(), day: column.day, time: row.time, subject: parsed.subject, room: parsed.room })
    }
  }
  return entries
}

/* ---------- Подготовка снимка ----------

   Фото расписания снимают с телефона: лист под углом, тень от руки, серый
   фон, мелкий шрифт. Распознавание берёт на себя только чёткую чёрно-белую
   картинку, поэтому перед ним снимок проходит четыре шага: оттенки серого с
   растяжкой контраста, бинаризация по местной яркости (тень не съедает
   текст, белые буквы на тёмной шапке переворачиваются), выравнивание наклона
   и снятие линий таблицы - линии остаются координатами клеток, а буквам
   больше не мешают. Функции ниже чистые и проверяются юнит-тестами. */

export type GrayImage = { width: number; height: number; data: Uint8ClampedArray }

export function toGrayImage(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  const data = new Uint8ClampedArray(width * height)
  for (let index = 0; index < data.length; index += 1) {
    const offset = index * 4
    data[index] = (rgba[offset] * 299 + rgba[offset + 1] * 587 + rgba[offset + 2] * 114) / 1000
  }
  return { width, height, data }
}

export function stretchContrast(image: GrayImage) {
  const histogram = new Uint32Array(256)
  for (const value of image.data) histogram[value] += 1
  const total = image.data.length
  let low = 0
  let high = 255
  for (let seen = 0; low < 255 && seen + histogram[low] < total * 0.01; low += 1) seen += histogram[low]
  for (let seen = 0; high > 0 && seen + histogram[high] < total * 0.01; high -= 1) seen += histogram[high]
  if (high - low < 24) return image
  const scale = 255 / (high - low)
  for (let index = 0; index < image.data.length; index += 1) image.data[index] = (image.data[index] - low) * scale
  return image
}

function integralImage(image: GrayImage) {
  const stride = image.width + 1
  const integral = new Float64Array(stride * (image.height + 1))
  for (let y = 0; y < image.height; y += 1) {
    let rowSum = 0
    for (let x = 0; x < image.width; x += 1) {
      rowSum += image.data[y * image.width + x]
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum
    }
  }
  return integral
}

function windowMean(integral: Float64Array, width: number, height: number, x: number, y: number, radius: number) {
  const stride = width + 1
  const left = Math.max(0, x - radius)
  const right = Math.min(width, x + radius + 1)
  const top = Math.max(0, y - radius)
  const bottom = Math.min(height, y + radius + 1)
  const sum = integral[bottom * stride + right] - integral[top * stride + right] - integral[bottom * stride + left] + integral[top * stride + left]
  return sum / ((right - left) * (bottom - top))
}

/**
 * Чернила: 1 там, где пиксель заметно темнее своей округи (Брэдли-Рот).
 * В тёмных областях полярность обратная: там чернила - светлые буквы.
 */
export function binarizeAdaptive(image: GrayImage) {
  const { width, height, data } = image
  const integral = integralImage(image)
  const radius = Math.max(8, Math.round(Math.max(width, height) / 64))
  const wideRadius = radius * 4
  const ink = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = data[y * width + x]
      const local = windowMean(integral, width, height, x, y, radius)
      const dark = windowMean(integral, width, height, x, y, wideRadius) < 96
      ink[y * width + x] = dark ? Number(value > local + 28) : Number(value < local * 0.84)
    }
  }
  return ink
}

/**
 * Наклон строк в градусах: при нём проекция чернил на вертикаль даёт самые
 * резкие пики. Положительный угол - строки уходят вниз вправо.
 */
export function estimateSkewDegrees(ink: Uint8Array, width: number, height: number, maxDegrees = 7) {
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 900))
  const points: number[] = []
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) if (ink[y * width + x]) points.push(x, y)
  }
  if (points.length < 200) return 0

  const score = (degrees: number) => {
    const radians = degrees * Math.PI / 180
    const sin = Math.sin(radians)
    const cos = Math.cos(radians)
    const offset = Math.ceil(width * Math.abs(sin)) + step
    const bins = new Float64Array(Math.ceil((height + offset * 2) / step) + 2)
    for (let index = 0; index < points.length; index += 2) {
      const projected = points[index + 1] * cos - points[index] * sin + offset
      bins[Math.max(0, Math.round(projected / step))] += 1
    }
    let total = 0
    for (const value of bins) total += value * value
    return total
  }

  let bestAngle = 0
  let bestScore = score(0)
  const flatScore = bestScore
  for (let degrees = -maxDegrees; degrees <= maxDegrees + 1e-9; degrees += 0.25) {
    const current = score(degrees)
    if (current > bestScore) {
      bestScore = current
      bestAngle = degrees
    }
  }
  // Сомнительный выигрыш - не повод крутить снимок.
  return bestScore > flatScore * 1.03 ? bestAngle : 0
}

function lineCenters(coverage: Float64Array, threshold: number) {
  const centers: number[] = []
  let start = -1
  let weight = 0
  let weighted = 0
  for (let index = 0; index <= coverage.length; index += 1) {
    const value = index < coverage.length ? coverage[index] : 0
    if (value >= threshold) {
      if (start < 0) start = index
      weight += value
      weighted += value * index
    } else if (start >= 0) {
      centers.push(Math.round(weighted / weight))
      start = -1
      weight = 0
      weighted = 0
    }
  }
  return centers
}

/**
 * Линии таблицы - длинные непрерывные отрезки чернил. Возвращает их
 * координаты и маску пикселей линий, чтобы стереть их перед распознаванием.
 */
export function detectTableLines(ink: Uint8Array, width: number, height: number) {
  const mask = new Uint8Array(width * height)
  const rowCoverage = new Float64Array(height)
  const columnCoverage = new Float64Array(width)
  const minHorizontal = Math.max(40, Math.round(width * 0.12))
  const minVertical = Math.max(30, Math.round(height * 0.06))
  const gap = 2

  for (let y = 0; y < height; y += 1) {
    let start = -1
    let lastInk = -1
    for (let x = 0; x <= width; x += 1) {
      const isInk = x < width && ink[y * width + x] === 1
      if (isInk) {
        if (start < 0) start = x
        lastInk = x
      } else if (start >= 0 && x - lastInk > gap) {
        if (lastInk - start + 1 >= minHorizontal) {
          rowCoverage[y] += lastInk - start + 1
          for (let fill = start; fill <= lastInk; fill += 1) mask[y * width + fill] = 1
        }
        start = -1
      }
    }
  }

  for (let x = 0; x < width; x += 1) {
    let start = -1
    let lastInk = -1
    for (let y = 0; y <= height; y += 1) {
      const isInk = y < height && ink[y * width + x] === 1
      if (isInk) {
        if (start < 0) start = y
        lastInk = y
      } else if (start >= 0 && y - lastInk > gap) {
        if (lastInk - start + 1 >= minVertical) {
          columnCoverage[x] += lastInk - start + 1
          for (let fill = start; fill <= lastInk; fill += 1) mask[fill * width + x] = 1
        }
        start = -1
      }
    }
  }

  return {
    horizontal: lineCenters(rowCoverage, width * 0.25),
    vertical: lineCenters(columnCoverage, height * 0.2),
    mask,
  }
}

function inkShare(ink: Uint8Array, width: number, rectangle: ScheduleRectangle) {
  let count = 0
  const right = Math.min(width, rectangle.left + rectangle.width)
  const bottom = Math.min(ink.length / width, rectangle.top + rectangle.height)
  for (let y = rectangle.top; y < bottom; y += 1) {
    for (let x = rectangle.left; x < right; x += 1) count += ink[y * width + x]
  }
  return count / Math.max(1, rectangle.width * rectangle.height)
}

/* ---------- Распознавание в браузере ---------- */

type PreparedPhoto = { canvas: HTMLCanvasElement; ink: Uint8Array; lines: ScheduleTableLines; width: number; height: number }

async function loadPhoto(file: File): Promise<CanvasImageSource & { width: number; height: number; close?: () => void }> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file, { imageOrientation: 'from-image' })
  const image = new Image()
  image.src = URL.createObjectURL(file)
  await image.decode()
  URL.revokeObjectURL(image.src)
  return image
}

function drawScaled(source: CanvasImageSource & { width: number; height: number }, scale: number, degrees: number) {
  const radians = degrees * Math.PI / 180
  const width = source.width * scale
  const height = source.height * scale
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * Math.abs(Math.cos(radians)) + height * Math.abs(Math.sin(radians)))
  canvas.height = Math.round(width * Math.abs(Math.sin(radians)) + height * Math.abs(Math.cos(radians)))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('canvas')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.imageSmoothingQuality = 'high'
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate(-radians)
  context.drawImage(source, -width / 2, -height / 2, width, height)
  return { canvas, context }
}

const nextFrame = () => new Promise((resolve) => { window.setTimeout(resolve, 0) })

/** Снимок, готовый к распознаванию: выровненный, чёрно-белый, без линий таблицы. */
async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const source = await loadPhoto(file)
  const longSide = Math.max(source.width, source.height)
  // Мелкий текст увеличивается: распознаванию нужна строка высотой от 20 px.
  const scale = longSide < 1800 ? Math.min(3, 2400 / longSide) : Math.min(1, 2800 / longSide)

  const read = (degrees: number) => {
    const { canvas, context } = drawScaled(source, scale, degrees)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    const gray = stretchContrast(toGrayImage(pixels.data, canvas.width, canvas.height))
    return { canvas, context, pixels, ink: binarizeAdaptive(gray) }
  }

  let page = read(0)
  await nextFrame()
  const skew = estimateSkewDegrees(page.ink, page.canvas.width, page.canvas.height)
  if (Math.abs(skew) >= 0.4) {
    page = read(skew)
    await nextFrame()
  }
  source.close?.()

  const { canvas, context, pixels, ink } = page
  const { horizontal, vertical, mask } = detectTableLines(ink, canvas.width, canvas.height)
  for (let index = 0; index < ink.length; index += 1) {
    if (mask[index]) ink[index] = 0
    const value = ink[index] ? 0 : 255
    const offset = index * 4
    pixels.data[offset] = value
    pixels.data[offset + 1] = value
    pixels.data[offset + 2] = value
    pixels.data[offset + 3] = 255
  }
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.putImageData(pixels, 0, 0)
  return { canvas, ink, lines: { horizontal, vertical }, width: canvas.width, height: canvas.height }
}

/** Клетка отдельной картинкой: с белым полем и увеличенная до читаемой высоты. */
function cropCell(photo: PreparedPhoto, rectangle: ScheduleRectangle) {
  const scale = Math.max(1, Math.min(3, 120 / rectangle.height))
  const padding = 16
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(rectangle.width * scale) + padding * 2
  canvas.height = Math.round(rectangle.height * scale) + padding * 2
  const context = canvas.getContext('2d')
  if (!context) return photo.canvas
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.imageSmoothingQuality = 'high'
  context.drawImage(photo.canvas, rectangle.left, rectangle.top, rectangle.width, rectangle.height, padding, padding, canvas.width - padding * 2, canvas.height - padding * 2)
  return canvas
}

export type ScheduleRecognition = { entries: ScheduleEntry[]; rawText: string }

type RecognitionOptions = {
  /** Каталог со своими воркером и ядром tesseract.js. */
  assetBase: string
  onProgress: (progress: number, message: string) => void
  isCancelled: () => boolean
}

function loadingLabel(status: string) {
  const labels: Record<string, string> = {
    'loading tesseract core': 'Запускаем распознавание',
    'initializing tesseract': 'Настраиваем распознавание',
    'loading language traineddata': 'Загружаем русский язык',
    'initializing api': 'Готовим изображение',
  }
  return labels[status] ?? 'Обрабатываем фото'
}

/**
 * Распознаёт расписание на фото. Возвращает null, если распознавание
 * отменили. Сначала весь снимок - чтобы найти дни, время и сетку, затем каждая
 * клетка отдельно: мелкий текст внутри клетки читается заметно лучше.
 */
export async function recognizeSchedulePhoto(file: File, { assetBase, onProgress, isCancelled }: RecognitionOptions): Promise<ScheduleRecognition | null> {
  onProgress(0.03, 'Выравниваем снимок')
  const { createWorker, PSM } = await import('tesseract.js')
  await nextFrame()
  const photo = await preparePhoto(file)
  if (isCancelled()) return null

  let stage: 'loading' | 'page' | 'cells' = 'loading'
  let cellsDone = 0
  let cellsTotal = 1
  // Только русский: английская модель добавляла латиницу в русские слова
  // («Anre6pa») и вдвое удлиняла загрузку.
  const worker = await createWorker('rus', undefined, {
    workerPath: `${assetBase}/worker.min.js`,
    corePath: `${assetBase}/core`,
    logger: ({ progress, status }) => {
      if (isCancelled()) return
      if (status !== 'recognizing text') onProgress(0.06 + (progress || 0) * 0.08, loadingLabel(status))
      else if (stage === 'page') onProgress(0.15 + (progress || 0) * 0.4, 'Ищем дни недели и время')
      else if (stage === 'cells') onProgress(0.56 + ((cellsDone + (progress || 0)) / cellsTotal) * 0.42, `Читаем клетку ${Math.min(cellsDone + 1, cellsTotal)} из ${cellsTotal}`)
    },
  })

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    })
    stage = 'page'
    const { data } = await worker.recognize(photo.canvas, {}, { text: true, tsv: true })
    if (isCancelled()) return null
    const rawText = data.text.trim()
    const tsv = data.tsv ?? ''
    const cells = getScheduleTableCells(tsv, photo.lines)
    if (cells.length === 0) return { entries: parseScheduleText(data.text), rawText }

    const fallback = new Map(parseScheduleTableTsv(tsv, photo.lines).map((entry) => [`${entry.day}:${entry.time}`, entry]))
    // Пустая клетка не распознаётся вовсе: это и быстрее, и без выдуманных уроков.
    const inked = cells.filter((cell) => inkShare(photo.ink, photo.width, cell.rectangle) > 0.004)
    cellsTotal = Math.max(1, inked.length)
    stage = 'cells'
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })

    const results = new Map<ScheduleTableCell, { subject: string; room: string }>()
    const cellTexts: string[] = []
    // Воркер один: клетки читаются по очереди, отмена проверяется между ними.
    for (const cell of inked) {
      if (isCancelled()) return null
      // eslint-disable-next-line no-await-in-loop
      const { data: cellData } = await worker.recognize(cropCell(photo, cell.rectangle), {}, { text: true })
      results.set(cell, parseScheduleCellText(cellData.text, cellData.confidence))
      cellTexts.push(cellData.text.trim())
      cellsDone += 1
    }

    const unresolved = inked.filter((cell) => !results.get(cell)?.subject)
    if (unresolved.length > 0) {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
      for (const cell of unresolved) {
        if (isCancelled()) return null
        // eslint-disable-next-line no-await-in-loop
        const { data: retryData } = await worker.recognize(cropCell(photo, cell.rectangle), {}, { text: true })
        const retry = parseScheduleCellText(retryData.text, retryData.confidence)
        if (retry.subject) results.set(cell, retry)
      }
    }

    const entries = cells.map<ScheduleEntry>((cell) => {
      const read = results.get(cell)
      const backup = fallback.get(`${cell.day}:${cell.time}`)
      const subject = read?.subject || backup?.subject || ''
      return {
        id: makeScheduleEntryId(),
        day: cell.day,
        time: cell.time,
        subject,
        room: subject ? (read?.room || backup?.room || '') : '',
      }
    })
    return { entries, rawText: rawText || cellTexts.filter(Boolean).join('\n') }
  } finally {
    await worker.terminate()
  }
}
