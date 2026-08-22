import { describe, expect, it } from 'vitest'
import { parseScheduleTableTsv, parseScheduleText } from './scheduleOcr'

function makeTsv(words: ReadonlyArray<{ text: string; x: number; y: number; width?: number; height?: number }>) {
  const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'
  const rows = words.map(({ text, x, y, width = 70, height = 14 }, index) => (
    `5\t1\t1\t1\t${index + 1}\t1\t${x}\t${y}\t${width}\t${height}\t90\t${text}`
  ))
  return [header, ...rows].join('\n')
}

describe('schedule OCR parser', () => {
  it('turns recognized Russian timetable rows into editable lessons', () => {
    const rows = parseScheduleText(`
      Понедельник
      1. 08:30 Алгебра кабинет 312
      2. 09:25 Русский язык 218
      Вторник
      08.30 Геометрия каб. 406
    `)

    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ day: 'monday', time: '08:30', subject: 'Алгебра', room: '312' })
    expect(rows[1]).toMatchObject({ day: 'monday', time: '09:25', subject: 'Русский язык', room: '218' })
    expect(rows[2]).toMatchObject({ day: 'tuesday', time: '08:30', subject: 'Геометрия', room: '406' })
  })

  it('keeps useful subjects even when OCR misses time and room columns', () => {
    const rows = parseScheduleText('Алгебра\nФизика\nИстория')

    expect(rows.map(({ subject }) => subject)).toEqual(['Алгебра', 'Физика', 'История'])
    expect(rows.map(({ time }) => time)).toEqual(['08:30', '09:25', '10:20'])
  })

  it('maps photographed table cells by weekday columns and lesson rows', () => {
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
      { day: 'tuesday', time: '08:30', subject: 'Русский язык' },
      { day: 'thursday', time: '08:30', subject: 'Биология' },
      { day: 'monday', time: '09:25', subject: 'Физкультура' },
      { day: 'tuesday', time: '09:25', subject: 'История' },
      { day: 'wednesday', time: '09:25', subject: 'Алгебра' },
      { day: 'friday', time: '09:25', subject: 'Геометрия' },
    ])
    expect(rows[0]?.room).toBe('404')
  })
})
