# Homework Copilot: подробный live UI-аудит

Дата: 24 августа 2026<br>
Проверяемая версия: https://www.homeworkcopilot.ru/<br>
Локальный HEAD: 7b89421<br>
Режим: redesign-preserve, без изменений GeometryNotebookLayoutV1

## Design Read

Продуктовая главная для русскоязычного школьника: холодная учебная станция, где один кобальтовый маршрут ведёт от учебника и номера к готовому ответу.

- DESIGN_VARIANCE: 5
- MOTION_INTENSITY: 3
- VISUAL_DENSITY: 7
- Палитра: холодные нейтрали и один кобальтовый акцент
- Шрифты: Unbounded для крупных заголовков, Onest для интерфейса, JetBrains Mono для номеров и времени
- Фирменный элемент: направляющая линия от действия к готовому решению
- Не менять: GeometryNotebookLayoutV1, его SVG-координаты, бумагу, сетку и оформление

## Объём и методика

Проверены:

- desktop 1440x1000: светлая и тёмная темы;
- mobile 390x844: светлая и тёмная темы;
- главная, выбор учебника, вход, расписание, политика, условия;
- default, disabled, selected, expanded, focus и keyboard-состояния;
- DOM-семантика, hit targets, overflow, размеры, шрифты, цвета, границы, радиусы;
- npm run lint, npm run test, npm run build;
- механический Impeccable detector по App, AccountDialog, SchedulePage и LegalPage;
- независимый reference-анализ через web-design-analyzer.

Скриншоты лежат в .impeccable/review:

- desktop-light-audit.png
- desktop-dark-confirm.png
- mobile-light-audit.png
- mobile-dark-audit.png
- state-auth-desktop.png
- state-auth-mobile.png
- state-picker-desktop.png
- state-picker-mobile.png
- state-schedule-desktop.png
- state-schedule-mobile.png

## Audit Health Score

| # | Измерение | Балл | Главный вывод |
|---|---:|---:|---|
| 1 | Accessibility | 2/4 | Live-модалки выпускают фокус на фон; picker теряет Escape после выхода фокуса |
| 2 | Performance | 2/4 | Главный JS 680.66 kB minified, CSS 72.69 kB |
| 3 | Responsive | 2/4 | Переполнения нет, но fixed bottom-nav закрывает статус и расписание |
| 4 | Theming | 3/4 | Сильные токены и обе темы; есть недокументированный тёплый overlay и чрезмерный cobalt-area |
| 5 | Implementation Integrity | 2/4 | Legal routes сломаны, mock-данные выглядят личными, App.css содержит два слоя правил |
| **Итого** |  | **11/20** | **Acceptable: фундамент сильный, но перед релизом нужны обязательные исправления** |

Найдено: P0 1, P1 9, P2 12, P3 5.

## Implementation Integrity Verdict

У интерфейса есть собственная система: холодный canvas, Unbounded, прямые предметные иконки, один cobalt route и фиксированный rhythm 4 px. Это не generic AI-dashboard.

Вердикт пока fail для production. Причины: обязательные legal URL недоступны, live-auth отстаёт от локального OTP-flow, без входа показываются правдоподобные персональные данные, а базовый App.css содержит старый и новый набор правил для одних компонентов.

## P0: блокирует выпуск

### P0.1 Политика и условия недоступны на купленном домене

- Live evidence: /privacy и /terms открывают GitHub Pages 404. На mobile 404-страница имеет scrollWidth 700 px при viewport 390 px.
- Причина: vercel.json сначала перенаправляет любой путь на www, а GitHub Pages не применяет Vercel rewrites и не имеет SPA fallback.
- Код: vercel.json:2-16, .github/workflows/deploy-pages.yml:26-36.
- Влияние: пользователь не может открыть обязательные документы; ссылки регистрации становятся ложными.
- Рекомендация: положить статические privacy/index.html и terms/index.html либо настроить GitHub Pages SPA 404 fallback с восстановлением пути.
- Команда: $impeccable harden.

## P1: исправить до следующего production

### P1.1 Live-модалки не изолируют клавиатурный фокус

- Auth: после шести Tab фокус уходит на body, затем на controls страницы под backdrop.
- Textbook picker: после элементов picker фокус уходит в решения и bottom-nav.
- Picker закрывается по Escape только пока событие всплывает внутри backdrop. После ухода фокуса Escape не работает.
- Код picker: src/App.tsx:363-404.
- Локальный AccountDialog уже содержит trap, но он ещё не на live: src/account/AccountDialog.tsx:616-647.
- Влияние: WCAG 2.1.2, modal context теряется для клавиатуры и screen reader.
- Рекомендация: focus trap, inert для app-shell, глобальный Escape, возврат фокуса на trigger.
- Команда: $impeccable harden.

