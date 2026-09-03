# Homework Copilot

Ученик приносит условие задачи фотографией или текстом и получает готовую
запись для тетради: дано, ход решения, чертёж, ответ. 14 предметов, 5-11 класс.
Прод: [www.homeworkcopilot.ru](https://www.homeworkcopilot.ru).

Перед работой прочитай `AGENTS.md` — там правила, которые нельзя нарушать,
и разбор поломок, из-за которых они появились.

## Команды

```bash
npm run dev            # разработка на 5173
npm run lint           # oxlint
npm run test           # vitest, юнит-тесты
npm run test:e2e       # playwright без снимков тетради — то же, что в CI
npm run test:visual    # весь playwright, включая снимки тетради (только локально)
npm run build          # tsc + vite + статические маршруты
npm run assets:og      # перерисовать карточку для соцсетей
npm run promo:render   # отрендерить ролик первого экрана в public/hero.mp4 (1080p60)
node scripts/render-app-icons.mjs   # перерисовать иконки приложения
```

Ролик первого экрана собран кодом: `src/promo/` - сцены как функция времени T,
без CSS-анимаций. Студия с таймлайном - `http://localhost:5173/?promo=1`
(только в разработке). Менять текст и тайминги - там, потом `npm run promo:render`.

Проверка перед пушем: `npm run lint && npm run test && npm run test:e2e && npm run build`.

Push в `main` выкатывает только превью: Vercel обновляет
[homework-copilot-taupe.vercel.app](https://homework-copilot-taupe.vercel.app)
сам. Прод (`www.homeworkcopilot.ru`, GitHub Pages) — вручную, после проверки
на превью: `gh workflow run deploy-pages.yml`. Подробнее — «Выкатка» в AGENTS.md.

## Стек

React 19, TypeScript, Vite 8, motion. Serverless-функции на Vercel (Node),
база и авторизация — Supabase (Postgres 17, регион Франкфурт). Модели — через
шлюз Kie.ai. Распознавание расписания — tesseract.js в браузере.

## Архитектура

- `src/` — приложение. `Root.tsx` разводит витрину и продукт по чанкам,
  `App.tsx` — маршруты и очередь решений, `landing/` — публичная витрина,
  `chat/` — ИИ-чат, `solution/` — очередь и разбор, `notebook/` — тетрадный лист,
  `lib/` — клиент Supabase, деньги, контракты.
- `server/` — общая логика функций: `homeworkSolver.ts` (HTTP, оплата,
  сохранение), `geometrySolutionEngine.ts` (проходы модели и проверка),
  `chat*.ts`, `support.ts`.
- `api/` — тонкие обёртки Vercel над `server/`.
- `supabase/migrations/` — схема и все денежные функции.
- `scripts/` — сборка статических маршрутов, иконки, разовые проверки.
- `tests/` — Playwright. Юнит-тесты лежат рядом с кодом.

## Правила

- Фронт раздаёт GitHub Pages, функции живут на Vercel. Не сводить на один
  хостинг: из России трафик к нашему домену на адресах Vercel душится.
- Цена решения — в `private.solution_price_kopecks()` и
  `src/lib/solutionPricing.ts`. Больше нигде.
- Миграции применяются к проду и называются той версией, которую записала база.
- Снимки тетради не обновлять без явного согласования.
- Ничего не обещать в интерфейсе, чего нет в коде: цена, сроки, предметы и
  бонусы проверяются по исходникам.

## Язык

Русский. Только дефис `-`, не длинное тире.
