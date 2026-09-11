import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { RealtimeChannel, SupabaseClient, User } from '@supabase/supabase-js'
import {
  ArrowLeft,
  ArrowRight,
  ChatCircleText,
  CheckCircle,
  Checks,
  CircleNotch,
  CreditCard,
  Lightbulb,
  Lifebuoy,
  PaperPlaneTilt,
  Question,
  ShieldCheck,
  Star,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import type { Database } from '../lib/database.types'
import { useModalIsolation } from '../lib/useModalIsolation'
import './SupportCenter.css'

export type SupportCategory = 'general' | 'payment' | 'feature' | 'wrong_solution'

// Тот же адрес, что в юридических документах (src/LegalPage.tsx).
const supportEmail = 'roman.kandeevy@gmail.com'

export type SupportPrefill = {
  wrongSolution?: {
    textbookId: string
    textbookTitle: string
    subject: string
    grade: string
    edition: string
    source: 'number' | 'photo' | 'text'
    task: string
    condition: string
    given: string[]
    goal: { title: string; text: string }
    steps: string[]
    answer?: string
    sourceUrl?: string
    sourcePage?: number
  }
}

type SupportConversation = Database['public']['Tables']['support_conversations']['Row']
type SupportMessage = Database['public']['Tables']['support_messages']['Row']

type SupportCenterProps = {
  user: User | null
  supabaseClient: SupabaseClient<Database> | null
  initialCategory: SupportCategory
  initialContext?: SupportPrefill
  onRequireAuth: () => void
  onClose: () => void
}

const categories: { id: SupportCategory; title: string; copy: string; icon: typeof Lifebuoy }[] = [
  { id: 'general', title: 'Общий вопрос', copy: 'Как работает сервис или где найти функцию.', icon: Lifebuoy },
  { id: 'payment', title: 'Оплата и баланс', copy: 'Баланс, списание или вопрос по оплате.', icon: CreditCard },
  { id: 'feature', title: 'Идея для сервиса', copy: 'Если идея понравится, начислим 10 ₽ на баланс.', icon: Lightbulb },
  { id: 'wrong_solution', title: 'Решение неверное', copy: 'Разберём условие и найденную ошибку.', icon: WarningCircle },
]

const faqs = [
  { question: 'Как получить решение задачи?', answer: 'Впиши условие на главной или приложи фотографию задачи, выбери предмет и нажми «Решить». Предмет обязателен: по нему решение проверяется — единица измерения при ответе, разбор по составу, уравненная реакция. Класс можно не указывать. Готовое решение останется в разделе «Мои решения».' },
  { question: 'Почему баланс изменился?', answer: 'В истории аккаунта видны все списания и начисления. Решение задачи стоит от 4 ₽: цену считает сервер по размеру задачи — длинное условие, фотография и счётный предмет дороже. Она показана над формой до запуска, и списывается ровно она. Ответ в ИИ-чате списывается отдельно и по факту.' },
  { question: 'Как работают приглашения?', answer: 'В разделе баланса у каждого есть личная ссылка. Когда новый пользователь зарегистрируется по ней и впервые пополнит баланс, пригласившему начислят 10 ₽, а приглашённому — 5 ₽. Для существующих аккаунтов бонус не действует.' },
  { question: 'Что делать, если решение кажется неверным?', answer: 'Открой решение и нажми «Сообщить об ошибке». В обращение автоматически попадут полное условие, решение и данные задачи, чтобы владелец мог быстро проверить результат.' },
  { question: 'Можно ли восстановить доступ к аккаунту?', answer: 'Если вход не получается, используй восстановление пароля в окне аккаунта. Для других случаев напиши в поддержку — ответ владельца появится здесь.' },
]

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'только что'
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}

function errorMessage(message: string) {
  if (message.includes('Сессия') || message.includes('Войди')) return message
  return 'Не получилось отправить сообщение. Попробуй ещё раз.'
}

async function accessToken(client: SupabaseClient<Database>) {
  const { data, error } = await client.auth.getSession()
  if (error || !data.session?.access_token) throw new Error('Сессия закончилась. Войди в аккаунт ещё раз')
  return data.session.access_token
}

function SupportLauncher({ onClick }: { onClick: () => void }) {
  return (
    <button className="support-launcher" type="button" onClick={onClick} aria-label="Открыть поддержку">
      <ChatCircleText size={22} weight="duotone" aria-hidden="true" />
      <span>Поддержка</span>
    </button>
  )
}

