import { CheckCircle, WarningCircle } from '@phosphor-icons/react'
import type { HomeworkDecisionSummary, HomeworkSolutionVerification } from '../lib/homeworkContract'

function DecisionSummary({ value }: { value: HomeworkDecisionSummary }) {
  return (
    <dl className="solution-verification-decisions">
      <div><dt>Что требуется?</dt><dd>{value.taskGoal}</dd></div>
      <div><dt>Нужен чертёж?</dt><dd>{value.diagramRequired ? 'Да' : 'Нет'} · {value.diagramReason}</dd></div>
      <div><dt>Что должно быть?</dt><dd>{value.requiredElements.length > 0 ? value.requiredElements.join(' · ') : 'Дополнительные элементы не нужны'}</dd></div>
      <div><dt>Формат решения</dt><dd>{value.notebookFormat}</dd></div>
    </dl>
  )
}

export function SolutionVerificationPanel({ verification }: { verification: HomeworkSolutionVerification }) {
  const passed = verification.checks.filter((check) => check.passed).length

  return (
    <details className="solution-verification" open>
      <summary>
        <span><strong>Проверка решения</strong><small>Контрольные вопросы, автопроверка и независимый редактор</small></span>
        <b>{passed}/{verification.checks.length}</b>
      </summary>
      <div className="solution-verification-body">
        <section aria-labelledby="solution-verification-decisions-title">
          <h2 id="solution-verification-decisions-title">Итоговые ответы движка</h2>
          <DecisionSummary value={verification.reviewer} />
        </section>

        <section aria-labelledby="solution-verification-self-check-title">
          <h2 id="solution-verification-self-check-title">Самопроверка модели</h2>
          <ul className="solution-verification-list">
            {verification.reviewer.selfChecks.map((check) => <li key={check}><CheckCircle weight="fill" aria-hidden="true" />{check}</li>)}
          </ul>
        </section>

        <section aria-labelledby="solution-verification-gates-title">
          <h2 id="solution-verification-gates-title">Контроль качества</h2>
          <ul className="solution-verification-checks">
            {verification.checks.map((check) => (
              <li className={check.passed ? 'is-passed' : 'has-warning'} key={check.label}>
                {check.passed ? <CheckCircle weight="fill" aria-hidden="true" /> : <WarningCircle weight="fill" aria-hidden="true" />}
                <span><strong>{check.label}</strong><small>{check.note}</small></span>
              </li>
            ))}
          </ul>
        </section>

        <details className="solution-verification-first-pass">
          <summary>Первый проход модели</summary>
          <DecisionSummary value={verification.author} />
          <p>
            {verification.authorIssues.length === 0
              ? 'Автопроверка не нашла ошибок в первом варианте.'
              : `Редактор получил замечания: ${verification.authorIssues.join('; ')}.`}
          </p>
        </details>
      </div>
    </details>
  )
}
