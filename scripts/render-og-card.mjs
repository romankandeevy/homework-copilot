import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const outputPath = resolve('public', 'og-card.png')
await mkdir(resolve('public'), { recursive: true })

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  await page.setContent(`<!doctype html>
    <html lang="ru"><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; }
      body { margin: 0; width: 1200px; height: 630px; overflow: hidden; color: #f7f7f8; background: #11131a; font-family: Arial, sans-serif; }
      main { position: relative; display: grid; height: 100%; padding: 76px 82px; border: 1px solid #313543; }
      main::before { position: absolute; inset: 0; content: ''; background: repeating-linear-gradient(to bottom, transparent 0, transparent 63px, rgba(255,255,255,.055) 63px, rgba(255,255,255,.055) 64px); }
      main::after { position: absolute; top: 0; bottom: 0; left: 48px; width: 3px; content: ''; background: #496dff; }
      .brand, .copy, .meta { position: relative; z-index: 1; }
      .brand { display: flex; align-items: center; gap: 18px; font-size: 24px; font-weight: 700; }
      .mark { display: grid; width: 58px; height: 58px; place-items: center; border: 1px solid #454a5a; border-radius: 12px; font-size: 21px; letter-spacing: -.08em; }
      .mark b { color: #6e8bff; }
      .copy { align-self: center; max-width: 920px; }
      h1 { margin: 0; font-size: 68px; line-height: 1.08; letter-spacing: -.045em; }
      p { max-width: 820px; margin: 28px 0 0; color: #bec2ce; font-size: 28px; line-height: 1.42; }
      .meta { align-self: end; display: flex; align-items: center; gap: 14px; color: #bec2ce; font-size: 20px; }
      .meta i { width: 10px; height: 10px; border-radius: 50%; background: #496dff; }
    </style></head><body><main>
      <div class="brand"><span class="mark">H<b>C</b></span><span>Homework Copilot</span></div>
      <div class="copy"><h1>Решение задачи<br>по номеру из учебника</h1><p>Сверь условие и получи понятное решение, которое удобно переписать в тетрадь.</p></div>
      <div class="meta"><i></i><span>homeworkcopilot.ru</span></div>
    </main></body></html>`)
  await page.screenshot({ path: outputPath, type: 'png' })
} finally {
  await browser.close()
}
