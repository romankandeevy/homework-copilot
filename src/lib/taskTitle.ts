import type { HomeworkSolution } from './homeworkContract'

/* Название задачи в «Моих решениях».

   До 14 сентября 2026 подписью служило поле `task`, а оно не название: для
   вписанного условия это первые 60 знаков, отрезанные на полуслове, для
   фотографии - одинаковое у всех «Задача с фото». Владелец с полусотней
   решений не мог найти нужное, не открывая каждое.

   Название собирается из того, что уже лежит в решении, без вызова модели:
   - номер, если он есть: из номера учебника или из начала условия
     («274. …», «№ 274», «Упр. 274», «Стр. 45, № 274»);
   - вопрос задачи её же словами: первое предложение, которое что-то просит
     («Найдите сторону ромба», «Почему Печорина называют лишним человеком?»).
     Вопрос с местоимением («Сколько км он прошёл?») без первой фразы
     непонятен - тогда берётся первая фраза условия;
   - длинное режется по слову с многоточием, а «Решите неравенство и
     изобразите …: 0,7x - 7 > 0» сжимается до «Решите неравенство: 0,7x - 7 > 0»:
     различает такие задачи именно формула после двоеточия.

   Остаток условия уходит в `detail` - вторую строку карточки, чтобы
   название и условие не повторяли друг друга. */

export type TaskTitle = {
  /** «№ 274» с неразрывным пробелом, если у задачи есть номер. */
  number: string | null
  /** Короткое название. Пустым не бывает. */
  title: string
  /** То, чего нет в названии: остаток условия или «Найти: …». Может быть пустым. */
  detail: string
}

export type TaskTitleSource = Pick<HomeworkSolution, 'task' | 'source' | 'condition' | 'goal' | 'subject'>

/* Две строки карточки шириной 17,5 rem - около семидесяти знаков. Длиннее
   уже не название, а пересказ условия. */
export const taskTitleLimit = 72

const numberToken = String.raw`\d{1,4}(?:\.\d{1,3}){0,2}[а-е]?(?![\p{L}\d])`
// «№ 274», «Упр. 274», «Задача 12.3» в начале условия.
const labelledNumber = new RegExp(String.raw`^(?:№|номер|задача|задание|упражнение|упр\.)\s*(${numberToken})[\s.:)]*`, 'iu')
// «274. Найдите …». Номер со скобкой не берём: «1)» - пункт задания, а не номер.
const bareNumber = /^(\d{1,4}(?:\.\d{1,3}){0,2})\.\s+/u
// «Стр. 45, № 274. …» - адрес в учебнике перед номером, в пределах первых 30 знаков.
const addressedNumber = new RegExp(String.raw`^[^\n]{0,30}?№\s*(${numberToken})[\s.:)]*`, 'iu')
const textbookNumber = /^\d{1,4}(?:\.\d{1,3}){0,2}$/u
const conditionLabel = /^(?:условие|задача|задание)\s*[:.]\s*/iu
// Кириллица и латиница - отдельными классами: смешанный класс проверка
// алфавитов (`npm run check:unicode`) принимает за опечатку и роняет сборку.
const partLabel = /^(?:[а-е]|[a-e])\)\s*/u

/* Граница предложения: знак конца, пробел и заглавная. После одиночной
   русской заглавной с точкой не режем - это инициалы («А. С. Пушкин»).
   Латинская буква с точкой режется: в геометрии это точка, «…углом C. Найдите AB». */
