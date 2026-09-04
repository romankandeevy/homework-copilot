/* Рендер роликов витрины в mp4.

   Кадры считают React-сцены (src/promo) от авторского времени T. Здесь
   Playwright открывает студию в режиме рендера, выставляет T кадр за кадром
   через window.promoControl.setTime и снимает экран, а ffmpeg собирает снимки
   в видео.

     node scripts/render-promo.mjs [--film hero|solve|all] [--format wide|tall|all]
                                   [--fps 60] [--scale 1] [--crf 14]

   hero  - первый экран, 45 с  -> public/hero.mp4 + hero-poster.jpg
   solve - как решается задача -> public/promo.mp4 + promo-poster.jpg

   Формата два. wide - 1920×1080 для экрана. tall - 1080×1350 для телефона,
   файлы получают суффикс `-tall`: на узком экране широкий кадр обрезался
   по бокам вместе с надписями. Сцены знают оба формата сами (src/promo).

   --scale 2 снимает тот же кадр на плотности 2, то есть вдвое крупнее.
   --crf 14 - визуально без потерь; файл при этом заметно тяжелее, чем при 18.

   Длительности сцен живут в src/promo/timelines.ts и приходят сюда со
   страницы; здесь задано только то, куда класть готовый файл. */

/* Кадры снимаются строго по очереди: следующий нельзя снять раньше предыдущего. */
/* eslint-disable no-await-in-loop */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { stat } from 'node:fs/promises'
import net from 'node:net'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}

const targets = {
  hero: { name: 'hero', posterAt: 21 },
  solve: { name: 'promo', posterAt: 12 },
}

/* `css` - ширина окна, в котором студия рисует кадр (src/promo/stage.tsx).
   У вертикали она уже сцены: приложение внутри кадра должно разложиться
   по-телефонному. Плотность снимка поднимается настолько же, поэтому
   готовый кадр всё равно выходит 1080×1350. */
const formats = {
  wide: { width: 1920, height: 1080, css: 1920, suffix: '' },
  tall: { width: 1080, height: 1350, css: 960, suffix: '-tall' },
}

const fps = Number(option('fps', 60))
const scale = Number(option('scale', 1))
const crf = Number(option('crf', 14))
const requested = option('film', 'all')
const films = requested === 'all' ? Object.keys(targets) : [requested]
const requestedFormat = option('format', 'all')
const shapes = requestedFormat === 'all' ? Object.keys(formats) : [requestedFormat]
const port = 4179

for (const film of films) {
  if (!targets[film]) throw new Error(`неизвестный ролик: ${film}. Есть hero, solve, all`)
}
for (const shape of shapes) {
  if (!formats[shape]) throw new Error(`неизвестный формат: ${shape}. Есть wide, tall, all`)
}

async function waitForPort(target, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const open = await new Promise((done) => {
      const socket = net.connect(target, '127.0.0.1')
      socket.on('connect', () => { socket.destroy(); done(true) })
      socket.on('error', () => done(false))
    })
    if (open) return
    await new Promise((done) => setTimeout(done, 500))
  }
  throw new Error(`dev-сервер не поднялся на порту ${target}`)
}

async function settle(page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(undefined)))))
}

async function renderFilm(browser, film, shape) {
  const { name, posterAt } = targets[film]
  const { width, height, css, suffix } = formats[shape]
  const viewScale = css / width
  const outputPath = `public/${name}${suffix}.mp4`
  const posterPath = `public/${name}${suffix}-poster.jpg`
  const output = resolve(outputPath)
  const poster = resolve(posterPath)
  const label = `${film}:${shape}`

  const page = await browser.newPage({
    viewport: { width: Math.round(width * viewScale), height: Math.round(height * viewScale) },
    deviceScaleFactor: scale / viewScale,
  })
  let ffmpeg
  try {
    await page.goto(`http://127.0.0.1:${port}/?promo=1&render=1&film=${film}&format=${shape}`, { waitUntil: 'load' })
    await page.waitForFunction(() => Boolean(window.promoControl))

    // Шрифты должны быть на месте до первого кадра, иначе заголовки
    // перерисуются посреди ролика.
    await page.evaluate(async () => {
      const faces = [
        '400 100px "Unbounded Variable"',
        '400 100px "Onest"',
        '540 100px "Onest"',
        '620 100px "Onest"',
        '600 100px "JetBrains Mono Variable"',
      ]
      await Promise.all(faces.map((face) => document.fonts.load(face)))
      await document.fonts.ready
    })

    const total = await page.evaluate(() => window.promoControl.total)
    const frames = Math.ceil(total * fps)
    console.log(`[${label}] ${width}×${height}, ${total.toFixed(1)} с, ${frames} кадров, ${fps} к/с, масштаб ${scale}, crf ${crf}`)

    ffmpeg = spawn('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(fps), '-i', '-',
      '-an', '-c:v', 'libx264', '-profile:v', 'high', '-crf', String(crf), '-preset', 'slow',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(fps),
      output,
    ], { stdio: ['pipe', 'inherit', 'inherit'] })

    const started = Date.now()
    for (let index = 0; index < frames; index += 1) {
      const time = index / fps
      await page.evaluate((value) => window.promoControl.setTime(value), time)
      await settle(page)
      const frame = await page.screenshot({ type: 'png' })
      if (!ffmpeg.stdin.write(frame)) await once(ffmpeg.stdin, 'drain')
      if (index % (fps * 2) === 0) {
        const elapsed = ((Date.now() - started) / 1000).toFixed(0)
        process.stdout.write(`\r[${film}] ${time.toFixed(0).padStart(3)} с из ${total.toFixed(0)} · ${elapsed} с прошло   `)
      }
    }
    process.stdout.write('\n')
    ffmpeg.stdin.end()
    const [code] = await once(ffmpeg, 'exit')
    ffmpeg = undefined
    if (code !== 0) throw new Error(`ffmpeg завершился с кодом ${code}`)

    await page.evaluate((value) => window.promoControl.setTime(value), posterAt)
    await settle(page)
    await page.screenshot({ type: 'jpeg', quality: 92, path: poster })

    const [videoSize, posterSize] = await Promise.all([stat(output), stat(poster)])
    console.log(`[${label}] ${outputPath} - ${(videoSize.size / 1024 / 1024).toFixed(1)} МБ`)
    console.log(`[${label}] ${posterPath} - ${(posterSize.size / 1024).toFixed(0)} КБ (кадр на ${posterAt} с)`)
  } finally {
    if (ffmpeg && ffmpeg.exitCode === null) ffmpeg.kill()
    await page.close()
  }
}

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
let browser

try {
  await waitForPort(port)
  browser = await chromium.launch()
  for (const film of films) {
    for (const shape of shapes) await renderFilm(browser, film, shape)
  }
} finally {
  if (browser) await browser.close()
  vite.kill()
}
