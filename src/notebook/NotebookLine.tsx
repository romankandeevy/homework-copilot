import type { ReactNode } from 'react'

/* Дробь столбиком: числитель и знаменатель в скобках через косую черту.

   Аудит 15 сентября: «(x² - 9)/(x - 3) = 0» в строку восьмиклассник
   прочитал как деление, в тетради это дробь. Числовые дроби вроде «22/5»
   остаются в строке: в тетради их пишут и так, а столбик из каждого
   деления сделал бы лист лестницей. */
/* Три вида дроби: «(x² - 9)/(x - 3)», «(v - v₀)/t» и «m(Al)/M(Al)».
   Скобка после буквы - аргумент функции, а не числитель: «m(Al)» не
   рвётся на «m» и «(Al)». Слова с косой чертой - «км/ч», «г/моль» - и
   числа «1/2» остаются строкой. */
const plain = String.raw`[^\s()·:+=,;/]+`
const call = String.raw`[^\s()·:+=,;/]+\([^()]*\)`
const fractionPattern = new RegExp([
  String.raw`(?<![\p{L}\d₀-₉])\((?<n1>[^()]+)\)\s*/\s*(?:\((?<d1>[^()]+)\)|(?<d2>${call}|${plain}))`,
  String.raw`(?<![\p{L}\d₀-₉(])(?<n2>${call}|${plain})\s*/\s*\((?<d3>[^()]+)\)`,
  String.raw`(?<![\p{L}\d₀-₉(])(?<n3>${call})\s*/\s*(?<d4>${call})`,
].join('|'), 'gu')

export function NotebookText({ text }: { text: string }) {
  const parts: ReactNode[] = []
  let cursor = 0
  for (const match of text.matchAll(fractionPattern)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push(text.slice(cursor, index))
    const groups = match.groups ?? {}
    const numerator = groups.n1 ?? groups.n2 ?? groups.n3 ?? ''
    const denominator = groups.d1 ?? groups.d2 ?? groups.d3 ?? groups.d4 ?? ''
    parts.push(
      <span className="notebook-fraction" key={`${index}:${match[0]}`} role="math" aria-label={`(${numerator}) делить на (${denominator})`}>
        <span className="notebook-fraction-top">{numerator}</span>
        <span className="notebook-fraction-bottom">{denominator}</span>
      </span>,
    )
    cursor = index + match[0].length
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}
