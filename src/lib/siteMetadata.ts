export const siteOrigin = 'https://www.homeworkcopilot.ru'

export type SeoMetadata = {
  title: string
  description: string
  path: string
  robots: 'index, follow' | 'noindex, follow' | 'noindex, nofollow'
}

const metadataByPath: Record<string, SeoMetadata> = {
  '/': {
    title: 'Homework Copilot — готовые решения по номеру задачи',
    description: 'Найди условие по учебнику и получи понятное решение задачи, которое удобно переписать в тетрадь.',
    path: '/',
    robots: 'index, follow',
  },
  '/solutions': {
    title: 'Решения задач — Homework Copilot',
    description: 'Личные и готовые решения задач по выбранным школьным учебникам.',
    path: '/solutions',
    robots: 'index, follow',
  },
  '/cdz': {
    title: 'ЦДЗ пока закрыт — Homework Copilot',
    description: 'Раздел ЦДЗ ещё не запущен и откроется после полной проверки.',
    path: '/cdz',
    robots: 'noindex, follow',
  },
  '/schedule': {
    title: 'Расписание — Homework Copilot',
    description: 'Личное школьное расписание в Homework Copilot.',
    path: '/schedule',
    robots: 'noindex, nofollow',
  },
  '/chat': {
    title: 'ИИ-чат — Homework Copilot',
    description: 'Личные диалоги с ИИ в Homework Copilot.',
    path: '/chat',
    robots: 'noindex, nofollow',
  },
  '/support': {
    title: 'Поддержка — Homework Copilot',
    description: 'Личные обращения в поддержку Homework Copilot.',
    path: '/support',
    robots: 'noindex, nofollow',
  },
  '/privacy': {
    title: 'Политика обработки персональных данных — Homework Copilot',
    description: 'Какие данные использует Homework Copilot, зачем они нужны и как управлять своими данными.',
    path: '/privacy',
    robots: 'index, follow',
  },
  '/terms': {
    title: 'Пользовательское соглашение — Homework Copilot',
    description: 'Правила использования Homework Copilot, аккаунта, решений и баланса.',
    path: '/terms',
    robots: 'index, follow',
  },
  '/consent': {
    title: 'Согласие на обработку персональных данных — Homework Copilot',
    description: 'Отдельное согласие пользователя на обработку персональных данных в Homework Copilot.',
    path: '/consent',
    robots: 'noindex, follow',
  },
  '/cookies': {
    title: 'Cookie и локальное хранение — Homework Copilot',
    description: 'Какие данные Homework Copilot сохраняет в браузере и почему рекламные cookie не используются.',
    path: '/cookies',
    robots: 'index, follow',
  },
  '/offer': {
    title: 'Публичная оферта — Homework Copilot',
    description: 'Статус платных услуг и публичной оферты Homework Copilot.',
    path: '/offer',
    robots: 'index, follow',
  },
  '/admin': {
    title: 'Управление — Homework Copilot',
    description: 'Закрытая панель управления Homework Copilot.',
    path: '/admin',
    robots: 'noindex, nofollow',
  },
}

function normalizePath(pathname: string) {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/main') return '/'
  if (path === '/base') return '/solutions'
  if (path === '/tasks' || path === '/textbooks') return '/cdz'
  if (path === '/agreement') return '/terms'
  return path
}

export function getSeoMetadata(pathname: string, task?: string): SeoMetadata {
  const path = normalizePath(pathname)
  if (/^\/solutions\/[^/]+\/[^/]+$/i.test(path)) {
    return {
      title: task ? `Решение задачи № ${task} — Homework Copilot` : 'Решение задачи — Homework Copilot',
      description: 'Личное решение задачи в Homework Copilot.',
      path,
      robots: 'noindex, nofollow',
    }
  }
  return metadataByPath[path] ?? metadataByPath['/']
}

function upsertMeta(selector: string, attributes: Record<string, string>) {
  let element = document.head.querySelector<HTMLMetaElement>(selector)
  if (!element) {
    element = document.createElement('meta')
    document.head.append(element)
  }
  Object.entries(attributes).forEach(([name, value]) => element?.setAttribute(name, value))
}

export function applySeoMetadata(metadata: SeoMetadata) {
  const canonicalUrl = new URL(metadata.path, siteOrigin).toString()
  document.title = metadata.title
  upsertMeta('meta[name="description"]', { name: 'description', content: metadata.description })
  upsertMeta('meta[name="robots"]', { name: 'robots', content: metadata.robots })
  upsertMeta('meta[property="og:title"]', { property: 'og:title', content: metadata.title })
  upsertMeta('meta[property="og:description"]', { property: 'og:description', content: metadata.description })
  upsertMeta('meta[property="og:url"]', { property: 'og:url', content: canonicalUrl })
  upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: metadata.title })
  upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: metadata.description })

  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!canonical) {
    canonical = document.createElement('link')
    canonical.rel = 'canonical'
    document.head.append(canonical)
  }
  canonical.href = canonicalUrl
}
