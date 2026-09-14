import { describe, expect, it } from 'vitest'
import {
  binarizeAdaptive,
  changeLessonRange,
  detectTableLines,
  estimateSkewDegrees,
  extractLessonTimes,
  extractRooms,
  findScheduleSubjects,
  getScheduleTableCells,
  matchWeekday,
  normalizeLessonTimeRange,
  parseClockTime,
  parseScheduleCellText,
  parseScheduleTableTsv,
  parseScheduleText,
  readScheduleSettings,
  stretchContrast,
  toGrayImage,
  writeScheduleRecords,
} from './scheduleOcr'
import type { GrayImage, ScheduleEntry } from './scheduleOcr'

type TsvWord = { text: string; x: number; y: number; width?: number; height?: number; line?: number }

function makeTsv(words: readonly TsvWord[]) {
  const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'
  const rows = words.map(({ text, x, y, width = 70, height = 14, line }, index) => (
    `5\t1\t1\t1\t${line ?? index + 1}\t1\t${x}\t${y}\t${width}\t${height}\t90\t${text}`
  ))
  return [header, ...rows].join('\n')
}

const lessons = (rows: readonly ScheduleEntry[]) => rows.map(({ day, time, subject, room }) => ({ day, time, subject, room }))

describe('время урока', () => {
  it('понимает время в любой школьной записи', () => {
    for (const value of ['8.30', '8:30', '8 30', '830', '0830', '8,30', '08:30', 'O8:3O', '8ч30']) {
      expect(parseClockTime(value), value).toBe('08:30')
    }
    expect(parseClockTime('9')).toBe('09:00')
    expect(parseClockTime('24:00')).toBe('')
    expect(parseClockTime('8:75')).toBe('')
    expect(parseClockTime('Алгебра')).toBe('')
  })

  it('находит звонки в строке и не принимает за них кабинет, дату и номер урока', () => {
    expect(extractLessonTimes('1. 8.30-9.15 Алгебра')).toEqual(['08:30', '09:15'])
    expect(extractLessonTimes('7. 14:20–15:05 Химия')).toEqual(['14:20', '15:05'])
    expect(extractLessonTimes('1.08:30 - 09:15')).toEqual(['08:30', '09:15'])
    expect(extractLessonTimes('8 30 - 9 15 Физика')).toEqual(['08:30', '09:15'])
    expect(extractLessonTimes('830-915')).toEqual(['08:30', '09:15'])
    expect(extractLessonTimes('l0.3O-11.15')).toEqual(['10:30', '11:15'])
    expect(extractLessonTimes('Алгебра каб. 312 45')).toEqual([])
    expect(extractLessonTimes('Понедельник 15.09.2026')).toEqual([])
    expect(extractLessonTimes('кабинеты 312-314')).toEqual([])
  })

  it('держит сохранённый формат и достраивает конец урока', () => {
    expect(normalizeLessonTimeRange('08:30-09:15')).toBe('08:30-09:15')
    expect(normalizeLessonTimeRange('8.30 - 9.15')).toBe('08:30-09:15')
    expect(normalizeLessonTimeRange('08:30')).toBe('08:30-09:15')
    expect(normalizeLessonTimeRange('16:00')).toBe('16:00-16:45')
  })

  it('правит начало и конец урока, не ломая порядок', () => {
    expect(changeLessonRange('08:30-09:15', 'start', '8.00')).toBe('08:00-09:15')
    // Начало за концом тянет конец за собой, длина урока та же.
    expect(changeLessonRange('08:30-09:15', 'start', '9 20')).toBe('09:20-10:05')
    expect(changeLessonRange('08:30-09:15', 'end', '910')).toBe('08:30-09:10')
    expect(changeLessonRange('08:30-09:15', 'end', '8:00')).toBeNull()
    expect(changeLessonRange('08:30-09:15', 'start', 'abc')).toBeNull()
  })
})

