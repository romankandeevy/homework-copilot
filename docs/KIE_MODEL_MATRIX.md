# Матрица моделей KIE.ai для ИИ-чата

**Дата проверки: 30 августа 2026.**

Все данные ниже получены **живыми запросами** к `https://api.kie.ai` с боевым ключом
`KIE_API_KEY` из `.env.local` (ключ в отчёте не приводится) либо процитированы из
официальной документации со ссылкой. То, что проверить не удалось, вынесено в
отдельный раздел и явно помечено.

Точка отсчёта в коде — `server/geometrySolutionEngine.ts:588`:
`https://api.kie.ai/${model}/v1/chat/completions`, где `defaultHomeworkModel = 'gemini-3.1-pro'`
(`server/geometrySolutionEngine.ts:20`). Этот формат подтверждён, но он покрывает
**только одно из трёх семейств API** внутри KIE (см. ниже).

---

## 0. Главное в двух абзацах

У KIE **нет эндпоинта со списком моделей**: `GET /v1/models`, `/models`,
`/v1/chat/models`, `/api/v1/models`, `/api/v1/chat/models`, `/api/v1/market/models`
все отвечают 404. Единственный машиночитаемый каталог — карта документации
`https://docs.kie.ai/llms.txt` и `https://docs.kie.ai/sitemap.xml`. Именно из них
собран список моделей ниже, а затем каждая проверена живым вызовом.

