/* Иконки приложения в PNG.

   В манифесте была одна векторная иконка. Chrome на Android требует
   растровую 192 и 512, иначе не предлагает установку вовсе, а iOS не умеет
   `manifest` и берёт только `apple-touch-icon` — тоже растровый. Отдельно
   нужна maskable-версия: без неё система обрезает квадрат по своей маске и
   срезает угол монограммы.

   Рисуется из того же знака, что и favicon.svg, чтобы иконки не разъезжались.

   `favicon.ico` - для тех, кто SVG не берёт: браузеры и обходчики сами
   запрашивают `/favicon.ico` и до 16 сентября 2026 получали 404. Внутри -
   тот же favicon.svg растром 16, 32 и 48 пикселей, PNG в контейнере ICO
   (так ICO умеет с Windows Vista, и все браузеры его читают). */
/* Иконки рисуются по очереди одним браузером: их семь, параллелить нечего. */
/* eslint-disable no-await-in-loop */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const mark = (scale) => `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${64 * scale}" height="${64 * scale}">
    <path d="M17 17v30h8V36h14v11h8V17h-8v12H25V17z" fill="#f7f7f8"/>
    <circle cx="47" cy="17" r="7" fill="#496dff"/>
  </svg>`

/* Обычная иконка занимает почти весь квадрат, maskable — 60%: система
   оставляет от неё круг, и всё, что ближе к краю, обрезается. */
const icons = [
  { file: 'icon-192.png', size: 192, inset: 0.12, radius: 0.19 },
  { file: 'icon-512.png', size: 512, inset: 0.12, radius: 0.19 },
  { file: 'icon-maskable-512.png', size: 512, inset: 0.26, radius: 0 },
  { file: 'apple-touch-icon.png', size: 180, inset: 0.14, radius: 0 },
]

await mkdir(resolve('public'), { recursive: true })
const browser = await chromium.launch({ headless: true })

try {
  for (const { file, size, inset, radius } of icons) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      html, body { margin: 0; width: ${size}px; height: ${size}px; }
      body { display: grid; place-items: center; background: #11131a; border-radius: ${size * radius}px; overflow: hidden; }
      svg { width: ${size * (1 - inset * 2)}px; height: auto; }
    </style></head><body>${mark(1)}</body></html>`)
    await page.screenshot({ path: resolve('public', file), omitBackground: false })
    await page.close()
    console.log(`[icons] ${file} ${size}×${size}`)
  }

  /* ICO: заголовок 6 байт, по 16 байт на каждый размер, потом сами PNG. */
  const favicon = await readFile(resolve('public', 'favicon.svg'), 'utf8')
  const sizes = [16, 32, 48]
  const images = []
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      html, body { margin: 0; width: ${size}px; height: ${size}px; background: transparent; }
      svg { display: block; width: ${size}px; height: ${size}px; }
    </style></head><body>${favicon}</body></html>`)
    images.push(await page.screenshot({ omitBackground: true }))
    await page.close()
  }
  const header = Buffer.alloc(6 + 16 * sizes.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((size, index) => {
    const entry = 6 + 16 * index
    header.writeUInt8(size, entry)
    header.writeUInt8(size, entry + 1)
    header.writeUInt8(0, entry + 2)
    header.writeUInt8(0, entry + 3)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(images[index].length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += images[index].length
  })
  await writeFile(resolve('public', 'favicon.ico'), Buffer.concat([header, ...images]))
  console.log(`[icons] favicon.ico ${sizes.join(', ')}`)
} finally {
  await browser.close()
}