### P1.2 Fixed bottom-nav перекрывает главный статус

- Mobile nav занимает примерно 374x68 px на y=768-836.
- Карточка статуса занимает y=651-1013, поэтому nav закрывает progress bar и этапы.
- На расписании nav закрывает середину таблицы.
- Код: src/App.css:830-860.
- Влияние: пользователь теряет состояние задачи и редактируемую строку.
- Рекомендация: сделать nav отдельным слоем app-shell с зарезервированной областью либо добавить реальный viewport-safe offset и scroll-padding.
- Команда: $impeccable layout.

### P1.3 Активный пункт sidebar двигает текст вместе с иконкой

- Код переносит весь .navigation-item на 1.5rem: src/App.css:111.
- Контракт DESIGN.md требует двигать только icon, а label оставлять на общей вертикали.
- Маркер на seam сейчас математически ровный, но подпись активного раздела выбивается из колонки.
- Рекомендация: переносить только .navigation-icon; путь и diamond считать от icon center.
- Команда: $impeccable layout.

### P1.4 Неавторизованный экран выглядит как чужой аккаунт

- Одновременно видны «Войти», «Готовим №118», конкретные timestamps, три учебника и «Мои решения».
- Влияние: это читается как утечка чужих данных или поддельный продукт.
- Рекомендация: скрыть личные блоки до входа либо явно маркировать единый demo-state словом «Пример».
- Команда: $impeccable clarify.

### P1.5 Mobile header содержит три конкурирующих account-action

- Есть «Войти» в balance, кнопка + и отдельная иконка профиля.
- Plus до входа не имеет понятного пользовательского смысла.
- Влияние: три точки входа в один flow, выше cognitive load.
- Рекомендация: до входа оставить «Войти» и тему; после входа показать баланс и подписанное «Пополнить».
- Команда: $impeccable distill.

### P1.6 Live-auth не соответствует утверждённому OTP-flow

- Live показывает Google, email и password.
- В рабочем дереве уже есть verify-email, шестизначный код, срок 5 минут и resend через 60 секунд.
- Влияние: production не реализует запрошенный сценарий и остаётся визуально и функционально старым.
- Рекомендация: выпускать только после готовности SMTP и end-to-end проверки письма, кода, перехода из письма и повторной отправки.
- Команда: $impeccable harden.

### P1.7 Progress и timer выглядят реальными, но захардкожены

- src/App.tsx:631 содержит 03:42.
- src/App.tsx:637 содержит 44%.
- src/App.tsx:745 стартует с processing №118.
- Влияние: нарушается доверие; точность выглядит серверной, хотя данных нет.
- Рекомендация: реальный server-state либо честный demo label без точного процента и таймера.
- Команда: $impeccable clarify.

### P1.8 Mobile расписание противоречит утверждённой модели

- DESIGN.md требует один день за раз ниже 980 px.
- Реализация сохраняет таблицу min-width 72.5rem и горизонтальный scroll: src/SchedulePage.css:712-745.
- Влияние: одновременно видно один день и обрезок следующего, редактирование требует постоянного горизонтального движения.
- Рекомендация: day-tabs и один day-column на mobile.
- Команда: $impeccable adapt.

### P1.9 Главный bundle слишком тяжёлый

- Vite: index JS 680.66 kB minified, 195.32 kB gzip.
- Преобразовано 5044 modules; Vite выдаёт chunk warning.
- Положительное исключение: Tesseract загружается динамически в src/SchedulePage.tsx:287.
- Рекомендация: lazy-load SchedulePage, вынести nav destinations по route chunks, проверить Phosphor imports и motion boundary.
- Команда: $impeccable optimize.

## P2: следующий исправляющий проход

### P2.1 На mobile нет видимого H1

- В desktop H1 равен «Добрый день».
- На mobile .page-heading скрыт: src/App.css:863-876.
- Визуально первым заголовком становится H2 «Списать задачу».
- Рекомендация: «Списать задачу» сделать H1, приветствие оставить secondary copy.

### P2.2 Desktop controls ниже 44 px

