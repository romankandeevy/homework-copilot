-- Наполнение каталога моделей ИИ-чата.
--
-- Состав и тарифы взяты не из документации, а из живой проверки каждой модели
-- запросами — отчёт в `docs/KIE_MODEL_MATRIX.md`. Из пяти моделей, названных
-- в плане, две на старт не идут:
--   * Gemini 3.7 Flash — шлюз отвечает «no user can use», доступа у аккаунта нет;
--   * Claude Sonnet 5 — всё семейство Claude отдаёт 500 на любой запрос.
-- Вместо них берём проверенные gemini-3-6-flash-openai и gemini-3-pro.
--
-- Единица тарификации у KIE — кредит, он стоит $0.005 для всех моделей.
-- По курсу 100 ₽ за доллар это 50 копеек за кредит. Курс намеренно взят
-- с запасом: при укреплении рубля мы просто заработаем чуть больше,
-- при ослаблении — не уйдём в минус.
--
-- input_cost_per_mtok / output_cost_per_mtok оставлены нулевыми: у KIE нет
-- токенного прайса для чат-моделей, а измеренный `usage.total_tokens` у Gemini
-- не сходится с суммой промпта и ответа. Расчёт идёт по credits_consumed,
-- токены пишем только для статистики.

insert into private.chat_model_catalog (
  model_id, title, description,
  supports_images, supports_web_search,
  credit_cost_kopecks, max_charge_kopecks,
  tariff_version, sort_order, is_enabled
)
values
  (
    'gemini-3-6-flash-openai',
    'Gemini 3.6 Flash',
    'Быстрая и дешёвая. Подходит для большинства вопросов.',
    true, true, 50, 300, 1, 10, true
  ),
  (
    'gpt-5-6-luna',
    'GPT-5.6 Luna',
    'Быстрая универсальная модель для общих вопросов.',
    false, true, 50, 400, 1, 20, true
  ),
  (
    'gpt-5-6-terra',
    'GPT-5.6 Terra',
    'Сбалансирована по скорости и качеству ответа.',
    false, true, 50, 600, 1, 30, true
  ),
  (
    'gemini-3-pro',
    'Gemini 3 Pro',
    'Сильная модель для сложных задач. Отвечает дольше.',
    true, true, 50, 1000, 1, 40, true
  ),
  (
    'gemini-3.1-pro',
    'Gemini 3.1 Pro',
    'Самая сильная из доступных. Понимает фотографии.',
    true, true, 50, 1200, 1, 50, true
  )
on conflict (model_id) do update
set title = excluded.title,
    description = excluded.description,
    supports_images = excluded.supports_images,
    supports_web_search = excluded.supports_web_search,
    credit_cost_kopecks = excluded.credit_cost_kopecks,
    max_charge_kopecks = excluded.max_charge_kopecks,
    tariff_version = excluded.tariff_version,
    sort_order = excluded.sort_order,
    is_enabled = excluded.is_enabled,
    updated_at = now();

-- Чат остаётся выключенным: включаем его отдельным действием, после того как
-- каждая модель отработает живой запрос на проде.
update private.chat_settings set is_enabled = false, updated_at = now() where id;
