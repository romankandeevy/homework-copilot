/* Формула графика: разбор и вычисление без eval.

   График функции на чертеже задаётся строкой вида «2x - 3», «x² - 4x + 1»,
   «1/x», «√(x + 2)», «|x - 1|». Её пишет модель, а считать по ней должны
   и сервер (проверить, что точки лежат на графике), и браузер (нарисовать
   кривую). Общий разбор в одном месте, чтобы обе стороны понимали формулу
   одинаково. Никакого eval: строка приходит от модели.

   Понимает: числа с точкой и запятой, x, + - * / ^, скобки, унарный минус,
   умножение без знака (2x, 3(x+1), x(x-2)), надстрочные степени x², x³,
   √ и sqrt, |...| и abs, sin, cos, tg/tan, ln, lg, log, exp, π и e. */

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'x' }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' | '^' }
  | { kind: 'open' }
  | { kind: 'close' }
  | { kind: 'bar' }
  | { kind: 'fn'; value: string }

const superscripts: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' }
const functions: Record<string, (value: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  tg: Math.tan,
  ln: Math.log,
  lg: Math.log10,
  log: Math.log10,
  exp: Math.exp,
}

function tokenize(source: string): Token[] | null {
  const text = source
    .toLocaleLowerCase('ru-RU')
    .replace(/^\s*[yf]\s*(?:\(\s*x\s*\))?\s*=\s*/u, '')
    .replace(/,/gu, '.')
    .replace(/·|×/gu, '*')
    .replace(/:/gu, '/')
    .replace(/−/gu, '-')
    .replace(/√/gu, 'sqrt')
    .replace(/π/gu, '(3.141592653589793)')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/gu, (match) => `^(${[...match].map((char) => superscripts[char] ?? char).join('')})`)
  const tokens: Token[] = []
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (/\s/u.test(char)) { index += 1; continue }
    if (/[\d.]/u.test(char)) {
      const match = text.slice(index).match(/^\d*\.?\d+|^\d+\.?/u)
      if (!match) return null
      tokens.push({ kind: 'number', value: Number(match[0]) })
      index += match[0].length
      continue
    }
    if (char === 'x') { tokens.push({ kind: 'x' }); index += 1; continue }
    if (char === 'e' && !/[a-z]/u.test(text[index + 1] ?? '')) { tokens.push({ kind: 'number', value: Math.E }); index += 1; continue }
    if ('+-*/^'.includes(char)) { tokens.push({ kind: 'op', value: char as '+' }); index += 1; continue }
    if (char === '(') { tokens.push({ kind: 'open' }); index += 1; continue }
    if (char === ')') { tokens.push({ kind: 'close' }); index += 1; continue }
    if (char === '|') { tokens.push({ kind: 'bar' }); index += 1; continue }
    const word = text.slice(index).match(/^[a-z]+/u)
    if (word && functions[word[0]]) { tokens.push({ kind: 'fn', value: word[0] }); index += word[0].length; continue }
    return null
  }
  return tokens
}

type Node = (x: number) => number

/* Рекурсивный спуск: expr → term → power → unary → atom. Умножение без
   знака ставится там, где два операнда стоят рядом: число и x, x и скобка,
   скобка и скобка. */
