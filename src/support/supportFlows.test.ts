import { describe, expect, it } from 'vitest'
import { initialTopic, instantAnswer, nextStep, supportTopics, ticketBody, topicById } from './supportFlows'

describe('сценарии поддержки', () => {
  it('известный случай отвечает сразу, без обращения', () => {
    const topic = topicById('payment')
    expect(nextStep(topic, {})?.id).toBe('problem')
    const answers = { problem: 'topup' }
    expect(nextStep(topic, answers)).toBeNull()
    const answer = instantAnswer(topic, answers)
    expect(answer?.text).toMatch(/нескольких минут/)
    expect(answer?.escalate).toBeUndefined()
  })

  it('возврат денег и проверка решения всегда уходят разработчику', () => {
    expect(instantAnswer(topicById('payment'), { problem: 'refund' })?.escalate).toBe('always')
    const wrong = topicById('wrong_solution')
    expect(nextStep(wrong, { problem: 'answer' })?.id).toBe('details')
    expect(instantAnswer(wrong, { problem: 'answer', details: 'ответ 36' })?.escalate).toBe('always')
  })

  it('обращение несёт тему, выбранные ответы и подробности', () => {
    const topic = topicById('solve_failed')
    const body = ticketBody(topic, { problem: 'charged' }, '  вчера, физика  ')
    expect(body.split('\n')).toEqual([
      'Задача не решается',
      'Что происходит? - Деньги списали, а решения нет',
      'Готовый ответ не помог.',
      'Подробности: вчера, физика',
    ])
  })

  it('карточка решения открывает сразу «неверное решение», баланс - деньги', () => {
    expect(initialTopic('wrong_solution', true)).toBe('wrong_solution')
    expect(initialTopic('wrong_solution', false)).toBeNull()
    expect(initialTopic('payment', false)).toBe('payment')
    expect(initialTopic('general', false)).toBeNull()
  })

  it('у каждой темы есть путь до ответа или до разработчика', () => {
    for (const topic of supportTopics) {
      for (const step of topic.steps) {
        if (step.kind !== 'choice') continue
        for (const option of step.options) {
          const answers = { [step.id]: option.id }
          const pending = nextStep(topic, answers)
          // Либо ещё вопрос, либо ответ - тупика нет.
          expect(pending !== null || instantAnswer(topic, answers) !== null, `${topic.id}/${option.id}`).toBe(true)
        }
      }
    }
  })

  it('тексты на дефисах, без длинного тире', () => {
    const text = JSON.stringify(supportTopics)
    expect(text).not.toMatch(/[—–]/u)
  })
})
