import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const numberScanPath = path.resolve(process.argv[2] ?? 'tmp/pdfs/geometry-task-number-scan.json')
const markerScanPath = path.resolve(process.argv[3] ?? 'tmp/pdfs/geometry-task-marker-scan.json')
const outputPath = path.resolve(process.argv[4] ?? 'tmp/pdfs/geometry-task-markers.json')
const numberScan = JSON.parse(await readFile(numberScanPath, 'utf8'))
const markerScan = JSON.parse(await readFile(markerScanPath, 'utf8'))

const firstTaskPage = 9
const lastTaskPage = 365
const lastTaskNumber = 1431

function markerShape(candidate, pageNumber, task) {
  const digits = String(task).length
  const oddPage = pageNumber % 2 === 1
  const xRange = oddPage
    ? digits === 1 ? [123, 130] : digits === 2 ? [112, 120] : [101, 111]
    : digits === 1 ? [93, 100] : digits === 2 ? [83, 90] : [72, 81]
  const widthRange = digits === 1
    ? [7, 23]
    : digits === 2
      ? [18, 34]
      : digits === 3
        ? [27, 44]
        : [35, 54]

  return candidate.height >= 10
    && candidate.height <= 20
    && candidate.x >= xRange[0]
    && candidate.x <= xRange[1]
    && candidate.width >= widthRange[0]
    && candidate.width <= widthRange[1]
}

function positionValue(candidate) {
  return candidate.pageNumber * 2_000 + candidate.y
}

function digitDistance(left, right) {
  const a = String(left)
  const b = String(right)
  const rows = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0))
  for (let row = 0; row <= a.length; row += 1) rows[row][0] = row
  for (let column = 0; column <= b.length; column += 1) rows[0][column] = column
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      )
    }
  }
  return rows[a.length][b.length]
}

const ocrCandidates = numberScan.pages
  .flatMap((page) => page.candidates.map((candidate) => ({ ...candidate, pageNumber: page.pageNumber })))
  .filter((candidate) => candidate.pageNumber >= firstTaskPage
    && candidate.pageNumber <= lastTaskPage
    && candidate.task >= 1
    && candidate.task <= lastTaskNumber
    && candidate.confidence >= 60
    && markerShape(candidate, candidate.pageNumber, candidate.task))
  .sort((left, right) => positionValue(left) - positionValue(right))

const lisLength = ocrCandidates.map(() => 1)
const previous = ocrCandidates.map(() => -1)
let bestIndex = 0
for (let index = 0; index < ocrCandidates.length; index += 1) {
  for (let prior = 0; prior < index; prior += 1) {
    if (ocrCandidates[prior].task < ocrCandidates[index].task && lisLength[prior] + 1 > lisLength[index]) {
      lisLength[index] = lisLength[prior] + 1
      previous[index] = prior
    }
  }
  if (lisLength[index] > lisLength[bestIndex]) bestIndex = index
}

const anchors = []
for (let index = bestIndex; index >= 0; index = previous[index]) {
  anchors.push(ocrCandidates[index])
  if (previous[index] < 0) break
}
anchors.reverse()

const visualCandidates = markerScan.pages
  .flatMap((page) => page.candidates.map((candidate) => {
    const nearbyOcr = numberScan.pages
      .find((entry) => entry.pageNumber === page.pageNumber)
      ?.candidates
      .filter((entry) => Math.abs(entry.y - candidate.y) <= 3)
      .sort((left, right) => Math.abs(left.y - candidate.y) - Math.abs(right.y - candidate.y))[0]
    return { ...candidate, pageNumber: page.pageNumber, ocrTask: nearbyOcr?.task, ocrConfidence: nearbyOcr?.confidence ?? 0 }
  }))
  .filter((candidate) => candidate.pageNumber >= firstTaskPage && candidate.pageNumber <= lastTaskPage)
  .sort((left, right) => positionValue(left) - positionValue(right))

const resolved = new Map(anchors.map((anchor) => [anchor.task, anchor]))
const taskOne = visualCandidates.find((candidate) => candidate.pageNumber === 9 && Math.abs(candidate.y - 592) <= 2)
if (!taskOne) throw new Error('Task 1 marker was not detected')
resolved.set(1, { ...taskOne, task: 1, confidence: taskOne.ocrConfidence })

