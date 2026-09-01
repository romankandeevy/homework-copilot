/* Публичная витрина продукта.
   Это первое, что видит человек, никогда не слышавший о Homework Copilot.
   Рабочая часть продукта живёт на `/app` и здесь только показывается.

   Всё, что заявлено на этой странице, проверяется по коду:
   цена решения — `src/lib/solutionPricing.ts`, стартовые 20 ₽ и бонусы за
   приглашение — миграции кошелька, двойной проход и рецензент —
   `server/homeworkSolver.ts`, чертёж — `GeometryNotebookLayoutV1`,
   значки разбора — `src/solution/WrittenAnalysis.tsx`, предметы и классы —
   `src/CopyTask.tsx`. Ничего сверх этого страница не обещает. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  ArrowRight,
  ArrowsClockwise,
  CameraPlus,
  ChatsCircle,
  Check,
  CheckCircle,
  ClockCounterClockwise,
  Compass,
  List,
  Moon,
  Notebook,
  PencilSimpleLine,
  Plus,
  ShieldCheck,
  Sun,
  X,
} from '@phosphor-icons/react'
import { SiteFooter } from '../support/SupportCenter'
import {
  AnalysisPreview,
  ChatPreview,
  NotebookPreview,
  ResultPreview,
  SchedulePreview,
  SolvingPreview,
  TaskFormPreview,
} from './LandingPreviews'
import './LandingPage.css'

const appPath = '/app'
const signInPath = '/app?auth=signin'
const themeStorageKey = 'homework-copilot:theme'
const demoCondition = 'Диагонали ромба равны 10 см и 24 см. Найдите сторону ромба.'

type Theme = 'light' | 'dark'
type Stage = 'typing' | 'solving' | 'result'

const sections = [
  { id: 'how', label: 'Как это работает' },
  { id: 'features', label: 'Возможности' },
  { id: 'price', label: 'Цена' },
  { id: 'faq', label: 'Вопросы' },
] as const

/* `matchMedia` есть не в каждой среде — в jsdom его нет вовсе. Без проверки
   витрина падала бы при первом же рендере вне браузера. */
function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/* Вход определяем по ключу сессии Supabase в localStorage. Тянуть ради
   этого клиент Supabase в первый чанк витрины незачем: страница ничего
   не запрашивает от имени пользователя, ей нужно только выбрать надпись
   на кнопке — «Начать» или «Открыть приложение». */
function hasStoredSession() {
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key && /^sb-.*-auth-token$/.test(key) && window.localStorage.getItem(key)) return true
    }
  } catch {
    // Приватный режим браузера: считаем, что пользователь не вошёл.
  }
  return false
}

function useLandingTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const stored = window.localStorage.getItem(themeStorageKey)
      if (stored === 'light' || stored === 'dark') return stored
    } catch {
      // Тема документа остаётся безопасным запасным вариантом.
    }
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    try {
      window.localStorage.setItem(themeStorageKey, theme)
    } catch {
      // Выбор темы просто не запомнится.
    }
  }, [theme])

  return { theme, toggleTheme: () => setTheme((current) => (current === 'light' ? 'dark' : 'light')) }
}

/* Появление секции при прокрутке.

   Движение отдано motion: библиотека уже стоит в проекте (аккаунт, чат,
   расписание) и считает анимации на композиторе, а не в потоке вёрстки.

   `whileInView` вместо своего IntersectionObserver: раньше на каждый блок
   создавался отдельный наблюдатель, и на длинной странице их набиралось
   больше двадцати. */
function Reveal({
  children,
  className = '',
  delay = 0,
  as = 'div',
}: {
  children: React.ReactNode
  className?: string
  delay?: number
  as?: 'div' | 'li' | 'article'
}) {
  const reduceMotion = useReducedMotion()
  const Element = motion[as]

  if (reduceMotion) {
    const Plain = as
    return <Plain className={className || undefined}>{children}</Plain>
  }

  return (
    <Element
      className={className || undefined}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      transition={{ type: 'spring', stiffness: 120, damping: 20, mass: 0.9, delay: delay / 1000 }}
    >
      {children}
    </Element>
  )
}

