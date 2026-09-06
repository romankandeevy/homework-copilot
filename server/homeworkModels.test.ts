import { describe, expect, it } from 'vitest'
import { solvableSubjects } from '../src/lib/subjects.ts'
import {
  defaultHomeworkModels,
  homeworkModelsBySubject,
  homeworkModelsForSubject,
} from './homeworkModels.ts'

/* Модель выбирается предметом.

   Пул перестал быть общим, чтобы порядок моделей можно было менять по
   предметам, не трогая остальные. Головы при этом одинаковые: замер
   6 сентября показал, что дорогая reasoning-модель ошибается там же, где
   дешёвая, только вчетверо дороже. */

describe('модель под предмет', () => {
  /* Головой везде стоит проверенная быстрая модель. Дорогую reasoning
     6 сентября прогнали полным решателем на той самой комбинаторике:
     75 секунд, 6,10 кредита и НЕВЕРНЫЙ ответ - вчетверо дороже за тот же
     промах. Держим её последней, на отказ шлюза. */
  it('везде первой идёт проверенная быстрая модель', () => {
    for (const subject of ['Математика', 'Физика', 'Информатика', 'Русский язык', 'История', 'Геометрия']) {
      expect(homeworkModelsForSubject(subject)[0], subject).toBe('gemini-3-6-flash-openai')
    }
  })

  it('дорогая модель стоит последней, а не первой', () => {
    const counting = homeworkModelsForSubject('Математика')
    expect(counting.at(-1)).toBe('gpt-5-6-sol')
    expect(counting.indexOf('gpt-5-6-sol')).toBeGreaterThan(0)
  })

  it('у счётного предмета и предмета слова порядок разный', () => {
    // Разделение остаётся: замер по предметам ещё не сделан, но место для
    // него есть, и менять пул одного предмета можно, не трогая остальные.
    expect(homeworkModelsForSubject('Геометрия')).not.toEqual(homeworkModelsForSubject('Русский язык'))
  })

  it('понимает и название предмета, и его идентификатор', () => {
    expect(homeworkModelsForSubject('mathematics')).toEqual(homeworkModelsForSubject('Математика'))
    expect(homeworkModelsForSubject('  Химия  ')[0]).toBe('gemini-3-6-flash-openai')
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
    expect(Object.keys(homeworkModelsBySubject).length).toBeGreaterThan(0)
    for (const pool of Object.values(homeworkModelsBySubject)) {
      for (const model of banned) expect(pool).not.toContain(model)
    }
  })
})
