/* Страницы PDF разбираются по очереди: разбор держит общий документ. */
/* eslint-disable no-await-in-loop */
import { access, readFile, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createWorker, PSM } from 'tesseract.js'

const imageDirectory = path.resolve(process.argv[2] ?? 'tmp/textbook-pages/geometry-text-2x')
const outputFile = path.resolve(process.argv[3] ?? 'tmp/pdfs/geometry-figure-captions.json')
const imageScale = Math.max(1, Number.parseInt(process.argv[4] ?? '1', 10) || 1)
const requestedWorkers = Number.parseInt(process.env.GEOMETRY_OCR_WORKERS ?? '', 10)
const workerCount = Number.isFinite(requestedWorkers)
  ? Math.max(1, Math.min(requestedWorkers, 8))
  : Math.max(1, Math.min(4, os.availableParallelism()))

const allPageNumbers = (await readdir(imageDirectory))
  .map((fileName) => fileName.match(/^page-(\d{4})\.jpg$/)?.[1])
  .filter(Boolean)
  .map(Number)
  .sort((left, right) => left - right)
const firstPage = Number.parseInt(process.env.GEOMETRY_FIRST_PAGE ?? '', 10)
const lastPage = Number.parseInt(process.env.GEOMETRY_LAST_PAGE ?? '', 10)
const pageNumbers = allPageNumbers.filter((pageNumber) => (
  (!Number.isFinite(firstPage) || pageNumber >= firstPage)
  && (!Number.isFinite(lastPage) || pageNumber <= lastPage)
))

const existingPages = new Map()
try {
  await access(outputFile)
  const existing = JSON.parse(await readFile(outputFile, 'utf8'))
  for (const page of existing.pages ?? []) existingPages.set(page.pageNumber, page)
} catch {
  // A missing checkpoint starts a fresh scan.
}

const pendingPages = pageNumbers.filter((pageNumber) => !existingPages.has(pageNumber))
let nextPageIndex = 0
let completedThisRun = 0
let checkpoint = Promise.resolve()

function parseLines(tsv) {
  const groups = new Map()
  for (const row of String(tsv ?? '').split('\n')) {
    const columns = row.split('\t')
    if (columns[0] !== '5' || !columns[11]?.trim()) continue
    const key = `${columns[2]}:${columns[3]}:${columns[4]}`
    const words = groups.get(key) ?? []
    words.push({
      x: Number(columns[6]) / imageScale,
      y: Number(columns[7]) / imageScale,
      width: Number(columns[8]) / imageScale,
      height: Number(columns[9]) / imageScale,
      confidence: Math.max(0, Number(columns[10])),
      text: columns.slice(11).join('\t').trim(),
    })
    groups.set(key, words)
  }

  return [...groups.values()].map((words) => {
    words.sort((left, right) => left.x - right.x)
    return {
      text: words.map((word) => word.text).join(' ').replace(/\s+/g, ' ').trim(),
      x: Math.min(...words.map((word) => word.x)),
      y: Math.min(...words.map((word) => word.y)),
      right: Math.max(...words.map((word) => word.x + word.width)),
      bottom: Math.max(...words.map((word) => word.y + word.height)),
      confidence: Math.round(words.reduce((total, word) => total + word.confidence, 0) / words.length),
    }
  })
}

function readCaptionNumber(value) {
  const normalized = value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('і', 'i')
  const match = normalized.match(/^(?:рис|puc|pic|рие)\.?\s*(\d{1,3})(?:\D|$)/u)
  return match ? Number.parseInt(match[1], 10) : null
}

function scanPage(pageNumber, tsv) {
  const captions = []
  for (const line of parseLines(tsv)) {
    const figure = readCaptionNumber(line.text)
    if (!Number.isInteger(figure) || figure < 1 || figure > 999) continue
    captions.push({ figure, ...line })
  }
  return { pageNumber, captions }
}

async function saveCheckpoint() {
  const pages = [...existingPages.values()].sort((left, right) => left.pageNumber - right.pageNumber)
  await writeFile(outputFile, `${JSON.stringify({ pages }, null, 2)}\n`, 'utf8')
}

async function runWorker(workerNumber) {
  const worker = await createWorker(['rus', 'eng'])
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    preserve_interword_spaces: '0',
    user_defined_dpi: '300',
  })

  while (true) {
    const jobIndex = nextPageIndex
    nextPageIndex += 1
    if (jobIndex >= pendingPages.length) break

    const pageNumber = pendingPages[jobIndex]
    const fileName = `page-${String(pageNumber).padStart(4, '0')}.jpg`
    const { data } = await worker.recognize(path.join(imageDirectory, fileName), {}, { tsv: true })
    existingPages.set(pageNumber, scanPage(pageNumber, data.tsv))
    completedThisRun += 1

    if (completedThisRun % 10 === 0 || completedThisRun === pendingPages.length) {
      process.stdout.write(`${existingPages.size}/${pageNumbers.length}\tpage ${pageNumber}\tworker ${workerNumber}\n`)
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

const captions = [...existingPages.values()].flatMap((page) => page.captions)
process.stdout.write(`captions=${captions.length}\tunique=${new Set(captions.map((caption) => caption.figure)).size}\n`)
