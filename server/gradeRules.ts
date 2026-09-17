import type { HomeworkSolution } from '../src/lib/homeworkContract.ts'
import { findSubjectById, findSubjectByName } from '../src/lib/subjects.ts'

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
  /** Текст записи в нижнем регистре, «ё» заменена на «е». */
  found: (text: string) => boolean
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

/* Координаты в пространстве - по слову, а не по одной тройке чисел.

   Аудит 16 сентября: «египетский треугольник (3; 4; 5)» в геометрии
   восьмого класса читался как точка в пространстве, и верное решение
   уходило в полный повтор, который это «починить» не может. Тройка чисел
   в скобках - это и стороны треугольника, и пифагорова тройка, и набор
   ответов. Точкой пространства она становится там, где рядом сказано
   «координаты». */
const spaceTriple = /\(\s*-?\d+(?:[.,]\d+)?\s*;\s*-?\d+(?:[.,]\d+)?\s*;\s*-?\d+(?:[.,]\d+)?\s*\)/gu
const coordinatesNearby = 60

function spaceCoordinates(text: string) {
  if (/координат\p{L}*\s+в\s+пространств/u.test(text)) return true
  return [...text.matchAll(spaceTriple)].some((match) => {
    const start = Math.max(0, match.index - coordinatesNearby)
    const end = match.index + match[0].length + coordinatesNearby
    return text.slice(start, end).includes('координат')
  })
}

const rules: readonly StageRule[] = [
  {
    allowedFrom: 'university',
    found: (text) => /векторн\p{L}*\s+произведени|смешанн\p{L}*\s+произведени|\[\s*[A-Za-z][\p{L}\d₀-₉]*\s*×/u.test(text),
    name: 'векторное и смешанное произведение',
    instead: 'найди расстояние через уравнение плоскости или построй общий перпендикуляр',
  },
  {
    allowedFrom: 'university',
    found: (text) => /определител\p{L}*\s+матриц|матриц\p{L}*\s+перехода|собственн\p{L}*\s+значени|комплексн\p{L}*\s+числ/u.test(text),
    name: 'матрицы, определители и комплексные числа',
    instead: 'решай школьными средствами своего класса',
  },
  {
    allowedFrom: 'senior',
    found: (text) => /производн\p{L}*|интеграл\p{L}*|предел\s+функци|лопитал/u.test(text),
    name: 'производные, интегралы и пределы',
    instead: 'в этом классе то же самое делают через свойства функции и преобразования',
  },
  {
    allowedFrom: 'senior',
    found: spaceCoordinates,
    name: 'координаты в пространстве',
    instead: 'до десятого класса стереометрию считают по планиметрическим сечениям',
  },
]

/* Правила класса - только у предметов со счётом.

   Аудит 16 сентября: образец «производн…» ловил биологию восьмого класса
   («производные кожи»), химию девятого («производные углеводородов») и
   русский седьмого («производное слово»). Замечание о приёме не по классу
   чинится только полным повтором, а повтор слово из темы не уберёт - ученик
   получал отказ после трёх платных вызовов. Производная, интеграл и
   векторное произведение как приём бывают только там, где считают. */
const gradeRuleSubjects = new Set(['mathematics', 'algebra', 'geometry', 'physics', 'informatics', 'astronomy'])

function gradeRulesApply(subject: string) {
  const known = findSubjectByName(subject) ?? findSubjectById(subject.trim())
  return known ? gradeRuleSubjects.has(known.id) : false
}

/* Замечания о приёме не по классу.

   Возвращаются в том же виде, что и остальные проверки решателя: пусто -
   всё в порядке, иначе строка уходит в адресную починку. */
export function verifyGradeLevel(solution: HomeworkSolution, grade: string, subject: string): string[] {
  if (!gradeRulesApply(subject)) return []
  const stage = stageFromGrade(grade)
  if (stage === 'unknown' || stage === 'university') return []

  const text = [...solution.steps, ...(solution.explanation ?? [])]
    .join(' ')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')

  const issues: string[] = []
  for (const rule of rules) {
    if (stageOrder[stage] >= stageOrder[rule.allowedFrom]) continue
    if (!rule.found(text)) continue
    issues.push(`В ${grade.trim()} ${rule.name} не проходят: ${rule.instead}`)
  }
  return issues.slice(0, 2)
}
