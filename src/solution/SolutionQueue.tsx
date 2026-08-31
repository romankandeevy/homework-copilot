import { useEffect, useState } from 'react'
import { ArrowClockwise, ArrowRight, Check, CheckCircle, Lifebuoy, SpinnerGap, Trash, WarningCircle } from '@phosphor-icons/react'
import type { SolutionJob } from '../lib/solutionJobs'
import { orderedActiveJobs, solutionStages, stageState } from '../lib/solutionJobs'
import './SolutionQueue.css'

/* Очередь решений на главной.

   Одна карточка на задачу в работе, строка на каждую ожидающую, отдельная
   карточка на готовую и на сорвавшуюся. Всё, что здесь показано, взято из
   строки задачи в базе, поэтому картинка одинакова на всех устройствах и
   переживает перезаход. */

function elapsedLabel(from: string, now: number) {
  const startedAt = Date.parse(from)
  if (!Number.isFinite(startedAt)) return '0:00'
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function elapsedSeconds(from: string, now: number) {
  const startedAt = Date.parse(from)
  if (!Number.isFinite(startedAt)) return 0
  return Math.max(0, Math.floor((now - startedAt) / 1000))
}

function taskLabel(job: SolutionJob) {
  if (job.conditionPreview) return job.conditionPreview
  if (job.source === 'number') return `№ ${job.task}`
  if (job.source === 'photo') return 'Задача с фотографии'
  return job.task
}

function subjectLabel(job: SolutionJob, fallback: string) {
  const parts = [job.subject || fallback, job.grade].filter(Boolean)
  return parts.join(' · ')
}

function SolvingCard({ job, subject, now, mine }: { job: SolutionJob; subject: string; now: number; mine: boolean }) {
  const startedFrom = job.startedAt || job.createdAt
  const seconds = elapsedSeconds(startedFrom, now)
  // Пока решатель не прислал первую отметку, задача уже в работе: запрос ушёл.
  // Показывать при этом четыре пустых шага — значит показывать зависание.
  const stage = job.stage === 'queued' ? 'reading' : job.stage
  // За измеренным потолком перестаём обещать «вот-вот» и говорим прямо.
  const takingLong = seconds >= 75

  return (
    <article className="solve-card is-solving" role="status" aria-live="polite" aria-busy="true">
      <header className="solve-card-head">
        <span className="solve-card-mark" aria-hidden="true">
          <SpinnerGap size={22} weight="bold" />
        </span>
        <div className="solve-card-title">
          <h2>Решаем задачу</h2>
          <p>{subjectLabel(job, subject)}{job.source === 'photo' ? ' · читаем условие с фотографии' : ''}</p>
        </div>
        <time className="solve-card-clock" aria-label={`Идёт ${seconds} секунд`}>{elapsedLabel(startedFrom, now)}</time>
      </header>

      <p className="solve-card-task">{taskLabel(job)}</p>

      <ol className="solve-steps">
        {solutionStages.map((step) => {
          const state = stageState(stage, step.id)
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

      <p className="solve-card-note">
        {!mine
          ? 'Задача запущена на другом устройстве. Решение придёт сюда же, как только будет готово.'
          : takingLong
            ? 'Задача сложная и считается дольше обычного. Не уложимся — деньги вернутся на баланс.'
            : 'Обычно 15–70 секунд. Страницу можно закрыть: решение сохранится и появится здесь.'}
      </p>
    </article>
  )
}

function QueuedRow({ job, subject, position, onDismiss }: {
  job: SolutionJob
  subject: string
  position: number
  onDismiss: (job: SolutionJob) => void
}) {
  return (
    <li className="solve-queued">
      <span className="solve-queued-position" aria-hidden="true">{position}</span>
      <span className="solve-queued-copy">
        <strong>{taskLabel(job)}</strong>
        <small>{subjectLabel(job, subject)} · ждёт очереди</small>
      </span>
      <button type="button" onClick={() => onDismiss(job)} aria-label="Убрать задачу из очереди">
        <Trash size={16} weight="duotone" aria-hidden="true" />
      </button>
    </li>
  )
}

function FailedCard({ job, subject, onRetry, onDismiss, onOpenSupport }: {
  job: SolutionJob
  subject: string
  onRetry: (job: SolutionJob) => void
  onDismiss: (job: SolutionJob) => void
  onOpenSupport: (job: SolutionJob) => void
}) {
  const canceled = job.status === 'canceled'

  return (
    <article className={`solve-card is-failed${canceled ? ' is-canceled' : ''}`} role="alert">
      <header className="solve-card-head">
        <span className="solve-card-mark" aria-hidden="true">
          <WarningCircle size={22} weight="fill" />
        </span>
        <div className="solve-card-title">
          <h2>{canceled ? 'Задача снята с очереди' : 'Решение не дошло'}</h2>
          <p>{subjectLabel(job, subject)}</p>
        </div>
      </header>

      <p className="solve-card-task">{taskLabel(job)}</p>

      {!canceled && <p className="solve-card-reason">{job.error || 'Решатель не справился с этой задачей.'}</p>}

      <p className="solve-card-refund">
        <Check size={14} weight="bold" aria-hidden="true" />
        Деньги за неготовое решение не списаны
      </p>

      <div className="solve-card-actions">
        <button className="solve-action-primary" type="button" onClick={() => onRetry(job)}>
          <ArrowClockwise size={17} weight="bold" aria-hidden="true" />
          Решить ещё раз
        </button>
        {!canceled && (
          <button className="solve-action-quiet" type="button" onClick={() => onOpenSupport(job)}>
            <Lifebuoy size={17} weight="duotone" aria-hidden="true" />
            Написать в поддержку
          </button>
        )}
        <button className="solve-action-quiet" type="button" onClick={() => onDismiss(job)}>Убрать</button>
      </div>
    </article>
  )
}

function ReadyCard({ job, subject, onOpen, onDismiss }: {
  job: SolutionJob
  subject: string
  onOpen: (job: SolutionJob) => void
  onDismiss: (job: SolutionJob) => void
}) {
  return (
    <article className="solve-card is-ready">
      <header className="solve-card-head">
        <span className="solve-card-mark" aria-hidden="true">
          <CheckCircle size={22} weight="fill" />
        </span>
        <div className="solve-card-title">
          <h2>Решение готово</h2>
          <p>{subjectLabel(job, subject)} · оформлено тетрадной страницей</p>
        </div>
      </header>

      <p className="solve-card-task">{taskLabel(job)}</p>

      <div className="solve-card-actions">
        <button className="solve-action-primary" type="button" onClick={() => onOpen(job)}>
          Открыть решение
          <ArrowRight size={17} weight="bold" aria-hidden="true" />
        </button>
        <button className="solve-action-quiet" type="button" onClick={() => onDismiss(job)}>Убрать</button>
      </div>
    </article>
  )
}

export function SolutionQueue({
  jobs,
  deviceId,
  subjectOf,
  onOpen,
  onRetry,
  onDismiss,
  onOpenSupport,
}: {
  jobs: readonly SolutionJob[]
  deviceId: string
  subjectOf: (textbookId: string) => string
  onOpen: (job: SolutionJob) => void
  onRetry: (job: SolutionJob) => void
  onDismiss: (job: SolutionJob) => void
  onOpenSupport: (job: SolutionJob) => void
}) {
  const active = orderedActiveJobs(jobs)
  const running = active.filter((job) => job.status === 'running')
  const waiting = active.filter((job) => job.status === 'queued')
  const finished = jobs.filter((job) => job.status !== 'queued' && job.status !== 'running')
  const [now, setNow] = useState(() => Date.now())

  // Секундомер один на всю очередь: отдельный таймер в каждой карточке
  // перерисовывал бы их вразнобой.
  useEffect(() => {
    if (running.length === 0) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running.length])

  if (jobs.length === 0) return null

  return (
    <section className="solve-queue" aria-label="Очередь задач">
      {running.map((job) => (
        <SolvingCard
          key={job.id}
          job={job}
          subject={subjectOf(job.textbookId)}
          now={now}
          mine={!job.deviceId || job.deviceId === deviceId}
        />
      ))}

      {waiting.length > 0 && (
        <ol className="solve-queued-list" aria-label="Ждут очереди">
          {waiting.map((job) => (
            <QueuedRow
              key={job.id}
              job={job}
              subject={subjectOf(job.textbookId)}
              position={running.length + waiting.indexOf(job) + 1}
              onDismiss={onDismiss}
            />
          ))}
        </ol>
      )}

      {finished.map((job) => (job.status === 'done'
        ? <ReadyCard key={job.id} job={job} subject={subjectOf(job.textbookId)} onOpen={onOpen} onDismiss={onDismiss} />
        : (
          <FailedCard
            key={job.id}
            job={job}
            subject={subjectOf(job.textbookId)}
            onRetry={onRetry}
            onDismiss={onDismiss}
            onOpenSupport={onOpenSupport}
          />
        )
      ))}
    </section>
  )
}