describe('предметы и кабинеты', () => {
  it('узнаёт школьные сокращения и шум распознавания', () => {
    const cases: Array<[string, string]> = [
      ['Anre6pa', 'Алгебра'],
      ['алг.', 'Алгебра'],
      ['Геом.', 'Геометрия'],
      ['Рус. яз.', 'Русский язык'],
      ['Русск.яз', 'Русский язык'],
      ['Pусский язык', 'Русский язык'],
      ['Руский язык', 'Русский язык'],
      ['Лит-ра', 'Литература'],
      ['Литер.', 'Литература'],
      ['Физ-ра', 'Физкультура'],
      ['физкультура', 'Физкультура'],
      ['Англ.яз.', 'Английский язык'],
      ['Информ.', 'Информатика'],
      ['Обществозн.', 'Обществознание'],
      ['Геогр.', 'География'],
      ['6иология', 'Биология'],
      ['ИЗО', 'ИЗО'],
      ['ОБЖ', 'ОБЖ'],
      ['ОБЗР', 'ОБЗР'],
      ['Вероятн. и стат.', 'Вероятность и статистика'],
      ['Разговоры о важном', 'Разговоры о важном'],
      ['Россия - мои горизонты', 'Мои горизонты'],
      ['Кл. час', 'Классный час'],
      ['Информатнка', 'Информатика'],
      ['Mатематика', 'Математика'],
    ]
    for (const [text, subject] of cases) expect(findScheduleSubjects(text), text).toEqual([subject])
  })

  it('делит групповой урок и не путает фамилию учителя с предметом', () => {
    expect(parseScheduleCellText('Англ.яз / Информ.')).toEqual({ subject: 'Английский язык / Информатика', room: '' })
    expect(parseScheduleCellText('Биология\nИванова Н.П.\nкаб. 21б')).toEqual({ subject: 'Биология', room: '21б' })
    expect(parseScheduleCellText('Физ-ра с/з')).toEqual({ subject: 'Физкультура', room: 'Спортзал' })
    expect(parseScheduleCellText('Химия З12')).toEqual({ subject: 'Химия', room: '312' })
    expect(parseScheduleCellText('Алгебра 312 / 314')).toEqual({ subject: 'Алгебра', room: '312 / 314' })
  })

  it('оставляет пустым то, что похоже на шум, а не на урок', () => {
    for (const noise of ['|| ~~ .,', 'щшщ ъъъ', '—', 'Петрова А.А.', 'l1 |', '312', 'ааааа']) {
      expect(parseScheduleCellText(noise, 90).subject, noise).toBe('')
    }
    // Незнакомый предмет принимается, только если распознавание в нём уверено.
    expect(parseScheduleCellText('Шахматы', 90).subject).toBe('Шахматы')
    expect(parseScheduleCellText('Шахматы', 30).subject).toBe('')
  })

  it('находит кабинет в разных записях', () => {
    expect(extractRooms('Алгебра каб. 312')).toBe('312')
    expect(extractRooms('Физика кабинет №5')).toBe('5')
    expect(extractRooms('Химия 8:30-9:15 204а')).toBe('204а')
    expect(extractRooms('Актовый зал')).toBe('Актовый зал')
    expect(extractRooms('Физика 8.30')).toBe('')
  })
})

describe('дни недели', () => {
  it('узнаёт дни в полном и коротком написании с ошибками распознавания', () => {
    const cases: Array<[string, string]> = [
      ['Понедельник', 'monday'],
      ['Понедельннк', 'monday'],
      ['ПН', 'monday'],
      ['Bторник', 'tuesday'],
      ['Cреда,', 'wednesday'],
      ['4т', 'thursday'],
      ['Четверr', 'thursday'],
      ['ПЯТНИЦА', 'friday'],
      ['Пятнпца', 'friday'],
      ['C6', 'saturday'],
      ['Суббота', 'saturday'],
    ]
    for (const [text, day] of cases) expect(matchWeekday(text), text).toBe(day)
    for (const text of ['Алгебра', 'Физика', 'Среднее', 'каб']) expect(matchWeekday(text), text).toBeNull()
  })
})

