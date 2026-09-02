/* Обход дерева по очереди: параллельное чтение всего репозитория ради доли секунды не нужно. */
/* eslint-disable no-await-in-loop */
import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

const roots = ['src', 'public']
const standaloneFiles = ['index.html', 'README.md', 'PRODUCT.md']
const extensions = new Set(['.ts', '.tsx', '.css', '.html', '.md', '.json', '.xml', '.txt', '.svg'])
const excluded = new Set([
  'src/textbooks/taskCatalog.ts',
])
const intentionalRegexTokens = new Map([
  ['src/account/passwordStrengthRules.ts', new Set(['zа', 'ZА'])],
  ['src/App.tsx', new Set(['aа', 'mм', 'рисунKe', 'bВи'])],
  ['src/scheduleOcr.ts', new Set(['bпн', 'bвт', 'bср', 'bчт', 'bпт', 'bсб', 'яa', 'ЯЁA', 'яёA'])],
])

async function collect(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collect(path))
    else if (extensions.has(extname(entry.name))) files.push(path)
  }
  return files
}

function location(text, index) {
  const before = text.slice(0, index)
  const lines = before.split(/\r?\n/)
  return { line: lines.length, column: lines.at(-1).length + 1 }
}

const files = [...standaloneFiles]
for (const root of roots) files.push(...await collect(root))

const problems = []
for (const path of files) {
  const normalizedPath = relative('.', path).replaceAll('\\', '/')
  if (excluded.has(normalizedPath) || /\.test\.[cm]?[jt]sx?$/.test(normalizedPath)) continue
  const text = await readFile(path, 'utf8')

  if (text !== text.normalize('NFC')) problems.push(`${normalizedPath}: текст не нормализован в NFC`)

  const invisibleIndex = text.search(/(?:\u200B|\u200C|\u200D|\u2060|\uFFFD)/u)
  if (invisibleIndex >= 0) {
    const point = location(text, invisibleIndex)
    problems.push(`${normalizedPath}:${point.line}:${point.column}: невидимый или повреждённый символ`)
  }

  for (const match of text.matchAll(/[\p{L}\p{M}\p{N}_]+/gu)) {
    const token = match[0]
    if (!/[A-Za-z]/.test(token) || !/[А-Яа-яЁё]/.test(token)) continue
    if (intentionalRegexTokens.get(normalizedPath)?.has(token)) continue
    const point = location(text, match.index)
    problems.push(`${normalizedPath}:${point.line}:${point.column}: смешаны латиница и кириллица в «${token}»`)
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Unicode audit passed: ${files.length} files checked`)
}
