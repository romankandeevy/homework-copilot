import { lazy, Suspense } from 'react'
import LandingPage from './landing/LandingPage'
import PrivacyNotice from './PrivacyNotice'
import { currentApplicationPath } from './lib/appPath'

/* Витрина и приложение разведены по чанкам прямо здесь.

   `/` — единственный адрес, который открывают, ничего не зная о продукте, и
   тянуть ради него всю оболочку приложения незачем: она весит больше самой
   витрины. Приложение грузится отдельным чанком, а для его адресов ссылка
   modulepreload проставлена в статическом html (scripts/create-static-routes.mjs),
   поэтому лишнего ожидания на `/app` не возникает. */
const App = lazy(() => import('./App'))

/* Возврат авторизации открывает приложение, а не витрину.

   Письма и Google возвращали человека на `/`, где живёт витрина: клиента
   Supabase она не создаёт, обработчиков `auth=confirm`, `auth=google-code` и
   события `PASSWORD_RECOVERY` в ней нет. Из-за этого вход через Google, кнопка
   «Подтвердить почту» в письме и смена пароля не доходили до конца — человек
   видел обычную витрину и не понимал, что произошло.

   Ссылки теперь ведут прямо на `/app`, но старые письма уже разошлись, поэтому
   корень обязан узнавать возврат и сам отдавать приложение:
   `auth=` — наши метки, `code` и `token_hash` — обмен кодом у Supabase,
   `error`/`error_description` — отказ провайдера, `#access_token` и
   `type=recovery` — неявный поток, в котором приходит смена пароля. */
export function opensAccountFlow(search = window.location.search, hash = window.location.hash) {
  const params = new URLSearchParams(search)
  if (['auth', 'code', 'token_hash', 'error', 'error_description'].some((key) => params.has(key))) return true
  const fragment = new URLSearchParams(hash.replace(/^#/, ''))
  return fragment.has('access_token') || fragment.has('error_description') || fragment.get('type') === 'recovery'
}

export function Root() {
  const params = new URLSearchParams(window.location.search)
  const opensDevTool = import.meta.env.DEV
    && (params.get('canvas') === '1' || params.get('design-system') === '1')

  if (!opensDevTool && currentApplicationPath() === '/' && !opensAccountFlow()) {
    return <><LandingPage /><PrivacyNotice /></>
  }

  return <Suspense fallback={null}><App /></Suspense>
}
