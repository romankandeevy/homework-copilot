/* Попытка переопределить промпт изнутри условия.

   Условие приходит текстом, фотографией или распознанным со снимка, и в
   нём может оказаться «игнорируй прошлые инструкции» - случайно или нарочно.
   Решение не блокируем: ложное срабатывание на настоящей задаче хуже
   пропуска, а промпт и так велит считать условие данными. Срабатывание
   пишется в журнал, чтобы видеть, приходит ли такое вообще. */

const markers: readonly (readonly [string, RegExp])[] = [
  ['ignore-previous', /ignore\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|earlier)/iu],
  ['disregard', /disregard\s+(?:all|any|the|your|previous)|forget\s+(?:all|everything|your|previous)/iu],
  ['system-prompt', /system\s*prompt|системн\p{L}*\s+(?:промпт|инструкц|сообщени)/iu],
  // «Act as a tour guide» и «Pretend you are» - обычные задания по английскому, их не ловим.
  ['role-override', /ты\s+(?:теперь|больше)\s+не\s+(?:решател|помощник|ассистент|модел)/iu],
  ['ignore-previous-ru', /(?:игнорируй|проигнорируй|забудь|отмени)\s+(?:\p{L}+\s+){0,2}(?:инструкц|правил|указани|промпт)/iu],
  ['not-follow-ru', /не\s+(?:следуй|соблюдай|выполняй)\s+(?:\p{L}+\s+){0,2}(?:инструкц|правил|указани)/iu],
  ['developer-mode', /developer\s+mode|jailbreak|режим\s+разработчика/iu],
]

export function conditionInjectionMarkers(condition: string): string[] {
  if (!condition) return []
  return markers.filter(([, pattern]) => pattern.test(condition)).map(([name]) => name)
}
