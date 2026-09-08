/* Публичная витрина продукта.
   Это первое, что видит человек, никогда не слышавший о Homework Copilot.
   Рабочая часть продукта живёт на `/app` и здесь только показывается.

   Всё, что заявлено на этой странице, проверяется по коду:
   цена решения - `src/lib/solutionPricing.ts`, стартовые 20 ₽ и бонусы за
   приглашение - миграции кошелька, проход модели и проверка правилами -
   `server/homeworkSolver.ts`, чертёж - `GeometryNotebookLayoutV1`,
   значки разбора - `src/solution/WrittenAnalysis.tsx`, предметы и классы -
   `src/CopyTask.tsx`. Ничего сверх этого страница не обещает. */

import { useCallback, useEffect, useState } from 'react'
import {
  ArrowRight,
  CameraPlus,
  ChatsCircle,
  Check,
  CheckCircle,
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
import { AnalysisPreview, NotebookPreview, SchedulePreview } from './LandingPreviews'
import './LandingPage.css'

const appPath = '/app'
const signInPath = '/app?auth=signin'
const themeStorageKey = 'homework-copilot:theme'

type Theme = 'light' | 'dark'

const sections = [
  { id: 'how', label: 'Как это работает' },
  { id: 'features', label: 'Возможности' },
  { id: 'price', label: 'Цена' },
  { id: 'faq', label: 'Вопросы' },
] as const

/* `matchMedia` есть не в каждой среде - в jsdom его нет вовсе. Без проверки
   витрина падала бы при первом же рендере вне браузера. */
function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/* Вход определяем по ключу сессии Supabase в localStorage. Тянуть ради
   этого клиент Supabase в первый чанк витрины незачем: страница ничего
   не запрашивает от имени пользователя, ей нужно только выбрать надпись
   на кнопке - «Начать» или «Открыть приложение». */
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

   Наблюдатель один на всю страницу (по одному на каждое поле обзора), а не
   свой на каждый блок: на длинной витрине их набиралось больше двадцати.
   Само движение отдано CSS-переходам - оно считается на композиторе и не
   требует библиотеки анимаций в первом чанке. */
const revealMargin = '0px 0px -12% 0px'
const compareMargin = '0px 0px -15% 0px'

const inViewObservers = new Map<string, IntersectionObserver>()
const inViewCallbacks = new WeakMap<Element, () => void>()

function observeOnce(element: Element, margin: string, onEnter: () => void) {
  let observer = inViewObservers.get(margin)
  if (!observer) {
    observer = new IntersectionObserver((entries, self) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        inViewCallbacks.get(entry.target)?.()
        inViewCallbacks.delete(entry.target)
        self.unobserve(entry.target)
      }
    }, { rootMargin: margin })
    inViewObservers.set(margin, observer)
  }
  inViewCallbacks.set(element, onEnter)
  observer.observe(element)
  const active = observer
  return () => {
    inViewCallbacks.delete(element)
    active.unobserve(element)
  }
}

function useInView(margin: string) {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (!element || inView) return
    // Без наблюдателя блок обязан остаться видимым, а не пропасть навсегда.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    return observeOnce(element, margin, () => setInView(true))
  }, [element, inView, margin])

  return { ref: setElement, inView }
}

function Reveal({
  children,
  className = '',
  delay = 0,
  as: Element = 'div',
}: {
  children: React.ReactNode
  className?: string
  delay?: number
  as?: 'div' | 'li' | 'article'
}) {
  const { ref, inView } = useInView(revealMargin)

  return (
    <Element
      ref={ref}
      className={className ? `reveal ${className}` : 'reveal'}
      data-revealed={inView ? 'true' : 'false'}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Element>
  )
}

