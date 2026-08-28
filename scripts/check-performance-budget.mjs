import { readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { basename, join, resolve } from 'node:path'

const outputDirectory = resolve(process.argv[2] ?? 'dist')
const html = readFileSync(join(outputDirectory, 'index.html'), 'utf8')
const scriptNames = [
  ...html.matchAll(/<script[^>]+src="[^"]*\/([^/"?]+\.js)"/g),
  ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="[^"]*\/([^/"?]+\.js)"/g),
].map((match) => match[1])
const stylesheetNames = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="[^"]*\/([^/"?]+\.css)"/g)]
  .map((match) => match[1])

if (!scriptNames.length || !stylesheetNames.length) {
  throw new Error('Не удалось определить стартовые JS и CSS из index.html')
}

const assets = [
  {
    label: 'initial JavaScript',
    names: scriptNames,
    rawLimit: 140 * 1024,
    gzipLimit: 45 * 1024,
    maxFileGzipLimit: 30 * 1024,
  },
  {
    label: 'initial CSS',
    names: stylesheetNames,
    rawLimit: 95 * 1024,
    gzipLimit: 16 * 1024,
  },
]

let failed = false

for (const asset of assets) {
  const sizes = asset.names.map((name) => {
    const path = join(outputDirectory, 'assets', basename(name))
    return {
      name,
      raw: statSync(path).size,
      gzip: gzipSync(readFileSync(path), { level: 9 }).byteLength,
    }
  })
  const rawSize = sizes.reduce((total, file) => total + file.raw, 0)
  const gzipSize = sizes.reduce((total, file) => total + file.gzip, 0)
  const largestFile = sizes.reduce((largest, file) => file.gzip > largest.gzip ? file : largest)
  const rawKilobytes = (rawSize / 1024).toFixed(1)
  const gzipKilobytes = (gzipSize / 1024).toFixed(1)
  console.log(`${asset.label}: ${rawKilobytes} kB raw, ${gzipKilobytes} kB gzip across ${sizes.length} files`)

  if (rawSize > asset.rawLimit || gzipSize > asset.gzipLimit) {
    failed = true
    console.error(`${asset.label} exceeds its performance budget`)
  }

  if (asset.maxFileGzipLimit && largestFile.gzip > asset.maxFileGzipLimit) {
    failed = true
    console.error(`${asset.label} file ${largestFile.name} exceeds the per-file performance budget`)
  }
}

if (failed) process.exitCode = 1
