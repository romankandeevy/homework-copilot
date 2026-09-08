import type { HomeworkSolution } from '../src/lib/homeworkContract.ts'

/* Приём решения ограничен ступенью обучения.

   7 сентября на проде стереометрия за 11 класс - расстояние между
   скрещивающимися прямыми в кубе - решилась через векторное и смешанное
   произведение: `[DM × A₁N]`, `DA₁ · [DM × A₁N]`. Ответ верный до последней
   цифры, а сдать такое нельзя: векторного произведения нет ни в одном
   школьном учебнике. Школьный путь - метод координат с уравнением
   плоскости либо построение общего перпендикуляра.

   Правило «решай средствами своего класса» стояло в промпте с самого
   начала. Промпт - просьба: пока никто не проверяет, модель берёт тот
   приём, которым короче. Здесь она проверяется.

   Проверка нарочно грубая - по названию приёма, а не по существу записи.
   Она ловит то, что в школьной тетради вообще не появляется, и молчит на
   всём остальном: отвергать решение за то, чего мы не умеем разобрать,
   дороже, чем пропустить. */

export type Stage = 'junior' | 'middle' | 'senior' | 'university' | 'unknown'

/* Ступень из строки формы: «8 класс», «11 класс», «Университет» или пусто.

   Пустая строка - «Класс: любой» в форме - это отказ ученика от
   ограничения, а не повод его выдумывать: проверка тогда не работает. */
export function stageFromGrade(grade: string): Stage {
  const normalized = grade.trim().toLocaleLowerCase('ru-RU')
  if (!normalized) return 'unknown'
  if (/универ|вуз|студент|курс/u.test(normalized)) return 'university'
  const number = Number(normalized.match(/\d{1,2}/u)?.[0])
  if (!Number.isFinite(number)) return 'unknown'
  if (number <= 6) return 'junior'
  if (number <= 9) return 'middle'
  if (number <= 11) return 'senior'
  return 'university'
}

type StageRule = {
  /** Со ступени, где приём уже проходят, правило снимается. */
  allowedFrom: Stage
  pattern: RegExp
  /** Как называется приём в замечании. */
  name: string
  /** Чем его заменить в школьной записи. */
  instead: string
}

const stageOrder: Record<Stage, number> = {
  junior: 1,
  middle: 2,
  senior: 3,
  university: 4,
  unknown: 0,
}

const rules: readonly StageRule[] = [
  {
    allowedFrom: 'university',
    pattern: /векторн\p{L}*\s+произведени|смешанн\p{L}*\s+произведени|\[\s*[A-Za-z][\p{L}\d₀-₉]*\s*×/u,
    name: 'векторное и смешанное произведение',
    instead: 'найди расстояние через уравнение плоскости или построй общий перпендикуляр',
  },
  {
    allowedFrom: 'university',
    pattern: /определител\p{L}*\s+матриц|матриц\p{L}*\s+перехода|собственн\p{L}*\s+значени|комплексн\p{L}*\s+числ/u,
    name: 'матрицы, определители и комплексные числа',
    instead: 'решай школьными средствами своего класса',
  },
  {
    allowedFrom: 'senior',
    pattern: /производн\p{L}*|интеграл\p{L}*|предел\s+функци|лопитал/u,
    name: 'производные, интегралы и пределы',
    instead: 'в этом классе то же самое делают через свойства функции и преобразования',
  },
  {
    allowedFrom: 'senior',
    pattern: /координат\p{L}*\s+в\s+пространств|\(\s*-?\d+\s*;\s*-?\d+\s*;\s*-?\d+\s*\)/u,
    name: 'координаты в пространстве',
    instead: 'до десятого класса стереометрию считают по планиметрическим сечениям',
  },
]

/* Замечания о приёме не по классу.

   Возвращаются в том же виде, что и остальные проверки решателя: пусто -
   всё в порядке, иначе строка уходит в адресную починку. */
export function verifyGradeLevel(solution: HomeworkSolution, grade: string): string[] {
  const stage = stageFromGrade(grade)
  if (stage === 'unknown' || stage === 'university') return []

  const text = [...solution.steps, ...(solution.explanation ?? [])]
    .join(' ')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')

  const issues: string[] = []
  for (const rule of rules) {
    if (stageOrder[stage] >= stageOrder[rule.allowedFrom]) continue
    if (!rule.pattern.test(text)) continue
    issues.push(`В ${grade.trim()} ${rule.name} не проходят: ${rule.instead}`)
  }
  return issues.slice(0, 2)
}
