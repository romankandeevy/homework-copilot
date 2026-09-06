import { describe, expect, it } from 'vitest'
import { solvableSubjects } from '../src/lib/subjects.ts'
import {
  defaultHomeworkModels,
  homeworkModelsBySubject,
  homeworkModelsForSubject,
} from './homeworkModels.ts'

/* Модель выбирается предметом.

   6 сентября общий пул выдал на комбинаторике 8616 вместо 9744: быстрая
   модель не держит длинную счётную цепочку. Держать её должна голова пула
   счётного предмета, а на разборе слова платить за неё нечем. */

describe('модель под предмет', () => {
  it('на счётном предмете первой идёт reasoning-модель', () => {
    expect(homeworkModelsForSubject('Математика')[0]).toBe('gpt-5-6-sol')
    expect(homeworkModelsForSubject('Физика')[0]).toBe('gpt-5-6-sol')
    expect(homeworkModelsForSubject('Информатика')[0]).toBe('gpt-5-6-sol')
  })

  it('на предмете слова и на геометрии первой идёт быстрая модель', () => {
    expect(homeworkModelsForSubject('Русский язык')[0]).toBe('gemini-3-6-flash-openai')
    expect(homeworkModelsForSubject('История')[0]).toBe('gemini-3-6-flash-openai')
    // Геометрии нужен чертёж, а не длинный счёт: там быстрая модель проверена.
    expect(homeworkModelsForSubject('Геометрия')[0]).toBe('gemini-3-6-flash-openai')
  })

  it('понимает и название предмета, и его идентификатор', () => {
    expect(homeworkModelsForSubject('mathematics')).toEqual(homeworkModelsForSubject('Математика'))
    expect(homeworkModelsForSubject('  Химия  ')[0]).toBe('gpt-5-6-sol')
  })

  it('у незнакомого предмета остаётся общий пул', () => {
    expect(homeworkModelsForSubject('Труд')).toEqual(defaultHomeworkModels)
    expect(homeworkModelsForSubject('')).toEqual(defaultHomeworkModels)
  })

  it('пул задан для каждого предмета из списка и нигде не пуст', () => {
    for (const subject of solvableSubjects) {
      const pool = homeworkModelsBySubject[subject.id]
      expect(pool, subject.name).toBeDefined()
      expect(pool.length, subject.name).toBeGreaterThan(1)
      expect(new Set(pool).size, subject.name).toBe(pool.length)
    }
  })

  it('дорогих моделей в пулах нет: вызов не может стоить больше решения', () => {
    // Решение стоит 5 ₽, кредит — примерно 0,5 ₽. gpt-5-5 берёт 12 кредитов.
    const banned = ['gpt-5-5', 'gpt-5-6-luna', 'claude-opus-5', 'grok-4-6']
    for (const pool of Object.values(homeworkModelsBySubject)) {
      for (const model of banned) expect(pool).not.toContain(model)
    }
  })
})