Чат-модели KIE живут в **трёх несовместимых API**, и «универсального»
`/{model}/v1/chat/completions» не существует:

| Семейство | Путь | Протокол | Кто внутри |
|---|---|---|---|
| Gemini (OpenAI-совместимые) | `POST /{slug}/v1/chat/completions` | OpenAI Chat Completions | `gemini-3-pro`, `gemini-3.1-pro`, `gemini-3-6-flash-openai`, `gemini-3-5-flash-openai`, `gemini-3-flash`, `gemini-2.5-flash`, `gemini-2.5-pro` |
| GPT-5.x | `POST /codex/v1/responses` | OpenAI **Responses API** | `gpt-5-6-luna`, `gpt-5-6-terra`, `gpt-5-6-sol`, `gpt-5-5`, `gpt-5-4` |
| Claude | `POST /claude/v1/messages` | Anthropic Messages | `claude-sonnet-5`, `claude-opus-5`, `claude-fable-5`, `claude-sonnet-4-6`, `claude-haiku-4-5`, … |
| Grok | `POST /grok/v1/responses` | OpenAI Responses API | `grok-4-6`, `grok-4-5`, `grok-4-3` |
| Gemini (нативные) | `POST /gemini/v1/models/{model}:streamGenerateContent` | Google GenAI | `gemini-3-6-flash`, `gemini-3-7-flash`, … |

Авторизация везде одна: `Authorization: Bearer <KIE_API_KEY>`
(«All API requests require a Bearer Token» — [docs.kie.ai/market/quickstart](https://docs.kie.ai/market/quickstart)).
Для Claude документация просит `X-Api-Key` и `anthropic-version`, но фактически
`x-api-key` без `Authorization` даёт 401, а рабочей схемой остаётся Bearer.

---

## 1. Матрица моделей

Цены — из **измерений** (см. раздел 5), курс кредита официальный: **$0.005 за кредит**
(kie.ai: «The standard price is $0.005 per credit. However, depending on the SKU we offer
5% or 10% bonus credits» — [kie.ai/pricing](https://kie.ai/pricing), [kie.ai/billing](https://kie.ai/billing)).

| Идентификатор (slug в URL) | Название | Текст | Изобр. | Стрим | Поиск | Цена/1M вход | Цена/1M выход | Статус проверки |
|---|---|---|---|---|---|---|---|---|
| `gemini-3-6-flash-openai` | Gemini 3.6 Flash (openai) | ✅ | ✅ data-URL | ✅ SSE | ✅ `googleSearch` | ~90 кр ≈ **$0.45** | ~446 кр ≈ **$2.23** | Проверено живьём, все 4 сценария |
| `gemini-3-5-flash-openai` | Gemini 3.5 Flash (openai) | ✅ | не проверял | не проверял | не проверял | не мерил | не мерил | Текст проверен живьём (0.01 кр) |
| `gemini-3-flash` | Gemini 3 Flash | ✅ | не проверял | не проверял | не проверял | не мерил | не мерил | Текст проверен живьём (0.01 кр) |
| `gemini-3-pro` | Gemini 3 Pro | ✅ | ✅ data-URL | не проверял | ✅ `googleSearch` | не мерил | не мерил | Текст/фото/поиск живьём (0.06–0.09 кр) |
| `gemini-3.1-pro` | Gemini 3.1 Pro | ⚠️ ✅ но нестабильно | ✅ data-URL | ✅ SSE | не проверял | ~86 кр ≈ **$0.43** | ~746 кр ≈ **$3.73** | Живьём; **~40 % запросов падают с 524** |
| `gemini-2.5-flash` | Gemini 2.5 Flash | ✅ | не проверял | не проверял | не проверял | не мерил | не мерил | Текст живьём (0.01 кр) |
| `gemini-2.5-pro` | Gemini 2.5 Pro | ✅ | не проверял | не проверял | не проверял | не мерил | не мерил | Текст живьём |
| `gpt-5-6-luna` | GPT-5.6 Luna | ✅ | ✅ data-URL | ✅ SSE (по умолчанию) | ✅ `web_search` + citations | ~11.6 кр ≈ **$0.058** | ~65 кр ≈ **$0.33** | Проверено живьём, все 4 сценария |
| `gpt-5-6-terra` | GPT-5.6 Terra | ✅ | наследует Luna, не проверял | ✅ SSE | наследует Luna, не проверял | не мерил | не мерил | Текст живьём (0.01 кр) |
| `gpt-5-6-sol` | GPT-5.6 Sol | ✅ | не проверял | ✅ SSE | не проверял | не мерил | не мерил | Текст живьём (0.01 кр) |
| `gpt-5-5` | GPT-5.5 | ✅ | не проверял | ✅ SSE | не проверял | не мерил | не мерил | Текст живьём (0.03 кр) |
| `gpt-5-4` | GPT-5.4 | ✅ | не проверял | ✅ SSE | не проверял | не мерил | не мерил | Текст живьём (0.02 кр) |
| `grok-4-6` | Grok 4.6 | ✅ | не проверял | ✅ SSE | не проверял | не мерил | не мерил | Текст живьём (0.08 кр) |
| `gemini-3-7-flash-openai` | Gemini 3.7 Flash (openai) | ❌ | ❌ | ❌ | ❌ | — | — | **Недоступна.** 3 попытки → `{"code":524,"msg":"no user can use"}` |
| `gemini-3-7-flash` (нативный) | Gemini 3.7 Flash | ❌ | ❌ | ❌ | ❌ | — | — | **Недоступна.** `{"code":500,"msg":"Server exception..."}` |
| `claude-sonnet-5` | Claude Sonnet 5 | ❌ | ❌ | ❌ | ❌ | — | — | **Не работает.** 5 попыток → HTTP 500 `api_error` |
| `claude-opus-5`, `claude-fable-5`, `claude-sonnet-4-6`, `claude-haiku-4-5` | Claude 4.5–5 | ❌ | ❌ | ❌ | ❌ | — | — | **Не работают.** Все → HTTP 500 `api_error` |

Легенда: ✅ — подтверждено живым ответом; ❌ — подтверждён отказ; «не проверял» —
запросов не делал, чтобы не жечь бюджет (модель из того же семейства, поведение
ожидаемо одинаковое, но это **не проверено**).

### Кандидаты из `docs/AI_CHAT_IMPLEMENTATION_PLAN.md` — что оказалось правдой

| Имя в плане | Реальный идентификатор | Реальный эндпоинт | Вердикт |
|---|---|---|---|
| Gemini 3.7 Flash | `gemini-3-7-flash-openai` | `/gemini-3-7-flash-openai/v1/chat/completions` | Документация есть, **аккаунту не выдана**: `524 no user can use` |
| GPT-5.6 Luna | `gpt-5-6-luna` | **`/codex/v1/responses`**, не chat/completions | Работает |
| Gemini 3.1 Pro | `gemini-3.1-pro` | `/gemini-3.1-pro/v1/chat/completions` | Работает, но нестабильно |
| GPT-5.6 Terra | `gpt-5-6-terra` | **`/codex/v1/responses`** | Работает |
| Claude Sonnet 5 | `claude-sonnet-5` (страница документации — с опечаткой: `market/claude/cluade-sonnet-5`) | `/claude/v1/messages` | **Не отвечает: HTTP 500** |

Итого: из пяти моделей плана на 30.08.2026 реально работают три.

### Как отличить «модели нет» от «модель есть, но недоступна»

Живые ответы шлюза (все — с HTTP 200, кроме Claude):

```json
{"code":422,"msg":"The model is not supported","data":null}      // slug неизвестен шлюзу
{"code":500,"msg":"The page does not exist","data":null}         // модель неизвестна в /claude/v1/messages
{"code":524,"msg":"no user can use"}                             // модель есть, но аккаунту не выдана
{"code":524,"msg":"2 times retry fail"}                          // апстрим отвалился, шлюз сделал 2 ретрая
```

Обратите внимание на **написание slug**: часть моделей адресуется через точки
(`gemini-3.1-pro`, `gemini-2.5-flash`, `gemini-2.5-pro`), часть — через дефисы
(`gemini-3-pro`, `gemini-3-flash`, `gemini-3-6-flash-openai`). Перепутанное написание даёт
422: `gemini-2-5-flash` → 422, а `gemini-2.5-flash` → 200; `gemini-3.6-flash-openai` → 422,
а `gemini-3-6-flash-openai` → 200. Единого правила нет, только перебор.

---

## 2. Формат `usage` — реальные ответы

### 2.1. Семейство Gemini OpenAI-совместимое (`/{slug}/v1/chat/completions`)

`credits_consumed` лежит **на верхнем уровне ответа, а не внутри `usage`**.

`gemini-3-6-flash-openai`, обычный текст:

```json
{
  "choices": [{"finish_reason": "stop", "index": 0,
               "message": {"content": "2 + 2 = 4", "role": "assistant"}}],
  "created": 1788042934,
  "credits_consumed": 0.01,
  "id": "chatcmpl-9717c8fa2170453fb3dc6c84f3dc7a76",
  "object": "chat.completion",
  "usage": {
    "completion_tokens": 7,
    "completion_tokens_details": {"reasoning_tokens": 0},
    "prompt_tokens": 5,
    "total_tokens": 77
  }
}
```

`gemini-3.1-pro`, тот же формат плюс `message.reasoning_content`:

```json
{
  "choices": [{"finish_reason": "stop", "index": 0,
               "message": {"content": "…ответ…",
                           "reasoning_content": "**Analyzing the Request**…",
                           "role": "assistant"}}],
  "created": 1788043250,
  "credits_consumed": 0.07,
  "id": "chatcmpl-ff457240a87c4dca91118601ac8f9aaa",
  "object": "chat.completion",
  "usage": {
    "completion_tokens": 91,
    "completion_tokens_details": {"reasoning_tokens": 0},
    "prompt_tokens": 25,
    "total_tokens": 116
  }
}
```

Ключи верхнего уровня, подтверждённые разбором ответа:
`["choices","created","credits_consumed","id","object","usage"]`.
Поля `model` в ответе может не быть (у `gemini-3-6-flash-openai` его нет,
у `gemini-2.5-flash` и `gemini-3.1-pro` — есть).

**`total_tokens` ≠ `prompt_tokens + completion_tokens`.** Измеренные пары:
5 + 7 → `total_tokens` 77; 20 + 7 → 257; 21 + 24 → 275; 85 + 7 → 230; 1099 + 13 → 1274.
Для биллинга `total_tokens` использовать нельзя — только `credits_consumed`.

### 2.2. Семейство GPT-5.x (`/codex/v1/responses`) и Grok (`/grok/v1/responses`)

```json
"usage": {
  "input_tokens": 6028,
  "input_tokens_details": {"cache_write_tokens": 0, "cached_tokens": 0},
  "output_tokens": 6,
  "output_tokens_details": {"reasoning_tokens": 0},
  "total_tokens": 6034
}
```

Здесь `total_tokens` **корректен** (= вход + выход). `credits_consumed` — на верхнем
уровне объекта `response` в неполном (не-стриминговом) ответе и в теле события
`response.completed` при стриминге.

Полный список ключей не-стримингового ответа Luna:
`top_logprobs, instructions, metadata, tool_usage, presence_penalty, reasoning, usage,
created_at, safety_identifier, tools, output, top_p, frequency_penalty, temperature,
tool_choice, model, service_tier, id, text, prompt_cache_key, truncation, store,
completed_at, parallel_tool_calls, background, credits_consumed, object, status,
prompt_cache_retention`.

⚠️ Если не передать `instructions`, KIE подставляет **свой системный промпт Codex**
(«You are Codex, a coding agent based on GPT-5. You and the user share the same workspace…»,
~40 КБ) — и тогда `usage.input_tokens` приходит **равным 0**, то есть скрытый промпт
не тарифицируется по токенам, но полностью меняет поведение модели. С явным
`instructions` промпт заменяется и `input_tokens` считается честно (33 токена на
короткий запрос). Для школьного чата `instructions` передавать **обязательно**.

### 2.3. Нативный Gemini (`/gemini/v1/models/{model}:streamGenerateContent`)

```json
{"usageMetadata":{"thinkingTokenCount":131,"candidatesTokenCount":5,
                  "totalTokenCount":142,"promptTokenCount":6},
 "credits_consumed":0.01}
