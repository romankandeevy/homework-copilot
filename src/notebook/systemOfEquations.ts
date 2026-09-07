/* Система уравнений пишется скобкой.

   7 сентября на проде задача «y = -0,1x + 0,5 и y = 0,3x + 0,1 решить
   в виде системы уравнений» вернулась верным решением, но в «Дано»
   стояли две отдельные строки. Ученика просили записать систему - а
   системы на листе не было ни одной: две строки под фигурной скобкой и
   две строки просто так - разные записи, и учитель считает вторую
   невыполненным заданием.

   Скобку рисует лист, а не модель: просить у модели псевдографику
   бесполезно, а вот сказать «эти строки идут одной системой» код умеет
   сам - по условию и по виду строк. */

export function taskAsksForSystem(condition: string) {
  return /систем\w*\s+уравнени|в виде системы|системой уравнени/iu.test(condition)
}

// Строка системы - это уравнение: знак равенства и буква-переменная.
// «m = 5 кг» из «Дано» физики под это не подходит - там нет неизвестной,
// и скобка бы там только мешала.
function looksLikeEquation(line: string) {
  return line.includes('=') && /[a-zA-Zα-ωа-я]\s*[-+*/^)(]?\s*(?:=|[\d,.]*\s*[a-zA-Z])/u.test(line)
    && /[xyzuvtabkmn]/u.test(line)
}

export type NotebookBlock =
  | { kind: 'system'; lines: string[] }
  | { kind: 'line'; line: string }

/** Соседние уравнения собирает в систему; всё прочее оставляет строками. */
export function notebookBlocks(lines: string[], condition: string): NotebookBlock[] {
  if (!taskAsksForSystem(condition)) return lines.map((line) => ({ kind: 'line', line }))

  const blocks: NotebookBlock[] = []
  let run: string[] = []
  const flush = () => {
    if (run.length >= 2) blocks.push({ kind: 'system', lines: run })
    else for (const line of run) blocks.push({ kind: 'line', line })
    run = []
  }

  for (const line of lines) {
    if (looksLikeEquation(line)) run.push(line)
    else {
      flush()
      blocks.push({ kind: 'line', line })
    }
  }
  flush()
  return blocks
}