- Theme: 40x40.
- Profile: 128x40.
- «Все мои решения» и «Добавить»: высота 33.
- «Открыть базу»: высота 40.
- Влияние: точность клика хуже, особенно при touch-desktop и zoom.
- Рекомендация: минимум 44 px hit-area без обязательного увеличения визуальной плашки.

### P2.3 Mobile bottom-nav labels равны 0.55rem

- Код: src/App.css:860 и 919.
- Это примерно 8.8 px.
- Рекомендация: минимум 10-11 px, лучше 12 px с укороченными названиями или четырьмя primary destinations.

### P2.4 Disabled CTA не объясняет причину

- «Списать за 1 рубль» выглядит серым, но рядом нет постоянной причины.
- Upload остаётся доступным, однако из-за серой поверхности визуально похож на disabled.
- Рекомендация: helper «Введи номер или добавь фото»; upload сделать явно интерактивным.

### P2.5 Главная на mobile ставит учебники раньше истории

- Фактический порядок: progress, textbooks, solutions, base.
- Для returning user полезнее: progress, recent solutions, textbooks, base.
- Команда: $impeccable layout.

### P2.6 «Мои решения» и «База решений» различаются недостаточно

- Названия требуют чтения пояснений.
- «Разобраться» не сообщает действие.
- Вариант vocabulary: «Мои ответы», «Все ответы», «Объяснить».
- Перед переименованием проверить analytics и muscle memory.

### P2.7 Metadata повторяет предмет

- Примеры: «Геометрия. Геометрия. 7-9 классы», «Геометрия · Геометрия. 7-9 классы».
- Рекомендация: «Геометрия, Атанасян, №118» и author line отдельно.

### P2.8 Слишком слабый non-text contrast границ

- Dark border/surface: примерно 1.45:1.
- Dark strong-border/surface: примерно 2.32:1.
- Light border/surface: примерно 1.59:1.
- Текстовые пары проходят: light subtle 6.08:1, dark subtle 5.60:1, hero text 4.95:1.
- Рекомендация: boundaries интерактивных controls довести до 3:1; декоративные card borders могут оставаться мягче.

### P2.9 Dark hero занимает слишком большую долю внимания

- Cobalt остаётся одинаковым в обеих темах и на dark canvas выглядит заметно тяжелее.
- Рекомендация: не менять hue, но снизить dark-theme chroma/lightness только для большой surface; interactive accent оставить ярким.

### P2.10 У selector учебника слишком тяжёлая тень

- На hero поле выглядит отдельной модалкой.
- Рекомендация: 1 px border и короткая тень 0 2px 8px; overlay-shadow оставить диалогам.

### P2.11 Тёплый overlay нарушает cold-only правило

- Detector: src/App.css:1052 использует oklch(18% 0.02 95 / 0.58).
- Hue 95 относится к тёплой области и отсутствует в DESIGN.md.
- Рекомендация: нейтральный overlay на hue 258 или чистом нулевом chroma.

### P2.12 Hover rows двигают layout без равноценного focus-state

- src/App.css:1721-1722 сдвигает textbook и solution rows по X.
- Keyboard focus получает общий ring, но не тот же directional feedback.
- Рекомендация: либо одинаковая focus-visible реакция, либо тихая background/border реакция без смещения строки.

## P3: точная полировка

### P3.1 Route line, bend и diamond перегружают sidebar

Линия полезна как фирменный мотив, но одновременно route, active cobalt tile и diamond сообщают одно состояние трижды. Оставить один line-node сигнал.

### P3.2 Типографическая шкала дрейфует

Impeccable detector нашёл 17 advisories, преимущественно размеры вне DESIGN.md: 33.12, 34.4, 27.2, 24 и дополнительные clamp endpoints.

Рекомендуемая рабочая шкала: 12, 14, 16, 20, 28, 48, 72.

### P3.3 App.css содержит два поколения правил

- Базовые Home rules начинаются около src/App.css:344.
- Второй слой «Home: textbook-first copying flow» начинается около src/App.css:937.
- Одни и те же selectors определяются повторно: copy-task, copy-task-copy, home-grid, task-number-control, section-heading и media rules.
- Влияние: правка раннего правила может не дать эффекта из-за позднего override.
- Рекомендация: после visual freeze удалить мёртвый слой и оставить один источник.

### P3.4 Вертикальный rhythm на mobile слишком равномерный

Почти все переходы между блоками равны 32 px. Перед переходом от текущей задачи к библиотеке нужен более крупный semantic gap, около 48 px.

### P3.5 Системные линии в целом хорошие, но их роли не задокументированы

