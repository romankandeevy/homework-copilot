import type { HomeworkSolution } from './homeworkContract'
import { isReviewedHomeworkSolution } from './homeworkSolution'

type CatalogSolutionIdentity = {
  textbook_id: string
  textbook_edition: string
  source_url: string
  task: string
}

type TextbookIdentity = {
  id: string
  edition: string
  sourceUrl?: string
}

export function catalogSolutionEntries<Textbook extends TextbookIdentity>(
  catalog: readonly CatalogSolutionIdentity[],
  textbooks: readonly Textbook[],
) {
  return catalog.flatMap((solution) => {
    const textbook = textbooks.find((item) => item.id === solution.textbook_id
      && item.edition === solution.textbook_edition
      && item.sourceUrl === solution.source_url)
    return textbook ? [{ textbook, task: solution.task }] : []
  })
}

export function findAvailableNumberSolution(
  solutions: readonly HomeworkSolution[],
  textbookId: string,
  task: string,
) {
  return solutions.find((solution) => solution.textbookId === textbookId
    && solution.task === task
    && solution.source === 'number'
    && isReviewedHomeworkSolution(solution))
}
