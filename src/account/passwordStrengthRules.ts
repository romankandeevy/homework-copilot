const COMMON_PATTERN = /^(?:password|passw0rd|пароль|qwerty|йцукен|letmein|welcome|admin|iloveyou|monkey|dragon|abc123|111111|123123|123456)/iu
const REPEATED_CHARACTER = /(.)\1{3,}/u
const SIMPLE_SEQUENCE = /(?:0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|defg|qwer|wert|erty|asdf|йцук|цукен)/iu
const SYMBOL = /[!-/:-@[-`{-~]/

const labels = ['Пусто', 'Слабый', 'Средний', 'Хороший', 'Надёжный'] as const

const passwordRules = [
  { id: 'length', label: 'Не меньше 8 символов', test: (value: string) => value.length >= 8 },
  { id: 'case', label: 'Строчные и заглавные буквы', test: (value: string) => /[a-zа-яё]/u.test(value) && /[A-ZА-ЯЁ]/u.test(value) },
  { id: 'digit', label: 'Хотя бы одна цифра', test: (value: string) => /\d/u.test(value) },
  { id: 'symbol', label: 'Хотя бы один спецсимвол', test: (value: string) => SYMBOL.test(value) },
] as const

export function evaluatePassword(value: string) {
  const rules = passwordRules.map((rule) => ({ ...rule, met: rule.test(value) }))
  const passed = rules.filter((rule) => rule.met).length
  const guessable = value.length > 0 && (COMMON_PATTERN.test(value) || REPEATED_CHARACTER.test(value) || SIMPLE_SEQUENCE.test(value))
  const score = value.length === 0 ? 0 : guessable ? 1 : Math.max(1, passed)
  const unmet = rules.filter((rule) => !rule.met)
  const label = labels[score]
  const announcement = value.length === 0
    ? ''
    : [
        `Надёжность пароля: ${label.toLocaleLowerCase('ru')}.`,
        guessable ? 'Пароль слишком предсказуемый.' : '',
        unmet.length === 0 ? 'Все требования выполнены.' : `Нужно добавить: ${unmet.map((rule) => rule.label.toLocaleLowerCase('ru')).join(', ')}.`,
      ].filter(Boolean).join(' ')

  return { score, max: passwordRules.length, label, rules, guessable, announcement }
}

export function isStrongPassword(value: string) {
  const result = evaluatePassword(value)
  return result.score === result.max && !result.guessable
}
