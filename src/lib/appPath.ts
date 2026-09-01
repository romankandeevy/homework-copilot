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
