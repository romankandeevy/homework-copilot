# TREE — карта проекта

Указатель для ИИ: где что лежит и как использовать. Обновляется в тот же заход,
когда меняется структура.

```
homework Copilot/
├── .github/workflows/       - ci.yml (lint, test, e2e, build на каждый push и PR), deploy-pages.yml (прод вручную)
├── api/                     - обёртки Vercel: solve, chat, support, telegram-webhook, admin, payment, auth-yandex, sms-hook
├── docs/                    - аудит 16 сентября (действующий план), цена, конкуренты, качество решений, поддержка
│   └── archive/             - закрытые планы и замеры: план чата, матрица моделей Kie, ввод задачи, лицензии, UI-аудит 24 августа
├── public/                  - статика: robots, sitemap, llms.txt, манифест, иконки, карточка для соцсетей, .well-known/security.txt
├── scripts/                 - сборка статических маршрутов и отрисовка страниц, иконки, проверки перед сборкой, прогон предметов
│   ├── db-smoke.sql         - дымовая проверка денежных функций в транзакции с rollback: перед каждым db push
│   └── archive/             - индекс учебников геометрии: читали PDF, которых в репозитории нет; не запускаются
├── server/                  - логика функций, общая для api/ и тестов
│   ├── geometrySolutionEngine.ts - проходы модели, перебор семейств, проверка качества
│   ├── diagramBuilder.ts    - чертёж по плану построения, включая тела в проекции
│   ├── sceneOrientation.ts  - чертёж основанием вниз и школьные значки равенства
│   ├── homeworkModels.ts    - какая модель на каком предмете, с замерами
│   ├── worksheet.ts         - калькулятор черновика: счёт проверяет код
│   ├── homeworkSolver.ts    - HTTP решателя: оплата, стадии, сохранение решения
│   ├── promptPreview.ts     - проверка промпта владельца тем же движком, без денег и сохранения
│   ├── subjectRules.ts      - правила предмета, они же рецензент
│   ├── gradeRules.ts        - приём решения по ступени: школа против вуза
│   ├── conditionGuard.ts    - признаки попытки переопределить промпт внутри условия
│   ├── chat.ts / chatProviders.ts / chatErrors.ts - ИИ-чат: квоты, списание, два протокола шлюза, ошибки
│   ├── payments.ts / robokassa.ts - пополнение через Робокассу: заказ, Result, сверка, подписи
│   ├── yandexAuth.ts        - вход через Яндекс ID: state, обмен кода, аккаунт
│   ├── smsHook.ts           - Send SMS Hook Supabase: код входа по телефону через SMS.ru
│   ├── support.ts           - обращения, мост в Telegram
│   ├── telemetry.ts         - журнал запросов, ошибки, устройства, настройки решателя
│   └── admin.ts             - функция админки: вход под пользователем, сброс пароля, уведомления, health
├── src/
│   ├── Root.tsx             - развилка витрины и приложения, возврат авторизации
│   ├── App.tsx              - маршруты, очередь решений, экран решения
│   ├── NotFoundPage.tsx     - 404: что случилось, куда идти, подсказка по опечатке
│   ├── tokens.css           - токены: цвета, шрифты, отступы, радиусы
│   ├── account/             - вход, регистрация, профиль, баланс, пополнение, тариф, промокод, удаление аккаунта
│   ├── admin/               - админка: AdminApp (вход, 2FA, каркас), api.ts, ui.tsx, sections/ по разделам ТЗ
│   ├── chat/                - страница ИИ-чата и разметка ответов
│   ├── landing/             - публичная витрина
│   ├── lib/                 - Supabase, деньги, оплата, вход (Яндекс, телефон), контракты, очередь, согласия
│   ├── notebook/            - тетрадный лист (утверждённая вёрстка), записи аудита по предметам для ?sheets=1
│   │   └── geometry/labelLayout.ts - общая раскладка подписей чертежа и схемы
│   ├── promo/               - студия роликов для внешних площадок (?promo=1, npm run promo:render); витрина видео не показывает
│   ├── solution/            - очередь задач, карточка решения в списке, разбор со школьными значками
│   ├── support/             - центр помощи; SiteFooter - общий подвал сайта
│   └── textbooks/taskCatalog.ts - проверенные условия задач (единственный остаток индекса)
├── supabase/
│   ├── config.toml          - настройки Auth для `supabase config push`: почта, телефон через хук, MFA
│   ├── functions/api/       - Edge-прокси на домене Supabase: браузер зовёт функции Vercel через него
│   ├── migrations/          - схема, деньги, оплата, чат, поддержка, админка, согласия
│   ├── archive/             - ROLLBACK_wallet_in_kopecks.sql: ручной откат копеек, устарел, не применять
│   └── templates/           - письма: подтверждение, вход, смена пароля
├── tests/                   - Playwright; fixtures.ts подменяет настройки админки и список моделей, adminMocks.ts - базу админки
├── AGENTS.md                - правила и разбор поломок: читать до правок
├── CLAUDE.md                - коротко: команды, стек, архитектура, правила
├── PLAN.md                  - указатель на действующий план (docs/AUDIT_2026-09-16.md)
├── DESIGN.md                - визуальный язык: токены, шрифты, лист, навигация
└── PRODUCT.md               - что за продукт, для кого, цена и границы
```

## Точки входа

- Приложение: `src/main.tsx` → `src/Root.tsx`
- Решатель: `api/solve.ts` → `server/homeworkSolver.ts` → `server/geometrySolutionEngine.ts`
- Сборка статики: `scripts/create-static-routes.mjs` (запускается из `npm run build`)

## Куда смотреть по задачам

| Задача | Где |
|---|---|
| Цена, списание, возврат | `supabase/migrations/*wallet*`, `src/lib/solutionPricing.ts`, проверка - `scripts/db-smoke.sql` |
| Оплата через Робокассу | `server/payments.ts`, `server/robokassa.ts`, `supabase/migrations/20260913090000_robokassa_payments.sql`, «Оплата через Робокассу» в `AGENTS.md` |
| Модели и их отказы | `server/homeworkModels.ts`, раздел «Пул моделей» в `AGENTS.md` |
| Что можно решать в этом классе | `server/gradeRules.ts`, `src/lib/subjects.ts` (`solvableGrades`) |
| Требования к записи по предмету | `server/subjectRules.ts`, `server/worksheet.ts` |
| Очередь и стадии решения | `src/lib/solutionJobs.ts`, `src/solution/SolutionQueue.tsx` |
| Вход, письма, согласия | `src/account/AccountDialog.tsx`, `supabase/templates/`, `src/lib/legalConsent.ts`, `server/yandexAuth.ts`, `server/smsHook.ts` |
| Юридические тексты | `src/LegalPage.tsx` (версия — `private.current_legal_version()`) |
| Маршруты и метаданные | `src/lib/siteMetadata.ts`, `scripts/create-static-routes.mjs`, `vercel.json` |
| Витрина и её обещания | `src/landing/LandingPage.tsx`, `src/landing/LandingPreviews.tsx` |
| ИИ-чат: квоты и деньги | `supabase/migrations/20260830170000_ai_chat_core.sql`, `server/chat.ts` |
| Админка: роли, 2FA, аудит | `supabase/migrations/20260911090000_admin_roles_audit_mfa.sql`, `src/admin/AdminApp.tsx` |
| Админка: метрики, финансы, мониторинг | `supabase/migrations/20260911090400_*`, `src/admin/sections/` |
| Настройки без деплоя, уведомления | `supabase/migrations/20260911090500_*`, `server/admin.ts`, `src/lib/publicConfig.ts` |