function CompareRow({ row, index }: { row: (typeof comparison)[number]; index: number }) {
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      className="compare-row"
      role="row"
      initial={reduceMotion ? undefined : { opacity: 0.001 }}
      whileInView={reduceMotion ? undefined : { opacity: 1 }}
      viewport={{ once: true, margin: '0px 0px -15% 0px' }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1], delay: index * 0.07 }}
    >
      <span className="compare-question" role="cell">{row.question}</span>
      <span className="compare-gdz" role="cell">{row.gdz}</span>
      <span className="compare-ours" role="cell">
        {/* Черта дорисовывается под нашим ответом: ею строка и «сходится». */}
        <motion.i
          aria-hidden="true"
          className="compare-underline"
          initial={reduceMotion ? undefined : { scaleX: 0 }}
          whileInView={reduceMotion ? undefined : { scaleX: 1 }}
          viewport={{ once: true, margin: '0px 0px -15% 0px' }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.15 + index * 0.07 }}
        />
        {row.ours}
      </span>
    </motion.div>
  )
}

/* Ролик о продукте. Файл тяжёлый, поэтому до появления в кадре грузится
   только постер: `preload="none"` плюс запуск по пересечению. */
function PromoFilm() {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) void video.play().catch(() => undefined)
        else video.pause()
      })
    }, { threshold: 0.35 })

    observer.observe(video)
    return () => observer.disconnect()
  }, [])

  return (
    <video
      ref={videoRef}
      className="promo-film"
      poster="/promo-poster.jpg"
      preload="none"
      muted
      loop
      playsInline
      // Ролик без звука и без сюжета, который можно упустить: он повторяет
      // то, что рядом написано словами, поэтому обходится без подписей.
      aria-label="Как выглядит решение задачи в Homework Copilot"
    >
      <source src="/promo.mp4" type="video/mp4" />
    </video>
  )
}

/* Сценарий первого экрана: условие печатается, задача уходит на два
   независимых прохода, открывается тетрадная страница. Проигрывается
   один раз — витрина не должна мельтешить, пока человек читает. */
function useHeroSequence() {
  const [stage, setStage] = useState<Stage>(() => (prefersReducedMotion() ? 'result' : 'typing'))
  const [typed, setTyped] = useState(() => (prefersReducedMotion() ? demoCondition : ''))
  const [passes, setPasses] = useState(0)
  const [run, setRun] = useState(0)
  const timers = useRef<number[]>([])

  useEffect(() => {
    timers.current.forEach(window.clearTimeout)
    timers.current = []
    if (prefersReducedMotion()) return

    const wait = (delay: number, action: () => void) => {
      timers.current.push(window.setTimeout(action, delay))
    }

    setStage('typing')
    setTyped('')
    setPasses(0)

    const typingStep = 26
    for (let index = 1; index <= demoCondition.length; index += 1) {
      wait(280 + index * typingStep, () => setTyped(demoCondition.slice(0, index)))
    }

    const typingEnd = 280 + demoCondition.length * typingStep
    wait(typingEnd + 520, () => setStage('solving'))
    wait(typingEnd + 1000, () => setPasses(1))
    wait(typingEnd + 1500, () => setPasses(2))
    wait(typingEnd + 2050, () => setPasses(3))
    wait(typingEnd + 2600, () => setStage('result'))

    return () => {
      timers.current.forEach(window.clearTimeout)
      timers.current = []
    }
  }, [run])

  return { stage, typed, passes, replay: () => setRun((value) => value + 1) }
}

