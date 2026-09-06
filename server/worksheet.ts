/* Черновик решения, который проверяет калькулятор, а не модель.

   6 сентября обе модели - и дешёвая, и дорогая - провалили одну и ту же
   задачу по комбинаторике, и провалили одинаково. gpt-5-6-sol написала:

     Число наборов из 5 цифр с суммой, кратной 3: 3 + 3 + 27 + 3 = 36

   Схема разбора верная, сложение верное, второй случай посчитан верно.
   Неверен ровно один член: набор «три цифры из первой группы, по одной из
   второй и третьей» - это C(3,3)·C(3,1)·C(3,1) = 9, а не 3. Из-за одной
   этой девятки ответ вышел 9024 вместо 9744.

   Такой счёт не длинный, а широкий: десяток независимых веток, каждую надо
   посчитать и удержать, пока считаешь остальные. Модель делает это в один
   проход, и потерянный множитель даёт правдоподобное число - ни она сама,
   ни проверка формата противоречия не видят.

   Поэтому модель обязана записать не только число, но и выражение, из
   которого оно получилось. Выражение считаем мы. Расхождение ловится
   детерминированно, без второго вызова модели: где написано 3, а выходит 9,
   там ошибка, и спорить не о чем.

   Считает свой калькулятор по разрешённой грамматике, а не eval и не код
   модели: условие задачи приходит от ученика фотографией, и всё, что попало
   в промпт, модель может утащить в выражение. Здесь выполнить нечего -
   только числа, скобки, четыре действия, степень, корень, факториал и
   школьные C(n,k) и A(n,k).

   Чего проверка не ловит: забытую ветку перебора и выражение, неверное
   само по себе. Против них помогает только сверка двух независимых
   проходов. */

/** Строка черновика: что считаем, чем считаем, что получилось. */
export type WorksheetLine = {
  label: string
  expression: string
  value: string
}

const maxExpressionLength = 120

/* Знаки, которыми школьник и модель пишут одно и то же действие. */
function canonicalExpression(expression: string) {
  return expression
    .replace(/[·×∙*]/gu, '*')
    .replace(/[÷:]/gu, '/')
    .replace(/[−–—]/gu, '-')
    .replace(/\s+/gu, '')
}

type Token = { kind: 'number'; value: number } | { kind: 'name'; value: string } | { kind: 'symbol'; value: string }

/* Запятая значит разное в разных местах: в «0,5» это десятичная дробь,
   в «C(3,2)» - разделитель аргументов. Различаем по тому, чьи это скобки:
   у скобок после имени функции запятая разделяет, у остальных - дробит.
   Раньше запятая всюду превращалась в точку, и C(3,3) читалось как C(3.3)
   с одним аргументом - калькулятор молча пропускал всю комбинаторику,
   ровно ту, ради которой затевался. */
function tokenize(source: string): Token[] | null {
  const tokens: Token[] = []
  const callStack: boolean[] = []
  let index = 0

  const previous = () => tokens[tokens.length - 1]

  while (index < source.length) {
    const character = source[index]
    if (/[0-9.]/u.test(character)) {
      const match = /^\d+(?:\.\d+)?/u.exec(source.slice(index))
      if (!match) return null
      tokens.push({ kind: 'number', value: Number(match[0]) })
      index += match[0].length
      continue
    }
    if (/[A-Za-zА-Яа-яЁё]/u.test(character)) {
      const match = /^[A-Za-zА-Яа-яЁё]+/u.exec(source.slice(index))
      if (!match) return null
      tokens.push({ kind: 'name', value: match[0].toLowerCase() })
      index += match[0].length
      continue
    }
    if (character === ',') {
      if (callStack[callStack.length - 1] === true) {
        tokens.push({ kind: 'symbol', value: ',' })
        index += 1
        continue
      }
      const fraction = /^,(\d+)/u.exec(source.slice(index))
      const head = previous()
      if (!fraction || !head || head.kind !== 'number') return null
      head.value = Number(`${head.value}.${fraction[1]}`)
      index += fraction[0].length
      continue
    }
    if (character === '(') {
      const head = previous()
      callStack.push(Boolean(head && head.kind === 'name'))
      tokens.push({ kind: 'symbol', value: '(' })
      index += 1
      continue
    }
    if (character === ')') {
      callStack.pop()
      tokens.push({ kind: 'symbol', value: ')' })
      index += 1
      continue
    }
    if ('+-*/^!√'.includes(character)) {
      tokens.push({ kind: 'symbol', value: character })
      index += 1
      continue
    }
    return null
  }
  return tokens
}

/* Разбор по убыванию приоритета: сумма → произведение → степень → атом.
   Ошибка разбора - не ошибка ученика: непонятое выражение мы пропускаем,
   а не объявляем неверным. Поэтому все ветки возвращают null. */
