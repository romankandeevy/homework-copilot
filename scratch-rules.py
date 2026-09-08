import io

p = 'server/subjectRules.ts'
s = io.open(p, encoding='utf-8').read()

anchor = "const commonRules: readonly SubjectRule[] = ["

rules = '''/* Невозможность доказывается, а не объявляется.

   8 сентября на проде задача 788: «зная, что a < b, сравните a + 2 и
   b - 6». Пункт закрыт строкой «Сравнить невозможно». Утверждение верное,
   но у доски за него ставят ноль: невозможность - такое же утверждение,
   как равенство, и показывается она примером. Достаточно двух наборов
   чисел, дающих разный ответ: a = 0, b = 1 и a = 0, b = 100.

   Ищем не слово, а подстановку: строку, где буква получает числовое
   значение. Одной мало - вся суть в том, что ответ меняется. */
const impossibilityClaim = /невозможн|нельзя (?:сравнить|определить|найти|однозначно)|не удастся|не определ|любой знак|знак (?:может быть )?любой|зависит от знач/u
const substitution = /[a-zа-я]\\s*=\\s*-?\\d/giu

const impossibilityProved: SubjectRule = {
  id: 'impossibility-proved',
  question: 'Если ответ «сравнить нельзя» или «определить нельзя» - показаны два набора чисел, дающих разный ответ?',
  applies: (solution) => mentions(`${solution.answer} ${solution.steps.join(' ')}`, impossibilityClaim),
  verify: (solution) => {
    const examples = solution.steps
      .concat(solution.answer)
      .reduce((count, line) => count + [...line.matchAll(substitution)].length, 0)
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

   Ловим не длину, а повтор формы: если пункты размечены буквами и строки
   внутри них совпадают по существу от пункта к пункту, значит расписан
   один и тот же ход. Сравниваем тем же трёхграммным сходством, которым
   сверяется условие: числа и буквы меняются, форма остаётся. */
const partLabel = /^\\s*([а-я])\\s*\\)/u

const partsNotSplit: SubjectRule = {
  id: 'parts-not-split',
  question: 'Каждый пункт задания занимает одну строку, если во всех пунктах делается одно и то же?',
  applies: (solution) => solution.steps.filter((line) => partLabel.test(line)).length >= 2,
  verify: (solution) => {
    const groups: string[][] = []
    for (const line of solution.steps) {
      if (partLabel.test(line) || groups.length === 0) groups.push([line])
      else groups[groups.length - 1].push(line)
    }
    const split = groups.filter((group) => group.length > 1)
    if (split.length < 2) return null

    // Совпадает ли второй ход в разных пунктах: «Так как a < b, то...».
    const seconds = split.map((group) => group[1])
    const alike = seconds.some((line, index) => seconds
      .slice(index + 1)
      .some((other) => similarity(line, other) >= 0.55))

    return alike
      ? 'Во всех пунктах расписан один и тот же ход: сожми каждый пункт в одну строку, начав её с его буквы'
      : null
  },
}

'''

assert anchor in s, 'commonRules anchor'
s = s.replace(anchor, rules + anchor, 1)

old = """const commonRules: readonly SubjectRule[] = [
  explanationExplains,"""
new = """const commonRules: readonly SubjectRule[] = [
  explanationExplains,
  impossibilityProved,
  partsNotSplit,"""
assert old in s, 'commonRules list'
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('rules ok')
