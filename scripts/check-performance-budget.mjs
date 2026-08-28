import { readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { basename, join, resolve } from 'node:path'

const outputDirectory = resolve(process.argv[2] ?? 'dist')
const html = readFileSync(join(outputDirectory, 'index.html'), 'utf8')
const scriptName = html.match(/<script[^>]+src="[^"]*\/([^/"?]+\.js)"/)?.[1]
const stylesheetName = html.match(/<link[^>]+rel="stylesheet"[^>]+href="[^"]*\/([^/"?]+\.css)"/)?.[1]

if (!scriptName || !stylesheetName) {
  throw new Error('Не удалось определить стартовые JS и CSS из index.html')
}

const assets = [
  {
    label: 'initial JavaScript',
    path: join(outputDirectory, 'assets', basename(scriptName)),
    rawLimit: 400 * 1024,
    gzipLimit: 115 * 1024,
  },
  {
    label: 'initial CSS',
    path: join(outputDirectory, 'assets', basename(stylesheetName)),
    rawLimit: 95 * 1024,
    gzipLimit: 16 * 1024,
  },
]

let failed = false

for (const asset of assets) {
  const contents = readFileSync(asset.path)
  const rawSize = statSync(asset.path).size
  const gzipSize = gzipSync(contents, { level: 9 }).byteLength
  const rawKilobytes = (rawSize / 1024).toFixed(1)
  const gzipKilobytes = (gzipSize / 1024).toFixed(1)
  console.log(`${asset.label}: ${rawKilobytes} kB raw, ${gzipKilobytes} kB gzip`)

  if (rawSize > asset.rawLimit || gzipSize > asset.gzipLimit) {
    failed = true
    console.error(`${asset.label} exceeds its performance budget`)
  }
}

if (failed) process.exitCode = 1
