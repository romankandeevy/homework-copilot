import { findSubjectByName } from '../src/lib/subjects.ts'
import type { HomeworkSolution } from '../src/lib/homeworkContract.ts'

/* Правила предмета вместо второго мнения модели.

   Рецензент — это третий вызов модели, и он шёл на каждой задаче: замер
   31 августа на проде показал 25–50 секунд из 43–78. Причина в том, что
   быстрый путь «два прохода сошлись» почти никогда не срабатывал, но и сама
   идея «спросить модель, всё ли хорошо» отвечает медленно и неточно.

   Школьные требования к записи — не предмет мнения. «В ответе есть единица
   измерения», «разбор по составу содержит корень», «уравнение реакции
   уравнено» проверяются кодом за микросекунды и всегда одинаково.

   Правила работают дважды. Сначала они уходят в промпт вопросами, на которые
   модель обязана ответить до выдачи решения и сама исправить нарушенное.
   Потом те, что проверяемы, проверяются здесь. Модель зовут ещё раз только
   когда правило нарушено, — а не «на всякий случай». */

export type SubjectRule = {
  id: string
  /** Вопрос, на который модель отвечает до выдачи решения. */
  question: string
  /** Когда правило вообще применимо к этой задаче. Нет — правило пропускается. */
  applies?: (solution: HomeworkSolution) => boolean
  /** Проверка кодом. Возвращает замечание или null. Нет проверки — правило только в промпте. */
  verify?: (solution: HomeworkSolution) => string | null
}

/* Число с единицей измерения.

   Границу слова `\b` в конце ставить нельзя: словом она считает только
   латиницу с цифрами, и после кириллического «км» никакой границы нет —
   выражение молча переставало находить «12 км». Вместо неё запрет на
   продолжение буквой, чтобы «м» не срабатывало внутри «минут». */
const unitPattern = /\d[\d\s.,]*\s*(?:км\/ч|м\/с|г\/моль|моль|мин|сут|руб|мм|мл|мг|км|кг|дм|см|°C|Дж|Вт|Ом|Па|м|г|т|л|с|ч|Н|В|А|°|%|₽)(?![а-яёa-z])/iu
const numberPattern = /\d/u

function text(solution: HomeworkSolution) {
  return [solution.answer, ...solution.steps].join(' ')
}

