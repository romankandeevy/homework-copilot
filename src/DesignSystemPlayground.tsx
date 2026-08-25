import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  BellRinging,
  BookOpenText,
  CaretDown,
  Check,
  CheckCircle,
  Clock,
  Command,
  Copy,
  CursorClick,
  DotsThree,
  Eye,
  GearSix,
  House,
  Info,
  Keyboard,
  MagnifyingGlass,
  Moon,
  NavigationArrow,
  Palette,
  PaperPlaneTilt,
  Plus,
  SlidersHorizontal,
  SpinnerGap,
  Stack,
  Student,
  Sun,
  TextT,
  Tray,
  UploadSimple,
  WarningCircle,
  X,
  XCircle,
} from '@phosphor-icons/react'
import { GeometryNotebookLayoutV1 } from './notebook/GeometryNotebookLayoutV1'
import { fixtures } from './fixtures'
import './DesignSystemPlayground.css'

const showcaseSections = [
  { id: 'overview', label: 'Обзор', icon: NavigationArrow },
  { id: 'foundations', label: 'Основа', icon: Palette },
  { id: 'typography', label: 'Типографика', icon: TextT },
  { id: 'actions', label: 'Действия', icon: CursorClick },
  { id: 'forms', label: 'Формы', icon: SlidersHorizontal },
  { id: 'navigation', label: 'Навигация', icon: Stack },
  { id: 'feedback', label: 'Состояния', icon: BellRinging },
  { id: 'motion', label: 'Движение', icon: Clock },
] as const

const neutralTokens = [
  ['Canvas', '--color-canvas'],
  ['Surface', '--color-surface'],
  ['Raised', '--color-surface-raised'],
  ['Sunken', '--color-surface-sunken'],
  ['Border', '--color-border'],
  ['Muted', '--color-text-muted'],
  ['Text', '--color-text'],
  ['Strong', '--color-strong'],
] as const

const accentTokens = [
  ['Soft', '--color-accent-soft'],
  ['Base', '--color-accent'],
  ['Hover', '--color-accent-hover'],
  ['Ink', '--color-on-accent'],
] as const

const semanticTokens = [
  ['Инфо', '--color-info'],
  ['Успех', '--color-success'],
  ['Внимание', '--color-warning'],
  ['Ошибка', '--color-danger'],
] as const

const spacingTokens = [
  ['4', '--space-1'],
  ['8', '--space-2'],
  ['12', '--space-3'],
  ['16', '--space-4'],
  ['24', '--space-6'],
  ['32', '--space-8'],
  ['48', '--space-12'],
  ['64', '--space-16'],
] as const

const iconSamples = [
  ['Главная', House],
  ['Учёба', Student],
  ['Материалы', BookOpenText],
  ['Поиск', MagnifyingGlass],
  ['Время', Clock],
  ['Настройки', GearSix],
  ['Просмотр', Eye],
  ['Команда', Command],
] as const

type IconWeight = 'regular' | 'bold' | 'duotone'
type Theme = 'light' | 'dark'

const railRouteMetrics = {
  baseX: 18,
  activeX: 42,
  startY: 24,
  rowPitch: 52,
  nodeRadius: 18,
  gap: 16,
} as const

function getRailRoutePath(activePosition: number) {
  const { baseX, activeX, startY, rowPitch, nodeRadius, gap } = railRouteMetrics
  const lastIndex = showcaseSections.length - 1
  const endY = startY + lastIndex * rowPitch
  const activeY = startY + activePosition * rowPitch
  const curveInset = gap / 2
  const approachStart = Math.max(startY, activeY - nodeRadius - gap)
  const approachEnd = Math.max(startY, activeY - nodeRadius)
  const departureStart = Math.min(endY, activeY + nodeRadius)
  const departureEnd = Math.min(endY, activeY + nodeRadius + gap)
  const startX = baseX + (activeX - baseX) * Math.max(0, 1 - activePosition)
  const endX = baseX + (activeX - baseX) * Math.max(0, 1 - (lastIndex - activePosition))

  return [
    `M ${startX} ${startY}`,
    `L ${startX} ${approachStart}`,
    `C ${startX} ${Math.min(approachEnd, approachStart + curveInset)} ${activeX} ${Math.max(approachStart, approachEnd - curveInset)} ${activeX} ${approachEnd}`,
    `L ${activeX} ${departureStart}`,
    `C ${activeX} ${Math.min(departureEnd, departureStart + curveInset)} ${endX} ${Math.max(departureStart, departureEnd - curveInset)} ${endX} ${departureEnd}`,
    `L ${endX} ${endY}`,
  ].join(' ')
}

