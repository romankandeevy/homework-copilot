export const solutionPriceTiers = [5, 10, 15] as const

export type SolutionPrice = typeof solutionPriceTiers[number]

function chapterLengthFor(textbookId: string) {
  if (textbookId === 'geometry') return 60
  if (textbookId === 'physics' || textbookId === 'chemistry') return 45
  return 40
}

export function getSolutionPrice(textbookId: string, task: string | number, source: 'number' | 'photo' = 'number'): SolutionPrice {
  if (source === 'photo') return 15

  const taskNumber = typeof task === 'number' ? task : Number.parseInt(task, 10)
  if (!Number.isInteger(taskNumber) || taskNumber < 1) return 15

  const chapterLength = chapterLengthFor(textbookId)
  const positionInChapter = (taskNumber - 1) % chapterLength
  const easyTaskLimit = Math.ceil(chapterLength / 3)
  const mediumTaskLimit = Math.ceil((chapterLength * 2) / 3)

  if (positionInChapter < easyTaskLimit) return 5
  if (positionInChapter < mediumTaskLimit) return 10
  return 15
}
