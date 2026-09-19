import { contactEmail } from '../lib/seller'

/* Сценарии поддержки: тема - вопросы по одному - готовый ответ - «помогло?».

   С 19 сентября 2026 поддержка - не форма с одним полем, а разговор, как в
   чатах поддержки банков и магазинов: ученик выбирает тему кнопкой, отвечает
   на пару уточнений тоже кнопками, и если случай известный, ответ приходит
   сразу. Только если он не помог (или случай требует человека - проверка
   решения, возврат денег, идея), уходит обращение разработчику, и в нём уже
   собраны все ответы.

   Здесь только данные и чистые функции: окно - SupportWizard.tsx. Каждый
   ответ сверен с кодом, как и документы: цена, сроки, возвраты. */

export type SupportTopicId = 'wrong_solution' | 'solve_failed' | 'payment' | 'account' | 'feature' | 'other'

/** Категория обращения на сервере: server/support.ts знает только эти четыре. */
export type TicketCategory = 'general' | 'payment' | 'feature' | 'wrong_solution'

export type SupportLink = { href: string; label: string }

/* Готовый ответ на известный случай. `escalate: 'always'` - случай решает
   только человек (проверка решения, возврат): ответ объясняет, что будет
   дальше, и сразу предлагает отправить обращение. */
export type InstantAnswer = {
  text: string
  links?: SupportLink[]
  escalate?: 'always'
  /** Подсказка к полю описания, если ученик всё же пишет разработчику. */
  detailsHint?: string
}

export type ChoiceStep = {
  kind: 'choice'
  id: string
  question: string
  options: { id: string; label: string; answer?: InstantAnswer }[]
}

export type TextStep = {
  kind: 'text'
  id: string
  question: string
  placeholder: string
  optional?: boolean
}

export type SupportStep = ChoiceStep | TextStep

export type SupportTopic = {
  id: SupportTopicId
  label: string
  category: TicketCategory
  steps: SupportStep[]
  /** Ответ после всех шагов, если ни один вариант не дал своего. */
  answer?: InstantAnswer
}

const refundLink: SupportLink = { href: '/docs/refund', label: 'Правила возврата' }