function readExpression(tokens: readonly Token[]): number | null {
  let position = 0

  const peek = () => tokens[position]
  const eat = (value: string) => {
    const token = peek()
    if (token && token.kind === 'symbol' && token.value === value) {
      position += 1
      return true
    }
    return false
  }

  const readFactorial = (value: number): number | null => {
    let result = value
    while (eat('!')) {
      const factorial = factorialOf(result)
      if (factorial === null) return null
      result = factorial
    }
    return result
  }

  const readArguments = (): number[] | null => {
    if (!eat('(')) return null
    const args: number[] = []
    if (eat(')')) return args
    for (;;) {
      const value = readSum()
      if (value === null) return null
      args.push(value)
      if (eat(',')) continue
      return eat(')') ? args : null
    }
  }

  function readAtom(): number | null {
    if (eat('-')) {
      const value = readAtom()
      return value === null ? null : -value
    }
    if (eat('+')) return readAtom()
    if (eat('√')) {
      const value = readAtom()
      return value === null || value < 0 ? null : Math.sqrt(value)
    }

    const token = peek()
    if (!token) return null

    if (token.kind === 'number') {
      position += 1
      return readFactorial(token.value)
    }

    if (token.kind === 'name') {
      position += 1
      const args = readArguments()
      if (args === null) return null
      const value = applyFunction(token.value, args)
      return value === null ? null : readFactorial(value)
    }

    if (eat('(')) {
      const value = readSum()
      if (value === null || !eat(')')) return null
      return readFactorial(value)
    }

    return null
  }

  function readPower(): number | null {
    const base = readAtom()
    if (base === null) return null
    if (eat('^')) {
      const exponent = readPower()
      if (exponent === null) return null
      return base ** exponent
    }
    return base
  }

  function readProduct(): number | null {
    let left = readPower()
    if (left === null) return null
    for (;;) {
      if (eat('*')) {
        const right = readPower()
        if (right === null) return null
        left *= right
      } else if (eat('/')) {
        const right = readPower()
        if (right === null || right === 0) return null
        left /= right
      } else {
        return left
      }
    }
  }

  function readSum(): number | null {
    let left = readProduct()
    if (left === null) return null
    for (;;) {
      if (eat('+')) {
        const right = readProduct()
        if (right === null) return null
        left += right
      } else if (eat('-')) {
        const right = readProduct()
        if (right === null) return null
        left -= right
      } else {
        return left
      }
    }
  }

  const value = readSum()
  return value === null || position !== tokens.length ? null : value
}

function factorialOf(value: number): number | null {
  if (!Number.isInteger(value) || value < 0 || value > 170) return null
  let result = 1
  for (let step = 2; step <= value; step += 1) result *= step
  return result
}

function combinations(total: number, taken: number): number | null {
  if (!Number.isInteger(total) || !Number.isInteger(taken) || total < 0 || taken < 0 || total > 1000) return null
  if (taken > total) return 0
  let result = 1
  for (let step = 1; step <= taken; step += 1) result = (result * (total - taken + step)) / step
  return Math.round(result)
}

function arrangements(total: number, taken: number): number | null {
  const chosen = combinations(total, taken)
  const order = factorialOf(taken)
  return chosen === null || order === null ? null : chosen * order
}

/* Школьные обозначения. C и A пишут и латиницей, и кириллицей: С(3,1) с
   русской «эс» модель отдаёт регулярно, и отвергать её за это глупо. */
function applyFunction(name: string, args: number[]): number | null {
  const arity = args.length
  if ((name === 'c' || name === 'с') && arity === 2) return combinations(args[0], args[1])
  if ((name === 'a' || name === 'а') && arity === 2) return arrangements(args[0], args[1])
  if ((name === 'p' || name === 'р') && arity === 1) return factorialOf(args[0])
  if ((name === 'sqrt' || name === 'корень') && arity === 1) return args[0] < 0 ? null : Math.sqrt(args[0])
  if (name === 'abs' && arity === 1) return Math.abs(args[0])
  if ((name === 'nod' || name === 'нод') && arity === 2) return greatestCommonDivisor(args[0], args[1])
  return null
}

function greatestCommonDivisor(left: number, right: number): number | null {
  if (!Number.isInteger(left) || !Number.isInteger(right)) return null
  let first = Math.abs(left)
  let second = Math.abs(right)
  while (second > 0) [first, second] = [second, first % second]
  return first
}

/* Значение выражения или null, если оно нам непонятно. */
export function evaluateExpression(expression: string): number | null {
  const source = canonicalExpression(expression)
  if (!source || source.length > maxExpressionLength) return null
  const tokens = tokenize(source)
  if (!tokens || tokens.length === 0) return null
  const value = readExpression(tokens)
  return value === null || !Number.isFinite(value) ? null : value
}