```

### 2.4. Claude (`/claude/v1/messages`)

Проверить не удалось — все запросы падают (см. раздел 7). По документации
[docs.kie.ai/market/claude/cluade-sonnet-5](https://docs.kie.ai/market/claude/cluade-sonnet-5)
в ответе есть обязательное поле `credits_consumed` с примером `0.25`.

---

## 3. Формат SSE-потока — реальные фрагменты

### 3.1. Gemini OpenAI-совместимый, `stream: true`

Заголовки ответа: `Content-Type: text/event-stream;charset=UTF-8`, `Transfer-Encoding: chunked`.
Именованных событий нет — только строки `data:`.

```
data: {"choices":[{"delta":{"content":"2x + 5 = 13  \n2x = 8  \n**x = ","role":"assistant"},"index":0}],"created":1788043442,"id":"chatcmpl-c27e597eba3a437d85c592dd75c12a77","object":"chat.completion.chunk"}

data: {"choices":[{"delta":{"content":"4**","role":"assistant"},"index":0}],"created":1788043442,"id":"chatcmpl-879f924da1fe4314b4f61d28bd63d2c7","object":"chat.completion.chunk"}

data: {"choices":[],"created":1788043442,"id":"chatcmpl-9032334f3e04406fa11075f545a440c4","object":"chat.completion.chunk"}