const sentenceBreak = /(?<=[.!?…])(?<![\s(«"][А-ЯЁ]\.)(?<!^[А-ЯЁ]\.)\s+(?=[«"(]?(?:[А-ЯЁ]|[A-Z]))/u
const lineBreak = /\n+(?=\s*[«"(]?(?:[А-ЯЁ]|[A-Z]))/u

/* Предложение, которое что-то просит: повелительное или неопределённое
   наклонение, вопросительное слово, знак вопроса. */
const askStart = /^(?:во\s+сколько|(?:\p{L}*(?:ите|йте|ьте)|найди|найти|реши|решить|вычисли|вычислить|докажи|доказать|построй|построить|определи|определить|упрости|упростить|сравни|сравнить|запиши|записать|составь|составить|объясни|объяснить|напиши|написать|переведи|перевести|укажи|указать|выбери|выбрать|ответь|ответить|изобрази|изобразить|начерти|начертить|разложи|разложить|сократи|сократить|исследуй|исследовать|проверь|проверить|приведи|привести|назови|назвать|опиши|описать|подчеркни|вставь|расставь|прочитай|выпиши|выписать|спиши|списать|какой|какая|какое|какие|каков|какова|каково|каковы|чему|сколько|почему|зачем|как|что|где|когда|кто|чем|find|solve|write|translate|choose|complete|answer|read|fill|put|make|describe|explain|calculate|prove|what|why|how|which|who|where|when)(?!\p{L}))/iu

/* Вопрос со ссылкой на предыдущую фразу («Сколько км он прошёл?»,
   «Найдите его площадь») сам по себе не название. */
const anaphora = /(?:^|[^\p{L}])(?:он|она|оно|они|его|её|ее|их|него|неё|нее|них|ему|ей|им|ним|ней|нему|этот|эта|это|эти|этого|этой|этих|этом|этим|эту|данн\p{L}*|тот|та|те|того|той|тех)(?!\p{L})/iu

/* «Решите задачу», «Ответьте на вопросы», «Рассмотрите рисунок» - просьба
   без предмета: так начинается половина условий, особенно распознанных с
   фото, и отличить по ней задачи нельзя. */
const genericAsk = /^\p{L}+(?:\s+(?:на|по|к|в))?(?:\s+(?:эту|эти|это|следующ\p{L}*|данн\p{L}*|все))?\s+(?:задач\p{L}*|задани\p{L}*|упражнени\p{L}*|пример\p{L}*|вопрос\p{L}*|тест\p{L}*|номер\p{L}*|рисун\p{L}*|схем\p{L}*|таблиц\p{L}*|текст\p{L}*|график\p{L}*|фото\p{L}*)$/iu

const subjectDative: Record<string, string> = {
  Математика: 'математике',
  Алгебра: 'алгебре',
  Геометрия: 'геометрии',
  Физика: 'физике',
  Химия: 'химии',
  Биология: 'биологии',
  Информатика: 'информатике',
  'Русский язык': 'русскому языку',
  Литература: 'литературе',
  'Английский язык': 'английскому языку',
  История: 'истории',
  Обществознание: 'обществознанию',
  География: 'географии',
  Астрономия: 'астрономии',
}

function withoutTrailingPunctuation(text: string) {
  return text.replace(/[\s.;,:…]+$/u, '')
}

function splitNumber(source: TaskTitleSource, text: string) {
  const task = typeof source.task === 'string' ? source.task.trim() : ''
  const fromTextbook = source.source === 'number' && textbookNumber.test(task) ? task : null
  for (const pattern of [labelledNumber, bareNumber, addressedNumber]) {
    const match = pattern.exec(text)
    if (match) return { number: fromTextbook ?? match[1], body: text.slice(match[0].length) }
  }
  return { number: fromTextbook, body: text }
}

function sentencesOf(text: string) {
  return text
    .split(lineBreak)
    .flatMap((line) => line.replace(/\s+/gu, ' ').trim().split(sentenceBreak))
    .map((sentence) => sentence.trim())
    .filter((sentence) => /[\p{L}\d]/u.test(sentence))
}

function isGeneric(sentence: string) {
  const text = withoutTrailingPunctuation(sentence.replace(partLabel, '')).replace(/[!?]+$/u, '')
  return text.split(' ').length < 2 || genericAsk.test(text)
}

function isAsk(sentence: string) {
  const text = sentence.replace(partLabel, '')
  return /\?\s*$/u.test(text) || askStart.test(text)
}

function cutAtWord(text: string) {
  const space = text.lastIndexOf(' ', taskTitleLimit)
  const cut = space >= taskTitleLimit / 2 ? text.slice(0, space) : text.slice(0, taskTitleLimit - 1)
  return `${cut.replace(/[\s.,;:!?(«"'=+-]+$/u, '')}…`
}

function shorten(sentence: string) {
  const text = withoutTrailingPunctuation(sentence)
  if (text.length <= taskTitleLimit) return text
  const colon = text.lastIndexOf(': ')
  if (colon > 0) {
    const tail = text.slice(colon + 2).trim()
    const clause = text.slice(0, colon).split(/,\s|\s(?:и|или|а также)\s/u)[0].trim()
    const joined = `${clause}: ${tail}`
    if (tail && joined.length <= taskTitleLimit) return joined
  }
  return cutAtWord(text)
}

function capitalize(text: string) {
  return /^[а-яё]{2}/u.test(text) ? `${text[0].toLocaleUpperCase('ru-RU')}${text.slice(1)}` : text
}

function goalLine(goal: TaskTitleSource['goal'] | undefined) {
  const text = withoutTrailingPunctuation(typeof goal?.text === 'string' ? goal.text.replace(/\s+/gu, ' ').trim() : '')
  if (text.length < 2 || /^(?:ответ|решение|значение)$/iu.test(text)) return { line: '', text: '' }
  return { line: `${goal?.title || 'Найти'}: ${text}`, text }
}

export function describeTask(source: TaskTitleSource): TaskTitle {
  const condition = typeof source.condition === 'string' ? source.condition.trim() : ''
  const { number: rawNumber, body: numbered } = splitNumber(source, condition)
  const body = numbered.replace(conditionLabel, '').trim()
  const number = rawNumber ? `№ ${rawNumber}` : null
  const sentences = sentencesOf(body)
  const usable = sentences.filter((sentence) => !isGeneric(sentence))
  const chosen = usable.find((sentence) => isAsk(sentence) && !anaphora.test(sentence)) ?? usable[0] ?? null
  const goal = goalLine(source.goal)

  if (!chosen) {
    const dative = subjectDative[source.subject]
    const title = goal.line ? capitalize(shorten(goal.line)) : dative ? `Задача по ${dative}` : 'Задача'
    return { number, title, detail: goal.line && title !== goal.line ? goal.line : '' }
  }

  const clean = chosen.replace(partLabel, '')
  const short = shorten(clean)
  const title = capitalize(short)
  /* Урезанное название показывает начало фразы, поэтому ниже - условие
     целиком. Полное - только то, чего в названии нет. */
  const rest = short === withoutTrailingPunctuation(clean)
    ? sentences.filter((sentence) => sentence !== chosen).join(' ')
    : body.replace(/\s+/gu, ' ').trim()
  const goalRepeatsTitle = title.toLocaleLowerCase('ru-RU').includes(goal.text.toLocaleLowerCase('ru-RU'))
  return { number, title, detail: rest || (goalRepeatsTitle ? '' : goal.line) }
}