- Sidebar seam: 1 px, структурная, оставить.
- Header divider: 1 px, структурная, оставить.
- Card outline: 1 px, grouping, оставить мягким.
- List group top: strong, оправдан.
- Row dividers: один bottom border, оправдан.
- Schedule grid: клеточная структура реальна, линии оправданы.
- Upload dashed border: единственная пунктирная линия, семантически означает drop/upload.
- Focus outline: отдельный 3/5 px ring, не смешивать с обычными borders.

## Поэлементный вердикт

| Область | Элемент | Вердикт | Точное действие |
|---|---|---|---|
| Global | Cool canvas | Pass | Сохранить |
| Global | One cobalt accent | Pass с оговоркой | Dark large-surface сделать глубже, hue сохранить |
| Global | Text contrast | Pass | Текстовые пары AA проходят |
| Global | Interactive borders | Fix | Критичные boundaries довести до 3:1 |
| Global | Radii 16/12/8/4 | Pass | Система читается |
| Global | Shadows | Watch | Selector легче, overlay оставить |
| Global | Reduced motion | Pass | CSS и Motion fallback присутствуют |
| Global | Horizontal overflow | Pass | На app-screen 0 px в 1440 и 390 |
| Logo | HC mark | Pass | Узнаваем и компактен |
| Logo | Homework Copilot lockup | Pass | Desktop читается, mobile mark-only уместен |
| Sidebar | Seam | Pass | 1 px и ровно на x=224 |
| Sidebar | Route path | Watch | Упростить количество сигналов |
| Sidebar | Diamond | Pass геометрически | Центр совпадает с активной строкой |
| Sidebar | Active item | Fix | Двигать icon, не label |
| Sidebar | Subject icons | Pass | Одна Phosphor family, direct duotone |
| Sidebar | Labels | Pass desktop | Выравнивание сломано только active transform |
| Sidebar footer | Divider | Pass | Отделяет utilities |
| Sidebar footer | Theme | Fix target | 40 px до 44 px |
| Sidebar footer | Profile | Fix target | 40 px до 44 px |
| Header | Greeting | Reframe | Secondary, не главный H1 |
| Header | Date | Pass | Mono и тихая роль |
| Header | Divider | Pass | Структурная линия |
| Header | Balance card | Fix mobile | Убрать дублирующий login |
| Header | Wallet icon | Pass | Рубль-иконка удалена |
| Header | Plus | Fix | Подписать «Пополнить» после входа |
| Hero | Cobalt panel | Pass light | Distinctive и функциональный |
| Hero | Cobalt panel dark | Watch | Слишком доминирует |
| Hero | Title | Pass | Хорошая кириллица, 2 строки |
| Hero | Lead | Pass | Короткий и конкретный |
| Textbook | Trigger surface | Watch | Снять overlay-like shadow |
| Textbook | Book icon | Pass | Прямой предметный icon |
| Textbook | Label/title/authors | Pass desktop | На mobile авторы скрыты осознанно |
| Textbook | Change/caret | Pass | Ясное действие |
| Task | Label | Pass | Не placeholder-as-label |
| Task | Hash and mono input | Pass | Сильная числовая affordance |
| Task | Focus ring | Pass | Очень заметен |
| Task | Error proximity | Pass | Inline и aria-errormessage |
| Photo | Dashed line | Pass | Единственная осмысленная dashed line |
| Photo | File input | Pass | Label даёт реальную hit-area |
| Photo | Available look | Fix | Не должен выглядеть disabled |
| CTA | Label and price | Pass | «рубль», без плохой ₽-иконки |
| CTA | Disabled state | Fix | Добавить причину |
| CTA | Arrow | Pass | Directional, не декоративная |
| Status | Card shell | Pass | Иерархия понятна |
| Status | Title | Pass | Состояние названо |
| Status | Timer | Fix | Только реальные данные |
| Status | 44 percent | Fix | Только реальные данные |
| Status | Loader | Pass | Reduced motion fallback есть |
| Status | Progress track | Pass semantic | Нужен role=progressbar/value |
| Status | Stage labels | Pass visual | Не превращать в controls |
| Status | Stage colors | Watch | Green только для semantic success |
| Status | Inner divider | Pass | Отделяет этапы от progress |
| Textbooks | Panel | Pass | Понятная secondary column |
| Textbooks | Add action | Fix target | 33 px desktop, 44 px mobile |
| Textbooks | Group top line | Pass | Отделяет header |
| Textbooks | Row dividers | Pass | Один border-bottom |
| Textbooks | Metadata | Fix copy | Убрать повтор предмета |
| Textbooks | Selected check | Pass | Семантический cobalt |
| Textbooks | Chevrons | Pass | Движение вглубь |
| Solutions | Heading | Pass | Видимая история |
| Solutions | Header link | Fix target | 33 px desktop |
| Solutions | Group top line | Pass | Сильнее row dividers |
| Solutions | Rows | Pass | 80 px, понятная scan-line |
| Solutions | Dates | Pass desktop | Mono; скрытие mobile оправдано |
| Solutions | Mobile order | Fix | Поднять выше textbooks |
| Base | Border | Pass | Strong border отличает destination |
| Base | Icon/title | Pass | Хороший destination card |
| Base | Copy | Pass | Объясняет shared catalogue |
| Base | CTA | Fix target desktop | 40 px до 44 px |
| Mobile | Header | Fix | Один account action |
| Mobile | Bottom-nav shell | Fix | Не перекрывать контент |
| Mobile | Bottom-nav labels | Fix | 8.8 px слишком мало |
| Mobile | Safe areas | Partial pass | Insets учтены, layout-space нет |
| Picker dialog | Backdrop | Pass visual | Blur и depth читаются |
| Picker dialog | Shell | Pass | Desktop split, mobile stack |
| Picker dialog | Close | Pass visual | Keyboard flow всё ещё требует trap |
| Picker dialog | Search | Pass | Autofocus и label |
| Picker dialog | Listbox/options | Pass semantic | role и aria-selected есть |
| Picker dialog | Tabs | Partial | Нужны aria-controls и tabpanel |
| Picker dialog | Escape | Fix | Глобальный listener |
| Picker dialog | Focus trap | Fix | Сейчас фокус уходит на page |
| Auth dialog | Shell | Pass visual | Холодный, без белого «листа» в dark |
| Auth dialog | Google action | Pass | Ясная secondary route |
| Auth dialog | Inputs | Pass | Labels сверху |
| Auth dialog | Focus trap live | Fix | Live-версия выпускает фокус |
| Auth dialog | OTP local | Pass pending release | 6 цифр, 5 минут, resend 60 секунд |
| Schedule | Heading and grade | Pass | Контекст понятен |
| Schedule | OCR action | Pass | Primary cobalt |
| Schedule | Add lesson | Pass | Secondary action |
| Schedule | Save status | Pass | Semantic green допустим |
| Schedule | Table grid lines | Pass | Кодируют реальные строки и колонки |
| Schedule | Empty cells | Pass | Остаются редактируемыми |
| Schedule | Desktop density | Pass | Вся неделя читается |
| Schedule | Mobile model | Fix | Day-tabs вместо 72.5rem table |
| Legal | Privacy route | Blocked | Live 404 |
| Legal | Terms route | Blocked | Live 404 |

