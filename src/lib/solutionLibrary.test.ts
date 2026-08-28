import { describe, expect, it } from 'vitest'
import type { HomeworkSolution } from './homeworkContract'
import { catalogSolutionEntries, findAvailableNumberSolution } from './solutionLibrary'

const textbook = {
  id: 'geometry',
  edition: '14-е издание, Просвещение, 2023',
  sourceUrl: '/textbooks/geometry-7-9-atanasyan.pdf',
}

function reviewedSolution(task: string): HomeworkSolution {
  return {
    engineVersion: 2,
    textbookId: textbook.id,
    task,
    source: 'number',
    textbookEdition: textbook.edition,
    sourceUrl: textbook.sourceUrl,
    sourcePage: 9,
    conditionNormalized: `задача ${task}`,
    subject: 'Геометрия',
    textbookTitle: 'Геометрия. 7-9 классы',
    condition: `Условие задачи ${task}.`,
    given: ['Дано.'],
    goal: { title: 'Найти', text: 'ответ.' },
    steps: ['Решение.'],
    answer: 'Ответ.',
    diagram: { kind: 'construction', description: 'Чертёж.', vertices: [] },
    sourceVerified: true,
    taskType: 'mixed',
    quality: { diagramRequired: true, reviewPassed: true, symbolicShare: 0.7 },
    createdAt: '2026-08-28T17:00:00.000Z',
  }
}

describe('solution library', () => {
  it('renders every catalogued task instead of a hard-coded solved-task list', () => {
    const catalog = ['2', '4', '9'].map((task) => ({
      textbook_id: textbook.id,
      textbook_edition: textbook.edition,
      source_url: textbook.sourceUrl,
      task,
    }))

    expect(catalogSolutionEntries(catalog, [{ ...textbook, solvedTasks: ['2'] }]).map(({ task }) => task))
      .toEqual(['2', '4', '9'])
  })

  it('opens a reviewed purchased task directly and rejects an unfinished copy', () => {
    const ready = reviewedSolution('4')
    const unfinished = { ...reviewedSolution('9'), quality: { diagramRequired: true, reviewPassed: false, symbolicShare: 0.7 } }

    expect(findAvailableNumberSolution([ready, unfinished], textbook.id, '4')).toBe(ready)
    expect(findAvailableNumberSolution([ready, unfinished], textbook.id, '9')).toBeUndefined()
  })
})