function HeroPreview() {
  const { stage, typed, passes, replay } = useHeroSequence()

  return (
    <div className="hero-preview">
      <div className="hero-stage" data-stage={stage}>
        <div className="hero-stage-slot" data-active={stage === 'typing'} aria-hidden={stage !== 'typing'}>
          <TaskFormPreview typed={typed} submitted={typed.length >= demoCondition.length} />
        </div>
        <div className="hero-stage-slot" data-active={stage === 'solving'} aria-hidden={stage !== 'solving'}>
          <SolvingPreview passes={passes} />
        </div>
        <div className="hero-stage-slot" data-active={stage === 'result'} aria-hidden={stage !== 'result'}>
          <ResultPreview />
        </div>
      </div>

      <button className="hero-replay" type="button" onClick={replay}>
        <ArrowsClockwise size={15} weight="bold" aria-hidden="true" />
        Показать сначала
      </button>
    </div>
  )
}

function LandingHeader({ signedIn, theme, onToggleTheme }: { signedIn: boolean; theme: Theme; onToggleTheme: () => void }) {
  const [compact, setCompact] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const ThemeIcon = theme === 'light' ? Moon : Sun

  return (
    <header className={`landing-header${compact ? ' is-compact' : ''}`}>
      {/* Имя ссылки собирается из самой надписи: `aria-label` поверх
          видимого текста ломает совпадение доступного имени с надписью.
          Поэтому на узком экране прячется монограмма, а не название. */}
      <a className="landing-brand" href="/">
        <span className="brand-mark" aria-hidden="true"><span>H</span><span>C</span></span>
        <span className="brand-name"><span>Homework</span> <span className="brand-name-accent">Copilot</span></span>
      </a>

      <nav className="landing-nav" aria-label="Разделы страницы">
        {sections.map(({ id, label }) => (
          <a key={id} href={`#${id}`}>{label}</a>
        ))}
      </nav>

      <div className="landing-header-actions">
        <button className="landing-icon-button" type="button" onClick={onToggleTheme} aria-label={theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему'}>
          <ThemeIcon size={19} weight="duotone" aria-hidden="true" />
        </button>
        {!signedIn && <a className="landing-ghost-action" href={signInPath}>Войти</a>}
        <a className="landing-primary-action is-small" href={appPath}>
          {signedIn ? 'Открыть приложение' : 'Решить задачу'}
          <ArrowRight size={16} weight="bold" aria-hidden="true" />
        </a>
        <button className="landing-icon-button landing-burger" type="button" onClick={() => setMenuOpen(true)} aria-label="Открыть меню" aria-expanded={menuOpen}>
          <List size={20} weight="bold" aria-hidden="true" />
        </button>
      </div>

      {menuOpen && (
        <div className="landing-menu" role="dialog" aria-modal="true" aria-label="Меню">
          <div className="landing-menu-head">
            <span className="brand-name"><span>Homework</span> <span className="brand-name-accent">Copilot</span></span>
            <button className="landing-icon-button" type="button" onClick={() => setMenuOpen(false)} aria-label="Закрыть меню">
              <X size={20} weight="bold" aria-hidden="true" />
            </button>
          </div>
          <nav aria-label="Разделы страницы">
            {sections.map(({ id, label }) => (
              <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}>
                {label}
                <ArrowRight size={17} weight="bold" aria-hidden="true" />
              </a>
            ))}
          </nav>
          <div className="landing-menu-actions">
            <a className="landing-primary-action" href={appPath}>
              {signedIn ? 'Открыть приложение' : 'Решить задачу'}
              <ArrowRight size={17} weight="bold" aria-hidden="true" />
            </a>
            {!signedIn && <a className="landing-secondary-action" href={signInPath}>У меня уже есть аккаунт</a>}
          </div>
        </div>
      )}
    </header>
  )
}

