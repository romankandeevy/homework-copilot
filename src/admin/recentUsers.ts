/* Недавно открытые карточки: быстрый поиск раздела «Пользователи»
   показывает их, пока в поле ничего не набрано. Живут только в браузере
   администратора; хранилище может быть закрыто - тогда списка просто нет. */

export type RecentUser = { id: string; email: string; name: string }

const storageKey = 'homework-copilot:admin-recent-users'
const limit = 6

function isRecentUser(value: unknown): value is RecentUser {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string' && item.id !== '' && typeof item.email === 'string' && typeof item.name === 'string'
}

export function readRecentUsers(): RecentUser[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isRecentUser).slice(0, limit) : []
  } catch {
    return []
  }
}

export function rememberRecentUser(user: RecentUser) {
  if (!user.id) return
  try {
    const next = [user, ...readRecentUsers().filter((item) => item.id !== user.id)].slice(0, limit)
    window.localStorage.setItem(storageKey, JSON.stringify(next))
  } catch {
    // Хранилище закрыто или переполнено - недавние просто не запомнятся.
  }
}