describe('расписание строками', () => {
  it('разбирает зашумлённый список по дням', () => {
    const rows = parseScheduleText(`
      РАСПИСАНИЕ 7Б
      Понедельник
      1. 8.30-9.15 Разговоры о важном каб. 21
      2 9:25 - 10:10 Anre6pa 312
      Перемена 20 мин
      3. 10.30–11.15 Рус. яз. 218
      Вторник, 16.09
      1 8 30 9 15 Физ-ра с/з
      2) Геом. 312
      ~~ ,, |
    `)

    expect(lessons(rows)).toEqual([
      { day: 'monday', time: '08:30-09:15', subject: 'Разговоры о важном', room: '21' },
      { day: 'monday', time: '09:25-10:10', subject: 'Алгебра', room: '312' },
      { day: 'monday', time: '10:30-11:15', subject: 'Русский язык', room: '218' },
      { day: 'tuesday', time: '08:30-09:15', subject: 'Физкультура', room: 'Спортзал' },
      { day: 'tuesday', time: '09:25-10:10', subject: 'Геометрия', room: '312' },
    ])
  })

  it('держит прежний формат: время, предмет, кабинет', () => {
    const rows = parseScheduleText(`
      Понедельник
      1. 08:30 Алгебра кабинет 312
      2. 09:25 Русский язык 218
      Вторник
      08.30 Геометрия каб. 406
    `)

    expect(lessons(rows)).toEqual([
      { day: 'monday', time: '08:30-09:15', subject: 'Алгебра', room: '312' },
      { day: 'monday', time: '09:25-10:10', subject: 'Русский язык', room: '218' },
      { day: 'tuesday', time: '08:30-09:15', subject: 'Геометрия', room: '406' },
    ])
  })

  it('оставляет предметы, даже когда время и кабинеты не прочитались', () => {
    const rows = parseScheduleText('Алгебра\nФизика\nИстория')

    expect(rows.map(({ subject }) => subject)).toEqual(['Алгебра', 'Физика', 'История'])
    expect(rows.map(({ time }) => time)).toEqual(['08:30-09:15', '09:25-10:10', '10:30-11:15'])
  })

  it('читает строку таблицы, где день стоит слева, а уроки идут подряд', () => {
    const rows = parseScheduleText('Пн Алгебра Физика Химия\nВт Рус.яз Лит-ра Англ.яз')

    expect(rows.map(({ day, subject }) => `${day}:${subject}`)).toEqual([
      'monday:Алгебра', 'monday:Физика', 'monday:Химия',
      'tuesday:Русский язык', 'tuesday:Литература', 'tuesday:Английский язык',
    ])
    expect(rows.filter(({ day }) => day === 'tuesday').map(({ time }) => time)).toEqual(['08:30-09:15', '09:25-10:10', '10:30-11:15'])
  })
})

