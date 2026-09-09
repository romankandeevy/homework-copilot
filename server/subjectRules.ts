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
// То же выражение для перебора всех величин условия, а не первой попавшейся.
const numberWithUnitPattern = new RegExp(unitPattern.source, 'giu')
const numberPattern = /\d/u

function text(solution: HomeworkSolution) {
  return [solution.answer, ...solution.steps].join(' ')
}

function conditionMentions(solution: HomeworkSolution, pattern: RegExp) {
  return pattern.test(solution.condition.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е'))
}

/* Трёхграммное сходство строк.

   То же, чем движок сверяет условие, но местное: geometrySolutionEngine
   импортирует этот файл, и обратный импорт замкнул бы круг. Нужно, чтобы
   отличить «продолжение мысли» от «того же самого, переписанного ещё раз»:
   буквы и числа в пунктах меняются, форма остаётся. */
function similarity(left: string, right: string) {
  const normalize = (value: string) => value.toLocaleLowerCase('ru-RU').replace(/[^a-zа-яё0-9]+/giu, '')
  const grams = (value: string) => {
    const normalized = normalize(value)
    if (normalized.length < 3) return new Set([normalized])
    return new Set(Array.from({ length: normalized.length - 2 }, (_, index) => normalized.slice(index, index + 3)))
  }
  const leftGrams = grams(left)
  const rightGrams = grams(right)
  const overlap = [...leftGrams].filter((entry) => rightGrams.has(entry)).length
  return (2 * overlap) / Math.max(1, leftGrams.size + rightGrams.size)
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

/* Обозначение вводится раньше, чем используется.

   7 сентября на проде алгебра с параметром: в решении стояло
   «g(1) = -a < 0, g(3) = -3a < 0» - и функции g в записи нет нигде. Модель
   держала её в уме, а ученик читает лист с начала и упирается в букву,
   которая взялась ниоткуда. Такую запись у доски не защитить.

   Ищем обращения вида «буква(аргумент)» и требуем, чтобы раньше по листу
   стояла строка, где эта буква определена. Известные функции и обозначения
   комбинаторики сюда не входят: sin, lg, C(n,k) вводить не надо. */
const knownFunctionNames = new Set([
  'sin', 'cos', 'tg', 'ctg', 'sec', 'cosec', 'arcsin', 'arccos', 'arctg',
  'lg', 'ln', 'log', 'exp', 'abs', 'min', 'max', 'sh', 'ch',
  'A', 'C', 'P', 'V', 'S', 'M', 'm', 'n', 'w', 'Q', 'R', 'I', 'U', 'E', 'F', 'T', 'N', 'k', 'd', 'p',
])

const symbolIntroduced: SubjectRule = {
  id: 'symbol-introduced',
  question: 'Каждое введённое обозначение - функция g(x), вспомогательная величина - определено раньше, чем использовано?',
  applies: (solution) => solution.steps.length > 0,
  verify: (solution) => {
    const used = new Map<string, number>()
    solution.steps.forEach((line, index) => {
      for (const match of line.matchAll(/(?<![\p{L}\d])([a-zA-Zа-яёА-ЯЁ])\s*\(/gu)) {
        const name = match[1]
        if (knownFunctionNames.has(name)) continue
        if (!used.has(name)) used.set(name, index)
      }
    })
    for (const [name, firstUse] of used) {
      /* Определением считаем строку, где функция задана от буквы -
         «g(x) = x² + 1» - или введена словом: «Пусть g(x)», «обозначим
         g(x)». Подстановка числа определением не является: «g(1) = -a»
         сообщает значение, а не говорит, что такое g. Ровно так и вышло
         7 сентября - лист начинался с подстановки. */
      const defined = solution.steps.slice(0, firstUse + 1).some((line) => (
        new RegExp(`${name}\\s*\\(\\s*[a-zа-яё][^)]*\\)\\s*(?:=|:=|-)`, 'iu').test(line)
        || new RegExp(`(?:пусть|обознач\\p{L}*|введ[её]м|положим)\\s+${name}\\s*\\(`, 'iu').test(line)
      ))
      if (!defined) return `Обозначение ${name}(...) использовано, но нигде не введено: определи его строкой до первого применения`
    }
    return null
  },
}

/* Задание выполняется целиком.

   Условие алгебры 7 сентября просило «найти все значения параметра a... и
   обосновать количество корней при разных a». Найдено было одно значение,
   разбора остальных случаев на листе нет вовсе - половина задания не
   выполнена, а решение прошло как верное. */
const casesAnalysed: SubjectRule = {
  id: 'cases-analysed',
  question: 'Если условие просит обосновать или исследовать - разобраны все случаи, а не только искомый?',
  applies: (solution) => conditionMentions(
    solution,
    /обоснуй|обоснова|исследуй|исследова|при каких|при разных|в зависимости от|сколько корней|количество корней/u,
  ),
  verify: (solution) => {
    const caseLines = solution.steps.filter((line) => /(?:^|[\s(])(?:при|если)\s+[a-zа-яё]/iu.test(line))
    return caseLines.length >= 2
      ? null
      : 'Условие просит разобрать случаи, а разобран один: выпиши, сколько корней получается при каждом промежутке значений параметра'
  },
}

/* Множители названы словами.

   7 сентября комбинаторика вышла листом из одной строки:
   «A(8,4) = 8 · 7 · 6 · 5 = 1680». Ответ верный, а откуда 8 и откуда 4 -
   на листе не сказано, всё рассуждение осталось в разборе. Разбор ученик
   учителю не сдаёт: он сдаёт лист. */
const factorsExplained: SubjectRule = {
  id: 'factors-explained',
  question: 'На листе словами сказано, что считает каждый множитель или сочетание?',
  applies: (solution) => solution.taskType === 'calculation'
    && solution.steps.some((line) => /[ACP]\s*\(|!/u.test(line)),
  verify: (solution) => (solution.steps.some((line) => /[а-яё]{3,}/iu.test(line))
    ? null
    : 'На листе только формула: скажи словами, что считает каждый множитель'),
}

/* Направление обосновано правилом.

   7 сентября физика назвала силу Ампера направленной вверх - верно, - но
   без правила левой руки. В школе на доске спрашивают именно правило, и
   ответ без него не принимают. */
const directionJustified: SubjectRule = {
  id: 'direction-justified',
  question: 'Направление силы или тока обосновано правилом левой руки, Ленца или буравчика?',
  applies: (solution) => conditionMentions(solution, /направлени|куда направлен|в какую сторону/u),
  verify: (solution) => (mentions(text(solution), /правил\p{L}*\s+(?:лев|прав)\p{L}*\s+рук|правил\p{L}*\s+ленца|буравчик|правил\p{L}*\s+винта/u)
    ? null
    : 'Направление указано без обоснования: назови правило левой руки, Ленца или буравчика'),
}

/* Программа лежит в своём поле, а не в строке тетради.

   7 сентября информатика вернула решение, в котором код на Python втиснут
   в две строки тетради: «Python: count = {0:1}; s = 0; ans = 0». В строке
   тетради нет ни отступов, ни переносов, ни моноширинного шрифта - в ней
   программы не бывает. Поле для кода появилось 8 сентября; правило следит,
   чтобы модель клала программу туда. */
const codeProvided: SubjectRule = {
  id: 'code-provided',
  question: 'Программа положена в поле code целиком, а не втиснута в строки решения?',
  applies: (solution) => conditionMentions(solution, /python|паскал|pascal|c\+\+|java|программ|код|напиш\p{L}*\s+функци/u),
  verify: (solution) => (solution.code?.text.trim()
    ? null
    : 'Программа не приложена: положи её целиком в поле code, а в решение - разбор алгоритма словами'),
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

/* Невозможность доказывается, а не объявляется.

   8 сентября на проде задача 788: «зная, что a < b, сравните a + 2 и
   b - 6». Пункт закрыт строкой «Сравнить невозможно». Утверждение верное,
   но у доски за него ставят ноль: невозможность - такое же утверждение,
   как равенство, и показывается она примером. Достаточно двух наборов
   чисел, дающих разный ответ: a = 0, b = 1 и a = 0, b = 100.

   Ищем не слово, а подстановку: место, где буква получает числовое
   значение. Одной мало - вся суть в том, что ответ меняется. */
const impossibilityClaim = /невозможн|нельзя (?:сравнить|определить|найти|однозначно)|не удастся|не определ|любой знак|знак (?:может быть )?любой|зависит от знач/u

const impossibilityProved: SubjectRule = {
  id: 'impossibility-proved',
  question: 'Если ответ - «сравнить нельзя» или «определить нельзя», показаны два набора чисел, дающих разный ответ?',
  applies: (solution) => mentions(`${solution.answer} ${solution.steps.join(' ')}`, impossibilityClaim),
  verify: (solution) => {
    const examples = [...solution.steps, solution.answer]
      .reduce((count, line) => count + [...line.matchAll(/[a-zа-я]\s*=\s*-?\d/giu)].length, 0)
    return examples >= 2
      ? null
      : 'Невозможность заявлена, но не показана: приведи два набора конкретных чисел из условия, дающих разный ответ'
  },
}

/* Один метод не переписывают в каждом пункте.

   Та же задача 788: четыре пункта, в каждом разность, знак и вывод
   отдельными строками - двенадцать строк, из которых новых мыслей четыре.
   Тетрадь пронумеровала их своими 1..12 поверх авторских а)-г), и лист
   стал нечитаемым.

   Ловим не длину, а повтор формы: если пункты размечены буквами и вторые
   строки разных пунктов совпадают по существу, значит расписан один и тот
   же ход. */
const partLabel = /^\s*([а-я])\s*\)/u

const partsNotSplit: SubjectRule = {
  id: 'parts-not-split',
  question: 'Пункт задания занимает одну строку, если во всех пунктах делается одно и то же?',
  applies: (solution) => solution.steps.filter((line) => partLabel.test(line)).length >= 2,
  verify: (solution) => {
    const groups: string[][] = []
    for (const line of solution.steps) {
      if (partLabel.test(line) || groups.length === 0) groups.push([line])
      else groups[groups.length - 1].push(line)
    }
    const seconds = groups.filter((group) => group.length > 1).map((group) => group[1])
    if (seconds.length < 2) return null
    /* Столбик выкладок - не раздувание.

       9 сентября правило вышло боком: у неравенств а-г ход в пункте - три
       равносильных преобразования подряд, сжать их в строку иначе как
       лентой через ⇒ нельзя, и модель написала «2x > -5 ⇒ x > -2,5 ⇒
       x ∈ (-2,5; +∞)». Столбик из трёх чисто символьных строк - это и есть
       тетрадная запись неравенства.

       Раздувание задачи 788 выглядит иначе: там на пункт одно вычисление, а
       следующие строки - словесный вывод «Так как a < b, то ..., значит
       ...». Поэтому граница проходит по словам: пункт из одних выкладок
       остаётся столбиком, пункт с рассуждением сжимается в строку. */
    const symbolicColumn = (group: readonly string[]) => group.length > 2
      && group.every((line) => (line.match(/[а-яё]{2,}/giu)?.length ?? 0) <= 1)
    if (groups.some(symbolicColumn)) return null

    const alike = seconds.some((line, index) => seconds
      .slice(index + 1)
      .some((other) => similarity(line, other) >= 0.55))

    return alike
      ? 'Во всех пунктах расписан один и тот же ход: сожми каждый пункт в одну строку, начав её с его буквы'
      : null
  },
}

const commonRules: readonly SubjectRule[] = [
  explanationExplains,
  impossibilityProved,
  partsNotSplit,
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
  mathematics: [numericAnswer, answerUnits, stepsShowWork, factorsExplained, symbolIntroduced, {
    id: 'check-by-substitution',
    question: 'Найденное значение подставлено обратно и условие сошлось?',
  }],
  algebra: [numericAnswer, answerUnits, stepsShowWork, symbolIntroduced, casesAnalysed, {
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
  physics: [numericAnswer, answerUnits, formulaBeforeNumbers, directionJustified, {
    id: 'si-units',
    question: 'Все величины в «Дано» переведены в СИ и выписаны все числа из условия?',
    /* «Дано» собирает все числовые величины условия.

       7 сентября на проде задача про стержень на рельсах пришла с «Дано»
       из четырёх строк, а g = 10 м/с² в нём не было - хотя в условии оно
       задано и в решении использовано. Ученик перепишет «Дано» с листа и
       у доски не сможет сказать, откуда взялось 10. */
    verify: (solution) => {
      if (solution.given.length === 0) return 'Раздел «Дано» пуст'
      const given = solution.given.join(' ')
      const missing = [...solution.condition.matchAll(numberWithUnitPattern)]
        .map((match) => match[0].trim())
        .filter((value) => {
          const number = value.match(/\d+(?:[.,]\d+)?/u)?.[0]
          return number ? !given.includes(number) : false
        })
      return missing.length > 0
        ? `В «Дано» нет величины ${missing[0]} из условия: выпиши все заданные числа`
        : null
    },
  }, {
    id: 'answer-plausible',
    question: 'Порядок величины в ответе разумен для школьной задачи?',
  }],
  chemistry: [{
    /* Электронный баланс кодом не проверить: расставленные коэффициенты
       разбирать пришлось бы полноценным разбором формул. Оставляем
       вопросом модели - отвергать решение за то, чего мы не умеем
       проверить, нельзя (AGENTS.md). */
    id: 'electron-balance',
    question: 'Для реакции с концентрированной HNO₃, H₂SO₄, KMnO₄ или K₂Cr₂O₇ записан электронный баланс?',
    applies: (solution) => conditionMentions(solution, /hno₃|hno3|h₂so₄|h2so4|kmno₄|kmno4|k₂cr₂o₇|k2cr2o7|окислит|восстановит/u),
  }, {
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
  informatics: [codeProvided, {
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