data: {"choices":[],"created":1788043442,"credits_consumed":0.01,"id":"chatcmpl-7c24a9bda1fe47218c8819cb0baf7a84","object":"chat.completion.chunk","usage":{"completion_tokens":24,"completion_tokens_details":{"reasoning_tokens":0},"prompt_tokens":21,"total_tokens":275}}

data: [DONE]
```

Особенности, которые надо учесть в парсере:
- `id` **разный в каждом чанке** — по нему нельзя склеивать сообщение;
- предпоследний чанк несёт `usage` и `credits_consumed` при пустом `choices: []`;
- поток закрывается литералом `data: [DONE]`;
- у reasoning-моделей (`gemini-3.1-pro`, `gemini-3-pro`) первым приходит чанк с
  `delta.reasoning_content` — **его нельзя показывать пользователю** (требование плана,
  п. «Внутренняя цепочка рассуждений модели не показывается»);
- `finish_reason` приходит только в финальном чанке `gemini-3.1-pro`; у
  `gemini-3-6-flash-openai` его в потоке не было вовсе.

Пример потока `gemini-3.1-pro` с картинкой на входе:

```
data: {"choices":[{"delta":{"reasoning_content":"**Defining the Elements**\n\nI have isolated the key visual components…","role":"assistant"},"index":0}],"created":1788044578,"id":"chatcmpl-578581689f334b90bdd0387459e4a3d4","object":"chat.completion.chunk"}

data: {"choices":[{"delta":{"content":"Это красный круг.","role":"assistant"},"index":0}],"created":1788044579,"id":"chatcmpl-2c4de50c2a854c1d9331aa78955c8578","object":"chat.completion.chunk"}

data: {"choices":[{"delta":{},"finish_reason":"stop","index":0}],"created":1788044581,"credits_consumed":0.05,"id":"chatcmpl-8a18af3e358f4fe2a6f8014a13139ada","object":"chat.completion.chunk","usage":{"completion_tokens":27,"completion_tokens_details":{"reasoning_tokens":0},"prompt_tokens":347,"total_tokens":374}}

data: [DONE]
```

### 3.2. GPT-5.x / Grok, `/codex/v1/responses`

**Стриминг здесь включён по умолчанию**: без `stream` ответ приходит как
`text/event-stream`. Чтобы получить обычный JSON, надо явно передать `"stream": false`
(проверено: тогда `Content-Type: application/json;charset=UTF-8`).

Формат — именованные события Responses API:

```
event: response.created
data: {"type": "response.created", "response": {"id": "resp_08e0…", "object": "response", "status": "in_progress", …}}

event: response.output_text.delta
data: {"type": "response.output_text.delta", "delta": "x = ", …}

