// Ошибка API чата с кодом ответа. Вынесена отдельно, чтобы адаптеры
// провайдера не тянули за собой весь обработчик запроса.
//
// `message` видит ученик, поэтому он всегда наш и по-русски. `detail` -
// то, что сказал шлюз или база, - уходит только в журнал ошибок: 14 сентября
// 2026 строка шлюза «Network error, please try again later.» терялась
// целиком, и причину поломки пришлось добывать повторным запросом.
export class ChatApiError extends Error {
  status: number
  detail: string | null

  constructor(status: number, message: string, detail: string | null = null) {
    super(message)
    this.status = status
    this.detail = detail
  }
}
