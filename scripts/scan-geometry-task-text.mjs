/* Страницы PDF разбираются по очереди: разбор держит общий документ. */
/* eslint-disable no-await-in-loop */
import { access, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createWorker, PSM } from 'tesseract.js'

const imageDirectory = path.resolve(process.argv[2] ?? 'tmp/textbook-pages/geometry')
const markerFile = path.resolve(process.argv[3] ?? 'tmp/pdfs/geometry-task-markers.json')
const outputFile = path.resolve(process.argv[4] ?? 'tmp/pdfs/geometry-task-text-scan.json')
const imageScale = Math.max(1, Number.parseInt(process.argv[5] ?? process.env.GEOMETRY_OCR_SCALE ?? '1', 10) || 1)
const requestedWorkers = Number.parseInt(process.env.GEOMETRY_OCR_WORKERS ?? '', 10)
const workerCount = Number.isFinite(requestedWorkers)
  ? Math.max(1, Math.min(requestedWorkers, 8))
  : Math.max(1, Math.min(4, os.availableParallelism()))

const markerIndex = JSON.parse(await readFile(markerFile, 'utf8'))
const tasksByPage = new Map()
for (const task of markerIndex.tasks) {
  const pageTasks = tasksByPage.get(task.pageNumber) ?? []
  pageTasks.push(task)
  tasksByPage.set(task.pageNumber, pageTasks)
}
for (const pageTasks of tasksByPage.values()) pageTasks.sort((left, right) => left.y - right.y)

const existingPages = new Map()
try {
  await access(outputFile)
  const existing = JSON.parse(await readFile(outputFile, 'utf8'))
  for (const page of existing.pages ?? []) existingPages.set(page.pageNumber, page)
} catch {
  // A missing checkpoint starts a fresh scan.
}

const forcedPages = new Set(String(process.env.GEOMETRY_FORCE_PAGES ?? '')
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter(Number.isFinite))
for (const pageNumber of forcedPages) existingPages.delete(pageNumber)

const pageNumbers = [...tasksByPage.keys()].sort((left, right) => left - right)
const pendingPages = pageNumbers.filter((pageNumber) => !existingPages.has(pageNumber))
let nextPageIndex = 0
let completedThisRun = 0
let checkpoint = Promise.resolve()

function normalizeLine(value) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
}

function isNonConditionLine(value) {
  return /^(?:глава(?!\p{L})|§\s*\d+|дополнительные\s+задачи|задачи\s+(?:к\s+главе|повышенной\s+трудности)|вопросы\s+(?:и\s+задачи|для\s+повторения)|рис\.?\s*\d+\s*$|скачан\s+с\s+vk\.)/iu.test(value)
}

function normalizeCondition(lines) {
  return lines
    .map(normalizeLine)
    .filter((line) => line.length > 0 && !isNonConditionLine(line))
    .join(' ')
    .replace(/([\p{L}])-\s+([\p{L}])/gu, '$1$2')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
}

function parseWords(tsv) {
  return String(tsv ?? '')
    .split('\n')
    .map((row) => row.split('\t'))
    .filter((columns) => columns[0] === '5' && columns[11]?.trim())
    .map((columns) => ({
      block: Number(columns[2]),
      paragraph: Number(columns[3]),
      line: Number(columns[4]),
      x: Number(columns[6]) / imageScale,
      y: Number(columns[7]) / imageScale,
      width: Number(columns[8]) / imageScale,
      height: Number(columns[9]) / imageScale,
      confidence: Math.max(0, Number(columns[10])),
      text: columns.slice(11).join('\t').trim(),
    }))
}

function getTaskLines(words, pageNumber, startY, endY) {
  const textLeft = pageNumber % 2 === 1 ? 148 : 118
  const groups = new Map()

  for (const word of words) {
    const middleY = word.y + word.height / 2
    if (middleY < startY || middleY >= endY || word.x + word.width <= textLeft) continue
    const key = `${word.block}:${word.paragraph}:${word.line}`
    const lineWords = groups.get(key) ?? []
    lineWords.push(word)
    groups.set(key, lineWords)
  }

  return [...groups.values()]
    .map((lineWords) => {
      lineWords.sort((left, right) => left.x - right.x)
      const conditionWords = lineWords.filter((word) => word.x + word.width > textLeft)
      const contiguousWords = []
      for (const word of conditionWords) {
        const previous = contiguousWords.at(-1)
        if (previous && word.x - (previous.x + previous.width) > 48) break
        contiguousWords.push(word)
      }
      if (contiguousWords.length === 0) return null
      return {
        y: Math.min(...contiguousWords.map((word) => word.y)),
        bottom: Math.max(...contiguousWords.map((word) => word.y + word.height)),
        left: Math.min(...contiguousWords.map((word) => word.x)),
        confidence: contiguousWords.reduce((total, word) => total + word.confidence, 0) / contiguousWords.length,
        text: contiguousWords.map((word) => word.text).join(' '),
      }
    })
    .filter(Boolean)
    .filter((line) => line.left < 340)
    .sort((left, right) => left.y - right.y)
}