const steps = [
  {
    icon: CameraPlus,
    title: 'Приносишь условие',
    text: 'Фотография с телефона, скриншот из буфера обмена или текст. Выбираешь предмет — по нему проверяется решение. Класс можно не указывать.',
  },
  {
    icon: ShieldCheck,
    title: 'Задачу решают дважды',
    text: 'Два независимых прохода и проверка по правилам предмета: единица измерения при ответе, разбор по составу, уравненная реакция. Разошлись или правило нарушено — подключается рецензент. Не сошлось — решение не выдаём и деньги не списываем.',
  },
  {
    icon: PencilSimpleLine,
    title: 'Переписываешь в тетрадь',
    text: 'Дано, ход решения по шагам, чертёж и ответ. Формулы записаны по-школьному: дроби косой чертой, степени надстрочными, корень знаком √.',
  },
]

/* Сравнение с решебником. Здесь только различие форматов — то, чем ГДЗ
   является по устройству: заранее собранный ответ под конкретное издание.
   Никаких утверждений о чужом качестве: их нечем подтвердить. */
const comparison = [
  {
    question: 'Где искать задачу',
    gdz: 'В решебнике к своему изданию — если он есть',
    ours: 'Нигде. Условие приносишь ты: фото или текст',
  },
  {
    question: 'Задача из карточки или своего варианта',
    gdz: 'Не найдётся: решебник собран под учебник',
    ours: 'Решается так же, как любая другая',
  },
  {
    question: 'Что получаешь',
    gdz: 'Ответ к номеру',
    ours: 'Дано, ход решения, чертёж и ответ',
  },
  {
    question: 'В каком виде',
    gdz: 'Как в книге',
    ours: 'Как запись в тетради — переписывай строкой за строкой',
  },
] as const

const features = [
  {
    icon: Notebook,
    title: 'Запись, а не голый ответ',
    text: 'Решение приходит разложенным: что дано, что найти, каждый шаг с пояснением и вывод. Переписывать можно строку за строкой.',
  },
  {
    icon: Compass,
    title: 'Чертёж строится по условию',
    text: 'Треугольники, ромбы, трапеции, окружности. Фигура собирается из данных задачи — с точками, равными сторонами и прямыми углами на своих местах.',
  },
  {
    icon: PencilSimpleLine,
    title: 'Школьные значки на месте',
    text: 'Подлежащее одной чертой, сказуемое двумя, корень дугой, суффикс крышкой, степень окисления над элементом. Разбор выглядит так, как его ждёт учитель.',
  },
  {
    icon: ShieldCheck,
    title: 'Проверка до выдачи',
    text: 'Решение сверяется независимо, а не отдаётся как есть. Не прошло проверку — задача не считается решённой и не оплачивается.',
  },
  {
    icon: ChatsCircle,
    title: 'Чат, когда нужно понять',
    text: 'Отдельный ИИ-чат на три модели: спросить, почему шаг именно такой, разобрать тему заново, показать фото или поискать в интернете.',
  },
  {
    icon: ClockCounterClockwise,
    title: 'Решения не теряются',
    text: 'Каждая решённая задача остаётся в разделе «Мои решения». Открыть её снова можно в любой момент — платить второй раз не нужно.',
  },
]

const subjects = [
  'Математика', 'Алгебра', 'Геометрия', 'Физика', 'Химия', 'Биология', 'Информатика',
  'Русский язык', 'Литература', 'Английский язык', 'История', 'Обществознание', 'География', 'Астрономия',
]