event: response.completed
data: {"response": {…, "usage": {"input_tokens_details":{"cache_write_tokens":0,"cached_tokens":0},"total_tokens":8,"output_tokens":8,"input_tokens":0,"output_tokens_details":{"reasoning_tokens":0}}, "output":[{"phase":"final_answer","role":"assistant","type":"message","content":[{"annotations":[],"text":"x = 4","type":"output_text"}],"status":"completed"}], "model":"gpt-5.6-luna", "status":"completed"}, "credits_consumed": 0.01, "type": "response.completed"}
```

Реально пришедший набор событий на простой текстовый запрос к `gpt-5-6-luna`:
`response.created`, `response.in_progress`, `response.output_item.added`,
`response.content_part.added`, `response.output_text.delta` ×4,
`response.output_text.done`, `response.content_part.done`,
`response.output_item.done`, `response.completed`.

Терминатора `[DONE]` в этом семействе **нет** — конец потока определяется событием
`response.completed`.

---

## 4. Поиск в интернете

### 4.1. Gemini (OpenAI-совместимые эндпоинты) — Google Search grounding

Включается объявлением псевдо-функции в `tools`
([docs.kie.ai/market/gemini/gemini-3-7-flash-openai](https://docs.kie.ai/market/gemini/gemini-3-7-flash-openai)):

```json
"tools": [{"type": "function", "function": {"name": "googleSearch"}}]
```

Живой ответ `gemini-3-6-flash-openai` на «Кто сейчас президент Франции? Укажи источник.»:

```json
{"choices":[{"finish_reason":"stop","index":0,"message":{"content":"Президентом Франции является **Эмманюэль Макрон** (Emmanuel Macron)…\n\n**Источники:**\n1. **Официальный сайт Елисейского дворца…:** [elysee.fr](https://www.elysee.fr/)\n2. **Энциклопедия Britannica:** [страница Эмманюэля Макрона](https://www.britannica.com/biography/Emmanuel-Macron)","role":"assistant"}}],
 "created":1788043469,"credits_consumed":0.09,
 "usage":{"completion_tokens":164,"completion_tokens_details":{"reasoning_tokens":0},"prompt_tokens":205,"total_tokens":687}}
```

**Источники приходят только текстом внутри `message.content`, структурированного поля нет.**
Разбор ответа даёт ровно те же ключи, что и без поиска:
`choices / created / credits_consumed / id / object / usage`, а внутри
`message` — только `content` и `role`. Ни `grounding_metadata`, ни `annotations`,
ни `citations` KIE не отдаёт. Чтобы показать карточки источников, ссылки придётся
парсить из markdown, и модель их может не поставить вовсе.

Цена поиска: отдельной комиссии нет, дорожает только промпт — `prompt_tokens`
вырастает с ~20 до ~205 (Google подмешивает результаты в контекст).

### 4.2. GPT-5.x — встроенный `web_search` со структурированными цитатами

```json
"tools": [{"type": "web_search"}]
```

Здесь всё намного лучше: приходит отдельное событие потока и структурированные
аннотации. Реальный фрагмент от `gpt-5-6-luna`:

```
event: response.output_text.annotation.added
data: {"type": "response.output_text.annotation.added", "annotation": {"type": "url_citation", "end_index": 241, "start_index": 141, "title": "Les présidents de la République | Élysée", "url": "https://www.elysee.fr/la-presidence/les-presidents-de-la-republique?utm_source=openai"}, "annotation_index": 0, "content_index": 0, "item_id": "msg_0a8dc099…", "output_index": 2, "sequence_number": 17}
```

и в финальном `response.completed` то же самое лежит в
`output[].content[].annotations`:

```json
"annotations":[{"start_index":141,"end_index":241,"type":"url_citation",
                "title":"Les présidents de la République | Élysée",
                "url":"https://www.elysee.fr/la-presidence/les-presidents-de-la-republique?utm_source=openai"}]
