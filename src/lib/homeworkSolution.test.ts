import { afterEach, describe, expect, it } from 'vitest'
import {
  generatedSolutionsStorageKey,
  loadGeneratedSolutions,
  parseStoredHomeworkSolution,
  saveGeneratedSolutions,
} from './homeworkSolution'
import type { HomeworkSolution } from './homeworkContract'

const solution: HomeworkSolution = {
  textbookId: 'geometry',
  task: 'photo-test',
  source: 'photo',
  textbookEdition: '14-е издание, Просвещение, 2023',
  sourceUrl: 'photo',
  conditionNormalized: 'найдите стороны подобного треугольника.',
  subject: 'Геометрия',
  textbookTitle: 'Геометрия. 7-9 классы',
  condition: 'Найдите стороны подобного треугольника.',
  given: ['△ABC'],
  goal: { title: 'Найти', text: 'Стороны.' },
  steps: ['k = 1/2.'],
  answer: '4 см, 8 см, 10 см.',
  diagram: { kind: 'triangle', description: 'Треугольник ABC.', vertices: ['A', 'B', 'C'] },
  sourceVerified: true,
  createdAt: '2026-08-25T18:00:00.000Z',
}

afterEach(() => window.localStorage.clear())

describe('stored homework solutions', () => {
  it('restores a purchased answer for its current account on another device', () => {
    expect(parseStoredHomeworkSolution({ ...solution, ownerId: 'creator' }, 'buyer')).toEqual({
      ...solution,
      ownerId: 'buyer',
    })
  })

  it('rejects incomplete and malformed stored answers', () => {
    expect(parseStoredHomeworkSolution(null)).toBeNull()
    expect(parseStoredHomeworkSolution({ ...solution, condition: 42 })).toBeNull()
    expect(parseStoredHomeworkSolution({ ...solution, steps: 'answer' })).toBeNull()
  })

  it('keeps the browser cache as a fallback without treating corrupt entries as answers', () => {
    saveGeneratedSolutions([solution])
    expect(loadGeneratedSolutions()).toEqual([solution])

    window.localStorage.setItem(generatedSolutionsStorageKey, JSON.stringify([solution, { task: '999' }]))
    expect(loadGeneratedSolutions()).toEqual([solution])
  })
})