function parse(tokens: Token[]): Node | null {
  let position = 0
  const peek = () => tokens[position]
  const take = () => tokens[position++]

  const startsOperand = (token: Token | undefined) => Boolean(token)
    && (token!.kind === 'number' || token!.kind === 'x' || token!.kind === 'open' || token!.kind === 'fn' || token!.kind === 'bar')

  const atom = (): Node | null => {
    const token = take()
    if (!token) return null
    if (token.kind === 'number') { const value = token.value; return () => value }
    if (token.kind === 'x') return (x) => x
    if (token.kind === 'open') {
      const inner = expression()
      if (!inner || take()?.kind !== 'close') return null
      return inner
    }
    if (token.kind === 'bar') {
      const inner = expression()
      if (!inner || take()?.kind !== 'bar') return null
      return (x) => Math.abs(inner(x))
    }
    if (token.kind === 'fn') {
      const apply = functions[token.value]
      const argument = peek()?.kind === 'open' ? atom() : unary()
      if (!argument) return null
      return (x) => apply(argument(x))
    }
    return null
  }

  const power = (): Node | null => {
    const base = atom()
    if (!base) return null
    if (peek()?.kind === 'op' && (peek() as { value: string }).value === '^') {
      take()
      const exponent = unary()
      if (!exponent) return null
      return (x) => base(x) ** exponent(x)
    }
    return base
  }

  const unary = (): Node | null => {
    if (peek()?.kind === 'op' && (peek() as { value: string }).value === '-') {
      take()
      const operand = unary()
      return operand ? (x) => -operand(x) : null
    }
    if (peek()?.kind === 'op' && (peek() as { value: string }).value === '+') { take(); return unary() }
    return power()
  }

  const term = (): Node | null => {
    let left: Node | null = unary()
    if (!left) return null
    for (;;) {
      const token = peek()
      if (token?.kind === 'op' && (token.value === '*' || token.value === '/')) {
        take()
        const right = unary()
        if (!right) return null
        const previous: Node = left
        left = token.value === '*' ? (x) => previous(x) * right(x) : (x) => previous(x) / right(x)
        continue
      }
      // Умножение без знака: 2x, x(x-1), (x+1)(x-1), 3sqrt(x).
      if (startsOperand(token) && token!.kind !== 'bar') {
        const right = unary()
        if (!right) return null
        const previous: Node = left
        left = (x) => previous(x) * right(x)
        continue
      }
      return left
    }
  }

  const expression = (): Node | null => {
    let left: Node | null = term()
    if (!left) return null
    while (peek()?.kind === 'op' && ((peek() as { value: string }).value === '+' || (peek() as { value: string }).value === '-')) {
      const operator = (take() as { value: string }).value
      const right = term()
      if (!right) return null
      const previous: Node = left
      left = operator === '+' ? (x) => previous(x) + right(x) : (x) => previous(x) - right(x)
    }
    return left
  }

  const root = expression()
  return root && position === tokens.length ? root : null
}

/** Разбирает формулу; вернёт null, если строка не является выражением от x. */
export function compileFormula(source: string): ((x: number) => number) | null {
  const tokens = tokenize(source)
  if (!tokens || tokens.length === 0) return null
  const node = parse(tokens)
  if (!node) return null
  // Пробный счёт: формула обязана давать число хотя бы где-то на оси.
  const probe = [-2, -1, 0, 0.5, 1, 2, 3].map(node)
  return probe.some((value) => Number.isFinite(value)) ? node : null
}

/* Точки кривой для рисования. Разрывы (1/x, tg x) рвут путь: там, где
   значение бесконечно или соседние значения скачут через весь диапазон,
   начинается новая ветвь. */
export function sampleFormula(
  formula: (x: number) => number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  samples = 240,
): Array<Array<{ x: number; y: number }>> {
  const branches: Array<Array<{ x: number; y: number }>> = []
  let branch: Array<{ x: number; y: number }> = []
  const overflow = (yMax - yMin) * 2
  let previous: number | null = null
  for (let index = 0; index <= samples; index += 1) {
    const x = xMin + ((xMax - xMin) * index) / samples
    const y = formula(x)
    const jump = previous !== null && Math.abs(y - previous) > overflow
    if (!Number.isFinite(y) || Math.abs(y) > overflow * 4 || jump) {
      if (branch.length > 1) branches.push(branch)
      branch = []
      previous = Number.isFinite(y) ? y : null
      if (jump && Number.isFinite(y)) branch.push({ x, y })
      continue
    }
    branch.push({ x, y })
    previous = y
  }
  if (branch.length > 1) branches.push(branch)
  return branches
}
