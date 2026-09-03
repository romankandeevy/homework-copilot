import { lazy, Suspense } from 'react'
import LandingPage from './landing/LandingPage'
import PrivacyNotice from './PrivacyNotice'
import { currentApplicationPath, opensAccountFlow } from './lib/appPath'

/* Витрина и приложение разведены по чанкам прямо здесь.

   `/` — единственный адрес, который открывают, ничего не зная о продукте, и
   тянуть ради него всю оболочку приложения незачем: она весит больше самой
   витрины. Приложение грузится отдельным чанком, а для его адресов ссылка
   modulepreload проставлена в статическом html (scripts/create-static-routes.mjs),
   поэтому лишнего ожидания на `/app` не возникает. */
const App = lazy(() => import('./App'))

/* Студия ролика первого экрана живёт только в разработке (`?promo=1`):
   в сборке ветка мертва, и чанк в неё не попадает. */
const PromoStudio = import.meta.env.DEV ? lazy(() => import('./promo/PromoStudio')) : null

export function Root() {
  const params = new URLSearchParams(window.location.search)
  const opensDevTool = import.meta.env.DEV
    && (params.get('canvas') === '1' || params.get('design-system') === '1')

  if (PromoStudio && params.get('promo') === '1') {
    return <Suspense fallback={null}><PromoStudio /></Suspense>
  }

  if (!opensDevTool && currentApplicationPath() === '/' && !opensAccountFlow()) {
    return <><LandingPage /><PrivacyNotice /></>
  }

  return <Suspense fallback={null}><App /></Suspense>
}