function RailRoute({ activeIndex }: { activeIndex: number }) {
  const pathRef = useRef<SVGPathElement>(null)
  const activePositionRef = useRef(0)

  useEffect(() => {
    const path = pathRef.current
    if (!path) return

    const from = activePositionRef.current
    const to = activeIndex
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false

    if (reducedMotion || from === to) {
      activePositionRef.current = to
      path.setAttribute('d', getRailRoutePath(to))
      return
    }

    let frame = 0
    const startedAt = performance.now()
    const duration = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--motion-navigation')) || 420
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration)
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2
      const current = from + (to - from) * eased
      activePositionRef.current = current
      path.setAttribute('d', getRailRoutePath(current))

      if (progress < 1) frame = window.requestAnimationFrame(animate)
    }

    frame = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(frame)
  }, [activeIndex])

  return (
    <svg className="rail-nav-route" viewBox="0 0 64 412" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path ref={pathRef} d={getRailRoutePath(0)} />
    </svg>
  )
}

function useActiveSection() {
  const [activeSection, setActiveSection] = useState('overview')

  useEffect(() => {
    const elements = showcaseSections
      .map(({ id }) => document.getElementById(id))
      .filter((element): element is HTMLElement => Boolean(element))
    let frame = 0

    const updateActiveSection = () => {
      frame = 0
      const readingLine = window.innerHeight * 0.22
      const current = elements.find((element) => {
        const bounds = element.getBoundingClientRect()
        return bounds.top <= readingLine && bounds.bottom > readingLine
      })

      if (current?.id) setActiveSection(current.id)
    }

    const scheduleUpdate = () => {
      if (frame) return
      frame = window.requestAnimationFrame(updateActiveSection)
    }

    updateActiveSection()
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
    }
  }, [])

  return activeSection
}

function ThemeButton({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const Icon = theme === 'light' ? Moon : Sun

  return (
    <button className="icon-button tooltip" type="button" onClick={onToggle} aria-label={theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему'}>
      <Icon size={19} weight="bold" aria-hidden="true" />
      <span className="tooltip-content" role="tooltip">Сменить тему</span>
    </button>
  )
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" focusable="false">
        <path className="brand-mark-h" d="M3 4H7V14H13V4H17V28H13V18H7V28H3Z" />
        <path className="brand-mark-c" d="M29 4H25.25C20.6 4 18 7.85 18 16S20.6 28 25.25 28H29V24H25.65C23.15 24 22 21.35 22 16S23.15 8 25.65 8H29Z" />
      </svg>
    </span>
  )
}

function BrandName() {
  return (
    <span className="brand-name">
      <span>Homework</span>{' '}<span className="brand-name-accent">Copilot</span>
    </span>
  )
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <header className="section-heading">
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  )
}

function TokenSwatch({ label, token }: { label: string; token: string }) {
  return (
    <div className="token-swatch" style={{ '--swatch': `var(${token})` } as CSSProperties}>
      <span className="swatch-color" aria-hidden="true" />
      <span><strong>{label}</strong><code>{token}</code></span>
    </div>
  )
}