## Референс-направление

- Gauth: https://www.gauth.com/
  Брать один немедленный number/photo composer. Не брать бледный gradient.
- Photomath: https://www.photomath.net/
  Брать ясную последовательность Scan, Solve, Learn. Не брать тёплую red-cream палитру.
- Quizlet AI tools: https://quizlet.com/features/ai-study-tools
  Брать реальные product previews и постоянный search.
- StudyFetch: https://www.studyfetch.com/
  Брать один фирменный мотив. Не брать cream, pink и mascot.
- Khanmigo: https://www.khanmigo.ai/
  Брать контекстные подсказки. Не брать мультяшность и ролевую сложность.

## Рекомендуемый порядок

1. P0 $impeccable harden: восстановить /privacy и /terms на www.
2. P1 $impeccable harden: focus trap, inert, global Escape, focus return.
3. P1 $impeccable layout: bottom-nav, active sidebar icon-only movement, mobile content order.
4. P1 $impeccable adapt: mobile schedule с day-tabs.
5. P1 $impeccable clarify: demo-state, progress, timer и account actions.
6. P1 $impeccable optimize: route chunks и bundle.
7. P2 $impeccable typeset: mobile labels и единая type ramp.
8. P2 $impeccable colorize: cold overlay и dark cobalt surface.
9. P2 $impeccable shape: control boundaries и shadow hierarchy.
10. P3 $impeccable distill: удалить дублирующий CSS и лишние route signals.
11. $impeccable polish: финальный desktop/mobile, light/dark и keyboard pass.

После исправлений повторить $impeccable audit и сравнить score.
