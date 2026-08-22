import { describe, expect, it } from 'vitest'
import { parseScheduleText } from './scheduleOcr'

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
})