function conditionMentions(solution: HomeworkSolution, pattern: RegExp) {
  return pattern.test(solution.condition.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е'))
}

function mentions(value: string, pattern: RegExp) {
  return pattern.test(value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е'))
}

// Задача с числовым ответом обязана вернуть число. «Ответ: смотри решение»
// или «Ответ: найдено» — то, ради чего ученик и приходил, отсутствует.
const numericAnswer: SubjectRule = {
  id: 'numeric-answer',
  question: 'Ответ содержит найденное число, а не отсылку к решению?',
  applies: (solution) => solution.taskType === 'calculation' && Boolean(solution.answer.trim()),
  verify: (solution) => (numberPattern.test(solution.answer) ? null : 'В ответе нет найденного числа'),
}

/* Счётный ответ единицы измерения не имеет.

   5 сентября на проде отказ получила верно решённая задача «Сколько сторон
   имеет выпуклый многоугольник, каждый угол которого равен 160°?». В
   условии есть «160°», поэтому правило требовало единицу и от ответа - а
   ответом там служит число сторон, двенадцать. Единицы у него нет и быть
   не может, и адресный повтор её не придумает: он тоже вернул «12», и
   ученик остался без решения при верном ответе. */
const countableNouns = 'сторон|вершин|углов|точек|прямых|диагоналей|отрезков|треугольников'
  + '|чисел|цифр|способов|решений|корней|элементов|делителей|букв|слов|слагаемых|множителей'
const countingQuestion = new RegExp(`(?:скольк\\p{L}*|количеств\\p{L}*|число)\\s+(?:${countableNouns})`, 'iu')

// Единицы измерения теряются чаще всего, и работа за это снижается.
const answerUnits: SubjectRule = {
  id: 'answer-units',
  question: 'Единица измерения стоит при ответе, если она есть в условии?',
  applies: (solution) => solution.taskType === 'calculation'
    && unitPattern.test(solution.condition)
    && !mentions(`${solution.condition} ${solution.goal.text}`, countingQuestion),
  verify: (solution) => (unitPattern.test(solution.answer) ? null : 'В ответе нет единицы измерения'),
}

const stepsShowWork: SubjectRule = {
  id: 'steps-show-work',
  question: 'В решении есть сами вычисления со знаком равенства, а не только вывод?',
  applies: (solution) => solution.taskType === 'calculation',
  verify: (solution) => (solution.steps.some((line) => line.includes('=')) ? null : 'В решении нет ни одного вычисления'),
}

const latinPointLabels: SubjectRule = {
  id: 'latin-point-labels',
  question: 'Точки обозначены заглавными латинскими буквами?',
  applies: (solution) => solution.diagram.kind !== 'none',
  verify: (solution) => {
    const cyrillicPoints = solution.diagram.vertices.filter((vertex) => /[А-ЯЁ]/u.test(vertex))
    return cyrillicPoints.length > 0 ? 'Точки чертежа подписаны кириллицей вместо латиницы' : null
  },
}

const formulaBeforeNumbers: SubjectRule = {
  id: 'formula-before-numbers',
  question: 'Формула записана буквами до подстановки чисел?',
  applies: (solution) => solution.taskType === 'calculation',
}

/* Разбор перед решением.

   Это не украшение записи, а то, чем продукт отличается от списывания:
   сначала объясняем способ, потом показываем готовый лист. Проверяем то,
   что проверяемо кодом, - что разбор есть и что он не копия шагов. */
const explanationExplains: SubjectRule = {
  id: 'explanation-explains',
  question: 'Объяснение перед решением говорит, каким правилом задача решается и почему именно им?',
  verify: (solution) => {
    const explanation = solution.explanation ?? []
    if (explanation.length < 2) return 'Нет объяснения перед решением'
    const steps = new Set(solution.steps.map((line) => line.trim()))
    return explanation.some((line) => steps.has(line.trim()))
      ? 'Объяснение повторяет строки решения вместо разбора'
      : null
  },
}

const commonRules: readonly SubjectRule[] = [
  explanationExplains,
  {
    id: 'answer-answers-question',
    question: 'Ответ отвечает на вопрос задачи, а не пересказывает условие?',
    verify: (solution) => {
      const answer = solution.answer.trim()
      if (!answer) return null
      const condition = solution.condition.trim()
      return answer.length > 24 && condition.startsWith(answer.slice(0, 24))
        ? 'Ответ повторяет условие вместо ответа на вопрос'
        : null
    },
  },
]

const rulesBySubject: Record<string, readonly SubjectRule[]> = {
  mathematics: [numericAnswer, answerUnits, stepsShowWork, {
    id: 'check-by-substitution',
    question: 'Найденное значение подставлено обратно и условие сошлось?',
  }],
  algebra: [numericAnswer, answerUnits, stepsShowWork, {
    id: 'roots-checked',
    question: 'Все корни найдены и посторонние отброшены с указанием причины?',
  }, {
    id: 'domain-checked',
    question: 'Область допустимых значений выписана, если есть дробь, корень или логарифм?',
    applies: (solution) => conditionMentions(solution, /\/|дроб|корен|корн|логарифм|√/u),
  }, {
    id: 'identity-named',
    question: 'Названо преобразование или формула, по которой сделан каждый переход?',
  }],
  geometry: [answerUnits, latinPointLabels, {
    id: 'theorem-named',
    question: 'Названа теорема или признак, по которому сделан каждый вывод?',
  }, {
    id: 'drawing-matches-condition',
    question: 'На чертеже есть все объекты и подписи из условия?',
  }, {
    id: 'drawing-upright',
    question: 'Фигура стоит прямо - основание горизонтально, ось симметрии вертикальна - и занимает всё поле чертежа?',
    applies: (solution) => solution.diagram.kind !== 'none',
  }, {
    id: 'numbers-on-drawing',
    question: 'Числа из условия подписаны у нужных отрезков и углов чертежа?',
    applies: (solution) => solution.diagram.kind !== 'none' && /\d/u.test(solution.condition),
  }],
  physics: [numericAnswer, answerUnits, formulaBeforeNumbers, {
    id: 'si-units',
    question: 'Все величины в «Дано» переведены в СИ?',
    verify: (solution) => (solution.given.length > 0 ? null : 'Раздел «Дано» пуст'),
  }, {
    id: 'answer-plausible',
    question: 'Порядок величины в ответе разумен для школьной задачи?',
  }],
  chemistry: [{
    id: 'equation-balanced',
    question: 'Уравнение реакции уравнено — коэффициенты расставлены?',
    applies: (solution) => conditionMentions(solution, /реакц|уравнени|горени|раствор/u),
    verify: (solution) => (mentions(text(solution), /→|=|\+/u) ? null : 'Уравнения реакции в решении нет'),
  }, {
    id: 'molar-mass',
    question: 'Молярные массы взяты из таблицы и подписаны?',
    applies: (solution) => conditionMentions(solution, /масс|моль|доля/u),
  }, numericAnswer],
  biology: [{
    id: 'terms-named',
    question: 'Названы термины и процессы, а не бытовые описания?',
  }],
  informatics: [{
    id: 'base-marked',
    question: 'У чисел в непривычной системе счисления подписано основание?',
    applies: (solution) => conditionMentions(solution, /систем счислени|двоичн|восьмеричн|шестнадцатеричн/u),
  }, stepsShowWork],
  russian: [{
    id: 'morphemes-complete',
    question: 'В разборе по составу выделены корень и все имеющиеся приставки, суффиксы и окончание?',
    applies: (solution) => conditionMentions(solution, /по составу|морфемн/u),
    verify: (solution) => (mentions(text(solution), /корен|корн|приставк|суффикс|окончани|[а-я]+-[а-я]+-/u)
      ? null
      : 'В разборе по составу не выделены морфемы'),
  }, {
    id: 'derivation-named',
    question: 'Назван способ образования слова, если он спрошен?',
    applies: (solution) => conditionMentions(solution, /способ.{0,16}образовани|словообразовател/u),
    verify: (solution) => (mentions(text(solution), /способ|образован/u) ? null : 'Способ образования не назван'),
  }, {
    id: 'rule-named',
    question: 'Названо орфографическое или пунктуационное правило, если спрошено написание?',
    applies: (solution) => conditionMentions(solution, /написани|правописани|орфограмм|объясните, почему пишется/u),
    verify: (solution) => (mentions(text(solution), /пишетс|правил|орфограмм|проверочн/u) ? null : 'Правило написания не названо'),
  }],
  literature: [{
    id: 'text-evidence',
    question: 'Вывод опирается на текст произведения, а не на пересказ сюжета?',
  }],
  english: [{
    id: 'answer-language',
    question: 'Ответ дан на том языке, которого требует задание?',
  }],
  history: [{
    id: 'dates-named',
    question: 'Названы даты и участники событий, о которых спрашивают?',
    applies: (solution) => conditionMentions(solution, /когда|год|век|дат/u),
    verify: (solution) => (numberPattern.test(text(solution)) ? null : 'В ответе нет ни одной даты'),
  }],
  social: [{
    id: 'terms-defined',
    question: 'Обществоведческие термины употреблены в точном значении и раскрыты?',
  }],
  geography: [{
    id: 'place-named',
    question: 'Названы конкретные объекты и их расположение, а не общие слова?',
  }, answerUnits],
  astronomy: [numericAnswer, answerUnits, formulaBeforeNumbers],
}

export function subjectRules(subject: string): readonly SubjectRule[] {
  const known = findSubjectByName(subject)
  return [...(known ? rulesBySubject[known.id] ?? [] : []), ...commonRules]
}

/** Вопросы правил для промпта: модель отвечает на них до выдачи решения. */
export function subjectRuleQuestions(subject: string) {
  return subjectRules(subject).map((rule) => ({ id: rule.id, question: rule.question }))
}

/* Проверка правил кодом.

   Это и есть рецензент: там, где правило проверяемо, оно проверяется здесь
   и мгновенно. Правила без `verify` остаются требованием к модели и в
   замечания не попадают — иначе мы отвергали бы решение за то, чего сами
   не умеем проверить. */
export function verifySubjectRules(solution: HomeworkSolution): string[] {
  const issues: string[] = []

  for (const rule of subjectRules(solution.subject)) {
    if (!rule.verify) continue
    if (rule.applies && !rule.applies(solution)) continue
    const issue = rule.verify(solution)
    if (issue) issues.push(issue)
  }

  return [...new Set(issues)]
}
