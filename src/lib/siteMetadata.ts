export const siteOrigin = 'https://www.homeworkcopilot.ru'

export type SeoMetadata = {
  title: string
  description: string
  path: string
  robots: 'index, follow' | 'noindex, follow' | 'noindex, nofollow'
  /** У несуществующей страницы канонического адреса нет. По умолчанию - есть. */
  canonical?: boolean
}

/* Один список маршрутов на клиент и на сборку статики.

   Раньше он был записан дважды - здесь и в scripts/create-static-routes.mjs, -
   и копии разошлись: статика звала «найти условие по номеру в учебнике» из
   удалённого раздела и открывала ЦДЗ поисковикам, пока клиент закрывал его
   noindex. Раздел ЦДЗ удалён 16 сентября 2026: его адреса ведут на `/app`. */
export const metadataByPath: Record<string, SeoMetadata> = {
  '/': {
    title: 'Homework Copilot - решение задачи по фото с разбором',
    description: 'Сфотографируй задачу или впиши условие. Получишь готовую запись для тетради: дано, ход решения, чертёж и ответ. 14 предметов, 5-11 класс и университет.',
    path: '/',
    robots: 'index, follow',
  },
  /* `/app` и `/solutions` закрыты от поиска с 16 сентября 2026. Они стояли в
     карте сайта с `index, follow`, а готового HTML у них нет (отрисовывать
     там нечего без скриптов и входа): поисковик получал пустой
     `<div id="root">`. В поиск ходит витрина, с неё ведут все действия. */
  '/app': {
    title: 'Решить задачу - Homework Copilot',
    description: 'Рабочая страница Homework Copilot: условие текстом или фотографией, готовое решение и история задач.',
    path: '/app',
    robots: 'noindex, follow',
  },
  '/solutions': {
    title: 'Решения задач - Homework Copilot',
    description: 'Личная история решённых задач: открыть любую снова можно бесплатно.',
    path: '/solutions',
    robots: 'noindex, nofollow',
  },
  '/schedule': {
    title: 'Расписание - Homework Copilot',
    description: 'Личное школьное расписание в Homework Copilot.',
    path: '/schedule',
    robots: 'noindex, nofollow',
  },
  '/chat': {
    title: 'ИИ-чат - Homework Copilot',
    description: 'Личные диалоги с ИИ в Homework Copilot.',
    path: '/chat',
    robots: 'noindex, nofollow',
  },
  '/support': {
    title: 'Поддержка - Homework Copilot',
    description: 'Личные обращения в поддержку Homework Copilot.',
    path: '/support',
    robots: 'noindex, nofollow',
  },
  /* Профиль и баланс - страницы с 14 сентября 2026. Личные, поэтому
     закрыты от поиска; статика под них нужна, чтобы прямой заход не
     отдавал 404. */
  '/profile': {
    title: 'Профиль - Homework Copilot',
    description: 'Имя, класс и оформление аккаунта Homework Copilot.',
    path: '/profile',
    robots: 'noindex, nofollow',
  },
  '/balance': {
    title: 'Баланс - Homework Copilot',
    description: 'Баланс аккаунта Homework Copilot и история операций.',
    path: '/balance',
    robots: 'noindex, nofollow',
  },
  /* Документы - один раздел сайта под /docs/ (аудит владельца 14 сентября
     2026). Прежние адреса в корне продолжают работать: `legacyDocumentPaths`
     ниже. */
  '/docs/privacy': {
    title: 'Политика обработки персональных данных - Homework Copilot',
    description: 'Какие данные использует Homework Copilot, зачем они нужны и как управлять своими данными.',
    path: '/docs/privacy',
    robots: 'index, follow',
  },
  '/docs/terms': {
    title: 'Пользовательское соглашение - Homework Copilot',
    description: 'Правила использования Homework Copilot, аккаунта, решений и баланса.',
    path: '/docs/terms',
    robots: 'index, follow',
  },
  '/docs/consent': {
    title: 'Согласие на обработку персональных данных - Homework Copilot',
    description: 'Отдельное согласие пользователя на обработку персональных данных в Homework Copilot.',
    path: '/docs/consent',
    robots: 'noindex, follow',
  },
  '/docs/cookies': {
    title: 'Cookie и локальное хранение - Homework Copilot',
    description: 'Какие данные Homework Copilot сохраняет в браузере и почему рекламные cookie не используются.',
    path: '/docs/cookies',
    robots: 'index, follow',
  },
  '/docs/offer': {
    title: 'Публичная оферта - Homework Copilot',
    description: 'Публичная оферта Homework Copilot: цена решения, пополнение баланса через Робокассу, чек и возвраты.',
    path: '/docs/offer',
    robots: 'index, follow',
  },
  '/docs/refund': {
    title: 'Возврат денег и отказ от услуги - Homework Copilot',
    description: 'Как вернуть деньги в Homework Copilot: неиспользованный остаток, неудачное и неверное решение, сроки и порядок заявки.',
    path: '/docs/refund',
    robots: 'index, follow',
  },
  '/docs/contacts': {
    title: 'Реквизиты и контакты - Homework Copilot',
    description: 'Исполнитель услуг Homework Copilot: самозанятый, ИНН и контакты для связи.',
    path: '/docs/contacts',
    robots: 'index, follow',
  },
  '/admin': {
    title: 'Управление - Homework Copilot',
    description: 'Закрытая панель управления Homework Copilot.',
    path: '/admin',
    robots: 'noindex, nofollow',
  },
}