```

Дополнительно в потоке появляются служебные события
`response.web_search_call.in_progress`, `response.web_search_call.searching`,
`response.web_search_call.completed` — по ним удобно рисовать индикатор «ищу в интернете».
Поиск не увеличил стоимость запроса: `credits_consumed` остался 0.01.

### 4.3. Claude

Проверить не удалось — эндпоинт не отвечает.

---

## 5. Цены

### Курс кредита

**$0.005 за 1 кредит.** Формулировка kie.ai дословно: «The standard price is $0.005 per
credit. However, depending on the SKU we offer 5% or 10% bonus credits, so not everyone's
effective price is $0.005 per credit. For consistency, usage here is displayed at the
standard rate» ([kie.ai/pricing](https://kie.ai/pricing), [kie.ai/billing](https://kie.ai/billing),
[kie.ai/v3-api-pricing](https://kie.ai/v3-api-pricing)).

Официального прайса **по токенам для чат-моделей у KIE нет** — ни в документации,
ни на сайте. В `market/quickstart` сказано только: «Language Models: Charged per token
usage». Поэтому тарифы ниже **выведены из измерений**, а не процитированы.

### Как измерялось

Ставились пары запросов: (а) большой вход + минимальный выход, (б) минимальный вход +
большой выход. Из `credits_consumed` решалась система на две ставки.

`gemini-3-6-flash-openai`:

| Запрос | prompt_tokens | completion_tokens | credits_consumed |
|---|---|---|---|
| Длинный ввод | 6016 | 2 | 0.54 |
| Длинная генерация | 13 | 1140 | 0.51 |

→ вход ≈ 8.98·10⁻⁵ кр/токен = **89.8 кр/1M ≈ $0.449/1M**
→ выход ≈ 4.46·10⁻⁴ кр/токен = **446 кр/1M ≈ $2.23/1M**

Контрольные точки, подтверждающие модель: картинка (1098 in + 2 out) — расчёт 0.099,
факт **0.10**; поиск (205 in + 164 out) — расчёт 0.092, факт **0.09**;
389 токенов вывода — расчёт 0.175, факт **0.18**.

`gemini-3.1-pro` (три независимые точки, ставки подобраны по двум и проверены на третьей):

| Запрос | prompt | completion | credits |
|---|---|---|---|
| Короткий текст | 25 | 91 | 0.07 |
| Картинка | 347 | 27 | 0.05 |
| Длинный ввод + разнос генерации | 13464 | 5435 | 5.15 |

→ вход ≈ **86 кр/1M ≈ $0.43/1M**, выход ≈ **746 кр/1M ≈ $3.73/1M**.
Проверка на третьей точке: расчёт 5.21 против факта 5.15 — сходится.

`gpt-5-6-luna`:

| Запрос | input_tokens | output_tokens | credits |
|---|---|---|---|
| Длинный ввод | 6028 | 6 | 0.07 |
| Длинная генерация | 25 | 953 | 0.06 |
| Ещё генерация | ~15 | 1284 | 0.09 |

→ вход ≈ **11.6 кр/1M ≈ $0.058/1M**, выход ≈ **63–70 кр/1M ≈ $0.32–0.35/1M**.
Точность здесь хуже: `credits_consumed` округляется до двух знаков, при значениях
0.06–0.09 это ±8 %.

**Минимальное списание — 0.01 кредита ($0.00005) за запрос.** Расчётная стоимость
коротких вызовов Luna — 0.0008 кр, а списывается всегда 0.01.

### Сводка измеренных списаний за один короткий запрос

| Модель | credits_consumed | ≈ USD |
|---|---|---|
| `gemini-3-6-flash-openai`, `gemini-3-5-flash-openai`, `gemini-3-flash`, `gemini-2.5-flash` | 0.01 | $0.00005 |
| `gpt-5-6-luna`, `gpt-5-6-terra`, `gpt-5-6-sol` | 0.01 | $0.00005 |
| `gpt-5-4` | 0.02 | $0.0001 |
| `gpt-5-5` | 0.03 | $0.00015 |
| `gemini-3.1-pro` | 0.05–0.07 | $0.00025–0.00035 |
| `gemini-3-pro` | 0.06 | $0.0003 |
| `grok-4-6` | 0.08 | $0.0004 |
| Картинка на входе (`gemini-3-6-flash-openai`) | 0.10 | $0.0005 |
| Запрос с `googleSearch` (`gemini-3-6-flash-openai` / `gemini-3-pro`) | 0.09 | $0.00045 |

### Проверка баланса

```
GET https://api.kie.ai/api/v1/chat/credit
Authorization: Bearer <KIE_API_KEY>
→ {"code":200,"msg":"success","data":35.95}
```

⚠️ Баланс **нельзя** использовать для измерения стоимости конкретного запроса: за время
проверки он несколько раз падал между вызовами без наших запросов
(53.21 → 50.94 → 46.69 за пару минут). Источник расхода — `credits_consumed` из ответа,
как и записано в плане (`docs/AI_CHAT_IMPLEMENTATION_PLAN.md`, п. 6).

---

## 6. Лимиты и таймауты

| Параметр | Что установлено |
|---|---|
| Rate limit | **Не документирован и не сработал.** 10 одновременных запросов к `gemini-3-6-flash-openai` — все 10 вернули HTTP 200, ни одного 429. Заголовков `X-RateLimit-*` / `Retry-After` в ответах нет. Реальный потолок не найден. |
| Размер картинки на входе | Data-URL `data:image/png;base64,…` принимается. Проверено на 64×64 (0.3 КБ), 1024×1024 (23 КБ), 800×800 шум (**2.5 МБ** data-URL) и 1800×1800 шум (**13 МБ** data-URL, тело запроса 12.96 МБ) — все 200 OK. Потолок не найден. Документированные ограничения ≤10 МБ base64 / ≤100 МБ по URL относятся к отдельному File Upload API ([docs.kie.ai/file-upload-api/quickstart](https://docs.kie.ai/file-upload-api/quickstart)), а не к chat/completions. |
| Токенизация картинки | Плоская: 64×64 и 1024×1024 дали **одинаковые** `prompt_tokens ≈ 1098` у `gemini-3-6-flash-openai` и 347 у `gemini-3.1-pro`. Размер картинки на цену почти не влияет. |
| Максимальный контекст | **Не выяснен.** Ни в документации, ни в ответах API его нет. Живьём проверено прохождение 13.5 тыс. токенов промпта (`gemini-3.1-pro`) и 6 тыс. (`gemini-3-6-flash-openai`, `gpt-5-6-luna`) — без ошибок. Верхняя граница не нащупана. |
| **`max_tokens` игнорируется** | Критично. `gemini-3-6-flash-openai` с `max_tokens: 10` на «Напиши 200 слов про кота» вернул `completion_tokens: 389`, `finish_reason: "stop"`. `gpt-5-6-luna` с `max_output_tokens: 20` вернул `output_tokens: 1284`, `status: "completed"`. `gemini-3.1-pro` с `max_tokens: 8` вернул `completion_tokens: 5435` и 12.5 КБ мусора, списав 5.15 кредита за один запрос. **Ограничить расход одного запроса через `max_tokens` невозможно** — только текстом промпта и обрывом SSE на клиенте. |
| Таймаут ответа | Явного лимита в документации нет. Измеренные `time_total`: 2.9–12.0 с (короткий текст, 10 параллельных), 13.3 с (запрос 2.5 МБ), 39.6 с (запрос 13 МБ), до ~60 с (`gemini-3-pro` с поиском). Собственный таймаут стоит ставить не меньше 120 с для reasoning-моделей. |
| Ретраи на стороне KIE | Шлюз сам делает 2 попытки и лишь потом отдаёт `{"code":524,"msg":"2 times retry fail"}`. |
| Стабильность | `gemini-3.1-pro` — **нестабилен**: из 6 попыток 2 вернули `524 «2 times retry fail»`, 1 — `524 «no user can use»`. `gemini-3-6-flash-openai` дал 1 отказ 524 из ~15 запросов. Ретраи на нашей стороне обязательны. |
| Коды ошибок | Ошибки шлюза приходят **с HTTP 200** и телом `{"code":…,"msg":…}` — проверять только `response.ok` недостаточно. Anthropic-эндпоинт `/claude/v1/messages` — единственный, отдающий настоящий HTTP 500. Неверный ключ: `{"code":401,"msg":"Unauthorized – Authentication failed…"}` тоже с HTTP 200. |

---

## 7. Чего проверить не удалось и почему

1. **Claude Sonnet 5 и вообще всё семейство Claude.** `POST /claude/v1/messages` на
   `claude-sonnet-5`, `claude-opus-5`, `claude-fable-5`, `claude-sonnet-4-6`,
   `claude-haiku-4-5` — 8 попыток, все HTTP 500 с телом
   `{"type":"error","error":{"type":"api_error","message":"Server exception, please try again later"}}`.
   Пробовались варианты авторизации: `Authorization: Bearer`, `x-api-key`, оба сразу,
   с `anthropic-version: 2023-06-01` и без. `x-api-key` в одиночку даёт 401, значит
   Bearer — верная схема, и проблема не в аутентификации. Что модель существует,
   доказывается косвенно: несуществующий slug даёт `{"code":500,"msg":"The page does not exist"}`,
   а `claude-sonnet-5` доходит до апстрима и падает уже там. Диагноз: сторона KIE
   или апстрим Anthropic лежит. Нужна повторная проверка перед запуском.
2. **Gemini 3.7 Flash.** OpenAI-вариант — `524 «no user can use»` (3 попытки),
   нативный — HTTP 500. Формулировка ошибки означает, что модель зарегистрирована
   в шлюзе, но нашему аккаунту не выдана. Нужен запрос доступа в support@kie.ai.
3. **Цены по токенам для `gemini-3-pro`, `gpt-5-6-terra/sol`, `gpt-5-5/5-4`, `grok-4-6`,
   `gemini-3-5-flash-openai`, `gemini-2.5-*`.** Не мерил: каждая замерочная пара —
   это ~6 тыс. токенов входа и ~1 тыс. выхода, на всех моделях это заметный расход
   при балансе 36 кредитов. Есть только стоимость коротких вызовов (таблица в разделе 5).
4. **Изображения и поиск для `gpt-5-6-terra`, `gpt-5-6-sol`, `gpt-5-5`, `gpt-5-4`, `grok-4-6`.**
   Не проверял живьём. Они ходят в тот же `/codex/v1/responses`, что и Luna, где всё
   работает, но это **предположение**, а не факт.
5. **Максимальный контекст и жёсткий rate limit.** Ни то, ни другое не документировано,
   а нащупывать их перебором — это десятки дорогих запросов. Отложено.
6. **Официальный прайс по токенам.** У KIE его нет ни на сайте, ни в документации.
   Все токенные ставки в разделе 5 — наши измерения, не цитата.
7. **Список моделей через API.** Эндпоинта нет (шесть проверенных вариантов → 404).
   Каталог придётся хардкодить в админке и сверять руками с `https://docs.kie.ai/llms.txt`.