function manualCondition(task) {
  if (task === 1) return 'Проведите прямую, обозначьте её буквой a и отметьте точки A и B, лежащие на этой прямой, и точки P, Q и R, не лежащие на ней. Опишите взаимное расположение точек A, B, P, Q, R и прямой a, используя символы ∈ и ∉.'
  if (task === 2) return 'Отметьте три точки А, В и С, не лежащие на одной прямой, и через каждую пару точек проведите прямую. Сколько прямых получилось?'
  if (task === 3) return 'Проведите три прямые так, чтобы каждые две из них пересекались. Обозначьте все точки пересечения этих прямых. Сколько получилось точек? Рассмотрите все возможные случаи.'
  return ''
}

function trimConditionLines(lines, hasNextTaskOnPage, pageNumber) {
  if (hasNextTaskOnPage || lines.length < 2) return lines
  const contiguous = [lines[0]]
  const expectedTextLeft = pageNumber % 2 === 1 ? 148 : 118
  for (const line of lines.slice(1)) {
    const previous = contiguous[contiguous.length - 1]
    if (line.y - previous.bottom > 28) break
    if (line.left < expectedTextLeft - 20) break
    if (isNonConditionLine(line.text)) break
    contiguous.push(line)
  }
  return contiguous
}

function scanPage(pageNumber, words) {
  const pageTasks = tasksByPage.get(pageNumber)
  return {
    pageNumber,
    tasks: pageTasks.map((task, index) => {
      const next = pageTasks[index + 1]
      const startY = Math.max(45, task.y - 5)
      const endY = next ? Math.max(startY + 24, next.y - 5) : 995
      const lines = trimConditionLines(getTaskLines(words, pageNumber, startY, endY), Boolean(next), pageNumber)
      const recognizedCondition = normalizeCondition(lines.map((line) => line.text))
      const condition = manualCondition(task.task) || recognizedCondition
      const hasDiagram = /(?:^|[^\p{L}])(?:рис|puc)[\p{L}.\-\s]{0,8}\d+/iu.test(condition)
      const regionTop = Math.max(45, Math.floor(task.y - 12))
      const tightBottom = Math.min(995, Math.ceil(endY + 5))
      const regionBottom = tightBottom
      const regionLeft = pageNumber % 2 === 1 ? 94 : 64
      const regionRight = 790
      const confidence = lines.length > 0
        ? Math.round(lines.reduce((total, line) => total + line.confidence, 0) / lines.length)
        : 0

      return {
        task: task.task,
        condition,
        ocrConfidence: confidence,
        hasDiagram,
        sourceRegion: {
          page: pageNumber,
          x: regionLeft,
          y: regionTop,
          width: regionRight - regionLeft,
          height: Math.max(36, regionBottom - regionTop),
          sourceWidth: 827,
          sourceHeight: 1100,
        },
      }
    }),
  }
}

async function saveCheckpoint() {
  const pages = [...existingPages.values()].sort((left, right) => left.pageNumber - right.pageNumber)
  await writeFile(outputFile, `${JSON.stringify({ pages }, null, 2)}\n`, 'utf8')
}

async function runWorker(workerNumber) {
  const worker = await createWorker(['rus', 'eng'])
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.AUTO,
    preserve_interword_spaces: '0',
    user_defined_dpi: '300',
  })

  while (true) {
    const jobIndex = nextPageIndex
    nextPageIndex += 1
    if (jobIndex >= pendingPages.length) break

    const pageNumber = pendingPages[jobIndex]
    const fileName = `page-${String(pageNumber).padStart(4, '0')}.jpg`
    const { data } = await worker.recognize(
      path.join(imageDirectory, fileName),
      {},
      { text: true, tsv: true },
    )
    existingPages.set(pageNumber, scanPage(pageNumber, parseWords(data.tsv)))
    completedThisRun += 1

    if (completedThisRun % 10 === 0 || completedThisRun === pendingPages.length) {
      const completed = existingPages.size
      process.stdout.write(`${completed}/${pageNumbers.length}\tpage ${pageNumber}\tworker ${workerNumber}\n`)
      checkpoint = checkpoint.then(saveCheckpoint)
      await checkpoint
    }
  }

  await worker.terminate()
}

process.stdout.write(`pages=${pageNumbers.length}\tpending=${pendingPages.length}\tworkers=${workerCount}\n`)
await Promise.all(Array.from({ length: Math.min(workerCount, Math.max(1, pendingPages.length)) }, (_, index) => runWorker(index + 1)))
await checkpoint
await saveCheckpoint()

const allTasks = [...existingPages.values()].flatMap((page) => page.tasks).sort((left, right) => left.task - right.task)
const missingConditions = allTasks.filter((task) => task.condition.length < 8).map((task) => task.task)
process.stdout.write(`tasks=${allTasks.length}\tmissing=${missingConditions.length}\n`)
if (missingConditions.length > 0) process.stdout.write(`${JSON.stringify(missingConditions)}\n`)