function CompareRow({ row, index }: { row: (typeof comparison)[number]; index: number }) {
  const { ref, inView } = useInView(compareMargin)

  return (
    <div
      ref={ref}
      className="compare-row"
      role="row"
      data-revealed={inView ? 'true' : 'false'}
      style={{ '--row-delay': `${index * 0.07}s` } as React.CSSProperties}
    >
      <span className="compare-question" role="cell">{row.question}</span>
      <span className="compare-gdz" role="cell">{row.gdz}</span>
      <span className="compare-ours" role="cell">
        {/* Черта дорисовывается под нашим ответом: ею строка и «сходится». */}
        <i aria-hidden="true" className="compare-underline" />
        {row.ours}
      </span>
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

/* Числа первого экрана. Рублей здесь нет намеренно.

   Разбор 8 сентября: на одном экране стояли «от 4 ₽», «после регистрации
   20 ₽ - это ещё пять задач» и «первое решение бесплатно и без аккаунта».
   Человек не понимал, что делать первым - регистрироваться ради двадцати
   рублей или решать бесплатно, - и два обещания конкурировали. Обещание
   первого экрана осталось одно: первая задача бесплатна. Всё про цену -
   в секции «Цена», её источник `src/lib/solutionPricing.ts`.

   Предметы и классы - `src/CopyTask.tsx`, срок - карточка ожидания в
   `SolutionQueue`, право на бесплатное решение - `public.claim_guest_solution`. */
const heroMarks = [
  { value: 'бесплатно', note: 'первая задача, без регистрации' },
  { value: '14', note: 'предметов, 5-11 класс' },
  { value: '15-70 с', note: 'обычно занимает разбор' },
]

const steps = [
  {
    icon: CameraPlus,
    title: 'Приносишь условие',
    text: 'Фотография с телефона, скриншот из буфера обмена или текст. Выбираешь предмет - по нему проверяется решение. Класс можно не указывать.',
  },
  {
    icon: ShieldCheck,
    title: 'Сначала объясняем, потом решаем',
    text: 'Разбор обычными словами - что за задача и каким правилом решается - и только под ним готовая запись. Не вышло - не выдаём и деньги не списываем.',
  },
  {
    icon: PencilSimpleLine,
    title: 'Переписываешь в тетрадь',
    text: 'Дано, ход решения по шагам, чертёж и ответ. Формулы записаны по-школьному: дроби косой чертой, степени надстрочными, корень знаком √.',
  },
]

/* Сравнение с решебником. Здесь только различие форматов - то, чем ГДЗ
   является по устройству: заранее собранный ответ под конкретное издание.
   Никаких утверждений о чужом качестве: их нечем подтвердить. */
const comparison = [
  {
    question: 'Где искать задачу',
    gdz: 'В решебнике к своему изданию - если он есть',
    ours: 'Нигде. Условие приносишь ты: фото или текст',
  },
  {
    question: 'Задача из карточки или своего варианта',
    gdz: 'Не найдётся: решебник собран под учебник',
    ours: 'Решается так же, как любая другая',
  },
  {
    question: 'В каком виде',
    gdz: 'Как в книге',
    ours: 'Как запись в тетради - переписывай строкой за строкой',
  },
] as const

/* Четыре карточки, а не шесть плюс ещё три блока рядом.

   Разбор 8 сентября: витрина на телефоне была 10 999 пикселей - тринадцать
   с половиной экранов для человека, которому сдавать завтра. Секции
   «Сделано под то, как сдают домашку» и «Не только решение задачи»
   наполовину пересказывали друг друга и «Три шага». Слиты в одну: чертёж
   ушёл к записи, чат - к сохранённым решениям, значки забрали к себе
   картинку из бывшей витрины возможностей. */
const features = [
  {
    icon: Notebook,
    title: 'Запись, а не голый ответ',
    text: 'Что дано, что найти, каждый шаг с пояснением и вывод. Чертёж строится по условию: треугольники, ромбы, трапеции, окружности - с точками, равными сторонами и прямыми углами на своих местах.',
  },
  {
    icon: PencilSimpleLine,
    title: 'Школьные значки на месте',
    text: 'Подлежащее одной чертой, сказуемое двумя, корень дугой, суффикс крышкой, степень окисления над элементом. Разбор выглядит так, как его ждёт учитель.',
    preview: 'analysis' as const,
  },
  {
    icon: ShieldCheck,
    title: 'Проверка до выдачи',
    text: 'Решение сверяется по правилам предмета, а не отдаётся как есть. Не прошло проверку - задача не считается решённой и не оплачивается.',
  },
  {
    icon: ChatsCircle,
    title: 'Чат рядом, решения не теряются',
    text: 'Спросить, почему шаг именно такой, можно в ИИ-чате - от 20 копеек за ответ. Каждая решённая задача остаётся в «Моих решениях», открыть её снова бесплатно.',
  },
]

const subjects = [
  'Математика', 'Алгебра', 'Геометрия', 'Физика', 'Химия', 'Биология', 'Информатика',
  'Русский язык', 'Литература', 'Английский язык', 'История', 'Обществознание', 'География', 'Астрономия',
]

const faqs = [
  {
    question: 'Нужен ли учебник из какого-то списка?',
    answer: 'Нет. Условие приносишь ты - фотографией или текстом, поэтому подойдёт любой учебник, рабочая тетрадь, карточка от учителя или свой вариант. Ничего искать в чужой базе не нужно.',
  },
  {
    question: 'Нужна ли регистрация?',
    answer: 'Первое решение выдаётся без аккаунта - просто впиши условие и нажми «Решить». Аккаунт нужен со второго: решение привязывается к балансу и остаётся в истории. Войти можно через Google или по почте, и сразу после регистрации на счёте 20 ₽ - это ещё пять задач по минимальной цене.',
  },
  {
    question: 'Сколько это стоит?',
    answer: 'Первое решение бесплатное и без регистрации. Дальше от 4 ₽ за задачу: цену считает сервер по размеру задачи - длинное условие, фотография и счётный предмет дороже, потолок 12 ₽. Цена показана до отправки, и списывается ровно она. Ответ в ИИ-чате - от 20 копеек. Расписание бесплатное.',
  },
  {
    question: 'А если решение окажется неверным?',
    answer: 'В каждом решении есть кнопка «Сообщить об ошибке»: условие, ход решения и данные задачи уходят в поддержку целиком, разбираться не придётся. Если задача не прошла внутреннюю проверку, она не выдаётся вовсе, и деньги остаются на балансе.',
  },
  {
    question: 'Сколько ждать решение?',
    answer: 'Обычно 15-70 секунд: задача уходит одним проходом сильной модели, а запись проверяется кодом по правилам предмета. Страницу можно закрыть - решение сохранится и будет ждать в разделе «Мои решения».',
  },
  {
    question: 'Что происходит с моими данными?',
    answer: 'Фотография и условие уходят только на разбор задачи. Расписание хранится в браузере и синхронизируется с твоим аккаунтом. Данные школьных платформ мы не запрашиваем и рекламные cookie не используем - подробности в политике данных.',
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
  return (
    <div className={`faq-item${open ? ' is-open' : ''}`}>
      <h3>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`faq-answer-${index}`}>
          <span>{question}</span>
          <Plus size={18} weight="bold" aria-hidden="true" />
        </button>
      </h3>
      {/* Ответ не снимается с разметки, а сворачивается строкой сетки: так
          раскрытие считает CSS, а порядок фокуса и разметка не прыгают. */}
      <div className="faq-answer" id={`faq-answer-${index}`}>
        <div className="faq-answer-inner">
          <p>{answer}</p>
        </div>
      </div>
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
          <div className="landing-shell hero-shell">
            <div className="hero-column">
            <div className="hero-copy">
              <p className="hero-eyebrow">Домашняя работа по фотографии</p>
              <h1 id="hero-title">Сфоткал.<br />Понял. Сдал.</h1>
              <p className="hero-lead">
                Приноси условие фотографией или текстом - получаешь готовую запись
                для тетради: дано, ход решения, чертёж, ответ. Любой предмет,
                5-11 класс, учебник неважен.
              </p>
              {/* Действие на первом экране одно. «Как это работает» осталось
                  строкой-ссылкой, а не второй кнопкой того же веса: это
                  указатель вниз по странице, а не выбор, равный главному. */}
              <div className="hero-actions">
                <a className="landing-primary-action" href={appPath}>
                  {signedIn ? 'Открыть приложение' : 'Решить задачу'}
                  <ArrowRight size={18} weight="bold" aria-hidden="true" />
                </a>
                <a className="landing-quiet-action" href="#how" onClick={scrollToHow}>Как это работает</a>
              </div>
              <ul className="hero-facts">
                <li><Check size={15} weight="bold" aria-hidden="true" />Регистрация нужна со второй задачи</li>
                <li><Check size={15} weight="bold" aria-hidden="true" />Не решилась - платить не нужно</li>
              </ul>
            </div>

            {/* Под кнопками было пусто до самой следующей секции. Здесь то,
                что человек всё равно ищет глазами первым: цена, охват,
                сколько ждать. Все четыре числа проверяются по коду. */}
            <dl className="hero-marks">
              {heroMarks.map(({ value, note }) => (
                <div key={note}>
                  <dt>{value}</dt>
                  <dd>{note}</dd>
                </div>
              ))}
            </dl>
            </div>

            {/* Справа от текста пустовало полэкрана. Здесь лежит то, о чём
                обещает заголовок, - сама страница тетради. Ниже, в разделе
                «Как это работает», она же показана крупно и с разбором. */}
            <aside className="hero-aside" aria-hidden="true">
              <NotebookPreview compact />
              <p className="hero-aside-note">Так приходит решение</p>
            </aside>
          </div>
        </section>

        <section className="landing-section landing-compare" aria-labelledby="compare-title">
          <div className="landing-shell">
            <Reveal className="section-head">
              <h2 id="compare-title">Решебник ищет задачу. Мы её решаем.</h2>
              <p className="section-lead">
                ГДЗ - это заранее собранные ответы к конкретным изданиям. Пока твоя задача оттуда,
                всё сходится. Стоит появиться карточке от учителя или своему варианту - искать негде.
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

        <section className="landing-section landing-how" id="how" aria-labelledby="how-title">
          <div className="landing-shell">
            <Reveal className="section-head">
              <h2 id="how-title">Три шага от фотографии до тетради</h2>
            </Reveal>

            <ol className="how-steps">
              {steps.map(({ icon: Icon, title, text }, index) => (
                <Reveal as="li" key={title} className="how-step" delay={index * 90}>
                  <span className="how-step-index">
                    <Icon size={20} weight="duotone" aria-hidden="true" />
                    Шаг {index + 1}
                  </span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </Reveal>
              ))}
            </ol>

            <Reveal className="how-proof" delay={120}>
              <div className="how-proof-copy">
                <h3>Готовая страница, а не абзац текста</h3>
                <p>Ромб ABCD с диагоналями 10 и 24 см - реальная задача, решённая продуктом.</p>
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

            <div className="feature-list">
              {features.map((feature, index) => {
                const Icon = feature.icon
                return (
                  <Reveal key={feature.title} className="feature-row" delay={index * 60}>
                    <Icon size={24} weight="duotone" aria-hidden="true" />
                    <h3>{feature.title}</h3>
                    <p>{feature.text}</p>
                    {feature.preview === 'analysis' && <AnalysisPreview />}
                  </Reveal>
                )
              })}
            </div>

            {/* Расписание - самостоятельная бесплатная вещь и не про решение
                задач, поэтому оно стоит отдельным блоком, а не пятой
                карточкой. Своей секции с заголовком второго уровня ему не
                дают: страница и так была длиннее, чем её читают. */}
            <Reveal className="schedule-band" delay={80}>
              <div className="schedule-band-copy">
                <h3>Расписание с фотографии</h3>
                <p>Снимок доски превращается в редактируемое расписание. Бесплатно и без аккаунта.</p>
              </div>
              <SchedulePreview />
            </Reveal>

            <Reveal className="subject-band" delay={60}>
              <h3>14 предметов, 5-11 класс</h3>
              <ul>
                {subjects.map((subject) => <li key={subject}>{subject}</li>)}
              </ul>
            </Reveal>
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
                <strong className="price-value">от 4 ₽</strong>
                <p>
                  Цену считает сервер по размеру задачи: длинное условие, фотография и счётный предмет дороже,
                  потолок - 12 ₽. Она показана до отправки, и списывается ровно она. Не решилось или не прошло
                  проверку - деньги остаются на балансе.
                </p>
                <a className="landing-primary-action" href={appPath}>
                  {signedIn ? 'Открыть приложение' : 'Решить первую - бесплатно'}
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
                    <span><strong>Приглашение друга</strong><small>Когда он пополнит баланс в первый раз: ему 5 ₽, тебе 10 ₽</small></span>
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
              <p>Первое решение - без регистрации. Понравится - заведёшь аккаунт, и на счёт придут 20 ₽ ещё на пять задач.</p>
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
