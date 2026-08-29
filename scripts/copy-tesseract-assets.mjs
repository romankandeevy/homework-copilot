// Раскладывает исполняемые части tesseract.js локально, в public/tesseract.
//
// По умолчанию tesseract.js подтягивает воркер и wasm-ядро со стороннего CDN
// в рантайме и без контроля целостности: компрометация CDN означала бы
// выполнение произвольного кода в браузере ученика. Плюс при блокировке CDN
// распознавание расписания просто переставало работать.
//
// Файлы берутся из node_modules, поэтому версия всегда совпадает с package.json.
// Каталог назначения в .gitignore: в репозиторий эти 8 МБ не попадают,
// а в dist их кладёт обычный сбор статики Vite.
//
// Языковые модели (rus, eng) намеренно остаются на CDN: это данные, а не код,
// они весят около 15 МБ и не являются вектором выполнения.

import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(projectRoot, 'public', 'tesseract')
const coreTarget = join(target, 'core')

const workerSource = join(projectRoot, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js')
const coreSource = join(projectRoot, 'node_modules', 'tesseract.js-core')

if (!existsSync(workerSource) || !existsSync(coreSource)) {
  console.warn('[tesseract] пакеты не установлены, копирование пропущено')
  process.exit(0)
}

await rm(target, { recursive: true, force: true })
await mkdir(coreTarget, { recursive: true })

await cp(workerSource, join(target, 'worker.min.js'))

// Нужны только LSTM-варианты: именно их выбирает tesseract.js по умолчанию.
// Три сборки — базовая, simd и relaxedsimd — движок берёт подходящую сам.
const coreFiles = (await readdir(coreSource)).filter((name) =>
  /^tesseract-core(-relaxedsimd|-simd)?-lstm\.(js|wasm)$/.test(name),
)

if (!coreFiles.length) {
  console.warn('[tesseract] не нашёл LSTM-сборки ядра, копирование пропущено')
  process.exit(0)
}

for (const name of coreFiles) {
  await cp(join(coreSource, name), join(coreTarget, name))
}

console.log(`[tesseract] локально разложено: worker.min.js и ${coreFiles.length} файлов ядра`)