const orderedAnchors = [resolved.get(1), ...anchors.filter((anchor) => anchor.task > 1)]
const unresolved = []

for (let anchorIndex = 0; anchorIndex < orderedAnchors.length - 1; anchorIndex += 1) {
  const left = orderedAnchors[anchorIndex]
  const right = orderedAnchors[anchorIndex + 1]
  const missingTasks = Array.from({ length: right.task - left.task - 1 }, (_, index) => left.task + index + 1)
  if (missingTasks.length === 0) continue

  const candidates = visualCandidates.filter((candidate) => positionValue(candidate) > positionValue(left) + 3
    && positionValue(candidate) < positionValue(right) - 3
    && missingTasks.some((task) => markerShape(candidate, candidate.pageNumber, task)))

  const rows = missingTasks.length + 1
  const columns = candidates.length + 1
  const score = Array.from({ length: rows }, () => Array(columns).fill(Number.NEGATIVE_INFINITY))
  const move = Array.from({ length: rows }, () => Array(columns).fill(''))
  score[0][0] = 0

  for (let taskIndex = 0; taskIndex <= missingTasks.length; taskIndex += 1) {
    for (let candidateIndex = 0; candidateIndex <= candidates.length; candidateIndex += 1) {
      const current = score[taskIndex][candidateIndex]
      if (!Number.isFinite(current)) continue
      if (candidateIndex < candidates.length && current - 1 > score[taskIndex][candidateIndex + 1]) {
        score[taskIndex][candidateIndex + 1] = current - 1
        move[taskIndex][candidateIndex + 1] = 'skip-candidate'
      }
      if (taskIndex < missingTasks.length && candidateIndex < candidates.length) {
        const task = missingTasks[taskIndex]
        const candidate = candidates[candidateIndex]
        if (markerShape(candidate, candidate.pageNumber, task)) {
          const distance = candidate.ocrTask ? digitDistance(candidate.ocrTask, task) : 3
          const matchScore = candidate.ocrTask === task
            ? 30 + Math.max(0, candidate.ocrConfidence) / 10
            : distance === 1
              ? 18 + Math.max(0, candidate.ocrConfidence) / 20
              : distance === 2
                ? 10 + Math.max(0, candidate.ocrConfidence) / 25
              : candidate.ocrTask
                ? Math.max(0, 8 - distance * 2)
                : 3
          if (current + matchScore > score[taskIndex + 1][candidateIndex + 1]) {
            score[taskIndex + 1][candidateIndex + 1] = current + matchScore
            move[taskIndex + 1][candidateIndex + 1] = 'match'
          }
        }
      }
    }
  }

  let taskIndex = missingTasks.length
  let candidateIndex = candidates.length
  const matches = []
  while (taskIndex > 0 || candidateIndex > 0) {
    const step = move[taskIndex][candidateIndex]
    if (step === 'match') {
      matches.push([missingTasks[taskIndex - 1], candidates[candidateIndex - 1]])
      taskIndex -= 1
      candidateIndex -= 1
    } else if (step === 'skip-candidate') {
      candidateIndex -= 1
    } else {
      break
    }
  }
  matches.reverse()

  if (matches.length !== missingTasks.length) {
    unresolved.push({
      fromTask: left.task,
      toTask: right.task,
      fromPage: left.pageNumber,
      toPage: right.pageNumber,
      missingTasks,
      candidateCount: candidates.length,
      matchedTasks: matches.map(([task]) => task),
    })
    continue
  }

  for (const [task, candidate] of matches) {
    resolved.set(task, { ...candidate, task, confidence: candidate.ocrConfidence })
  }
}

const tasks = [...resolved.values()]
  .sort((left, right) => left.task - right.task)
  .map(({ ocrTask: _ocrTask, ocrConfidence: _ocrConfidence, ink: _ink, ...task }) => task)

await writeFile(outputPath, `${JSON.stringify({ tasks, unresolved }, null, 2)}\n`, 'utf8')
process.stdout.write(`anchors=${anchors.length}\nresolved=${tasks.length}\nunresolved=${unresolved.length}\n`)
if (unresolved.length > 0) process.stdout.write(`${JSON.stringify(unresolved, null, 2)}\n`)
