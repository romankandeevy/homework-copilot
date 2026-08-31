/* Предмет задачи.

   Раньше предмет был подсказкой: не выбрал — модель определит сама. Теперь от
   него зависит проверка. У каждого предмета свои правила записи, и рецензентом
   служат именно они, а не ещё один вызов модели: правило либо выполнено, либо
   нет, и это видно без второго мнения. Не зная предмета, проверять нечем.

   Список один на клиент и сервер: клиент показывает его в форме, сервер по
   нему же отвергает выдуманный предмет. */

export type SolvableSubject = {
  /** Идентификатор предмета. Он же `textbookId` решения: одно решение — один предмет. */
  id: string
  name: string
}

export const solvableSubjects: readonly SolvableSubject[] = [
  { id: 'mathematics', name: 'Математика' },
  { id: 'algebra', name: 'Алгебра' },
  { id: 'geometry', name: 'Геометрия' },
  { id: 'physics', name: 'Физика' },
  { id: 'chemistry', name: 'Химия' },
  { id: 'biology', name: 'Биология' },
  { id: 'informatics', name: 'Информатика' },
  { id: 'russian', name: 'Русский язык' },
  { id: 'literature', name: 'Литература' },
  { id: 'english', name: 'Английский язык' },
  { id: 'history', name: 'История' },
  { id: 'social', name: 'Обществознание' },
  { id: 'geography', name: 'География' },
  { id: 'astronomy', name: 'Астрономия' },
] as const

export const solvableGrades = [
  '5 класс', '6 класс', '7 класс', '8 класс', '9 класс', '10 класс', '11 класс',
] as const

export function findSubjectByName(name: string): SolvableSubject | null {
  const normalized = name.trim().toLocaleLowerCase('ru-RU')
  return solvableSubjects.find((subject) => subject.name.toLocaleLowerCase('ru-RU') === normalized) ?? null
}

export function findSubjectById(id: string): SolvableSubject | null {
  return solvableSubjects.find((subject) => subject.id === id) ?? null
}

export function isSolvableSubject(name: string) {
  return findSubjectByName(name) !== null
}
