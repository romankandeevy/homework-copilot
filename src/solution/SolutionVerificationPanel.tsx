import { CheckCircle, WarningCircle } from '@phosphor-icons/react'
import type { HomeworkDecisionSummary, HomeworkSolutionVerification } from '../lib/homeworkContract'

/* Что проверило решение.

   С 4 сентября проход модели один, а проверяет запись код: правила
   предмета, калькулятор черновика, разбор чертежа. Панель до 15 сентября
   говорила про «независимого редактора» и «первый проход модели», и
   владелец на аудите спросил, почему проходов снова два. Их не два:
   есть черновик, есть замечания кода к нему и есть починка, если
   замечания были. Так панель это и называет. */

function DecisionSummary({ value }: { value: HomeworkDecisionSummary }) {
  return (
    <dl className="solution-verification-decisions">
      <div><dt>Что требуется</dt><dd>{value.taskGoal}</dd></div>
      <div><dt>Чертёж</dt><dd>{value.diagramRequired ? 'Нужен' : 'Не нужен'} · {value.diagramReason}</dd></div>
      <div><dt>Что обязано быть в записи</dt><dd>{value.requiredElements.length > 0 ? value.requiredElements.join(' · ') : 'Дополнительные элементы не нужны'}</dd></div>
      <div><dt>Вид записи</dt><dd>{value.notebookFormat}</dd></div>
    </dl>
  )
}

export function SolutionVerificationPanel({ verification }: { verification: HomeworkSolutionVerification }) {
  const passed = verification.checks.filter((check) => check.passed).length
  const repaired = verification.authorIssues.length > 0

  return (
    <details className="solution-verification" open>
      <summary>
        <span><strong>Проверка решения</strong><small>Вопросы модели к себе и проверка записи кодом</small></span>
        <b>{passed}/{verification.checks.length}</b>
      </summary>
      <div className="solution-verification-body">
        <section aria-labelledby="solution-verification-decisions-title">
          <h2 id="solution-verification-decisions-title">Как модель поняла задачу</h2>
          <DecisionSummary value={verification.reviewer} />
        </section>

        <section aria-labelledby="solution-verification-self-check-title">
          <h2 id="solution-verification-self-check-title">Самопроверка модели</h2>
          <ul className="solution-verification-list">
            {verification.reviewer.selfChecks.map((check) => <li key={check}><CheckCircle weight="fill" aria-hidden="true" />{check}</li>)}
          </ul>
        </section>

        <section aria-labelledby="solution-verification-gates-title">
          <h2 id="solution-verification-gates-title">Проверка кодом</h2>
          <ul className="solution-verification-checks">
            {verification.checks.map((check) => (
              <li className={check.passed ? 'is-passed' : 'has-warning'} key={check.label}>
                {check.passed ? <CheckCircle weight="fill" aria-hidden="true" /> : <WarningCircle weight="fill" aria-hidden="true" />}
                <span><strong>{check.label}</strong><small>{check.note}</small></span>
              </li>
            ))}
          </ul>
        </section>

        {/* Починка - второй вызов модели, и он стоит времени: ученику
            полезно видеть, из-за чего решение шло дольше. Без замечаний
            раздела нет: черновик и есть решение. */}
        {repaired && (
          <details className="solution-verification-first-pass">
            <summary>Что исправлено после проверки черновика</summary>
            <p>Замечания к черновику: {verification.authorIssues.join('; ')}.</p>
          </details>
        )}
      </div>
    </details>
  )
}
