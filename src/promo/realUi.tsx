/* Настоящий интерфейс продукта внутри роликов.

   Здесь нет нарисованных «похожих» виджетов: разметка и классы взяты из
   рабочих компонентов, а красят её те же файлы стилей, что и приложение.
   Поэтому в ролике видно ровно то, что человек увидит на сайте.

   - форма - разметка `src/CopyTask.tsx`, стили `src/App.css`;
   - карточка решения - разметка `src/solution/SolutionQueue.tsx`,
     стили `src/solution/SolutionQueue.css`, шаги - `src/lib/solutionJobs.ts`;
   - тетрадный лист - сам компонент `GeometryNotebookLayoutV1` с проверенной
     задачей из `src/notebook/fixtures.ts`.

   Живого состояния у них здесь нет: поля только показываются, значения
   приходят сверху как функция времени ролика. */

import type { CSSProperties, ReactNode } from 'react'
import { ArrowRight, Check, ImageSquare, SpinnerGap } from '@phosphor-icons/react'
import { GeometryNotebookLayoutV1 } from '../notebook/GeometryNotebookLayoutV1'
import { approvedGeometryNotebookLayoutV1Fixture } from '../notebook/fixtures'
import { solutionStages } from '../lib/solutionJobs'
import { solutionPriceKopecks } from '../lib/solutionPricing'
import '../App.css'
import '../solution/SolutionQueue.css'

export const notebookSpec = approvedGeometryNotebookLayoutV1Fixture

export const taskCondition = notebookSpec.condition

export const taskPrice = `${Math.round(solutionPriceKopecks / 100)} ₽`

/* Экран продукта: тот же холст, что и у страницы приложения. Ролик тёмный,
   поэтому светлый экран лежит на нём отдельной плашкой - как настоящее окно
   сайта, а не как фон кадра. */
export function AppScreen({ width, height = 'auto', style, children }: {
  width: number
  /* По умолчанию экран садится по содержимому: фиксированная высота
     оставляла под карточкой пустое белое поле. */
  height?: number | 'auto'
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <div
      style={{
        position: 'absolute',
        boxSizing: 'border-box',
        width,
        height,
        padding: 40,
        borderRadius: 26,
        background: 'var(--color-canvas)',
        // Внутри экрана всё красится токенами приложения, а не светлыми
        // чернилами сцены: иначе заголовки карточек белеют на белом.
        color: 'var(--color-text)',
        boxShadow: '0 50px 120px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.06)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/* Форма ввода задачи - разметка CopyTask как есть. Поля только показываются:
   значение условия приходит из ролика, обработчики пустые. */
export function TaskFormCard({ condition, pressed, submitting }: {
  condition: string
  pressed: boolean
  submitting: boolean
}) {
  return (
    <section className="copy-task" aria-labelledby="copy-task-title">
      <header className="copy-task-header">
        <div className="copy-task-heading">
          <h1 id="copy-task-title">Списать задачу</h1>
          <p>Решение придёт готовым к переписыванию в тетрадь.</p>
        </div>
        <p className="copy-task-price">
          <strong>{taskPrice}</strong>
          <span>за решение</span>
          <em>Зарегистрируйся: на счёт придут 20 ₽ — это ещё четыре решения</em>
        </p>
      </header>

      <form className="copy-task-form" aria-label="Задача" onSubmit={(event) => event.preventDefault()}>
        <label className="task-condition-label" htmlFor="task-condition">Условие задачи</label>
        <textarea
          id="task-condition"
          className="task-condition-input"
          value={condition}
          readOnly
          placeholder="Впиши условие или вставь сюда фото задачи"
        />

        <div className="task-controls">
          <span className="task-photo-button">
            <ImageSquare size={20} weight="duotone" aria-hidden="true" />
            Добавить фото
          </span>
          <label className="task-select">
            <span className="sr-only">Предмет</span>
            <select value="Геометрия" onChange={() => {}}>
              <option>Геометрия</option>
            </select>
          </label>
          <label className="task-select">
            <span className="sr-only">Класс</span>
            <select value="7" onChange={() => {}}>
              <option value="7">7</option>
            </select>
          </label>
          <button
            className="copy-task-submit"
            type="button"
            style={pressed ? { transform: 'scale(0.96)', filter: 'brightness(1.15)' } : undefined}
          >
            {submitting ? 'Решаем…' : 'Решить'}
            {!submitting && <ArrowRight size={20} weight="bold" aria-hidden="true" />}
          </button>
        </div>

        <p className="task-entry-helper">Не решится — деньги вернутся на баланс.</p>
      </form>
    </section>
  )
}

/* Карточка «Решаем задачу» - разметка SolutionQueue. Крутящийся значок
   поворачивается от времени ролика, а не CSS-анимацией: иначе кадр перестал
   бы определяться одним T и рендер ловил бы разные фазы. */
export function SolveCard({ stageIndex, clock, spin }: { stageIndex: number; clock: string; spin: number }) {
  return (
    <article className="solve-card is-solving" role="status" aria-busy="true">
      <header className="solve-card-head">
        <span className="solve-card-mark" aria-hidden="true" style={{ animation: 'none' }}>
          <span style={{ display: 'grid', transform: `rotate(${spin.toFixed(1)}deg)` }}>
            <SpinnerGap size={22} weight="bold" />
          </span>
        </span>
        <div className="solve-card-title">
          <h2>Решаем задачу</h2>
          <p>Геометрия</p>
        </div>
        <time className="solve-card-clock">{clock}</time>
      </header>

      <p className="solve-card-task">{taskCondition}</p>

      <ol className="solve-steps">
        {solutionStages.map((step, index) => {
          const state = index < stageIndex ? 'done' : index === stageIndex ? 'current' : 'waiting'
          return (
            <li key={step.id} className={`solve-step is-${state}`}>
              <span className="solve-step-dot" aria-hidden="true">
                {state === 'done' ? <Check size={12} weight="bold" /> : null}
              </span>
              <strong>{step.title}</strong>
              <small>{step.note}</small>
            </li>
          )
        })}
      </ol>

      <p className="solve-card-note">Обычно 15–70 секунд. Страницу можно закрыть: решение сохранится и появится здесь.</p>
    </article>
  )
}

/* Тетрадный лист - настоящий компонент разбора. Заполнение показано
   подрезкой сверху вниз: сам лист при этом не подменяется. */
export function NotebookPage({ filled, width }: { filled: number; width: number }) {
  const visible = Math.min(1, Math.max(0, filled))
  return (
    <div style={{ position: 'relative', width, filter: 'drop-shadow(0 40px 90px rgba(0, 0, 0, 0.55))' }}>
      <div style={{ clipPath: `inset(0 0 ${((1 - visible) * 100).toFixed(2)}% 0)` }}>
        <GeometryNotebookLayoutV1 spec={notebookSpec} />
      </div>
      {visible > 0.02 && visible < 0.995 && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '6%',
            right: '6%',
            top: `${(visible * 100).toFixed(2)}%`,
            height: 2,
            background: 'linear-gradient(90deg, transparent, rgba(63, 108, 255, 0.55), transparent)',
          }}
        />
      )}
    </div>
  )
}
