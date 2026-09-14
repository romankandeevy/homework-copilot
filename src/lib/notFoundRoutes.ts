export type Destination = { path: string; label: string }
export type RouteStop = Destination & { hint: string }

/* Остановки маршрута на странице 404 - разделы, куда уходят со страницы,
   которой нет. «Решить задачу» среди них нет: это главная кнопка страницы, и
   то же действие второй раз в соседнем списке читалось бы как другое. */
export const notFoundStops: RouteStop[] = [
  { path: '/solutions', label: 'Мои решения', hint: 'Задачи, которые ты уже решал' },
  { path: '/chat', label: 'ИИ-чат', hint: 'Спросить, если непонятен шаг' },
  { path: '/schedule', label: 'Расписание', hint: 'Уроки на неделю' },
  { path: '/support', label: 'Поддержка', hint: 'Напиши, если ссылка должна была работать' },
]

/* С этими адресами сверяется опечатка. Кроме разделов - рабочая главная и
   документы: «/contact» и «/privaci» тоже чьи-то промахи на одну букву. */
const knownDestinations: Destination[] = [
  { path: '/app', label: 'Решить задачу' },
  ...notFoundStops,
  { path: '/terms', label: 'Пользовательское соглашение' },
  { path: '/privacy', label: 'Политика данных' },
  { path: '/consent', label: 'Согласие на обработку данных' },
  { path: '/cookies', label: 'Cookie и хранилище' },
  { path: '/offer', label: 'Публичная оферта' },
  { path: '/contacts', label: 'Реквизиты и контакты' },
]

function editDistance(from: string, to: string) {
  let previous = Array.from({ length: to.length + 1 }, (_, index) => index)
  for (let row = 1; row <= from.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= to.length; column += 1) {
      const substitution = previous[column - 1] + (from[row - 1] === to[column - 1] ? 0 : 1)
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, substitution)
    }
    previous = current
  }
  return previous[to.length]
}

/* Опечатка - самая частая причина 404, и обычно в одну-две буквы:
   «/shedule», «/solution», «/contact». Такой адрес получает прямую
   подсказку вместо общего списка. Сверяется и путь целиком, и его первый
   отрезок: у «/solutions/abc» раздел угадан верно, ошибка дальше. Допуск
   растёт с длиной адреса, иначе «/a» стал бы «/app». */
export function closestDestination(missingPath: string) {
  const typed = missingPath.toLowerCase()
  const firstSegment = `/${typed.split('/').find(Boolean) ?? ''}`
  let best: { destination: Destination; distance: number } | null = null
  for (const destination of knownDestinations) {
    const allowed = Math.max(1, Math.floor((destination.path.length - 1) / 3))
    for (const probe of new Set([typed, firstSegment])) {
      const distance = editDistance(probe, destination.path)
      if (distance <= allowed && (!best || distance < best.distance)) best = { destination, distance }
    }
  }
  return best?.destination ?? null
}
