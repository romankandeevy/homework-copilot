import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import {
  ArrowLeft,
  ArrowRight,
  ChatCircleText,
  CheckCircle,
  CircleNotch,
  CreditCard,
  Lightbulb,
  Lifebuoy,
  PaperPlaneTilt,
  Question,
  ShieldCheck,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import type { Database } from '../lib/database.types'
import { useModalIsolation } from '../lib/useModalIsolation'
import './SupportCenter.css'

export type SupportCategory = 'general' | 'payment' | 'feature' | 'wrong_solution'

export type SupportPrefill = {
  wrongSolution?: {
    textbookId: string
    textbookTitle: string
    subject: string
    grade: string
    edition: string
    source: 'number' | 'photo'
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
  { id: 'feature', title: 'Идея для сервиса', copy: 'Предложение, которое сделает учёбу удобнее.', icon: Lightbulb },
  { id: 'wrong_solution', title: 'Решение неверное', copy: 'Разберём условие и найденную ошибку.', icon: WarningCircle },
]

const faqs = [
  { question: 'Как открыть решение задачи?', answer: 'Выбери учебник, введи номер до четырёх цифр и проверь найденное условие. Номерная задача запускается только после сверки с выбранным изданием.' },
  { question: 'Почему баланс изменился?', answer: 'В истории аккаунта видны все списания и начисления. Решение по фото и номерная задача могут иметь разную стоимость — она показана до запуска.' },
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

function SiteFooter({ onOpenSupport }: { onOpenSupport?: () => void }) {
  return (
    <footer className="site-footer">
      <div className="site-footer-brand"><span className="site-footer-mark" aria-hidden="true">HC</span><span><strong>Homework Copilot</strong><small>Помощь с задачами — с проверкой и контекстом.</small></span></div>
      <nav className="site-footer-links" aria-label="Ссылки сайта">
        <a href="/main">Главная</a>
        <a href="/solutions">Решения</a>
        <a href="/cdz">ЦДЗ</a>
        {onOpenSupport ? <button type="button" onClick={onOpenSupport}>Поддержка</button> : <a href="/support">Поддержка</a>}
        <a href="/privacy">Политика</a>
        <a href="/terms">Условия</a>
      </nav>
      <span className="site-footer-copy">© 2026</span>
    </footer>
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

  useEffect(() => { void refreshConversations() }, [refreshConversations])

  useEffect(() => {
    if (!selectedId || !supabaseClient) return
    void refreshMessages(selectedId)
    const channel = supabaseClient
      .channel(`support:${selectedId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_messages', filter: `conversation_id=eq.${selectedId}` }, () => {
        void refreshMessages(selectedId)
        void refreshConversations()
      })
      .subscribe()
    return () => { void supabaseClient.removeChannel(channel) }
  }, [refreshConversations, refreshMessages, selectedId, supabaseClient])

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

  return (
    <div className="support-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} className="support-center" role="dialog" aria-modal="true" aria-labelledby="support-center-title" tabIndex={-1}>
        <header className="support-center-header">
          <div className="support-center-title"><span className="support-center-icon"><Lifebuoy size={24} weight="duotone" aria-hidden="true" /></span><div><span>Центр помощи</span><h1 id="support-center-title">Разберёмся вместе</h1></div></div>
          <button ref={initialFocusRef} className="support-close" type="button" onClick={onClose} aria-label="Закрыть поддержку"><X size={21} weight="bold" aria-hidden="true" /></button>
        </header>

        <div className="support-center-body">
          {!user ? (
            <section className="support-auth-gate"><ShieldCheck size={34} weight="duotone" aria-hidden="true" /><div><h2>Поддержка в аккаунте</h2><p>Войди, чтобы отправить обращение и увидеть ответ владельца в этой переписке.</p><button className="support-primary-button" type="button" onClick={onRequireAuth}>Войти в аккаунт <ArrowRight size={17} weight="bold" aria-hidden="true" /></button></div></section>
          ) : (
            <>
              <div className="support-center-intro"><div><span className="support-kicker">Личные обращения</span><h2>{selectedConversation && !showNew ? selectedConversation.subject : 'Чем помочь?'}</h2><p>{selectedConversation && !showNew ? 'Ответ владельца появится здесь и продублируется в статусе обращения.' : 'Выбери тему, опиши ситуацию — мы сохраним переписку в твоём аккаунте.'}</p></div>{selectedConversation && !showNew && <button className="support-back-button" type="button" onClick={() => { setShowNew(true); setSelectedId(null); setNotice(''); setError('') }}><ArrowLeft size={16} weight="bold" aria-hidden="true" /> Все обращения</button>}</div>

              {showNew ? (
                <>
                  <div className="support-category-grid" role="list" aria-label="Тема обращения">
                    {categories.map(({ id, title, copy, icon: Icon }) => <button key={id} className={`support-category-card${category === id ? ' is-selected' : ''}`} type="button" onClick={() => setCategory(id)} aria-pressed={category === id}><Icon size={23} weight="duotone" aria-hidden="true" /><span><strong>{title}</strong><small>{copy}</small></span>{category === id && <CheckCircle className="support-category-check" size={19} weight="fill" aria-hidden="true" />}</button>)}
                  </div>
                  {category === 'wrong_solution' && initialContext?.wrongSolution && <div className="support-context-note"><WarningCircle size={19} weight="duotone" aria-hidden="true" /><p><strong>Контекст решения приложится автоматически.</strong><span>Условие, найденное решение и данные учебника уже будут в обращении.</span></p></div>}
                  {category === 'payment' && <div className="support-context-note is-payment"><CreditCard size={19} weight="duotone" aria-hidden="true" /><p><strong>Мы проверим баланс и историю операций.</strong><span>Платежи пока не подключены, поэтому автоматический возврат не выполняется.</span></p></div>}
                  <form className="support-compose" onSubmit={submitMessage}><label htmlFor="support-new-message">Сообщение</label><textarea id="support-new-message" value={messageText} onChange={(event) => setMessageText(event.target.value.slice(0, 4000))} placeholder="Опиши, что произошло…" maxLength={4000} autoFocus /><div className="support-compose-footer"><span>{messageText.length}/4000</span><button className="support-primary-button" type="submit" disabled={sending || !messageText.trim()}>{sending ? <><CircleNotch size={17} className="support-spinner" aria-hidden="true" /> Отправляем…</> : <>Отправить <PaperPlaneTilt size={16} weight="bold" aria-hidden="true" /></>}</button></div></form>
                  <section className="support-history" aria-labelledby="support-history-title"><header><div><span className="support-kicker">История</span><h3 id="support-history-title">Твои обращения</h3></div><span>{loading ? 'Загружаем…' : conversations.length}</span></header>{conversations.length ? <div className="support-conversation-list">{conversations.map((conversation) => <button type="button" key={conversation.id} onClick={() => openConversation(conversation.id)}><span className={`support-status-dot is-${conversation.status}`} /><span className="support-conversation-copy"><strong>{conversation.subject}</strong><small>{conversation.context && typeof conversation.context === 'object' && 'wrongSolution' in conversation.context ? 'Контекст решения приложен' : conversation.category === 'payment' ? 'Проверка баланса и операций' : 'Личное обращение'}</small></span><span className="support-conversation-date">{formatDate(conversation.updated_at)}</span><ArrowRight size={17} weight="bold" aria-hidden="true" /></button>)}</div> : <p className="support-empty">Здесь появятся отправленные обращения.</p>}</section>
                </>
              ) : selectedConversation ? (
                <>
                  <div className="support-message-list" aria-live="polite">{messagesLoading ? <div className="support-loading"><CircleNotch size={22} className="support-spinner" aria-hidden="true" /> Загружаем переписку…</div> : messages.map((message) => <article className={`support-message${message.author_type === 'owner' ? ' is-owner' : ' is-user'}`} key={message.id}><div className="support-message-meta"><strong>{message.author_type === 'owner' ? 'Владелец' : 'Ты'}</strong><time dateTime={message.created_at}>{formatDate(message.created_at)}</time></div><p>{message.body}</p></article>)}</div>
                  <form className="support-compose support-compose-followup" onSubmit={submitMessage}><label htmlFor="support-followup-message">Новое сообщение</label><textarea id="support-followup-message" value={messageText} onChange={(event) => setMessageText(event.target.value.slice(0, 4000))} placeholder="Напиши уточнение…" maxLength={4000} /><div className="support-compose-footer"><span>{messageText.length}/4000</span><button className="support-primary-button" type="submit" disabled={sending || !messageText.trim()}>{sending ? 'Отправляем…' : <>Отправить <PaperPlaneTilt size={16} weight="bold" aria-hidden="true" /></>}</button></div></form>
                </>
              ) : null}
            </>
          )}

          {(error || notice) && <p className={`support-feedback${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</p>}

          <section className="support-faq" aria-labelledby="support-faq-title"><header><div><span className="support-kicker">Быстрые ответы</span><h2 id="support-faq-title">FAQ</h2></div><Question size={23} weight="duotone" aria-hidden="true" /></header><div className="support-faq-list">{faqs.map((faq, index) => <div className={`support-faq-item${faqOpen === index ? ' is-open' : ''}`} key={faq.question}><button type="button" onClick={() => setFaqOpen(faqOpen === index ? null : index)} aria-expanded={faqOpen === index}><span>{faq.question}</span><ArrowRight size={17} weight="bold" aria-hidden="true" /></button>{faqOpen === index && <p>{faq.answer}</p>}</div>)}</div></section>
        </div>
      </section>
    </div>
  )
}

export { SiteFooter, SupportLauncher }
