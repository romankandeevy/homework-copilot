/* Студия роликов: играет кадр правды по времени и даёт таймлайн.

   Открывается только в разработке:
     http://localhost:5173/?promo=1            - ролик первого экрана
     http://localhost:5173/?promo=1&film=solve - ролик «как решается задача»

   С `&render=1` остаётся голая сцена без панели - так её снимает
   scripts/render-promo.mjs, выставляя время через window.promoControl.
   `&format=tall` показывает вертикальный кадр 1080×1350 для телефона.

   Управление: пробел - пуск/пауза, стрелки - кадр, с Shift - секунда,
   Home - в начало. Панель нарисована inline-стилями, как и сами ролики. */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import { HeroFilm } from './HeroFilm'
import { SolveFilm } from './SolveFilm'
import { stageFormats, viewScaleOf, type StageFormat } from './stage'
import { beatAt, films, frameRate, timelineOf, type FilmId } from './timelines'

declare global {
  interface Window {
    promoControl?: {
      total: number
      fps: number
      film: FilmId
      format: StageFormat
      setTime: (T: number) => void
      getTime: () => number
    }
  }
}

const transportHeight = 132

const chipStyle: CSSProperties = {
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'transparent',
  color: '#c9ccd6',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  cursor: 'pointer',
}

function useStageScale(renderMode: boolean, stage: { width: number; height: number }) {
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    if (renderMode) return
    const measure = () => {
      const width = (window.innerWidth - 48) / stage.width
      const height = (window.innerHeight - transportHeight - 48) / stage.height
      setScale(Math.max(0.1, Math.min(width, height)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [renderMode, stage.width, stage.height])
  return scale
}

export default function PromoStudio() {
  const params = new URLSearchParams(window.location.search)
  const renderMode = params.get('render') === '1'
  const filmId: FilmId = params.get('film') === 'solve' ? 'solve' : 'hero'
  const format: StageFormat = params.get('format') === 'tall' ? 'tall' : 'wide'
  const stage = stageFormats[format]
  /* Окно кадра уже самой сцены: медиазапросы приложения должны увидеть
     ширину телефона. В студии окно - это окно браузера, поэтому раскладку
     интерфейса вертикального ролика точно показывает только рендер. */
  const viewScale = viewScaleOf(format)
  const film = films[filmId]
  const { total } = timelineOf(film.beats)
  const Film = filmId === 'solve' ? SolveFilm : HeroFilm
  const initialTime = Math.min(Math.max(Number(params.get('t') ?? 0) || 0, 0), total)

  const [T, setT] = useState(initialTime)
  const [playing, setPlaying] = useState(!renderMode && params.get('autoplay') !== '0')
  const timeRef = useRef(initialTime)
  timeRef.current = T
  const scale = useStageScale(renderMode, stage)

  // Часы студии: время течёт по requestAnimationFrame и зацикливается.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const delta = (now - last) / 1000
      last = now
      setT((current) => {
        const next = current + delta
        return next >= total ? next - total : next
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, total])

  // Ручка для рендера: выставить время и дорисовать кадр синхронно.
  useEffect(() => {
    window.promoControl = {
      total,
      fps: frameRate,
      film: filmId,
      format,
      setTime: (value) => {
        flushSync(() => {
          setPlaying(false)
          setT(Math.min(Math.max(value, 0), total))
        })
      },
      getTime: () => timeRef.current,
    }
    return () => {
      delete window.promoControl
    }
  }, [filmId, format, total])

  useEffect(() => {
    document.title = renderMode ? `Рендер: ${film.label}` : `Студия: ${film.label}`
    const { body, documentElement } = document
    const previous = { margin: body.style.margin, overflow: body.style.overflow, background: body.style.background, theme: documentElement.dataset.theme }
    body.style.margin = '0'
    body.style.overflow = 'hidden'
    body.style.background = renderMode ? '#000' : '#08090c'
    // Настоящие куски интерфейса в кадре красятся токенами темы. Ролик
    // показывает светлый экран приложения, поэтому тема документа светлая;
    // фон самой сцены задан явными цветами и от темы не зависит.
    documentElement.dataset.theme = 'light'
    return () => {
      body.style.margin = previous.margin
      body.style.overflow = previous.overflow
      body.style.background = previous.background
      if (previous.theme) documentElement.dataset.theme = previous.theme
    }
  }, [renderMode, film.label])

  useEffect(() => {
    if (renderMode) return
    const step = 1 / frameRate
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return
      if (event.code === 'Space') {
        event.preventDefault()
        setPlaying((value) => !value)
      } else if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
        event.preventDefault()
        const direction = event.code === 'ArrowRight' ? 1 : -1
        setPlaying(false)
        setT((current) => Math.min(Math.max(current + direction * (event.shiftKey ? 1 : step), 0), total - step))
      } else if (event.code === 'Home') {
        setPlaying(false)
        setT(0)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [renderMode, total])

  if (renderMode) {
    return (
      <div style={{ width: Math.round(stage.width * viewScale), height: Math.round(stage.height * viewScale), overflow: 'hidden' }}>
        <div style={{ width: stage.width, height: stage.height, transform: `scale(${viewScale})`, transformOrigin: '0 0' }}>
          <Film T={T} format={format} />
        </div>
      </div>
    )
  }

  const { beat, local } = beatAt(film.beats, T)
  const { starts } = timelineOf(film.beats)

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', gridTemplateRows: `1fr ${transportHeight}px`, background: '#08090c', color: '#e6e8ee' }}>
      <div style={{ display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
        <div style={{ width: stage.width * scale, height: stage.height * scale }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0', width: stage.width, height: stage.height, boxShadow: '0 30px 100px rgba(0,0,0,0.6)' }}>
            <Film T={T} format={format} />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 12, padding: '14px 24px 18px', borderTop: '1px solid rgba(255,255,255,0.08)', background: '#0c0d12' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            type="button"
            onClick={() => setPlaying((value) => !value)}
            style={{ ...chipStyle, minWidth: 92, padding: '8px 14px', background: playing ? 'rgba(63,108,255,0.22)' : 'transparent', color: '#fff', fontSize: 13 }}
          >
            {playing ? 'Пауза' : 'Пуск'}
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            {(Object.keys(films) as FilmId[]).map((id) => (
              <a
                key={id}
                href={`?promo=1&film=${id}&format=${format}`}
                style={{ ...chipStyle, textDecoration: 'none', borderColor: id === filmId ? '#3f6cff' : 'rgba(255,255,255,0.14)', color: id === filmId ? '#fff' : '#c9ccd6' }}
              >
                {films[id].label}
              </a>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(Object.keys(stageFormats) as StageFormat[]).map((id) => (
              <a
                key={id}
                href={`?promo=1&film=${filmId}&format=${id}`}
                style={{ ...chipStyle, textDecoration: 'none', borderColor: id === format ? '#3f6cff' : 'rgba(255,255,255,0.14)', color: id === format ? '#fff' : '#c9ccd6' }}
              >
                {id === 'tall' ? 'Телефон 4:5' : 'Экран 16:9'}
              </a>
            ))}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: '#c9ccd6', fontVariantNumeric: 'tabular-nums' }}>
            {T.toFixed(2)} с / {total.toFixed(1)} с · кадр {Math.floor(T * frameRate)}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: '#8b90a0' }}>
            {beat.label} · {local.toFixed(2)} с
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 900 }}>
            {film.beats.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setPlaying(false)
                  setT(starts.get(item.id) ?? 0)
                }}
                style={{ ...chipStyle, borderColor: item.id === beat.id ? '#3f6cff' : 'rgba(255,255,255,0.14)', color: item.id === beat.id ? '#fff' : '#c9ccd6' }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={total}
          step={1 / frameRate}
          value={T}
          onChange={(event) => {
            setPlaying(false)
            setT(Number(event.target.value))
          }}
          style={{ width: '100%', accentColor: '#3f6cff' }}
          aria-label="Время ролика"
        />
      </div>
    </div>
  )
}