describe('таблица на снимке', () => {
  it('раскладывает клетки по столбцам дней и строкам уроков', () => {
    const tsv = makeTsv([
      { text: 'Понедельник', x: 250, y: 60, width: 110 },
      { text: 'Вторник', x: 430, y: 60, width: 70 },
      { text: 'Среда', x: 590, y: 60, width: 60 },
      { text: 'Четверг', x: 745, y: 60, width: 70 },
      { text: 'Пятница', x: 900, y: 60, width: 70 },
      { text: '08:30', x: 165, y: 101, width: 45 },
      { text: '09:15', x: 215, y: 101, width: 45 },
      { text: '09:25', x: 165, y: 131, width: 45 },
      { text: '10:10', x: 215, y: 131, width: 45 },
      { text: 'Русский', x: 430, y: 101 },
      { text: 'язык', x: 505, y: 101, width: 35 },
      { text: 'Биология', x: 745, y: 101, width: 80 },
      { text: '404', x: 440, y: 110, width: 28 },
      { text: 'Физкультура', x: 265, y: 131, width: 100 },
      { text: 'История', x: 430, y: 131, width: 65 },
      { text: 'Anre6pa', x: 585, y: 131, width: 75 },
      { text: 'Геометрия', x: 900, y: 131, width: 85 },
    ])

    const rows = parseScheduleTableTsv(tsv)

    expect(rows.map(({ day, time, subject }) => ({ day, time, subject }))).toEqual([
      { day: 'tuesday', time: '08:30-09:15', subject: 'Русский язык' },
      { day: 'thursday', time: '08:30-09:15', subject: 'Биология' },
      { day: 'monday', time: '09:25-10:10', subject: 'Физкультура' },
      { day: 'tuesday', time: '09:25-10:10', subject: 'История' },
      { day: 'wednesday', time: '09:25-10:10', subject: 'Алгебра' },
      { day: 'friday', time: '09:25-10:10', subject: 'Геометрия' },
    ])
    expect(rows[0]?.room).toBe('404')
  })

  it('собирает урок из начала и конца, записанных в клетке друг под другом', () => {
    const tsv = makeTsv([
      { text: 'Понедельннк', x: 250, y: 40, width: 110 },
      { text: 'Bторник', x: 430, y: 40, width: 70 },
      { text: 'Cреда', x: 590, y: 40, width: 60 },
      { text: '8.30', x: 120, y: 100, width: 40 },
      { text: '9.15', x: 120, y: 118, width: 40 },
      { text: '9.25', x: 120, y: 170, width: 40 },
      { text: '10.10', x: 120, y: 188, width: 48 },
      { text: 'Алг.', x: 270, y: 105 },
      { text: 'Лит-ра', x: 440, y: 175 },
      { text: 'Физ-ра', x: 600, y: 175 },
    ])

    expect(lessons(parseScheduleTableTsv(tsv))).toEqual([
      { day: 'monday', time: '08:30-09:15', subject: 'Алгебра', room: '' },
      { day: 'tuesday', time: '09:25-10:10', subject: 'Литература', room: '' },
      { day: 'wednesday', time: '09:25-10:10', subject: 'Физкультура', room: '' },
    ])
  })

  it('берёт клетки по линиям таблицы и восстанавливает непрочитанный заголовок дня', () => {
    const lines = { vertical: [20, 150, 300, 450, 600, 750, 900], horizontal: [10, 80, 150, 220, 290, 360] }
    const tsv = makeTsv([
      { text: 'Пн', x: 210, y: 35, width: 30 },
      { text: 'Вт', x: 360, y: 35, width: 30 },
      // Среда не прочиталась вовсе.
      { text: 'Чт', x: 660, y: 35, width: 30 },
      { text: 'Пт', x: 810, y: 35, width: 30 },
      { text: '1', x: 40, y: 105, width: 10 },
      { text: '2', x: 40, y: 175, width: 10 },
      { text: '3', x: 40, y: 245, width: 10 },
      { text: 'Химия', x: 180, y: 105 },
      { text: 'ИЗО', x: 480, y: 175 },
      { text: 'Музыка', x: 480, y: 245 },
    ])

    const cells = getScheduleTableCells(tsv, lines)
    expect(new Set(cells.map(({ day }) => day))).toEqual(new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']))
    // Пустая последняя строка таблицы уроком не считается.
    expect(new Set(cells.map(({ time }) => time))).toEqual(new Set(['08:30-09:15', '09:25-10:10', '10:30-11:15']))
    expect(cells.find(({ day, time }) => day === 'wednesday' && time === '09:25-10:10')?.rectangle).toMatchObject({ left: 454, top: 154 })

    expect(lessons(parseScheduleTableTsv(tsv, lines))).toEqual([
      { day: 'monday', time: '08:30-09:15', subject: 'Химия', room: '' },
      { day: 'wednesday', time: '09:25-10:10', subject: 'ИЗО', room: '' },
      { day: 'wednesday', time: '10:30-11:15', subject: 'Музыка', room: '' },
    ])
  })

  it('разбирает таблицу, где дни стоят строками, а уроки столбцами', () => {
    const tsv = makeTsv([
      { text: 'Пн', x: 40, y: 150, width: 30 },
      { text: 'Вт', x: 40, y: 230, width: 30 },
      { text: 'Ср', x: 40, y: 310, width: 30 },
      { text: '8:30-9:15', x: 200, y: 60, width: 110, line: 90 },
      { text: '9:25-10:10', x: 380, y: 60, width: 110, line: 90 },
      { text: '10:30-11:15', x: 560, y: 60, width: 110, line: 90 },
      { text: 'Алгебра', x: 200, y: 150 },
      { text: 'Физика', x: 380, y: 150 },
      { text: 'Химия', x: 560, y: 230 },
      { text: 'История', x: 380, y: 310 },
    ])

    expect(lessons(parseScheduleTableTsv(tsv))).toEqual([
      { day: 'monday', time: '08:30-09:15', subject: 'Алгебра', room: '' },
      { day: 'monday', time: '09:25-10:10', subject: 'Физика', room: '' },
      { day: 'wednesday', time: '09:25-10:10', subject: 'История', room: '' },
      { day: 'tuesday', time: '10:30-11:15', subject: 'Химия', room: '' },
    ])
  })
})

function makeImage(width: number, height: number, paint: (x: number, y: number) => number): GrayImage {
  const data = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data[y * width + x] = paint(x, y)
  return { width, height, data }
}

describe('подготовка снимка', () => {
  it('переводит в оттенки серого и растягивает блёклый контраст', () => {
    const gray = toGrayImage(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]), 3, 1)
    expect(Array.from(gray.data)).toEqual([76, 150, 29])

    const faded = makeImage(100, 1, (x) => 110 + Math.round(x / 3))
    stretchContrast(faded)
    expect(faded.data[0]).toBeLessThan(10)
    expect(faded.data[99]).toBeGreaterThan(245)
  })

  it('отделяет буквы от фона и в тени, и на тёмной шапке', () => {
    // Слева светло, справа густая тень; в обеих половинах тёмные штрихи.
    // Внизу тёмная полоса со светлыми буквами - как шапка таблицы.
    const strokes = (x: number, y: number) => y > 20 && y < 40 && x % 20 < 3
    const image = makeImage(400, 240, (x, y) => {
      if (y >= 140) return x % 20 < 3 && y > 170 && y < 200 ? 230 : 30
      const background = 235 - Math.round(x * 0.35)
      return strokes(x, y) ? background - 70 : background
    })
    const ink = binarizeAdaptive(image)
    const at = (x: number, y: number) => ink[y * 400 + x]

    expect(at(21, 30)).toBe(1)
    expect(at(381, 30)).toBe(1)
    expect(at(30, 30)).toBe(0)
    expect(at(370, 30)).toBe(0)
    // Светлая буква на тёмной шапке становится чернилами, тёмный фон - нет.
    expect(at(201, 185)).toBe(1)
    expect(at(210, 185)).toBe(0)
  })

  it('находит наклон строк и не крутит ровный снимок', () => {
    const tilted = new Uint8Array(600 * 400)
    const flat = new Uint8Array(600 * 400)
    const slope = Math.tan(3 * Math.PI / 180)
    for (let row = 40; row < 360; row += 30) {
      for (let x = 20; x < 580; x += 1) {
        if (x % 12 > 8) continue
        tilted[Math.round(row + x * slope) * 600 + x] = 1
        flat[row * 600 + x] = 1
      }
    }
    expect(estimateSkewDegrees(tilted, 600, 400)).toBeCloseTo(3, 0)
    expect(estimateSkewDegrees(flat, 600, 400)).toBe(0)
  })

  it('находит линии таблицы и стирает их, не задевая буквы', () => {
    const width = 500
    const height = 300
    const ink = new Uint8Array(width * height)
    for (const y of [20, 100, 180, 260]) for (let x = 20; x <= 480; x += 1) { ink[y * width + x] = 1; ink[(y + 1) * width + x] = 1 }
    for (const x of [20, 170, 330, 480]) for (let y = 20; y <= 261; y += 1) ink[y * width + x] = 1
    // Буква внутри клетки: короткие штрихи.
    for (let y = 50; y < 70; y += 1) for (let x = 60; x < 64; x += 1) ink[y * width + x] = 1

    const { horizontal, vertical, mask } = detectTableLines(ink, width, height)
    expect(horizontal).toEqual([21, 101, 181, 261])
    expect(vertical).toEqual([20, 170, 330, 480])
    expect(mask[100 * width + 250]).toBe(1)
    expect(mask[60 * width + 61]).toBe(0)
  })
})

describe('хранение', () => {
  const entries: ScheduleEntry[] = [{ id: 'a', day: 'saturday', time: '08:30-09:15', subject: 'Химия', room: '101' }]

  it('читает прежние данные как есть: суббота на месте', () => {
    expect(readScheduleSettings(entries)).toEqual({ saturday: true })
    expect(readScheduleSettings(null)).toEqual({ saturday: true })
    expect(writeScheduleRecords(entries, { saturday: true })).toEqual(entries)
  })

  it('хранит убранную субботу в том же массиве, что и уроки', () => {
    const stored = JSON.parse(JSON.stringify(writeScheduleRecords(entries, { saturday: false }))) as unknown[]
    expect(readScheduleSettings(stored)).toEqual({ saturday: false })
    // Уроки субботы не стираются: вернёшь субботу - они на месте.
    expect(stored).toContainEqual(entries[0])
    // Прежний разбор отбрасывает запись настроек: у неё нет дня и предмета.
    expect(stored.filter((item) => typeof item === 'object' && item !== null && 'day' in item)).toEqual(entries)
  })
})
