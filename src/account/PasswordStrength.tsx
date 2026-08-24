import { useEffect, useMemo, useState } from 'react'
import { Check } from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import { evaluatePassword } from './passwordStrengthRules'

type PasswordStrengthProps = {
  value: string
  id: string
}

export default function PasswordStrength({ value, id }: PasswordStrengthProps) {
  const state = useMemo(() => evaluatePassword(value), [value])
  const [announcement, setAnnouncement] = useState('')
  const reduceMotion = useReducedMotion()
  const tone = state.score === 0 ? 'is-empty' : state.score === 1 ? 'is-danger' : state.score === 2 ? 'is-warning' : 'is-success'

  useEffect(() => {
    if (!state.announcement) {
      setAnnouncement('')
      return
    }

    const timer = window.setTimeout(() => setAnnouncement(state.announcement), 700)
    return () => window.clearTimeout(timer)
  }, [state.announcement])

  return (
    <div className={`password-strength ${tone}`} id={id}>
      <div
        className="password-strength-meter"
        role="meter"
        aria-label="Надёжность пароля"
        aria-valuemin={0}
        aria-valuemax={state.max}
        aria-valuenow={state.score}
        aria-valuetext={state.label}
      >
        {Array.from({ length: state.max }, (_, index) => (
          <span className="password-strength-cell" key={index}>
            <motion.span
              aria-hidden="true"
              initial={false}
              animate={{ scaleX: index < state.score ? 1 : 0 }}
              transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 34, mass: 0.45, delay: index < state.score ? index * 0.03 : 0 }}
            />
          </span>
        ))}
      </div>

      <div className="password-strength-summary">
        <span>{state.label}</span>
        {state.guessable && <span className="password-strength-warning">Слишком предсказуемый</span>}
      </div>

      <ul className="password-strength-rules" aria-label="Требования к паролю">
        {state.rules.map((rule) => (
          <li className={rule.met ? 'is-met' : ''} key={rule.id}>
            <span className="password-rule-state" aria-hidden="true">
              {rule.met && <Check size={10} weight="bold" />}
            </span>
            <span>{rule.label}</span>
            <span className="sr-only">{rule.met ? 'выполнено' : 'не выполнено'}</span>
          </li>
        ))}
      </ul>

      <p className="sr-only" aria-live="polite">{announcement}</p>
    </div>
  )
}
