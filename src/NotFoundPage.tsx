import type { CSSProperties } from 'react'
import { ArrowRight } from '@phosphor-icons/react'
import { applicationPath, currentApplicationPath } from './lib/appPath'
import { closestDestination, notFoundStops } from './lib/notFoundRoutes'
import { SiteFooter } from './support/SiteFooter'
import { SupportLauncher } from './support/SupportLauncher'
import './NotFoundPage.css'

// Кириллица в адресе приходит процентами: «/%D0%BF...» человек не узнает.
function readablePath(path: string) {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

/* Страница, которой нет.

   До 13 сентября здесь был тетрадный лист: перечёркнутый «№ 404», «Дано» с
   адресом и «Ответ». Выглядело это как чужое решение, а не как ошибка:
   «Страница не найдена» было написано только для читалки, шапки с именем
   сервиса не было, и человек решал, что попал на другой сайт. Теперь
   сначала словами сказано, что случилось, потом - куда идти. */
export function NotFoundPage() {
  const missingPath = readablePath(currentApplicationPath())
  // Длинный адрес узнают по началу, а целиком он растолкал бы абзац.
  const shownPath = missingPath.length > 56 ? `${missingPath.slice(0, 56)}…` : missingPath
  const suggestion = closestDestination(missingPath)

  return (
    <div className="not-found-page">
      <header className="not-found-header">
        <a className="not-found-brand" href={applicationPath('/')}>
          <span className="brand-mark" aria-hidden="true"><span>H</span><span>C</span></span>
          <span className="brand-name"><span>Homework</span> <span className="brand-name-accent">Copilot</span></span>
        </a>
      </header>

      <main className="not-found" aria-labelledby="not-found-title">
        <div className="not-found-message">
          {/* Номер ошибки - фоном за этой колонкой, а не заголовком: крупное
              «404» узнают с первого взгляда, а что случилось, сказано словами. */}
          <span className="not-found-watermark" aria-hidden="true">404</span>
          <span className="not-found-kicker">Ошибка 404</span>
          <h1 id="not-found-title">Страница не найдена</h1>
          <p>
            Адреса <code>{shownPath}</code> на сайте нет.{' '}
            {suggestion
              ? <>Похоже, в нём опечатка: ближе всего «{suggestion.label}».</>
              : 'Скорее всего, в ссылке опечатка или она устарела. С сервисом всё в порядке.'}
          </p>
          <div className="not-found-actions">
            <a className="not-found-primary" href={applicationPath(suggestion?.path ?? '/app')}>
              {suggestion ? `Открыть «${suggestion.label}»` : 'Решить задачу'}
              <ArrowRight size={18} weight="bold" aria-hidden="true" />
            </a>
            <a className="not-found-secondary" href={applicationPath('/')}>На главную</a>
          </div>
        </div>

        {/* Карта на языке маршрута из DESIGN.md: линия и узлы объясняют, где
            ты, а не украшают. Пунктир от «Ты здесь» - пути отсюда нет. */}
        <nav className="not-found-route" aria-labelledby="not-found-route-title">
          <h2 id="not-found-route-title">Куда можно перейти</h2>
          <ol>
            <li className="is-here">
              <div className="not-found-row">
                <span className="not-found-node" aria-hidden="true" />
                <span className="not-found-stop">
                  <strong>Ты здесь</strong>
                  <small>{shownPath}</small>
                </span>
              </div>
            </li>
            {notFoundStops.map((stop, index) => {
              const suggested = stop.path === suggestion?.path
              return (
                <li key={stop.path} className={suggested ? 'is-suggested' : undefined} style={{ '--i': index + 1 } as CSSProperties}>
                  <a className="not-found-row" href={applicationPath(stop.path)}>
                    <span className="not-found-node" aria-hidden="true" />
                    <span className="not-found-stop">
                      <strong>{stop.label}</strong>
                      <small>{suggested ? 'Похоже, ты искал этот раздел' : stop.hint}</small>
                    </span>
                    <ArrowRight className="not-found-stop-arrow" size={18} weight="bold" aria-hidden="true" />
                  </a>
                </li>
              )
            })}
          </ol>
        </nav>
      </main>

      <SiteFooter />
      <SupportLauncher />
    </div>
  )
}