/* Записанный моделью результат. Дробь ученик пишет косой чертой, и «29/405»
   здесь такой же законный результат, как «9744». */
export function parseWorksheetValue(value: string): number | null {
  return evaluateExpression(value)
}

/* Совпало ли записанное с посчитанным.

   Точное равенство не годится: 29/405 в десятичной записи бесконечна, а
   модель пишет 0,0716. Сравниваем с относительной точностью, но целые
   числа - строго: 9744 против 9743 расхождение, а не округление. */
function valuesAgree(written: number, computed: number) {
  if (Number.isInteger(computed) && Number.isInteger(written)) return written === computed
  const scale = Math.max(Math.abs(computed), Math.abs(written), 1)
  return Math.abs(written - computed) <= scale * 1e-3
}

/* Откуда взялось число.

   Первый живой прогон черновика 6 сентября показал предел проверки счётом:
   модель написала «36 * 120 = 4320» - арифметика сошлась, замечаний нет,
   ответ неверный. Неверна была сама 36: столько наборов цифр она насчитала
   в уме и записала готовым числом, не показав перебора. Верно 42.

   Значит проверять надо не только счёт, но и происхождение чисел. Большое
   число в выражении обязано откуда-то браться: из условия или из другой
   строки черновика. Нет - модель обязана выписать перебор, из которого оно
   получилось, и вот его калькулятор уже пересчитает.

   Граница в 12 не случайна и не строга: до дюжины числа честно считаются
   на пальцах - число цифр, вершин, месяцев, - и требовать для них вывода
   значит топить проверку в шуме. «9 · 9 · 8 · 7 · 6 · 5» вопросов не
   вызывает, «36 наборов» - вызывает. */
const traceableFrom = 13

/* Школьные постоянные выводить не надо.

   6 сентября проверка происхождения потребовала вывести 180 в «сумма
   углов треугольника = 180°», и модель дописала в решение строку
   «∠1 + ∠2 + ∠3 = 180°» про треугольник, которого в задаче не было.
   Ученик получил в тетради обломок доказательства теоремы вместо решения.

   Эти числа - не результат счёта, а известные величины: градусы полного
   угла и развёрнутого, проценты, метрические кратности, нормальные
   условия. Требовать для них вывода - плодить мусор в записи.
   Список нарочно короткий. «120» сюда не входит, хотя это и градусы: в
   комбинаторике 120 это 5!, и требовать вывода там правильно. Берём
   только те числа, которые счётным результатом почти не бывают. */
const schoolConstants = new Set([
  '100', '180', '360',
  '1000', '10000', '100000', '1000000',
  '273', '760', '1013',
])

function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)?/gu) ?? []).map((entry) => entry.replace(',', '.'))
}

export function verifyWorksheetDerivation(
  lines: readonly WorksheetLine[],
  condition: string,
): string[] {
  if (lines.length === 0) return []
  const known = new Set<string>(numbersIn(condition))
  for (const line of lines) {
    const value = parseWorksheetValue(line.value)
    if (value !== null) known.add(String(value))
    for (const number of numbersIn(line.value)) known.add(number)
  }

  const issues: string[] = []
  for (const line of lines) {
    for (const number of numbersIn(line.expression)) {
      const size = Number(number)
      if (!Number.isFinite(size) || size < traceableFrom) continue
      if (schoolConstants.has(number)) continue
      if (known.has(number) || known.has(String(size))) continue
      issues.push(`Черновик, «${line.label}»: число ${number} взято ниоткуда - выпиши строкой, как оно получено`)
    }
  }
  return issues.slice(0, 4)
}

/* Проверка черновика. Возвращает замечания в том же виде, что и остальные
   проверки решателя: пусто - всё сошлось. */
export function verifyWorksheet(lines: readonly WorksheetLine[]): string[] {
  const issues: string[] = []
  for (const line of lines) {
    const computed = evaluateExpression(line.expression)
    if (computed === null) continue
    const written = parseWorksheetValue(line.value)
    if (written === null) {
      issues.push(`Черновик, «${line.label}»: результат «${line.value}» не число`)
      continue
    }
    if (!valuesAgree(written, computed)) {
      /* Формулировка важнее самой проверки. Первый живой прогон 6 сентября:
         калькулятор сказал «= 22, а записано 20», модель молча подставила 22
         и ответ стал хуже - верным было именно 20, а неверным выражение.
         Расхождение значит «здесь ошибка», а не «возьми наше число»: что
         именно неверно - выражение или результат - решать модели. */
      issues.push(
        `Черновик, «${line.label}»: выражение ${line.expression} даёт ${formatComputed(computed)}, `
        + `а записано ${line.value}. Одно из двух неверно - разберись, что именно, и исправь его, `
        + 'а не подгоняй второе под первое',
      )
    }
  }
  return issues.slice(0, 6)
}

function formatComputed(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)))
}
