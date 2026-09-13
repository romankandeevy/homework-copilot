import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Root } from './Root.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { captureReferralFromCurrentUrl } from './lib/referrals'
import { captureYandexReturn } from './lib/yandexReturn'

const staleChunkReloadKey = 'homework-copilot:stale-chunk-reload'

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const now = Date.now()
  const lastReload = Number(window.sessionStorage.getItem(staleChunkReloadKey) ?? 0)
  if (now - lastReload < 15_000) return

  window.sessionStorage.setItem(staleChunkReloadKey, String(now))
  const nextUrl = new URL(window.location.href)
  nextUrl.searchParams.set('__app_reload', String(now))
  window.location.replace(nextUrl)
})

const currentUrl = new URL(window.location.href)
if (currentUrl.searchParams.has('__app_reload')) {
  currentUrl.searchParams.delete('__app_reload')
  window.history.replaceState(window.history.state, '', currentUrl)
}

/* Реферальная ссылка ведёт на витрину (`/?ref=…`), а витрина App не
   монтирует. Код запоминается здесь, до разводки: иначе он терялся, пока
   гость шёл с витрины в приложение. */
captureReferralFromCurrentUrl()

/* Возврат из Яндекс ID: `?code=` и `?state=` уходят из адреса до создания
   клиента Supabase, иначе supabase-js может принять код за свой. */
captureYandexReturn()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
)
