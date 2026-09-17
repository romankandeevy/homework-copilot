/* Страницы PDF разбираются по очереди: разбор держит общий документ. */
/* eslint-disable no-await-in-loop */
import { readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createWorker, PSM } from 'tesseract.js'

const inputDirectory = path.resolve(process.argv[2] ?? 'tmp/textbook-pages/geometry')
const outputFile = path.resolve(process.argv[3] ?? 'tmp/pdfs/geometry-task-number-scan.json')
const pageFiles = (await readdir(inputDirectory))
  .filter((name) => /^page-\d{4}-x\d+\.png$/i.test(name))
  .sort()

const worker = await createWorker('eng')
await worker.setParameters({
  tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
  tessedit_char_whitelist: '0123456789',
  user_defined_dpi: '300',
})

const pages = []
for (const [index, fileName] of pageFiles.entries()) {
  const pageNumber = Number(fileName.match(/\d{4}/)?.[0])
  const numberColumnLeft = Number(fileName.match(/-x(\d+)/)?.[1])
  const { data } = await worker.recognize(
    path.join(inputDirectory, fileName),
    {},
    { text: true, tsv: true },
  )
  const candidates = String(data.tsv ?? '')
    .split('\n')
    .map((row) => row.split('\t'))
    .filter((columns) => columns[0] === '5' && /^\d{1,4}$/.test(columns[11]?.trim() ?? ''))
    .map((columns) => ({
      task: Number(columns[11]),
      confidence: Math.round(Number(columns[10])),
      x: numberColumnLeft + Number(columns[6]) / 4,
      y: 45 + Number(columns[7]) / 4,
      width: Number(columns[8]) / 4,
      height: Number(columns[9]) / 4,
    }))
    .filter((candidate) => candidate.task > 0)
    .sort((left, right) => left.y - right.y)

  pages.push({ pageNumber, fileName, candidates })
  if (index === 0 || (index + 1) % 25 === 0 || index + 1 === pageFiles.length) {
    process.stdout.write(`${index + 1}/${pageFiles.length}\tpage ${pageNumber}\n`)
  }
}

await worker.terminate()
await writeFile(outputFile, `${JSON.stringify({ pages }, null, 2)}\n`, 'utf8')
