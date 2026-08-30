/* Превью продукта для витрины.
   Это не декоративные картинки: каждое повторяет реальную поверхность
   приложения — форму постановки задачи, тетрадную страницу решения,
   ИИ-чат и расписание. Ничего интерактивного здесь нет: работать
   с продуктом ученик идёт на `/app`, а витрина только показывает, что
   он там увидит. */

import {
  ArrowRight,
  Check,
  ChatsCircle,
  ImageSquare,
  Sparkle,
} from '@phosphor-icons/react'

/* Ромб с диагоналями 10 и 24 — та самая фигура, которую движок строит
   по условию. Пропорции честные: AC = 70, BD = 168, это ровно 10 к 24. */
export function RhombusDiagram() {
  return (
    <svg className="paper-figure" viewBox="0 0 200 200" role="img" aria-label="Чертёж ромба ABCD с диагоналями AC и BD">
      <g className="paper-figure-line">
        <path d="M100 16 L135 100 L100 184 L65 100 Z" />
        <path className="paper-figure-aux" d="M65 100 L135 100" />
        <path className="paper-figure-aux" d="M100 16 L100 184" />
        <path className="paper-figure-mark" d="M100 88 L88 88 L88 100" />
      </g>
      <g className="paper-figure-tick">
        <path d="M78 54 L88 62" />
        <path d="M112 62 L122 54" />
        <path d="M78 146 L88 138" />
        <path d="M112 138 L122 146" />
      </g>
      <g className="paper-figure-label">
        <text x="100" y="10" textAnchor="middle">B</text>
        <text x="142" y="105" textAnchor="start">C</text>
        <text x="100" y="198" textAnchor="middle">D</text>
        <text x="58" y="105" textAnchor="end">A</text>
        <text x="106" y="114" textAnchor="start">O</text>
      </g>
    </svg>
  )
}

/* Тетрадная страница: бумага, клетка, красное поле, «Дано» и «Найти»
   через разделитель, чертёж справа и ход решения строками — так решение
   выглядит в продукте и так же его переписывают в тетрадь. */
export function NotebookPreview({ compact = false }: { compact?: boolean }) {
  return (
    <figure className={`paper-page${compact ? ' is-compact' : ''}`}>
      <span className="paper-grid" aria-hidden="true" />
      <span className="paper-margin" aria-hidden="true" />

      <div className="paper-body">
        <span className="paper-number">№ 274</span>

        <div className="paper-head">
          <div className="paper-column">
            <div className="paper-given">
              <strong>Дано:</strong>
              <span>ромб ABCD</span>
              <span>AC = 10 см</span>
              <span>BD = 24 см</span>
            </div>
            <p className="paper-goal"><strong>Найти:</strong> AB</p>
          </div>
          <div className="paper-figure-zone"><RhombusDiagram /></div>
        </div>

        <div className="paper-solution">
          <strong>Решение</strong>
          <span>1) Диагонали ромба делятся пополам и перпендикулярны.</span>
          <span>2) AO = AC : 2 = 5 см, BO = BD : 2 = 12 см</span>
          <span>3) △AOB — прямоугольный, ∠AOB = 90°</span>
          <span>4) AB² = AO² + BO² = 5² + 12² = 25 + 144 = 169</span>
          <span>5) AB = √169 = 13 см</span>
          <strong className="paper-answer">Ответ: AB = 13 см.</strong>
        </div>
      </div>
    </figure>
  )
}

/* Разбор со школьными значками: подчёркивания членов предложения — то,
   что рисует WrittenAnalysis поверх обычных шагов решения. */
export function AnalysisPreview() {
  return (
    <div className="parse-preview">
      <span className="preview-kicker">Разбор предложения</span>
      <p className="parse-line">
        <span className="mark-wavy">Ранний</span>{' '}
        <span className="mark-single">снег</span>{' '}
        <span className="mark-double">лежал</span>{' '}
        <span className="mark-dash-dot">на крышах</span>
      </p>
      <ul className="parse-legend">
        <li><i className="legend-single" aria-hidden="true" />подлежащее</li>
        <li><i className="legend-double" aria-hidden="true" />сказуемое</li>
        <li><i className="legend-wavy" aria-hidden="true" />определение</li>
        <li><i className="legend-dash-dot" aria-hidden="true" />обстоятельство</li>
      </ul>
    </div>
  )
}

