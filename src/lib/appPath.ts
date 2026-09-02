/* Адрес страницы без префикса сборки. Витрина и приложение считают его
   одинаково, поэтому helper живёт отдельно от обоих. */
export function applicationPath(path: string) {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`
}

export function currentApplicationPath(pathname = window.location.pathname) {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '')
  const relativePath = basePath && pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : pathname
  return relativePath.replace(/\/+$/, '') || '/'
}

/* Возврат авторизации: письмо, Google или смена пароля.

   На `/` живёт витрина — клиента Supabase она не создаёт и обработчиков
   подтверждения не имеет, поэтому такой адрес обязан открывать приложение.
   `auth=` — наши метки, `code` и `token_hash` — обмен кодом у Supabase,
   `error` — отказ провайдера, `#access_token` и `type=recovery` — неявный
   поток, которым приходит смена пароля. */
export function opensAccountFlow(search = window.location.search, hash = window.location.hash) {
  const params = new URLSearchParams(search)
  if (['auth', 'code', 'token_hash', 'error', 'error_description'].some((key) => params.has(key))) return true
  const fragment = new URLSearchParams(hash.replace(/^#/, ''))
  return fragment.has('access_token') || fragment.has('error_description') || fragment.get('type') === 'recovery'
}