const faqs = [
  {
    question: 'Нужен ли учебник из какого-то списка?',
    answer: 'Нет. Условие приносишь ты — фотографией или текстом, поэтому подойдёт любой учебник, рабочая тетрадь, карточка от учителя или свой вариант. Ничего искать в чужой базе не нужно.',
  },
  {
    question: 'Нужна ли регистрация?',
    answer: 'Первое решение выдаётся без аккаунта — просто впиши условие и нажми «Решить». Аккаунт нужен со второго: решение привязывается к балансу и остаётся в истории. Войти можно через Google или по почте, и сразу после регистрации на счёте 20 ₽ — это ещё четыре решения.',
  },
  {
    question: 'Сколько это стоит?',
    answer: 'Первое решение бесплатное и без регистрации. Дальше 5 ₽ за задачу, одинаково для всех предметов и обоих способов ввода. Ответ в ИИ-чате — от 20 копеек. Расписание бесплатное. Стартовых 20 ₽ хватает ещё на четыре решения.',
  },
  {
    question: 'А если решение окажется неверным?',
    answer: 'В каждом решении есть кнопка «Сообщить об ошибке»: условие, ход решения и данные задачи уходят в поддержку целиком, разбираться не придётся. Если задача не прошла внутреннюю проверку, она не выдаётся вовсе, и деньги остаются на балансе.',
  },
  {
    question: 'Сколько ждать решение?',
    answer: 'Обычно несколько секунд: задача идёт через три-четыре прохода модели. Страницу лучше оставить открытой — статус обновится сам, а готовое решение останется в разделе «Мои решения».',
  },
  {
    question: 'Что происходит с моими данными?',
    answer: 'Фотография и условие уходят только на разбор задачи. Расписание хранится в браузере и синхронизируется с твоим аккаунтом. Данные школьных платформ мы не запрашиваем и рекламные cookie не используем — подробности в политике данных.',
  },
]

/* Аккордеон: открыт ровно один вопрос. Раскрытие и закрытие идут по высоте
   содержимого, поэтому соседние вопросы не прыгают, а плавно смещаются. */
function FaqItem({
  question,
  answer,
  index,
  open,
  onToggle,
}: {
  question: string
  answer: string
  index: number
  open: boolean
  onToggle: () => void
}) {
  const reduceMotion = useReducedMotion()

  return (
    <div className={`faq-item${open ? ' is-open' : ''}`}>
      <h3>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`faq-answer-${index}`}>
          <span>{question}</span>
          <Plus size={18} weight="bold" aria-hidden="true" />
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="faq-answer"
            id={`faq-answer-${index}`}
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { height: 0 } : { height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.36, ease: [0.16, 1, 0.3, 1] },
              opacity: { duration: open ? 0.28 : 0.16, ease: [0.16, 1, 0.3, 1] },
            }}
            style={{ overflow: 'hidden' }}
          >
            <p>{answer}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function FaqList() {
  // Один открытый вопрос за раз: повторное нажатие закрывает и его.
  const [openIndex, setOpenIndex] = useState(0)

  return (
    <div className="faq-list">
      {faqs.map(({ question, answer }, index) => (
        <FaqItem
          key={question}
          question={question}
          answer={answer}
          index={index}
          open={openIndex === index}
          onToggle={() => setOpenIndex((current) => (current === index ? -1 : index))}
        />
      ))}
    </div>
  )
}