/* Подвал двух видов.

   Полный - на витрине и на страницах документов: там он и есть содержание
   страницы. В рабочем приложении он был вреден: замер 8 сентября на экране
   375×812 дал 998 пикселей подвала при вьюпорте 812. Человек открыл
   приложение решить задачу, а под ней развёрнут портал с пятью документами
   и вторым меню, повторяющим нижнюю панель слово в слово.

   Рабочий подвал - одна строка. Документы никуда не деваются: каждая
   юридическая страница перечисляет все остальные, поэтому одной ссылки
   хватает, чтобы дойти до любой. */
function SiteFooter({ onOpenSupport, compact = false }: { onOpenSupport?: () => void; compact?: boolean }) {
  if (compact) {
    return (
      <footer className="site-footer is-compact">
        <p className="site-footer-disclaimer">Решения помогают разобраться, а не заменяют работу над задачей.</p>
        <nav className="site-footer-compact-links" aria-label="Служебные ссылки">
          <a href="/terms">Документы</a>
          {/* Ссылки на поддержку здесь нет, когда рядом уже висит плавающая
              кнопка: два входа в одно окно на одном экране - это дубль. */}
          {onOpenSupport && <button type="button" onClick={onOpenSupport}>Поддержка</button>}
          <span>© 2026 Homework Copilot</span>
        </nav>
      </footer>
    )
  }

  return (
    <footer className="site-footer">
      <div className="site-footer-hero">
        <a className="site-footer-brand" href="/">
          <span className="site-footer-monogram" aria-hidden="true"><span>H</span><span>C</span></span>
          <span className="site-footer-brand-copy">
            <strong><span>Homework</span><span>Copilot</span></strong>
            <small>Понятная домашняя работа</small>
          </span>
        </a>

        <section className="site-footer-support" aria-labelledby="site-footer-support-title">
          <div>
            <span className="site-footer-eyebrow">Поддержка</span>
            <h2 id="site-footer-support-title">Помощь рядом</h2>
            <p>Ответим прямо в личном кабинете</p>
          </div>
          {onOpenSupport ? (
            <button className="site-footer-support-action" type="button" onClick={onOpenSupport}>
              Написать в поддержку
              <ArrowRight size={18} weight="bold" aria-hidden="true" />
            </button>
          ) : (
            <a className="site-footer-support-action" href="/support">
              Написать в поддержку
              <ArrowRight size={18} weight="bold" aria-hidden="true" />
            </a>
          )}
        </section>
      </div>

      <div className="site-footer-directory">

        <nav className="site-footer-column" aria-label="Сервис">
          <h2>Сервис</h2>
          {/* Только запущенное. «ЦДЗ» отсюда убран: пункт обещал учебники,
              которых в продукте нет, и вёл на заглушку «раздел закрыт». */}
          <a href="/app">Решить задачу</a>
          <a href="/solutions">Решения</a>
          <a href="/chat">ИИ-чат</a>
          <a href="/schedule">Расписание</a>
        </nav>

        {/* «Написать в поддержку» стояло в подвале дважды: крупной кнопкой
            в блоке «Помощь рядом» и строкой здесь, в двадцати сантиметрах
            друг от друга. Кнопка выше заметнее, строка ушла. */}
        <nav className="site-footer-column" aria-label="Помощь">
          <h2>Помощь</h2>
          <a href="/support#faq">Частые вопросы</a>
        </nav>

        <nav className="site-footer-column site-footer-column-documents" aria-label="Документы">
          <h2>Документы</h2>
          <a href="/terms">Пользовательское соглашение</a>
          <a href="/privacy">Политика данных</a>
          <a href="/consent">Согласие на обработку данных</a>
          <a href="/cookies">Cookie и хранилище</a>
          <a href="/offer">Публичная оферта</a>
        </nav>
      </div>
      <div className="site-footer-meta">
        <span>© 2026 Homework Copilot</span>
        <span className="site-footer-disclaimer">Решения помогают разобраться, а не заменяют работу над задачей.</span>
      </div>
    </footer>
  )
}

/* «Печатает» в обе стороны: канал support-typing:<id> общий с админкой.
   Канал с тем же именем клиент отдаёт повторно, поэтому прежний, ещё не
   закрытый канал снимаем до подписки - иначе новая подписка молча не
   сработает. */