8. **`response_format: json_schema`** (используется в `server/geometrySolutionEngine.ts`)
   на новых моделях не проверял — задача была про чат, а не про решатель.

---

## 8. Рекомендация: какие 5 моделей брать на старт

| # | Модель | Эндпоинт | Зачем |
|---|---|---|---|
| 1 | `gemini-3-6-flash-openai` | `/gemini-3-6-flash-openai/v1/chat/completions` | **Замена недоступной Gemini 3.7 Flash.** Единственная модель, у которой живьём проверены все четыре сценария: текст, картинка data-URL, SSE, поиск. 0.01 кр за короткий запрос, ответ за 3 с. Ставить дефолтом. |
| 2 | `gpt-5-6-luna` | `/codex/v1/responses` | Самый дешёвый токен из измеренных ($0.058/1M вход, ~$0.33/1M выход) и **единственная модель со структурированными источниками** (`url_citation`) — то, чего требует план для карточек источников. Картинки и стриминг подтверждены. Обязательно передавать свой `instructions`, иначе KIE подсунет промпт Codex. |
| 3 | `gpt-5-6-terra` | `/codex/v1/responses` | Вторая «быстрая универсальная» из плана, та же цена короткого запроса (0.01 кр), тот же протокол — интеграция бесплатна, если Luna уже подключена. Даёт запасной вариант при деградации Luna. |
| 4 | `gemini-3-pro` | `/gemini-3-pro/v1/chat/completions` | Сильная reasoning-модель, живьём подтверждены текст, картинка и поиск, 0.06–0.09 кр. **Предпочесть `gemini-3.1-pro`**: тот же класс задач, но за всю проверку `gemini-3-pro` не дал ни одного 524, тогда как `3.1-pro` падал в трети запросов. |
| 5 | `gemini-3.1-pro` | `/gemini-3.1-pro/v1/chat/completions` | Держать как «премиальную мультимодальную»: это текущий дефолт решателя (`server/geometrySolutionEngine.ts:20`), поведение на фото уже обкатано. Но включать **только с ретраями и жёстким лимитом длины ответа в промпте** — она игнорирует `max_tokens` и в патологическом случае сожгла 5.15 кредита за один вызов. |

