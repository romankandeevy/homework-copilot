/* Построчная разница двух текстов: версии промпта и черновик против
   активной версии. Отдельный модуль - файлы с компонентами экспортируют
   только компоненты. */

export type DiffLine = { type: 'same' | 'add' | 'del'; text: string; id: number }

/* По наибольшей общей подпоследовательности. Промпт до 8000 символов - это
   сотни строк, таблица помещается в память легко. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const result: DiffLine[] = []
  const push = (type: DiffLine['type'], text: string) => {
    result.push({ type, text, id: result.length })
  }
  if (a.length * b.length > 400_000) {
    a.forEach((text) => push('del', text))
    b.forEach((text) => push('add', text))
    return result
  }
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i])
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push('del', a[i])
      i += 1
    } else {
      push('add', b[j])
      j += 1
    }
  }
  while (i < a.length) { push('del', a[i]); i += 1 }
  while (j < b.length) { push('add', b[j]); j += 1 }
  return result
}

/* Ключи строк без индекса: текст плюс номер его повторения. */
export function keyedLines(lines: readonly string[]) {
  const seen = new Map<string, number>()
  return lines.map((text) => {
    const count = (seen.get(text) ?? 0) + 1
    seen.set(text, count)
    return { key: `${count}:${text}`, text }
  })
}
