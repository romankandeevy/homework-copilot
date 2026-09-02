# Homework Copilot

Ученик приносит условие задачи фотографией или текстом и получает готовую
запись для тетради: дано, ход решения, чертёж, ответ. 14 предметов, 5-11 класс.

Прод: [www.homeworkcopilot.ru](https://www.homeworkcopilot.ru).

## Разработка

```bash
npm install
npm run dev
```

## Проверки

```bash
npm run lint
npm run test
npm run test:e2e
npm run build
```

`npm run test:visual` дополнительно прогоняет снимки тетрадного листа. Эталоны
сняты на Windows, поэтому в CI они не участвуют.

## Устройство

Фронт раздаёт GitHub Pages, serverless-функции живут на Vercel, база и
авторизация — Supabase. Почему именно так и что нельзя менять — в `AGENTS.md`.
Карта файлов — в `TREE.md`, команды и правила — в `CLAUDE.md`.

Ключи и адреса функций задаются переменными окружения, см. `.env.example`.
Ни одного секрета в клиентском коде нет.
