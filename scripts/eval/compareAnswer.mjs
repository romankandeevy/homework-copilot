/* Сверка ответа модели с эталоном для scripts/eval-subjects.mjs.

   Модели по-разному оформляют один и тот же верный ответ: «13 см», «AB = 13»,
   «≈13», «13,0». Точное совпадение строк здесь ничего не скажет о качестве
   решения, поэтому для числовых эталонов сравниваем сами числа, а не текст
   вокруг них. Для нечисловых эталонов (термин, а не число - «ямб», «has»)
   ищем эталон подстрокой без учёта регистра, как это уже делал
   scripts/probe-subject-models.mjs. */

const numberPattern = /-?\d+(?:[.,]\d+)?/gu

function extractNumbers(text) {
  return [...text.matchAll(numberPattern)].map((match) => Number(match[0].replace(',', '.')))
}

// Относительный допуск: 1% или 0,01 - что больше. Так «5,4» и «5,40·10^7»
// (десятичный порядок мог остаться текстом рядом, а не в самом числе)
// совпадают, но «5,4» и «6» - нет.
function numbersMatch(expected, actual) {
  const tolerance = Math.max(Math.abs(expected) * 0.01, 0.01)
  return Math.abs(expected - actual) <= tolerance
}

/* Каждое число эталона должно найтись среди чисел ответа (как мультимножество:
   одно число ответа закрывает ровно одно число эталона, повторно не считается). */
function numericAnswerMatches(expectedText, actualText) {
  const expectedNumbers = extractNumbers(expectedText)
  const remaining = extractNumbers(actualText)
  return expectedNumbers.every((expected) => {
    const index = remaining.findIndex((candidate) => numbersMatch(expected, candidate))
    if (index === -1) return false
    remaining.splice(index, 1)
    return true
  })
}

export function answerMatchesExpectation(expectedText, actualText) {
  if (!expectedText) return true
  const expectedNumbers = extractNumbers(expectedText)
  if (expectedNumbers.length > 0) return numericAnswerMatches(expectedText, actualText)
  return actualText.toLocaleLowerCase('ru-RU').includes(expectedText.toLocaleLowerCase('ru-RU'))
}
