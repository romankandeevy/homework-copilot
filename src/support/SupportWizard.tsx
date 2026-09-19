import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ArrowClockwise, ArrowRight, CheckCircle, CircleNotch, PaperPlaneTilt } from '@phosphor-icons/react'
import { answerLabel, guestContactText, instantAnswer, nextStep, supportTopics, ticketBody, topicById } from './supportFlows'
import type { SupportAnswers, SupportTopicId, TicketCategory } from './supportFlows'

/* Разговор с поддержкой до обращения: тема - уточнения - готовый ответ.
   Сценарии и тексты - supportFlows.ts. Обращение отправляет SupportCenter
   (`onSend`), он же потом показывает переписку с разработчиком. */

type Phase = 'asking' | 'answered' | 'compose' | 'resolved'

function BotBubble({ children }: { children: ReactNode }) {
  return <div className="support-bubble is-bot">{children}</div>
}

function UserBubble({ children }: { children: ReactNode }) {
  return <div className="support-bubble is-user">{children}</div>
}

export function SupportWizard({ signedIn, startTopic, onSend, onRequireAuth }: {
  signedIn: boolean
  startTopic: SupportTopicId | null
  /** Отправляет обращение; ошибка - текст для человека. */
  onSend: (category: TicketCategory, body: string) => Promise<void>
  onRequireAuth: () => void
}) {
  const [topicId, setTopicId] = useState<SupportTopicId | null>(startTopic)
  const [answers, setAnswers] = useState<SupportAnswers>({})
  const [draft, setDraft] = useState('')
  const [phase, setPhase] = useState<Phase>('asking')
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  const topic = topicId ? topicById(topicId) : null
  const step = topic ? nextStep(topic, answers) : null
  const answer = topic && !step ? instantAnswer(topic, answers) : null

  // Все шаги пройдены: известный случай - ответ, остальное - сразу к разработчику.
  useEffect(() => {
    if (phase !== 'asking' || !topic || step) return
    setPhase(answer && answer.escalate !== 'always' ? 'answered' : 'compose')
  }, [answer, phase, step, topic])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [answers, phase, topicId])

  const restart = () => {
    setTopicId(null)
    setAnswers({})
    setDraft('')
    setFailure('')
    setPhase('asking')
  }

  const choose = (stepId: string, value: string) => {
    setAnswers((current) => ({ ...current, [stepId]: value }))
    setDraft('')
  }

  const submitStepText = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!step || step.kind !== 'text' || !draft.trim()) return
    choose(step.id, draft.trim().slice(0, 2000))
  }

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!topic || sending) return
    if (!signedIn) {
      onRequireAuth()
      return
    }
    setSending(true)
    setFailure('')
    try {
      await onSend(topic.category, ticketBody(topic, answers, draft))
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Не получилось отправить. Попробуй ещё раз.')
      setSending(false)
    }
  }

  // Переписка до текущего шага: вопрос бота - ответ ученика.
  const transcript: ReactNode[] = []
  if (topic) {
    transcript.push(<UserBubble key="topic">{topic.label}</UserBubble>)
    for (const item of topic.steps) {
      if (!(item.id in answers)) break
      transcript.push(<BotBubble key={`${item.id}-q`}>{item.question}</BotBubble>)
      transcript.push(<UserBubble key={`${item.id}-a`}>{answerLabel(item, answers[item.id])}</UserBubble>)
    }
  }

  const detailsHint = answer?.detailsHint
  // Готовый ответ не помог - без описания разработчику не с чем работать.
  // Случай «сразу к человеку» (проверка, возврат, идея) уже описан шагами.
  const composeNeedsText = answer?.escalate !== 'always'

  return (
    <section className="support-chat" aria-label="Разговор с поддержкой">
      <div className="support-chat-log" aria-live="polite">
        <BotBubble>Привет! Что случилось? Выбери тему - подскажу сразу или передам разработчику.</BotBubble>

        {!topic && (
          <div className="support-chips" role="group" aria-label="Тема">
            {supportTopics.map((item) => <button key={item.id} type="button" className="support-chip" onClick={() => setTopicId(item.id)}>{item.label}</button>)}
          </div>
        )}

        {transcript}

        {step && <BotBubble>{step.question}</BotBubble>}
        {step?.kind === 'choice' && (
          <div className="support-chips" role="group" aria-label={step.question}>
            {step.options.map((option) => <button key={option.id} type="button" className="support-chip" onClick={() => choose(step.id, option.id)}>{option.label}</button>)}
          </div>
        )}

        {answer && phase !== 'asking' && (
          <BotBubble>
            <p>{answer.text}</p>
            {answer.links && <p className="support-bubble-links">{answer.links.map((link) => <a key={link.href} href={link.href}>{link.label} <ArrowRight size={14} weight="bold" aria-hidden="true" /></a>)}</p>}
          </BotBubble>
        )}

        {phase === 'answered' && (
          <>
            <BotBubble>Помогло?</BotBubble>
            <div className="support-chips" role="group" aria-label="Помог ли ответ">
              <button type="button" className="support-chip is-primary" onClick={() => setPhase('resolved')}>Да, спасибо</button>
              <button type="button" className="support-chip" onClick={() => setPhase('compose')}>Нет, написать разработчику</button>
            </div>
          </>
        )}

        {phase === 'resolved' && (
          <>
            <UserBubble>Да, спасибо</UserBubble>
            <BotBubble><p className="support-bubble-done"><CheckCircle size={18} weight="fill" aria-hidden="true" /> Отлично! Если что-то ещё - начни заново.</p></BotBubble>
          </>
        )}

        {phase === 'compose' && answer && answer.escalate !== 'always' && <UserBubble>Нет, написать разработчику</UserBubble>}
        {phase === 'compose' && <BotBubble>{signedIn ? 'Отправлю разработчику всё, что ты выбрал. Ответ придёт сюда, в этот чат, обычно в течение одного-двух рабочих дней.' : 'Чтобы получить ответ разработчика в чате, войди в аккаунт.'}</BotBubble>}
        <div ref={endRef} />
      </div>

      {step?.kind === 'text' && (
        <form className="support-chat-input" onSubmit={submitStepText}>
          <label className="sr-only" htmlFor="support-step-text">{step.question}</label>
          <textarea id="support-step-text" value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 2000))} placeholder={step.placeholder} rows={3} autoFocus />
          <button className="support-primary-button" type="submit" disabled={!draft.trim()} aria-label="Ответить"><ArrowRight size={17} weight="bold" aria-hidden="true" /></button>
        </form>
      )}

      {phase === 'compose' && (
        signedIn ? (
          <form className="support-chat-input" onSubmit={(event) => { void send(event) }}>
            <label className="sr-only" htmlFor="support-ticket-extra">Подробности для разработчика</label>
            <textarea
              id="support-ticket-extra"
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, 2000))}
              placeholder={detailsHint ?? (composeNeedsText ? 'Опиши, что не получилось' : 'Добавь что-нибудь, если хочешь - или просто отправь')}
              rows={3}
            />
            <button className="support-primary-button" type="submit" disabled={sending || (composeNeedsText && !draft.trim())}>
              {sending ? <><CircleNotch size={17} className="support-spinner" aria-hidden="true" /> Отправляем…</> : <>Отправить <PaperPlaneTilt size={16} weight="bold" aria-hidden="true" /></>}
            </button>
          </form>
        ) : (
          <div className="support-chat-guest">
            <button className="support-primary-button" type="button" onClick={onRequireAuth}>Войти в аккаунт <ArrowRight size={17} weight="bold" aria-hidden="true" /></button>
            <p>{guestContactText}</p>
          </div>
        )
      )}

      {failure && <p className="support-feedback is-error" role="alert">{failure}</p>}

      {topic && (
        <button type="button" className="support-restart" onClick={restart}><ArrowClockwise size={15} weight="bold" aria-hidden="true" /> Начать заново</button>
      )}
    </section>
  )
}