export function ChatPreview() {
  return (
    <div className="chat-preview">
      <div className="chat-preview-head">
        <ChatsCircle size={18} weight="duotone" aria-hidden="true" />
        <span>ИИ-чат</span>
        <span className="chat-preview-model">Gemini 2.5 Flash · от 20 коп</span>
      </div>
      <p className="chat-preview-ask">Почему в четвёртом шаге вдруг теорема Пифагора?</p>
      <div className="chat-preview-answer">
        <p>Потому что диагонали ромба пересекаются под прямым углом. Значит △AOB — прямоугольный, и его гипотенуза AB считается по катетам AO и BO.</p>
        <p className="chat-preview-formula">AB² = AO² + BO²</p>
      </div>
    </div>
  )
}

export function SchedulePreview() {
  const lessons = [
    { time: '08:30', subject: 'Геометрия', room: '212' },
    { time: '09:25', subject: 'Химия', room: '308' },
    { time: '10:30', subject: 'История', room: '104' },
  ]

  return (
    <div className="schedule-preview">
      <div className="schedule-preview-head">
        <span>Вторник</span>
        <span className="schedule-preview-badge"><ImageSquare size={14} weight="bold" aria-hidden="true" />Распознано с фото</span>
      </div>
      <ul>
        {lessons.map(({ time, subject, room }) => (
          <li key={time}>
            <time>{time}</time>
            <strong>{subject}</strong>
            <span>каб. {room}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* Карточка постановки задачи из первого экрана: повторяет форму
   «Списать задачу» вплоть до подписей и цены. */
export function TaskFormPreview({ typed, submitted }: { typed: string; submitted: boolean }) {
  return (
    <div className="stage-card stage-form">
      <span className="stage-label">Условие задачи</span>
      <div className="stage-input">
        <p>
          {typed}
          {!submitted && <i className="stage-caret" aria-hidden="true" />}
        </p>
      </div>
      <div className="stage-controls">
        <span className="stage-chip"><ImageSquare size={17} weight="duotone" aria-hidden="true" />Добавить фото</span>
        <span className="stage-chip is-muted">Предмет — определим сами</span>
        <span className="stage-chip is-muted">Класс — определим сами</span>
        <span className={`stage-submit${submitted ? ' is-pressed' : ''}`}>
          Решить
          <ArrowRight size={18} weight="bold" aria-hidden="true" />
        </span>
      </div>
      <p className="stage-note">Решение стоит 5 ₽. Если задача не решится, деньги вернутся на баланс.</p>
    </div>
  )
}

export function SolvingPreview({ passes }: { passes: number }) {
  const steps = ['Первый проход', 'Второй проход', 'Сверка решений']

  return (
    <div className="stage-card stage-solving">
      <div className="stage-solving-head">
        <span className="stage-spinner" aria-hidden="true" />
        <span><strong>Решаем задачу</strong><small>Затем оформим ответ как в тетради</small></span>
      </div>
      <ul className="stage-passes">
        {steps.map((step, index) => (
          <li key={step} className={index < passes ? 'is-done' : ''}>
            <i aria-hidden="true">{index < passes && <Check size={12} weight="bold" />}</i>
            {step}
          </li>
        ))}
      </ul>
      <span className="stage-track" aria-hidden="true"><i /></span>
    </div>
  )
}

export function ResultPreview() {
  return (
    <div className="stage-card stage-result">
      <div className="stage-result-head">
        <Sparkle size={19} weight="duotone" aria-hidden="true" />
        <span><strong>Решение готово</strong><small>Геометрия · проверка пройдена</small></span>
      </div>
      <NotebookPreview compact />
    </div>
  )
}
