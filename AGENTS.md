# Geometry notebook contract

`docs/references/geometry-notebook-layout-v1.png` is the approved visual source of truth for every 8th-grade geometry page. When prior code, instructions, or generated task data conflict with it, the approved reference wins.

- Render geometry tasks through `GeometryNotebookLayoutV1`; task data may supply only semantic content, never page layout, JSX, HTML, CSS, or absolute page coordinates.
- Keep every geometry layout value in `src/notebook/layouts/geometryNotebookLayoutV1.ts`. Do not add component-local layout numbers.
- Keep the page in its fixed SVG coordinate system and scale the whole page on narrow screens. Do not reflow, independently resize, or reposition page zones.
- Do not change the paper, grid, red margin, ink colour, writing font, title/solution alignment, task-number position, divider joint, or diagram zone without an explicitly approved layout-version change.
- The approved fixture is task №123. Never update visual snapshot baselines without explicit manual design approval.

# Витрина и приложение — разные адреса

`/` — публичная витрина продукта (`src/landing/LandingPage.tsx`). Это первое,
что видит новый посетитель: что за продукт, как он работает, сколько стоит и
куда нажать. Рабочая часть живёт на `/app`, и туда ведут все действия витрины.

- `/main` остаётся рабочим: ссылки на него уже разошлись. Он открывает
  приложение и переписывается на `/app` через `normalizeNavigationPath`.
- Витрина не заводит второй UI-kit: цвета, шрифты, радиусы и тени берутся из
  `src/tokens.css`, подвал переиспользуется из `SupportCenter`.
- Всё, что заявлено на витрине, проверяется по коду: цена — `solutionPricing.ts`,
  стартовые 20 ₽ и бонусы за приглашение — миграции кошелька, двойной проход
  и рецензент — `server/homeworkSolver.ts`. Ничего сверх этого не обещать.
- Инструменты разработки (`?canvas=1`, `?design-system=1`) проверяются в `App()`
  до маршрутов, иначе витрина перехватывает `/?canvas=1` и ломает утверждённые
  визуальные снимки тетради.
- Имена классов витрины не должны пересекаться с продуктовыми: `.analysis-line`
  уже занят разбором в `WrittenAnalysis.css`, поэтому разметка витрины —
  `.parse-line`.

# Иерархия первого экрана

Разбор интерфейса 31 августа 2026 показал одну общую причину почти всех
находок: страница не показывала, что на ней делать первым. Ниже то, что
исправлено и что нельзя вернуть обратно.

- **Главное действие сильнее всех остальных.** «Решить» — кобальтовая кнопка
  и она никогда не гаснет: по погасшей кнопке всё равно жмут, ничего не
  происходит и почему — не сказано. Пустая форма отвечает строкой ошибки и
  возвращает курсор в поле. «Войти» на главной — строка-ссылка, а не кнопка
  того же веса.
- **Цена стоит до ввода.** «5 ₽ за решение» и стартовые 20 ₽ — в шапке
  карточки. Узнавать про оплату после того, как условие набрано, читается
  как подвох.
- **Под формой одна карточка.** Два блока одного веса заставляли выбирать
  между вещами, ради которых человек не приходил.
- **На телефоне шапка в одну строку, разделы — в нижней панели.** Липкая
  шапка занимала 117 пикселей из 812, и «Решить» уходило за сгиб. Всё, что
  фиксировано у нижнего края (поддержка, уведомление о данных), поднимается
  над панелью, иначе оно перехватывает нажатия по ней.
- **Плавающей поддержки на главной нет:** она перекрывала угол «Решить».
- **Разделы — ссылки `<a href>`,** а не кнопки: их открывают в новой вкладке
  и копируют. Незапущенные разделы («ЦДЗ») в основное меню не добавляем.
- **Пустая база и неудачный поиск — разные состояния.** «Совпадений нет» на
  пустой базе читается как «ты сделал что-то не так».
- **Активный сегмент контрастнее дорожки, а не светлее её.**
- **Окно входа берёт те же токены поверхностей, что и сайт.** Раньше оно было
  всегда почти чёрным: на светлой теме это скачок, на тёмной — окно сливалось
  с фоном. Согласия стоят под формой, вплотную к кнопке, которую защищают,
  а вход через Google не гаснет молча — он объясняет, чего не хватает.
- **Класс за ученика никто не подставляет:** молча выбранный чужой класс
  уходит в решения.
- **Фокус при открытии диалога — на первое поле.** React 19 не отражает
  `autoFocus` атрибутом, поэтому цель фокуса помечается `data-initial-focus`.

# Хостинг: фронт на Pages, функции на Vercel

Разделение не историческая случайность и не техдолг — **не сводить на один хостинг.**

Проверено замерами 30 августа 2026 с российского провайдера: один и тот же
файл `assets/index-*.js`, одна и та же выдача, разные имена в TLS SNI —

| Откуда | Скорость |
|---|---|
| `www.homeworkcopilot.ru` → GitHub Pages | 246 КБ/с |
| `www.homeworkcopilot.ru` → Vercel | 1,2 КБ/с |
| `app.homeworkcopilot.ru` → Vercel | 1,5 КБ/с |
| `homework-copilot-taupe.vercel.app` | 200 КБ/с |

Трафик душится, когда наш домен идёт на адреса Vercel: первые килобайты
проходят, дальше поток срезается до килобайта в секунду. HTML успевает
приехать, бандл — нет, и страница не доходит до DOMContentLoaded. Поддомен
не спасает: душится любое наше имя, указывающее на Vercel. Само `*.vercel.app`
при этом не задето, поэтому короткие ответы функций ходят свободно.

Отсюда рабочая схема:

- фронт раздаёт GitHub Pages на `www.homeworkcopilot.ru` (workflow
  `.github/workflows/deploy-pages.yml`);
- serverless-функции живут на Vercel, клиент зовёт их по абсолютным адресам
  `https://homework-copilot-taupe.vercel.app/api/*` из переменных сборки
  `VITE_HOMEWORK_API_URL`, `VITE_SUPPORT_API_URL`, `VITE_CHAT_API_URL`;
- `scripts/check-build-env.mjs` роняет сборку под Pages, если адреса функций
  не заданы: без них клиент бьёт в относительный путь и попадает в SPA-заглушку.

Если однажды душить начнут и `*.vercel.app` — переносить функции, а не фронт.