**Claude Sonnet 5 из стартового набора убрать.** Пункт плана «Перед публичным включением
каждая модель должна пройти реальные текстовый, графический и поисковый запросы» она не
проходит: эндпоинт возвращает 500 на всех попытках. Вернуться к ней после ответа
support@kie.ai. Туда же — запрос доступа к `gemini-3-7-flash-openai`.

### Что это значит для кода

- Абстракция «одна модель = один URL `/{model}/v1/chat/completions`» из
  `server/geometrySolutionEngine.ts` **не масштабируется на чат**. Нужен адаптер на три
  протокола: Chat Completions (Gemini), Responses (GPT-5.x, Grok), Messages (Claude).
- Ошибки KIE приходят с HTTP 200 — проверять `body.code`, а не только `response.ok`.
- `max_tokens` не работает ни в одном семействе: «максимальное списание» из плана
  (п. «Перед отправкой видны модель, ориентир цены и максимальное списание») технически
  не гарантируется. Единственный реальный предохранитель — обрыв SSE-потока на сервере
  по счётчику символов.
- Из `delta.reasoning_content` (Gemini Pro) и из reasoning-блоков Responses API поток
  надо фильтровать до отправки клиенту.
- Списание считать по `credits_consumed`; `usage.total_tokens` у Gemini
  **не равен** сумме промпта и ответа и для тарификации непригоден.
