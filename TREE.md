# TREE — карта проекта

Указатель для ИИ: где что лежит и как использовать. Обновляется в тот же заход,
когда меняется структура.

```
homework Copilot/
├── api/                     — обёртки Vercel: solve, chat, support, telegram-webhook
├── docs/                    — замеры и исследования: цена, конкуренты, лицензии, чат
├── public/                  — статика: robots, sitemap, манифест, иконки, промо-ролик
├── scripts/                 — сборка статических маршрутов, иконки, проверки перед сборкой
├── server/                  — логика функций, общая для api/ и тестов
│   ├── geometrySolutionEngine.ts — проходы модели, перебор семейств, проверка качества
│   ├── homeworkSolver.ts    — HTTP решателя: оплата, стадии, сохранение решения
│   ├── subjectRules.ts      — правила предмета, они же рецензент
│   ├── chat.ts / chatProviders.ts — ИИ-чат: квоты, списание, два протокола шлюза
│   └── support.ts           — обращения, мост в Telegram
├── src/
│   ├── Root.tsx             — развилка витрины и приложения, возврат авторизации
│   ├── App.tsx              — маршруты, очередь решений, экран решения
│   ├── account/             — вход, регистрация, профиль, баланс, удаление аккаунта
│   ├── chat/                — страница ИИ-чата и разметка ответов
│   ├── landing/             — публичная витрина
│   ├── lib/                 — Supabase, деньги, контракты, очередь, согласия
│   ├── notebook/            — тетрадный лист геометрии (утверждённая вёрстка)
│   ├── solution/            — очередь задач, разбор со школьными значками
│   ├── support/             — центр помощи и общий подвал сайта
│   └── textbooks/taskCatalog.ts — проверенные условия задач (единственный остаток индекса)
├── supabase/
│   ├── migrations/          — схема, деньги, чат, поддержка, согласия, уборка
│   └── templates/           — письма: подтверждение, вход, смена пароля
├── tests/                   — Playwright
├── AGENTS.md                — правила и разбор поломок: читать до правок
├── DESIGN.md                — визуальный язык
└── PRODUCT.md               — продуктовые границы
```

## Точки входа

- Приложение: `src/main.tsx` → `src/Root.tsx`
- Решатель: `api/solve.ts` → `server/homeworkSolver.ts` → `server/geometrySolutionEngine.ts`
- Сборка статики: `scripts/create-static-routes.mjs` (запускается из `npm run build`)

## Куда смотреть по задачам

| Задача | Где |
|---|---|
| Цена, списание, возврат | `supabase/migrations/*wallet*`, `src/lib/solutionPricing.ts` |
| Модели и их отказы | `server/geometrySolutionEngine.ts`, раздел «Пул моделей» в `AGENTS.md` |
| Очередь и стадии решения | `src/lib/solutionJobs.ts`, `src/solution/SolutionQueue.tsx` |
| Вход, письма, согласия | `src/account/AccountDialog.tsx`, `supabase/templates/`, `src/lib/legalConsent.ts` |
| Юридические тексты | `src/LegalPage.tsx` (версия — `private.current_legal_version()`) |
| Маршруты и метаданные | `src/lib/siteMetadata.ts`, `scripts/create-static-routes.mjs`, `vercel.json` |
| Витрина и её обещания | `src/landing/LandingPage.tsx`, `src/landing/LandingPreviews.tsx` |
| ИИ-чат: квоты и деньги | `supabase/migrations/20260830170000_ai_chat_core.sql`, `server/chat.ts` |