export const supportTopics: SupportTopic[] = [
  {
    id: 'wrong_solution',
    label: 'Решение неверное',
    category: 'wrong_solution',
    steps: [
      {
        kind: 'choice',
        id: 'problem',
        question: 'Что не так с решением?',
        options: [
          { id: 'answer', label: 'Неверный ответ' },
          { id: 'steps', label: 'Ошибка в ходе решения' },
          { id: 'drawing', label: 'Неверный чертёж' },
          { id: 'grade', label: 'Решено не так, как учат в классе' },
          { id: 'condition', label: 'Условие распознано неверно' },
        ],
      },
      { kind: 'text', id: 'details', question: 'Где именно ошибка? Если знаешь верный ответ - напиши его.', placeholder: 'Например: в третьей строке 12 · 3 = 36, а не 38' },
    ],
    answer: {
      text: 'Решение проверит разработчик вручную. Если ошибка подтвердится, стоимость решения вернётся на баланс или деньгами - как выберешь, в течение десяти дней.',
      links: [refundLink],
      escalate: 'always',
    },
  },
  {
    id: 'solve_failed',
    label: 'Задача не решается',
    category: 'general',
    steps: [
      {
        kind: 'choice',
        id: 'problem',
        question: 'Что происходит?',
        options: [
          {
            id: 'slow',
            label: 'Долго висит «Решаем»',
            answer: {
              text: 'Обычно решение готово за 15-70 секунд. Если прошло больше двух минут, обнови страницу: задача сохранится в очереди на главной. Если решение так и не придёт, деньги за него сами вернутся на баланс.',
            },
          },
          {
            id: 'failed',
            label: 'Написало «не удалось решить»',
            answer: {
              text: 'Деньги за нерешённую задачу уже вернулись на баланс - это видно в истории операций как списание и встречное начисление. Проверь, что выбран верный предмет и класс, и что условие целиком: без таблицы или рисунка задачу бывает не решить. Потом попробуй ещё раз.',
              links: [{ href: '/balance', label: 'История операций' }],
            },
          },
          {
            id: 'charged',
            label: 'Деньги списали, а решения нет',
            answer: {
              text: 'Если решение не получилось, списанная сумма возвращается на баланс автоматически, сразу после отказа. Открой историю операций: рядом со списанием должно стоять встречное начисление.',
              links: [{ href: '/balance', label: 'История операций' }],
              detailsHint: 'Когда отправлял задачу и какой предмет',
            },
          },
          {
            id: 'photo',
            label: 'Не принимает фото',
            answer: {
              text: 'Сфотографируй задачу ровно и при хорошем свете, чтобы условие было целиком и читалось. Подойдёт обычный снимок с телефона. Если фото всё равно не принимается, впиши условие текстом.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'payment',
    label: 'Деньги и баланс',
    category: 'payment',
    steps: [
      {
        kind: 'choice',
        id: 'problem',
        question: 'Что случилось с деньгами?',
        options: [
          {
            id: 'topup',
            label: 'Пополнил, а деньги не пришли',
            answer: {
              text: 'Обычно деньги приходят на баланс в течение нескольких минут. Если Робокасса задерживает подтверждение, сервис сам спрашивает у неё состояние заказа и зачисляет деньги, как только платёж подтверждён. Если прошло больше часа - напиши, укажи дату и сумму.',
              detailsHint: 'Дата, сумма и номер заказа из письма Робокассы, если есть',
            },
          },
          {
            id: 'debit',
            label: 'Непонятное списание',
            answer: {
              text: 'Решение задачи стоит от 4 ₽: цену считает сервер по размеру задачи - длинное условие, фотография и счётный предмет дороже. Она показана до запуска, и списывается ровно она. Ответ в ИИ-чате списывается отдельно, по факту. Все операции - в истории баланса.',
              links: [{ href: '/balance', label: 'История операций' }],
              detailsHint: 'Какое списание непонятно: дата и сумма',
            },
          },
          {
            id: 'refund',
            label: 'Хочу вернуть деньги',
            answer: {
              text: 'Неиспользованный остаток возвращается полностью, без удержаний, в течение десяти дней тем же способом, которым платил. Возврат делает разработчик вручную - отправь заявку, этого достаточно. Промобаланс деньгами не возвращается.',
              links: [refundLink],
              escalate: 'always',
              detailsHint: 'По желанию: почему решил вернуть',
            },
          },
          {
            id: 'receipt',
            label: 'Нужен чек',
            answer: {
              text: 'Чек самозанятого из «Мой налог» приходит на почту аккаунта после каждого пополнения. Проверь папку «Спам». Если чека нет, напиши дату и сумму платежа - пришлём повторно.',
              detailsHint: 'Дата и сумма платежа',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'account',
    label: 'Вход и аккаунт',
    category: 'general',
    steps: [
      {
        kind: 'choice',
        id: 'problem',
        question: 'Что не получается?',
        options: [
          {
            id: 'code',
            label: 'Не приходит письмо с кодом',
            answer: {
              text: 'Проверь папку «Спам» и «Промоакции». Письмо обычно приходит за минуту; новый код можно запросить в окне входа через минуту после предыдущего. Проверь, что почта написана без опечатки.',
            },
          },
          {
            id: 'password',
            label: 'Забыл пароль',
            answer: {
              text: 'В окне входа нажми «Не помню пароль» - на почту аккаунта придёт письмо для смены пароля. Если аккаунт создан через Яндекс ID, пароль не нужен: входи кнопкой «Войти с Яндекс ID».',
            },
          },
          {
            id: 'yandex',
            label: 'Не входит через Яндекс ID',
            answer: {
              text: 'Нажми «Войти с Яндекс ID», на странице Яндекса разреши доступ и после возврата на сайт подожди несколько секунд, ничего не нажимая. Если появилась ошибка - напиши её текст.',
              detailsHint: 'Текст ошибки, которую показал сайт',
            },
          },
          {
            id: 'delete',
            label: 'Удалить аккаунт',
            answer: {
              text: 'Аккаунт удаляется самостоятельно: окно аккаунта, раздел «Профиль», кнопка «Удалить аккаунт». Вместе с ним удаляются решения, баланс и переписка. Если на балансе остались внесённые деньги, сначала запроси их возврат.',
              links: [refundLink],
            },
          },
        ],
      },
    ],
  },
  {
    id: 'feature',
    label: 'Есть идея',
    category: 'feature',
    steps: [{ kind: 'text', id: 'details', question: 'Расскажи идею: что добавить или изменить и зачем.', placeholder: 'Например: показывать решение по шагам с подсказками' }],
    answer: {
      text: 'Идею прочитает разработчик. Если она пойдёт в работу, на баланс начислим 10 ₽.',
      escalate: 'always',
    },
  },
  {
    id: 'other',
    label: 'Другое',
    category: 'general',
    steps: [{ kind: 'text', id: 'details', question: 'Опиши, что случилось или что хочешь спросить.', placeholder: 'Чем подробнее, тем быстрее ответ' }],
    answer: {
      text: 'Вопрос уйдёт разработчику, ответ появится здесь, в этом чате.',
      escalate: 'always',
    },
  },
]

export function topicById(id: SupportTopicId) {
  return supportTopics.find((topic) => topic.id === id) ?? supportTopics[supportTopics.length - 1]
}

/** Ответ на шаге: id варианта для выбора, текст для поля. */
export type SupportAnswers = Record<string, string>

/** Следующий неотвеченный шаг темы или null, если все пройдены. */
export function nextStep(topic: SupportTopic, answers: SupportAnswers): SupportStep | null {
  for (const step of topic.steps) {
    if (!(step.id in answers)) return step
    // Вариант с готовым ответом заканчивает расспросы: дальше - ответ.
    if (step.kind === 'choice' && step.options.find((option) => option.id === answers[step.id])?.answer) return null
  }
  return null
}

/** Готовый ответ по ответам ученика: последний выбранный вариант с ответом или ответ темы. */
export function instantAnswer(topic: SupportTopic, answers: SupportAnswers): InstantAnswer | null {
  for (const step of topic.steps) {
    if (step.kind !== 'choice') continue
    const option = step.options.find((item) => item.id === answers[step.id])
    if (option?.answer) return option.answer
  }
  return topic.answer ?? null
}

/** Подпись ответа для пузыря в чате и для текста обращения. */
export function answerLabel(step: SupportStep, value: string) {
  if (step.kind === 'text') return value
  return step.options.find((option) => option.id === value)?.label ?? value
}

/* Текст обращения: разработчик видит в Telegram и в админке ровно то, что
   ученик выбрал, а не пересказ. Заголовок обращения сервер берёт из
   категории, поэтому тема повторена первой строкой. */
export function ticketBody(topic: SupportTopic, answers: SupportAnswers, extra: string) {
  const lines = [topic.label]
  for (const step of topic.steps) {
    const value = answers[step.id]
    if (!value) continue
    lines.push(`${step.question} - ${answerLabel(step, value)}`)
  }
  const answer = instantAnswer(topic, answers)
  if (answer && answer.escalate !== 'always') lines.push('Готовый ответ не помог.')
  if (extra.trim()) lines.push(`Подробности: ${extra.trim()}`)
  return lines.join('\n').slice(0, 4000)
}

/** Тема, с которой открывается окно: из карточки решения - сразу «неверное решение». */
export function initialTopic(category: TicketCategory, hasSolutionContext: boolean): SupportTopicId | null {
  if (category === 'wrong_solution' && hasSolutionContext) return 'wrong_solution'
  if (category === 'payment') return 'payment'
  if (category === 'feature') return 'feature'
  return null
}

export const guestContactText = `Без аккаунта напиши на ${contactEmail} - опиши, что случилось.`