function Overview({ onOpenDialog }: { onOpenDialog: () => void }) {
  const [routeStep, setRouteStep] = useState(1)
  const routeLabels = ['Задание', 'Решение', 'Оформление']

  return (
    <section className="showcase-section overview-section" id="overview" data-showcase-section>
      <div className="overview-copy">
        <div className="brand-lockup">
          <BrandMark />
          <BrandName />
        </div>
        <h1>Живая дизайн-система для&nbsp;учёбы.</h1>
        <p>Не финальный интерфейс, а самостоятельная среда для проверки характера, компонентов, состояний и движения.</p>
        <div className="overview-actions">
          <button className="button button-primary" type="button" onClick={onOpenDialog}>
            Открыть диалог <ArrowUpRight size={18} weight="bold" aria-hidden="true" />
          </button>
          <a className="button button-secondary" href="#foundations">Смотреть систему</a>
        </div>
      </div>

      <div className="route-stage" aria-label="Интерактивный маршрут решения">
        <div className="route-stage-topline">
          <span>Маршрут решения</span>
          <span>{routeStep + 1} из 3</span>
        </div>
        <div className="route-track" style={{ '--route-step': routeStep } as CSSProperties}>
          <span className="route-line" aria-hidden="true" />
          {routeLabels.map((label, index) => (
            <button
              className={`route-stop${routeStep === index ? ' is-current' : ''}${routeStep > index ? ' is-complete' : ''}`}
              type="button"
              key={label}
              onClick={() => setRouteStep(index)}
              aria-current={routeStep === index ? 'step' : undefined}
            >
              <span className="route-node" aria-hidden="true">{routeStep > index ? <Check size={14} weight="bold" /> : index + 1}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="route-result" aria-live="polite">
          <div>
            <span className="route-result-label">Текущий этап</span>
            <strong>{routeLabels[routeStep]}</strong>
          </div>
          <button className="button button-on-accent" type="button" onClick={() => setRouteStep((routeStep + 1) % routeLabels.length)}>
            Дальше <ArrowRight size={18} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  )
}

function Foundations() {
  return (
    <section className="showcase-section" id="foundations" data-showcase-section>
      <SectionHeading title="Основа" description="Холодный графит, меловые поверхности и один цитрусовый сигнал. Семантические цвета появляются только там, где сообщают состояние." />

      <div className="foundation-layout">
        <div className="palette-block">
          <h3>Нейтральная шкала</h3>
          <div className="swatch-list">
            {neutralTokens.map(([label, token]) => <TokenSwatch key={token} label={label} token={token} />)}
          </div>
        </div>
        <div className="palette-side">
          <div className="accent-field">
            <span>Сигнальный цвет</span>
            <strong>Выделяет действие,<br />а не украшает экран.</strong>
            <div className="accent-swatches">
              {accentTokens.map(([label, token]) => <TokenSwatch key={token} label={label} token={token} />)}
            </div>
          </div>
          <div className="semantic-field">
            <h3>Семантика</h3>
            <div className="semantic-swatches">
              {semanticTokens.map(([label, token]) => (
                <span key={token} style={{ '--swatch': `var(${token})` } as CSSProperties}><i aria-hidden="true" />{label}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="foundation-rules">
        <article className="spacing-demo">
          <h3>Шаг 4 px</h3>
          <div className="spacing-list">
            {spacingTokens.map(([label, token]) => (
              <div key={token}><code>{label}</code><span style={{ '--space-demo': `var(${token})` } as CSSProperties} /><small>{token}</small></div>
            ))}
          </div>
        </article>
        <article className="shape-demo">
          <h3>Форма и глубина</h3>
          <div className="shape-row">
            <span className="radius-sample radius-control">8</span>
            <span className="radius-sample radius-surface">12</span>
            <span className="radius-sample radius-panel">16</span>
            <span className="radius-sample radius-pill">Pill</span>
          </div>
          <div className="elevation-row">
            <span className="elevation-flat">Flat</span>
            <span className="elevation-raised">Raised</span>
            <span className="elevation-overlay">Overlay</span>
          </div>
        </article>
      </div>
    </section>
  )
}

function Typography() {
  const [weight, setWeight] = useState(400)

  return (
    <section className="showcase-section" id="typography" data-showcase-section>
      <SectionHeading title="Типографика" description="Unbounded задаёт навигационный характер, Onest держит длинное чтение, JetBrains Mono обслуживает числа, клавиши и служебные данные." />

      <div className="type-specimen">
        <div className="type-display" style={{ fontVariationSettings: `'wght' ${weight}` }}>
          <span>Display / {weight}</span>
          <strong>Понять задачу.<br />Оформить ответ.</strong>
          <label>
            <span>Вес заголовка</span>
            <input type="range" min="400" max="850" step="50" value={weight} onChange={(event) => setWeight(Number(event.target.value))} />
          </label>
        </div>
        <div className="type-body">
          <span>Body / Onest</span>
          <h3>Текст остаётся спокойным, когда задача сложная.</h3>
          <p>Основной набор рассчитан на объяснения, условия и подсказки. Размеры живут в fluid-шкале, а длина строки ограничена для быстрого чтения.</p>
          <div className="type-body-weights"><span>Regular 400</span><strong>Medium 540</strong><b>Heavy 720</b></div>
        </div>
      </div>

      <div className="type-scale">
        {[
          ['Display', '--text-display', 'clamp(2.7rem, 4.8vw, 5.5rem)', 'Живая система'],
          ['Title', '--text-title', 'clamp(2rem, 4vw, 3.75rem)', 'Новый раздел'],
          ['Heading', '--text-heading', '1.5rem', 'Заголовок компонента'],
          ['Body', '--text-body', '1rem', 'Понятный текст для ежедневной работы'],
          ['Small', '--text-small', '.8125rem', 'Подсказка или дополнительный контекст'],
          ['Meta', '--text-caption', '.75rem', '12:40 / ГОТОВО'],
        ].map(([name, token, size, copy]) => (
          <div className="type-scale-row" key={name}>
            <code>{name}</code><span style={{ fontSize: `var(${token})` }}>{copy}</span><small>{token} · {size}</small>
          </div>
        ))}
      </div>
    </section>
  )
}

function Actions() {
  const [loading, setLoading] = useState(false)
  const [selectedCard, setSelectedCard] = useState(true)
  const [iconWeight, setIconWeight] = useState<IconWeight>('duotone')
  const [iconSize, setIconSize] = useState(32)

  const runLoading = () => {
    setLoading(true)
    window.setTimeout(() => setLoading(false), 1100)
  }

  return (
    <section className="showcase-section" id="actions" data-showcase-section>
      <SectionHeading title="Действия и объекты" description="Контролы отвечают сразу: цветом, коротким смещением и ясным текстом. Радиус зависит от роли, а не от случайного настроения компонента." />

      <div className="action-grid">
        <article className="component-panel button-panel">
          <div className="panel-title"><h3>Кнопки</h3><span>Высота 40 / 48</span></div>
          <div className="button-showcase">
            <button className="button button-primary" type="button">Решить задачу <ArrowRight size={18} weight="bold" /></button>
            <button className="button button-secondary" type="button">Сохранить</button>
            <button className="button button-quiet" type="button">Подробнее</button>
            <button className="button button-danger" type="button">Удалить</button>
            <button className="button button-primary" type="button" disabled>Недоступно</button>
            <button className="button button-secondary" type="button" onClick={runLoading} disabled={loading}>
              {loading ? <><SpinnerGap className="spin" size={18} weight="bold" /> Готовим</> : <><PaperPlaneTilt size={18} weight="bold" /> Проверить loading</>}
            </button>
          </div>
          <div className="icon-actions">
            <button className="icon-button" type="button" aria-label="Добавить"><Plus size={19} weight="bold" /></button>
            <button className="icon-button" type="button" aria-label="Копировать"><Copy size={19} weight="bold" /></button>
            <button className="icon-button tooltip" type="button" aria-label="Дополнительные действия"><DotsThree size={22} weight="bold" /><span className="tooltip-content" role="tooltip">Ещё действия</span></button>
          </div>
        </article>

        <article className="component-panel card-panel">
          <div className="panel-title"><h3>Карточки</h3><span>Выбор и hover</span></div>
          <button className={`assignment-card${selectedCard ? ' is-selected' : ''}`} type="button" onClick={() => setSelectedCard(!selectedCard)} aria-pressed={selectedCard}>
            <span className="assignment-icon"><BookOpenText size={22} weight="duotone" /></span>
            <span><small>Геометрия</small><strong>Три точки и прямые</strong><em>Задача № 2</em></span>
            <span className="selection-check"><Check size={15} weight="bold" /></span>
          </button>
          <div className="compact-card-list">
            <button type="button"><span><Clock size={18} /></span><strong>Недавнее решение</strong><small>12 минут назад</small><ArrowRight size={17} /></button>
            <button type="button"><span><Tray size={18} /></span><strong>Сохранённые работы</strong><small>8 материалов</small><ArrowRight size={17} /></button>
          </div>
        </article>
      </div>

      <div className="icon-lab">
        <div className="panel-title"><h3>Phosphor Icons</h3><span>Единая оптика</span></div>
        <div className="icon-controls">
          <div className="segmented-control" aria-label="Толщина иконок">
            {(['regular', 'bold', 'duotone'] as const).map((value) => <button type="button" key={value} className={iconWeight === value ? 'is-active' : ''} onClick={() => setIconWeight(value)}>{value}</button>)}
          </div>
          <label><span>Размер {iconSize}px</span><input type="range" min="18" max="36" step="2" value={iconSize} onChange={(event) => setIconSize(Number(event.target.value))} /></label>
        </div>
        <div className="icon-grid">
          {iconSamples.map(([label, Icon]) => <div key={label}><Icon size={iconSize} weight={iconWeight} /><span>{label}</span></div>)}
        </div>
      </div>
    </section>
  )
}

function Forms() {
  const [taskTitle, setTaskTitle] = useState('')
  const [subject, setSubject] = useState('geometry')
  const [toggle, setToggle] = useState(true)
  const [checked, setChecked] = useState(true)
  const [radio, setRadio] = useState('full')
  const fieldState = taskTitle.length === 0 ? 'default' : taskTitle.length < 4 ? 'error' : 'success'

  return (
    <section className="showcase-section" id="forms" data-showcase-section>
      <SectionHeading title="Формы" description="Подпись всегда остаётся над полем. Ошибка появляется рядом с причиной, успех не перетягивает внимание, а фокус заметен с клавиатуры." />

      <div className="form-layout">
        <form className="form-sheet" onSubmit={(event) => event.preventDefault()}>
          <div className={`field field-${fieldState}`}>
            <label htmlFor="task-name">Название задачи</label>
            <div className="input-shell"><BookOpenText size={18} aria-hidden="true" /><input id="task-name" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Например, теорема Пифагора" aria-invalid={fieldState === 'error'} aria-describedby="task-name-help" aria-errormessage={fieldState === 'error' ? 'task-name-help' : undefined} /></div>
            {fieldState === 'default' && <small id="task-name-help">Так работу будет проще найти позже.</small>}
            {fieldState === 'error' && <small id="task-name-help"><WarningCircle size={15} weight="fill" /> Введите минимум 4 символа.</small>}
            {fieldState === 'success' && <small id="task-name-help"><CheckCircle size={15} weight="fill" /> Название подходит.</small>}
          </div>

          <div className="field">
            <label htmlFor="subject">Предмет</label>
            <div className="select-shell"><select id="subject" value={subject} onChange={(event) => setSubject(event.target.value)} aria-describedby="subject-help"><option value="geometry">Геометрия</option><option value="algebra">Алгебра</option><option value="russian">Русский язык</option></select><CaretDown size={17} weight="bold" aria-hidden="true" /></div>
            <small id="subject-help">Выбор меняет формат будущего решения.</small>
          </div>

          <div className="field">
            <label htmlFor="condition">Условие</label>
            <textarea id="condition" rows={4} defaultValue="В равнобедренном треугольнике угол при вершине равен 36°. Найдите углы при основании." aria-describedby="condition-help" />
            <small id="condition-help">Можно вставить текст или добавить фотографию.</small>
          </div>

          <button className="dropzone" type="button">
            <span><UploadSimple size={23} weight="bold" /></span>
            <strong>Добавить фотографию</strong>
            <small>PNG, JPG до 10 МБ</small>
          </button>
        </form>

        <div className="control-sheet">
          <div className="control-group">
            <h3>Toggle</h3>
            <button className={`switch${toggle ? ' is-on' : ''}`} type="button" role="switch" aria-label="Показывать подсказки" aria-checked={toggle} onClick={() => setToggle(!toggle)}><span /></button>
            <p>{toggle ? 'Подсказки включены' : 'Подсказки выключены'}</p>
          </div>
          <div className="control-group">
            <h3>Checkbox</h3>
            <label className="check-control"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} /><span><Check size={14} weight="bold" /></span>Сохранить в мои решения</label>
            <label className="check-control is-disabled"><input type="checkbox" disabled /><span><Check size={14} weight="bold" /></span>Отправить преподавателю</label>
          </div>
          <fieldset className="control-group">
            <legend>Radio</legend>
            {[
              ['short', 'Короткий ответ'],
              ['full', 'Полное решение'],
              ['study', 'С пояснениями'],
            ].map(([value, label]) => <label className="radio-control" key={value}><input type="radio" name="answer-format" value={value} checked={radio === value} onChange={() => setRadio(value)} /><span />{label}</label>)}
          </fieldset>
        </div>
      </div>
    </section>
  )
}

function NavigationPatterns() {
  const [tab, setTab] = useState('Решение')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [subjectFilter, setSubjectFilter] = useState('Все предметы')
  const [segment, setSegment] = useState('Неделя')
  const dropdownButtonRef = useRef<HTMLButtonElement>(null)
  const dropdownMenuRef = useRef<HTMLDivElement>(null)
  const tabs = ['Условие', 'Решение', 'Ответ']
  const subjects = ['Все предметы', 'Геометрия', 'Алгебра', 'Русский язык']

  useEffect(() => {
    if (!dropdownOpen) return
    const frame = requestAnimationFrame(() => dropdownMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [dropdownOpen])

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = tabs.length - 1
    else return

    event.preventDefault()
    setTab(tabs[nextIndex])
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus()
  }

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    let nextIndex = currentIndex

    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length
    else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = items.length - 1
    else if (event.key === 'Escape') {
      event.preventDefault()
      setDropdownOpen(false)
      dropdownButtonRef.current?.focus()
      return
    } else if (event.key === 'Tab') {
      setDropdownOpen(false)
      return
    } else return

    event.preventDefault()
    items[nextIndex]?.focus()
  }

  return (
    <section className="showcase-section" id="navigation" data-showcase-section>
      <SectionHeading title="Навигация" description="Путь всегда читается как маршрут: где я, что было раньше, куда можно перейти дальше. Активное состояние использует форму и цвет одновременно." />

      <div className="navigation-lab">
        <nav className="breadcrumbs" aria-label="Хлебные крошки"><a href="#overview">Главная</a><ArrowRight size={14} /><a href="#navigation">Мои решения</a><ArrowRight size={14} /><span>Задача № 2</span></nav>

        <div className="tabs" role="tablist" aria-label="Разделы решения">
          {tabs.map((item, index) => <button type="button" role="tab" id={`solution-tab-${index}`} aria-controls="solution-tabpanel" key={item} aria-selected={tab === item} tabIndex={tab === item ? 0 : -1} className={tab === item ? 'is-active' : ''} onClick={() => setTab(item)} onKeyDown={(event) => handleTabKeyDown(event, index)}>{item}</button>)}
        </div>
        <div className="tab-preview" role="tabpanel" id="solution-tabpanel" aria-labelledby={`solution-tab-${tabs.indexOf(tab)}`}><span>Открыт раздел</span><strong>{tab}</strong><p>Контент меняется без потери контекста и с коротким подчёркиванием активного маршрута.</p></div>

        <div className="navigation-controls">
          <div className="segmented-control" aria-label="Период расписания">
            {['День', 'Неделя', 'Месяц'].map((item) => <button type="button" key={item} className={segment === item ? 'is-active' : ''} onClick={() => setSegment(item)}>{item}</button>)}
          </div>

          <div className="dropdown">
            <button ref={dropdownButtonRef} className="button button-secondary" type="button" aria-haspopup="menu" aria-expanded={dropdownOpen} onClick={() => setDropdownOpen(!dropdownOpen)} onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setDropdownOpen(true)
              }
            }}>{subjectFilter} <CaretDown size={17} weight="bold" /></button>
            {dropdownOpen && (
              <div ref={dropdownMenuRef} className="dropdown-menu" role="menu" aria-label="Фильтр по предмету" onKeyDown={handleMenuKeyDown}>
                {subjects.map((item) => <button type="button" role="menuitemradio" aria-checked={subjectFilter === item} key={item} onClick={() => {
                  setSubjectFilter(item)
                  setDropdownOpen(false)
                  dropdownButtonRef.current?.focus()
                }}>{subjectFilter === item ? <Check size={16} weight="bold" /> : <span />}{item}</button>)}
              </div>
            )}
          </div>
        </div>

        <div className="command-preview">
          <Command size={20} weight="bold" />
          <span>Быстрый переход</span>
          <div><Keyboard size={17} /><kbd>Ctrl</kbd><kbd>K</kbd></div>
        </div>
      </div>
    </section>
  )
}

function Feedback({ onOpenDialog }: { onOpenDialog: () => void }) {
  const [toastVisible, setToastVisible] = useState(false)
  const [progress, setProgress] = useState(64)
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([])

  const dismissAlert = (name: string) => setDismissedAlerts((alerts) => [...alerts, name])

  useEffect(() => {
    if (!toastVisible) return
    const timeout = window.setTimeout(() => setToastVisible(false), 3600)
    return () => window.clearTimeout(timeout)
  }, [toastVisible])

  return (
    <section className="showcase-section" id="feedback" data-showcase-section>
      <SectionHeading title="Состояния и обратная связь" description="Критическая информация появляется сразу и не прячется только в цвете. Демо-данные подписаны, чтобы их нельзя было принять за продуктовые показатели." />

      <div className="badge-row" aria-label="Бейджи">
        <span className="badge">Черновик</span><span className="badge badge-accent">Новое</span><span className="badge badge-success">Готово</span><span className="badge badge-warning">Нужно проверить</span><span className="badge badge-danger">Ошибка</span>
      </div>

      <div className="alert-stack">
        {!dismissedAlerts.includes('info') && <div className="alert alert-info"><Info size={21} weight="fill" /><span><strong>Есть подсказка</strong>Проверьте единицы измерения перед ответом.</span><button type="button" aria-label="Закрыть подсказку" onClick={() => dismissAlert('info')}><X size={17} weight="bold" /></button></div>}
        {!dismissedAlerts.includes('success') && <div className="alert alert-success"><CheckCircle size={21} weight="fill" /><span><strong>Решение сохранено</strong>Работа появилась в разделе «Мои решения».</span><button type="button" aria-label="Закрыть сообщение об успехе" onClick={() => dismissAlert('success')}><X size={17} weight="bold" /></button></div>}
        {!dismissedAlerts.includes('warning') && <div className="alert alert-warning"><WarningCircle size={21} weight="fill" /><span><strong>Нужна проверка</strong>На фотографии не видно правую часть условия.</span><button type="button" aria-label="Закрыть предупреждение" onClick={() => dismissAlert('warning')}><X size={17} weight="bold" /></button></div>}
        {!dismissedAlerts.includes('danger') && <div className="alert alert-danger"><XCircle size={21} weight="fill" /><span><strong>Файл не загрузился</strong>Выберите JPG или PNG размером до 10 МБ.</span><button type="button" aria-label="Закрыть сообщение об ошибке" onClick={() => dismissAlert('danger')}><X size={17} weight="bold" /></button></div>}
      </div>

      <div className="state-grid">
        <article className="empty-state">
          <span><Tray size={30} weight="duotone" /></span>
          <h3>Здесь пока нет решений</h3>
          <p>Добавьте первую задачу, чтобы вернуться к ней перед контрольной.</p>
          <button className="button button-primary" type="button"><Plus size={18} weight="bold" /> Добавить задачу</button>
        </article>

        <article className="loading-state" aria-label="Демонстрация загрузки: готовим решение">
          <div className="loading-state-topline">
            <span className="loading-state-icon" aria-hidden="true"><BookOpenText size={32} weight="duotone" /></span>
            <span className="loading-state-count">02 / 03</span>
          </div>
          <h3>Готовим решение</h3>
          <p>Сейчас выстраиваем ход решения.</p>
          <div className="proof-route" aria-hidden="true">
            <div className="proof-route-track">
              <svg viewBox="0 0 360 40" preserveAspectRatio="none">
                <path className="proof-route-base" d="M8 27 H130 L148 11 H212 L230 27 H352" />
                <path className="proof-route-active" d="M8 27 H130 L148 11 H212 L230 27 H352" />
                <rect className="proof-route-marker" x="4" y="23" width="8" height="8" rx="1" />
              </svg>
              <span className="proof-node proof-node-start" />
              <span className="proof-node proof-node-current">02</span>
              <span className="proof-node proof-node-end" />
            </div>
            <div className="proof-route-labels"><span>Условие</span><strong>Решение</strong><span>Оформление</span></div>
          </div>
          <ol className="solution-build" aria-label="Ход подготовки решения">
            <li className="is-complete"><b>01</b><span><strong>Данные</strong><small>условие прочитано</small></span><Check size={15} weight="bold" aria-hidden="true" /></li>
            <li className="is-active"><b>02</b><span><strong>Решение</strong><small>строим шаги</small></span><NavigationArrow size={16} weight="fill" aria-hidden="true" /></li>
            <li><b>03</b><span><strong>Запись</strong><small>подготовим следом</small></span><i aria-hidden="true" /></li>
          </ol>
        </article>

        <article className="progress-state">
          <div className="panel-title"><h3>Progress</h3><span>Демо {progress}%</span></div>
          <progress max="100" value={progress}>{progress}%</progress>
          <input aria-label="Изменить демо-прогресс" type="range" min="0" max="100" value={progress} onChange={(event) => setProgress(Number(event.target.value))} />
          <ol><li className="is-complete">Условие</li><li className={progress >= 50 ? 'is-complete' : ''}>Решение</li><li className={progress >= 100 ? 'is-complete' : ''}>Оформление</li></ol>
        </article>
      </div>

      <div className="feedback-actions">
        <button className="button button-secondary" type="button" onClick={() => setToastVisible(true)}><BellRinging size={18} weight="bold" /> Показать toast</button>
        <button className="button button-secondary" type="button" onClick={onOpenDialog}><ArrowUpRight size={18} weight="bold" /> Открыть dialog</button>
      </div>

      {toastVisible && (
        <div className="toast" role="status">
          <CheckCircle size={21} weight="fill" /><span><strong>Скопировано</strong>Решение готово для тетради.</span><button type="button" aria-label="Закрыть toast" onClick={() => setToastVisible(false)}><X size={17} weight="bold" /></button>
        </div>
      )}
    </section>
  )
}

function MotionLab() {
  const [motionRun, setMotionRun] = useState(0)

  return (
    <section className="showcase-section motion-section" id="motion" data-showcase-section>
      <SectionHeading title="Движение" description="Интеракции отвечают за 70-180 мс, панели ориентируют за 280 мс, навигация перестраивается за 420 мс, один маршрутный жест длится 640 мс. При reduced motion всё становится мгновенным." />

      <div className="motion-lab">
        <div className="motion-stage">
          <div className="motion-route" key={motionRun}>
            <span className="motion-line" />
            <span className="motion-marker"><NavigationArrow size={20} weight="fill" /></span>
            <span className="motion-stop motion-stop-a" />
            <span className="motion-stop motion-stop-b" />
            <span className="motion-stop motion-stop-c" />
          </div>
          <div className="motion-stage-copy"><span>Signature interaction</span><strong>Маркер проходит путь от задания к оформлению.</strong></div>
          <button className="button button-on-accent" type="button" onClick={() => setMotionRun(motionRun + 1)}>Повторить <ArrowRight size={18} weight="bold" /></button>
        </div>

        <div className="motion-tokens">
          {[
            ['Instant', '70 ms', 'Фокус, press'],
            ['Fast', '120 ms', 'Hover, icon'],
            ['UI', '180 ms', 'Dropdown, tooltip'],
            ['Panel', '280 ms', 'Dialog, overlay'],
            ['Navigation', '420 ms', 'Rail, section'],
            ['Route', '640 ms', 'Редкий акцент'],
          ].map(([name, duration, use]) => <div key={name}><strong>{name}</strong><code>{duration}</code><span>{use}</span><i /></div>)}
        </div>
      </div>

      <footer className="system-footer">
        <div className="brand-lockup"><BrandMark /><BrandName /></div>
        <p>Playground дизайн-системы. Финальные страницы продукта появятся только после утверждения визуального языка.</p>
        <a href="#overview">К началу <ArrowRight size={17} weight="bold" /></a>
      </footer>
    </section>
  )
}

function PlaygroundDialog({ dialogRef }: { dialogRef: RefObject<HTMLDialogElement | null> }) {
  return (
    <dialog className="ds-dialog" ref={dialogRef} onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close() }}>
      <div className="dialog-panel">
        <div className="dialog-icon"><BookOpenText size={26} weight="duotone" /></div>
        <button className="icon-button dialog-close" type="button" aria-label="Закрыть диалог" onClick={() => dialogRef.current?.close()}><X size={19} weight="bold" /></button>
        <h2>Добавить задачу?</h2>
        <p>Диалог защищает фокус, сохраняет контекст и появляется из точки действия без лишнего спектакля.</p>
        <div className="dialog-actions">
          <button className="button button-secondary" type="button" onClick={() => dialogRef.current?.close()}>Отмена</button>
          <button className="button button-primary" type="button" onClick={() => dialogRef.current?.close()}>Добавить</button>
        </div>
      </div>
    </dialog>
  )
}