function useSupportTyping(client: SupabaseClient<Database> | null, conversationId: string | null) {
  const channelRef = useRef<RealtimeChannel | null>(null)
  const lastSentRef = useRef(0)
  const [peer, setPeer] = useState<{ id: string; at: number } | null>(null)

  useEffect(() => {
    if (!client || !conversationId) return
    const topic = `support-typing:${conversationId}`
    let cancelled = false
    let channel: RealtimeChannel | null = null
    const open = async () => {
      const stale = client.getChannels().find((item) => item.topic === `realtime:${topic}`)
      if (stale) await client.removeChannel(stale)
      if (cancelled) return
      channel = client
        .channel(topic)
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
          if ((payload as { from?: unknown } | null)?.from === 'owner') setPeer({ id: conversationId, at: Date.now() })
        })
        .subscribe()
      channelRef.current = channel
    }
    void open()
    return () => {
      cancelled = true
      channelRef.current = null
      if (channel) void client.removeChannel(channel)
    }
  }, [client, conversationId])

  useEffect(() => {
    if (!peer) return
    const timer = window.setTimeout(() => setPeer(null), Math.max(0, 4000 - (Date.now() - peer.at)))
    return () => window.clearTimeout(timer)
  }, [peer])

  const notifyTyping = useCallback(() => {
    const channel = channelRef.current
    const now = Date.now()
    if (!channel || now - lastSentRef.current < 2000) return
    lastSentRef.current = now
    void channel.send({ type: 'broadcast', event: 'typing', payload: { from: 'user', at: now } })
  }, [])

  const clearPeer = useCallback(() => setPeer(null), [])

  return { peerTyping: peer !== null && peer.id === conversationId, notifyTyping, clearPeer }
}

const ratingLabels = ['', 'Совсем не помогли', 'Плохо', 'Нормально', 'Хорошо', 'Отлично']

/* Оценка закрытого обращения: одна на обращение, после отправки вместо
   формы остаётся поставленная оценка. */
function SupportRating({ conversation, client, onRated }: { conversation: SupportConversation; client: SupabaseClient<Database> | null; onRated: () => void }) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState('')

  if (conversation.rating) {
    const given = conversation.rating
    return (
      <section className="support-rating is-done" aria-label="Оценка обращения">
        <div className="support-rating-stars" role="img" aria-label={`Твоя оценка: ${given} из 5`}>
          {[1, 2, 3, 4, 5].map((value) => <Star key={value} size={20} weight={value <= given ? 'fill' : 'regular'} aria-hidden="true" />)}
          <span className="support-rating-label">{ratingLabels[given]}</span>
        </div>
        <p><strong>Спасибо за оценку.</strong>{conversation.rating_comment && <span>{conversation.rating_comment}</span>}</p>
      </section>
    )
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!client || saving || rating < 1) return
    setSaving(true)
    setFailure('')
    const { error: rateError } = await client.rpc('rate_support_conversation', { p_conversation_id: conversation.id, p_rating: rating, p_comment: comment.trim() || null })
    setSaving(false)
    if (rateError) {
      setFailure('Не получилось сохранить оценку. Попробуй ещё раз.')
      return
    }
    onRated()
  }

  const commentId = `support-rating-comment-${conversation.id}`
  return (
    <form className="support-rating" onSubmit={(event) => { void submit(event) }}>
      <h3>Обращение закрыто. Оцени, как мы помогли</h3>
      <div className="support-rating-stars" role="group" aria-label="Оценка от 1 до 5">
        {[1, 2, 3, 4, 5].map((value) => (
          <button key={value} type="button" className={value <= rating ? 'is-on' : ''} aria-pressed={rating === value} aria-label={`${value} из 5 - ${ratingLabels[value]}`} onClick={() => setRating(value)}>
            <Star size={20} weight={value <= rating ? 'fill' : 'regular'} aria-hidden="true" />
          </button>
        ))}
        {rating > 0 && <span className="support-rating-label">{ratingLabels[rating]}</span>}
      </div>
      <label htmlFor={commentId}>Комментарий - по желанию</label>
      <textarea id={commentId} value={comment} maxLength={500} onChange={(event) => setComment(event.target.value.slice(0, 500))} placeholder="Что было хорошо или что стоит исправить" />
      <div className="support-compose-footer">
        <span>{comment.length}/500</span>
        <button className="support-primary-button" type="submit" disabled={saving || rating < 1}>{saving ? <><CircleNotch size={17} className="support-spinner" aria-hidden="true" /> Сохраняем…</> : 'Отправить оценку'}</button>
      </div>
      {failure && <p className="support-feedback is-error" role="alert">{failure}</p>}
    </form>
  )
}