export default function LandingPage() {
  const { theme, toggleTheme } = useLandingTheme()
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    setSignedIn(hasStoredSession())
  }, [])

  const scrollToHow = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById('how')
    if (!target) return
    event.preventDefault()
    target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
  }, [])

  return (
    <div className="landing">
      <a className="landing-skip" href="#hero-title">Перейти к содержанию</a>
      <LandingHeader signedIn={signedIn} theme={theme} onToggleTheme={toggleTheme} />

      <main className="landing-main">
        <section className="landing-hero" aria-labelledby="hero-title">
          <span className="hero-grid-field" aria-hidden="true" />
          <div className="landing-shell hero-shell">
            <div className="hero-copy">
              <p className="hero-eyebrow">Домашняя работа по фотографии</p>
              <h1 id="hero-title">Сфоткал. <br />Списал.</h1>
              <p className="hero-lead">
                Homework Copilot решает задачу с фотографии или текста и возвращает её так, как её нужно сдать:
                дано, ход решения, чертёж, ответ. Любой предмет с 5 по 11 класс — учебник неважен,
                условие приносишь ты.
              </p>
              <div className="hero-actions">
                <a className="landing-primary-action" href={appPath}>
                  {signedIn ? 'Открыть приложение' : 'Решить задачу'}
                  <ArrowRight size={18} weight="bold" aria-hidden="true" />
                </a>
                <a className="landing-secondary-action" href="#how" onClick={scrollToHow}>Как это работает</a>
              </div>
              <ul className="hero-facts">
                <li><Check size={15} weight="bold" aria-hidden="true" />Первое решение — бесплатно и без регистрации</li>
                <li><Check size={15} weight="bold" aria-hidden="true" />После регистрации ещё 20 ₽ на счёте — это четыре решения</li>
              </ul>
            </div>

            <HeroPreview />
          </div>
        </section>

        <section className="landing-section landing-compare" aria-labelledby="compare-title">
          <div className="landing-shell">
            <Reveal className="section-head">
              <h2 id="compare-title">Решебник ищет задачу. Мы её решаем.</h2>
              <p className="section-lead">
                ГДЗ — это заранее собранные ответы к конкретным изданиям. Пока твоя задача оттуда,
                всё сходится. Стоит появиться карточке от учителя или своему варианту — искать негде.
              </p>
            </Reveal>

            <div className="compare-table" role="table" aria-label="Решебник и Homework Copilot">
              <div className="compare-head" role="row">
                <span role="columnheader" />
                <span role="columnheader">Решебник</span>
                <span role="columnheader" className="is-ours">Homework&nbsp;Copilot</span>
              </div>
              {comparison.map((row, index) => (
                <CompareRow key={row.question} row={row} index={index} />
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section landing-film" aria-labelledby="film-title">
          <div className="landing-shell">
            <Reveal className="section-head">
              <h2 id="film-title">Двадцать секунд — и понятно, что это</h2>
            </Reveal>
            <Reveal className="film-frame" delay={80}>
              <PromoFilm />
            </Reveal>
          </div>
        </section>

        <section className="landing-section landing-how" id="how" aria-labelledby="how-title">
          <div className="landing-shell">
            <Reveal className="section-head">
              <h2 id="how-title">Три шага от фотографии до тетради</h2>
            </Reveal>

            <ol className="how-steps">
              {steps.map(({ icon: Icon, title, text }, index) => (
                <Reveal as="li" key={title} className="how-step" delay={index * 90}>
                  <Icon size={26} weight="duotone" aria-hidden="true" />
                  <h3>{title}</h3>
                  <p>{text}</p>
                </Reveal>
              ))}
            </ol>

            <Reveal className="how-proof" delay={120}>
              <div className="how-proof-copy">
                <h3>Готовая страница, а не абзац текста</h3>
                <p>
                  Так выглядит решение той самой задачи из первого экрана: условие разложено на «дано» и «найти»,
                  чертёж построен по данным, каждый шаг записан отдельной строкой, ответ выделен.
                </p>
                <a className="landing-inline-action" href={appPath}>
                  Попробовать на своей задаче
                  <ArrowRight size={16} weight="bold" aria-hidden="true" />
                </a>
              </div>
              <div className="how-proof-visual"><NotebookPreview /></div>
            </Reveal>
          </div>
        </section>

        <section className="landing-section landing-features" id="features" aria-labelledby="features-title">
          <div className="landing-shell">
            <Reveal className="section-head">
              <h2 id="features-title">Сделано под то, как сдают домашку</h2>
            </Reveal>

            <dl className="feature-list">
              {features.map(({ title, text }, index) => (
                <Reveal key={title} className="feature-row" delay={index * 60}>
                  <dt>{title}</dt>
                  <dd>{text}</dd>
                </Reveal>
              ))}
            </dl>

            <Reveal className="subject-band" delay={60}>
              <h3>14 предметов, с 5 по 11 класс</h3>
              <ul>
                {subjects.map((subject) => <li key={subject}>{subject}</li>)}
              </ul>
            </Reveal>
          </div>
        </section>

        <section className="landing-section landing-showcase" aria-labelledby="showcase-title">
          <div className="landing-shell">
            <Reveal className="section-head">
              <h2 id="showcase-title">Не только решение задачи</h2>
            </Reveal>

            <div className="showcase-grid">
              <Reveal className="showcase-card is-wide">
                <div className="showcase-copy">
                  <h3>Разбор со школьными значками</h3>
                  <p>Русский и литература приходят размеченными: члены предложения подчёркнуты, морфемы отмечены, под записью — условные обозначения.</p>
                </div>
                <AnalysisPreview />
              </Reveal>

              <Reveal className="showcase-card" delay={70}>
                <div className="showcase-copy">
                  <h3>ИИ-чат по домашке</h3>
                  <p>Спросить, почему шаг именно такой. Три модели на выбор, ответ от 20 копеек, можно приложить фото.</p>
                </div>
                <ChatPreview />
              </Reveal>

              <Reveal className="showcase-card" delay={140}>
                <div className="showcase-copy">
                  <h3>Расписание с фотографии</h3>
                  <p>Снимок доски превращается в редактируемое расписание. Работает бесплатно и без аккаунта.</p>
                </div>
                <SchedulePreview />
              </Reveal>
            </div>
          </div>
        </section>

        <section className="landing-section landing-price" id="price" aria-labelledby="price-title">
          <div className="landing-shell">
            <Reveal className="section-head">
              <h2 id="price-title">Платишь за решение, а не за подписку</h2>
            </Reveal>

            <div className="price-grid">
              <Reveal className="price-card is-primary">
                <span className="price-label">Решение задачи</span>
                <strong className="price-value">5 ₽</strong>
                <p>Одна цена для всех предметов и для обоих способов ввода — фото и текста. Не решилось или не прошло проверку — деньги остаются на балансе.</p>
                <a className="landing-primary-action" href={appPath}>
                  {signedIn ? 'Открыть приложение' : 'Решить первую — бесплатно'}
                  <ArrowRight size={17} weight="bold" aria-hidden="true" />
                </a>
              </Reveal>

              <Reveal className="price-side" delay={80}>
                <ul className="price-list">
                  <li>
                    <span><strong>Первое решение</strong><small>Без аккаунта: впиши условие и нажми «Решить»</small></span>
                    <b>бесплатно</b>
                  </li>
                  <li>
                    <span><strong>Старт</strong><small>Начисляются сразу после регистрации</small></span>
                    <b>20 ₽</b>
                  </li>
                  <li>
                    <span><strong>Ответ в ИИ-чате</strong><small>Короткий вопрос упирается в минимальное списание</small></span>
                    <b>от 20 коп</b>
                  </li>
                  <li>
                    <span><strong>Расписание</strong><small>Ввод вручную и распознавание фото</small></span>
                    <b>бесплатно</b>
                  </li>
                  <li>
                    <span><strong>Приглашение друга</strong><small>Как только он подтвердит регистрацию: ему 5 ₽, тебе 10 ₽</small></span>
                    <b>+10 ₽</b>
                  </li>
                </ul>
                <p className="price-note">
                  <CheckCircle size={17} weight="duotone" aria-hidden="true" />
                  Подписки нет. Баланс тратится только на то, что ты запросил.
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        <section className="landing-section landing-faq" id="faq" aria-labelledby="faq-title">
          <div className="landing-shell faq-shell">
            <Reveal className="section-head">
              <h2 id="faq-title">Что обычно спрашивают первым</h2>
            </Reveal>

            <FaqList />
          </div>
        </section>

        <section className="landing-section landing-final" aria-labelledby="final-title">
          <div className="landing-shell">
            <Reveal className="final-card">
              <h2 id="final-title">Задача на завтра? Начни с фотографии.</h2>
              <p>Первое решение — без регистрации. Понравится — заведёшь аккаунт, и на счёт придут 20 ₽ ещё на четыре задачи.</p>
              <div className="final-actions">
                <a className="landing-primary-action" href={appPath}>
                  {signedIn ? 'Открыть приложение' : 'Решить задачу'}
                  <ArrowRight size={18} weight="bold" aria-hidden="true" />
                </a>
                <a className="landing-secondary-action is-quiet" href="/support#faq">Остались вопросы</a>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