function Playground() {
  const activeSection = useActiveSection()
  const activeSectionIndex = Math.max(0, showcaseSections.findIndex(({ id }) => id === activeSection))
  const dialogRef = useRef<HTMLDialogElement>(null)
  const railRef = useRef<HTMLElement>(null)
  const seamRef = useRef<HTMLDivElement>(null)
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
  }, [theme])

  useEffect(() => {
    const syncSeam = () => {
      const activeButton = railRef.current?.querySelector<HTMLButtonElement>(`button[data-section="${activeSection}"]`)
      const seam = seamRef.current

      if (!activeButton || !seam) return

      const bounds = activeButton.getBoundingClientRect()
      seam.style.setProperty('--seam-y', `${Math.round(bounds.top + bounds.height / 2)}px`)
      seam.dataset.ready = 'true'
    }

    const frame = window.requestAnimationFrame(syncSeam)
    window.addEventListener('resize', syncSeam)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', syncSeam)
    }
  }, [activeSection])

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  return (
    <main className="playground-shell">
      <aside className="system-rail" aria-label="Разделы дизайн-системы" ref={railRef}>
        <div className="rail-header">
          <div className="brand-lockup"><BrandMark /><BrandName /></div>
        </div>
        <nav className="rail-nav">
          <RailRoute activeIndex={activeSectionIndex} />
          {showcaseSections.map(({ id, label, icon: Icon }) => (
            <button className={activeSection === id ? 'is-active' : ''} type="button" key={id} data-section={id} onClick={() => scrollToSection(id)} aria-current={activeSection === id ? 'location' : undefined}>
              <span className="rail-node"><Icon size={18} weight={activeSection === id ? 'bold' : 'regular'} /></span><span className="rail-text">{label}</span>
            </button>
          ))}
        </nav>
        <div className="rail-footer">
          <ThemeButton theme={theme} onToggle={() => setTheme(theme === 'light' ? 'dark' : 'light')} />
          <span>Light / Dark</span>
        </div>
      </aside>

      <div className="shell-seam" aria-hidden="true" ref={seamRef}>
        <span className="shell-seam-track" />
        <span className="shell-seam-node" />
      </div>

      <div className="playground-content">
        <header className="mobile-header">
          <div className="brand-lockup"><BrandMark /><BrandName /></div>
          <label className="mobile-section-picker">
            <span className="sr-only">Раздел дизайн-системы</span>
            <select aria-label="Раздел дизайн-системы" value={activeSection} onChange={(event) => scrollToSection(event.target.value)}>
              {showcaseSections.map(({ id, label }) => <option value={id} key={id}>{label}</option>)}
            </select>
            <CaretDown size={14} weight="bold" aria-hidden="true" />
          </label>
          <ThemeButton theme={theme} onToggle={() => setTheme(theme === 'light' ? 'dark' : 'light')} />
        </header>
        <Overview onOpenDialog={() => dialogRef.current?.showModal()} />
        <Foundations />
        <Typography />
        <Actions />
        <Forms />
        <NavigationPatterns />
        <Feedback onOpenDialog={() => dialogRef.current?.showModal()} />
        <MotionLab />
      </div>

      <PlaygroundDialog dialogRef={dialogRef} />
    </main>
  )
}

function App() {
  const canvasMode = new URLSearchParams(window.location.search).get('canvas') === '1'

  if (canvasMode) {
    return (
      <main className="canvas-mode">
        <GeometryNotebookLayoutV1 spec={fixtures[0]} />
      </main>
    )
  }

  return <Playground />
}

export default App