export const legalDocumentKinds = ['terms', 'privacy', 'consent', 'cookies', 'offer', 'refund', 'contacts'] as const
export type LegalDocumentKind = (typeof legalDocumentKinds)[number]

/* Прежние адреса документов. До 14 сентября 2026 документы лежали в корне, и
   эти адреса уже стоят в письмах, в отметках согласия и в поиске - поэтому
   работают и дальше. На Pages по ним лежит страница с каноническим адресом
   нового документа и мгновенным переходом (scripts/create-static-routes.mjs),
   в разработке и на превью адрес переписывает клиент (`App`), как `/main` на
   `/app`. `/docs` без хвоста открывает соглашение: оно первое в списке
   документов, а отдельная страница-оглавление повторяла бы тот же список. */
export const legacyDocumentPaths: Record<string, string> = {
  '/terms': '/docs/terms',
  '/agreement': '/docs/terms',
  '/privacy': '/docs/privacy',
  '/consent': '/docs/consent',
  '/cookies': '/docs/cookies',
  '/offer': '/docs/offer',
  '/refund': '/docs/refund',
  '/contacts': '/docs/contacts',
  '/docs': '/docs/terms',
}

function normalizePath(pathname: string) {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/main') return '/app'
  if (path === '/base') return '/solutions'
  /* Адреса удалённого раздела ЦДЗ (16 сентября 2026) уже разошлись: ведут
     в рабочую страницу, а не в 404. */
  if (path === '/tasks' || path === '/textbooks' || path === '/cdz') return '/app'
  if (Object.hasOwn(legacyDocumentPaths, path)) return legacyDocumentPaths[path]
  return path
}

/* Какой документ открыт по адресу, с учётом прежних адресов. */
export function legalDocumentKind(pathname: string): LegalDocumentKind | null {
  const kind = /^\/docs\/([a-z]+)$/.exec(normalizePath(pathname))?.[1]
  return legalDocumentKinds.find((item) => item === kind) ?? null
}

export function getSeoMetadata(pathname: string, task?: string): SeoMetadata {
  const path = normalizePath(pathname)
  if (/^\/solutions\/[^/]+\/[^/]+$/i.test(path)) {
    return {
      /* Номер - только настоящий номер из учебника. У задачи по фото в
         адресе служебный ключ, и вкладка называлась «Решение задачи №
         photo-9807d724-…»; у задачи текстом там начало условия. */
      title: task && /^\d{1,4}(\.\d{1,3}){0,2}$/u.test(task)
        ? `Решение задачи № ${task} - Homework Copilot`
        : 'Решение задачи - Homework Copilot',
      description: 'Личное решение задачи в Homework Copilot.',
      path,
      robots: 'noindex, nofollow',
    }
  }
  /* Неизвестный адрес - это не главная. Раньше он получал её заголовок и её
     же canonical, то есть опечатка в ссылке объявляла себя главной страницей
     сайта. Теперь у него собственный заголовок и noindex, а canonical не
     ставится вовсе: у страницы, которой нет, канонического адреса нет тоже. */
  return metadataByPath[path] ?? {
    title: 'Страница не найдена - Homework Copilot',
    description: 'Такой страницы в Homework Copilot нет.',
    path,
    robots: 'noindex, nofollow',
    canonical: false,
  }
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

  const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (metadata.canonical === false) {
    canonical?.remove()
    return
  }
  if (canonical) {
    canonical.href = canonicalUrl
    return
  }
  const created = document.createElement('link')
  created.rel = 'canonical'
  created.href = canonicalUrl
  document.head.append(created)
}
