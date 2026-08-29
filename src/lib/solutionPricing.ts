// Цены в копейках: 5 / 10 / 15 ₽.
export const solutionPriceTiers = [500, 1000, 1500] as const

export type SolutionPrice = typeof solutionPriceTiers[number]

function chapterLengthFor(textbookId: string) {
  if (textbookId === 'geometry') return 60
  if (textbookId === 'physics' || textbookId === 'chemistry') return 45
  return 40
}

export function getSolutionPrice(textbookId: string, task: string | number, source: 'number' | 'photo' = 'number'): SolutionPrice {
  if (source === 'photo') return 1500

  const taskNumber = typeof task === 'number' ? task : Number.parseInt(task, 10)
  if (!Number.isInteger(taskNumber) || taskNumber < 1) return 1500

  const chapterLength = chapterLengthFor(textbookId)
  const positionInChapter = (taskNumber - 1) % chapterLength
  const easyTaskLimit = Math.ceil(chapterLength / 3)
  const mediumTaskLimit = Math.ceil((chapterLength * 2) / 3)

  if (positionInChapter < easyTaskLimit) return 500
  if (positionInChapter < mediumTaskLimit) return 1000
  return 1500
}