export function SupportCenter({ user, supabaseClient, initialCategory, initialContext, onRequireAuth, onClose }: SupportCenterProps) {
  const [category, setCategory] = useState<SupportCategory>(initialCategory)
  const [messageText, setMessageText] = useState('')
  const [conversations, setConversations] = useState<SupportConversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [faqOpen, setFaqOpen] = useState<number | null>(null)
  const [showNew, setShowNew] = useState(true)
  const initialFocusRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useModalIsolation<HTMLElement>(true, onClose, initialFocusRef)
  const { peerTyping: ownerTyping, notifyTyping, clearPeer: clearOwnerTyping } = useSupportTyping(supabaseClient, user ? selectedId : null)

  useEffect(() => {
    if (window.location.hash !== '#faq') return
    const frame = window.requestAnimationFrame(() => document.getElementById('faq')?.scrollIntoView({ block: 'start' }))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId],
  )

  const refreshConversations = useCallback(async () => {
    if (!user || !supabaseClient) return
    setLoading(true)
    const { data, error: conversationsError } = await supabaseClient
      .from('support_conversations')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(50)
    if (conversationsError) setError('Не получилось загрузить обращения.')
    else setConversations(data ?? [])
    setLoading(false)
  }, [supabaseClient, user])

  const refreshMessages = useCallback(async (conversationId: string) => {
    if (!supabaseClient) return
    setMessagesLoading(true)
    const { data, error: messagesError } = await supabaseClient
      .from('support_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
    if (messagesError) setError('Не получилось загрузить переписку.')
    else setMessages(data ?? [])
    setMessagesLoading(false)
  }, [supabaseClient])

  // Открытая переписка - прочитанная: поддержка видит это у своих ответов.
  const markRead = useCallback((conversationId: string) => {
    if (!supabaseClient) return
    void supabaseClient.rpc('mark_support_read', { p_conversation_id: conversationId }).then(() => undefined)
  }, [supabaseClient])

  useEffect(() => { void refreshConversations() }, [refreshConversations])

  useEffect(() => {
    if (!selectedId || !supabaseClient) return
    void refreshMessages(selectedId)
    markRead(selectedId)
    const channel = supabaseClient
      .channel(`support:${selectedId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_messages', filter: `conversation_id=eq.${selectedId}` }, (payload) => {
        void refreshMessages(selectedId)
        void refreshConversations()
        if (payload.eventType === 'INSERT' && (payload.new as Partial<SupportMessage>).author_type === 'owner') {
          clearOwnerTyping()
          if (document.visibilityState === 'visible') markRead(selectedId)
        }
      })
      // Прочтение поддержкой и оценка приходят обновлением строки обращения.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'support_conversations', filter: `id=eq.${selectedId}` }, (payload) => {
        const row = payload.new as SupportConversation
        setConversations((current) => current.map((conversation) => (conversation.id === row.id ? { ...conversation, ...row } : conversation)))
      })
      .subscribe()
    // Ответ, пришедший в фоновую вкладку, прочитан, когда её открыли.
    const onVisible = () => { if (document.visibilityState === 'visible') markRead(selectedId) }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void supabaseClient.removeChannel(channel)
    }
  }, [clearOwnerTyping, markRead, refreshConversations, refreshMessages, selectedId, supabaseClient])

  const submitMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user) {
      onRequireAuth()
      return
    }
    if (!supabaseClient || sending || !messageText.trim()) return
    setSending(true)
    setError('')
    setNotice('')
    try {
      const token = await accessToken(supabaseClient)
      const response = await fetch(import.meta.env.VITE_SUPPORT_API_URL || '/api/support', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(selectedId && !showNew ? { conversationId: selectedId } : { category, context: initialContext }),
          body: messageText.trim(),
        }),
      })
      const payload = await response.json() as { error?: string; conversationId?: string; deliveryStatus?: string }
      if (!response.ok && response.status !== 202) throw new Error(payload.error || 'support request failed')
      setMessageText('')
      setNotice(payload.deliveryStatus === 'failed'
        ? 'Обращение сохранено. Владелец увидит его после подключения Telegram.'
        : 'Сообщение отправлено владельцу.')
      await refreshConversations()
      if (payload.conversationId) {
        setSelectedId(payload.conversationId)
        setShowNew(false)
        await refreshMessages(payload.conversationId)
      }
    } catch (submissionError) {
      setError(errorMessage(submissionError instanceof Error ? submissionError.message : ''))
    } finally {
      setSending(false)
    }
  }

  const openConversation = (conversationId: string) => {
    setSelectedId(conversationId)
    setShowNew(false)
    setNotice('')
    setError('')
  }

  const ownerReadAt = selectedConversation?.owner_last_read_at ? Date.parse(selectedConversation.owner_last_read_at) : Number.NaN

  return (
    <div className="support-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} className="support-center" role="dialog" aria-modal="true" aria-labelledby="support-center-title" tabIndex={-1}>
        <header className="support-center-header">
          <div className="support-center-title"><span className="support-center-icon"><Lifebuoy size={24} weight="duotone" aria-hidden="true" /></span><div><span>Центр помощи</span><h1 id="support-center-title">Разберёмся вместе</h1></div></div>
          <button ref={initialFocusRef} className="support-close" type="button" onClick={onClose} aria-label="Закрыть поддержку"><X size={21} weight="bold" aria-hidden="true" /></button>
        </header>

        <div className="support-center-body">
          {!user ? (
            <section className="support-auth-gate"><ShieldCheck size={34} weight="duotone" aria-hidden="true" /><div><h2>Поддержка в аккаунте</h2><p>Войди, чтобы отправить обращение и увидеть ответ владельца в этой переписке.</p><button className="support-primary-button" type="button" onClick={onRequireAuth}>Войти в аккаунт <ArrowRight size={17} weight="bold" aria-hidden="true" /></button>{/* Гость с бесплатным решением аккаунта не имеет, и без этой строки
                пожаловаться на своё решение ему было некуда. */}<p className="support-auth-gate-email">Без аккаунта напиши на <a href={`mailto:${supportEmail}`}>{supportEmail}</a> — приложи условие и полученное решение.</p></div></section>
          ) : (
            <>
              <div className="support-center-intro"><div><span className="support-kicker">Личные обращения</span><h2>{selectedConversation && !showNew ? selectedConversation.subject : 'Чем помочь?'}</h2><p>{selectedConversation && !showNew ? 'Ответ владельца появится здесь и продублируется в статусе обращения.' : 'Выбери тему, опиши ситуацию — мы сохраним переписку в твоём аккаунте.'}</p></div>{selectedConversation && !showNew && <button className="support-back-button" type="button" onClick={() => { setShowNew(true); setSelectedId(null); setNotice(''); setError('') }}><ArrowLeft size={16} weight="bold" aria-hidden="true" /> Все обращения</button>}</div>

              {showNew ? (
                <>
                  <div className="support-category-grid" role="list" aria-label="Тема обращения">
                    {categories.map(({ id, title, copy, icon: Icon }) => <button key={id} className={`support-category-card${category === id ? ' is-selected' : ''}`} type="button" onClick={() => setCategory(id)} aria-pressed={category === id}><Icon size={23} weight="duotone" aria-hidden="true" /><span><strong>{title}</strong><small>{copy}</small></span>{category === id && <CheckCircle className="support-category-check" size={19} weight="fill" aria-hidden="true" />}</button>)}
                  </div>
                  {category === 'wrong_solution' && initialContext?.wrongSolution && <div className="support-context-note"><WarningCircle size={19} weight="duotone" aria-hidden="true" /><p><strong>Контекст решения приложится автоматически.</strong><span>Условие, найденное решение и данные учебника уже будут в обращении.</span></p></div>}
                  {category === 'feature' && <div className="support-context-note is-feature"><Lightbulb size={19} weight="duotone" aria-hidden="true" /><p><strong>За полезную идею начислим 10 ₽.</strong><span>Награда доступна после одобрения владельцем.</span></p></div>}
                  {category === 'payment' && <div className="support-context-note is-payment"><CreditCard size={19} weight="duotone" aria-hidden="true" /><p><strong>Мы проверим баланс и историю операций.</strong><span>Платежи пока не подключены, поэтому автоматический возврат не выполняется.</span></p></div>}
                  <form className="support-compose" onSubmit={submitMessage}><label htmlFor="support-new-message">Сообщение</label><textarea id="support-new-message" value={messageText} onChange={(event) => setMessageText(event.target.value.slice(0, 4000))} placeholder="Опиши, что произошло…" maxLength={4000} autoFocus /><div className="support-compose-footer"><span>{messageText.length}/4000</span><button className="support-primary-button" type="submit" disabled={sending || !messageText.trim()}>{sending ? <><CircleNotch size={17} className="support-spinner" aria-hidden="true" /> Отправляем…</> : <>Отправить <PaperPlaneTilt size={16} weight="bold" aria-hidden="true" /></>}</button></div></form>
                  <section className="support-history" aria-labelledby="support-history-title"><header><div><span className="support-kicker">История</span><h3 id="support-history-title">Твои обращения</h3></div><span>{loading ? 'Загружаем…' : conversations.length}</span></header>{conversations.length ? <div className="support-conversation-list">{conversations.map((conversation) => <button type="button" key={conversation.id} onClick={() => openConversation(conversation.id)}><span className={`support-status-dot is-${conversation.status}`} /><span className="support-conversation-copy"><strong>{conversation.subject}</strong><small>{conversation.context && typeof conversation.context === 'object' && 'wrongSolution' in conversation.context ? 'Контекст решения приложен' : conversation.category === 'payment' ? 'Проверка баланса и операций' : 'Личное обращение'}</small></span><span className="support-conversation-date">{formatDate(conversation.updated_at)}</span><ArrowRight size={17} weight="bold" aria-hidden="true" /></button>)}</div> : <p className="support-empty">Здесь появятся отправленные обращения.</p>}</section>
                </>
              ) : selectedConversation ? (
                <>
                  <div className="support-message-list" aria-live="polite">{messagesLoading ? <div className="support-loading"><CircleNotch size={22} className="support-spinner" aria-hidden="true" /> Загружаем переписку…</div> : <>{messages.map((message) => <article className={`support-message${message.author_type === 'owner' ? ' is-owner' : ' is-user'}`} key={message.id}><div className="support-message-meta"><strong>{message.author_type === 'owner' ? 'Владелец' : 'Ты'}</strong><time dateTime={message.created_at}>{formatDate(message.created_at)}</time></div><p>{message.body}</p>{message.author_type !== 'owner' && ownerReadAt >= Date.parse(message.created_at) && <span className="support-message-read"><Checks size={14} weight="bold" aria-hidden="true" /> Прочитано</span>}</article>)}{ownerTyping && <p className="support-typing" role="status"><span className="support-typing-dots" aria-hidden="true"><i /><i /><i /></span>Поддержка печатает…</p>}</>}</div>
                  {selectedConversation.status === 'resolved' && <SupportRating key={selectedConversation.id} conversation={selectedConversation} client={supabaseClient} onRated={() => { void refreshConversations() }} />}
                  <form className="support-compose support-compose-followup" onSubmit={submitMessage}><label htmlFor="support-followup-message">Новое сообщение</label><textarea id="support-followup-message" value={messageText} onChange={(event) => { setMessageText(event.target.value.slice(0, 4000)); if (event.target.value) notifyTyping() }} placeholder="Напиши уточнение…" maxLength={4000} /><div className="support-compose-footer"><span>{messageText.length}/4000</span><button className="support-primary-button" type="submit" disabled={sending || !messageText.trim()}>{sending ? 'Отправляем…' : <>Отправить <PaperPlaneTilt size={16} weight="bold" aria-hidden="true" /></>}</button></div></form>
                </>
              ) : null}
            </>
          )}

          {(error || notice) && <p className={`support-feedback${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</p>}

          <section id="faq" className="support-faq" aria-labelledby="support-faq-title"><header><div><span className="support-kicker">Быстрые ответы</span><h2 id="support-faq-title">FAQ</h2></div><Question size={23} weight="duotone" aria-hidden="true" /></header><div className="support-faq-list">{faqs.map((faq, index) => <div className={`support-faq-item${faqOpen === index ? ' is-open' : ''}`} key={faq.question}><button type="button" onClick={() => setFaqOpen(faqOpen === index ? null : index)} aria-expanded={faqOpen === index}><span>{faq.question}</span><ArrowRight size={17} weight="bold" aria-hidden="true" /></button>{faqOpen === index && <p>{faq.answer}</p>}</div>)}</div></section>
        </div>
      </section>
    </div>
  )
}

export { SiteFooter, SupportLauncher }
