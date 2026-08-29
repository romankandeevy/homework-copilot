// Ошибка API чата с кодом ответа. Вынесена отдельно, чтобы адаптеры
// провайдера не тянули за собой весь обработчик запроса.
export class ChatApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
