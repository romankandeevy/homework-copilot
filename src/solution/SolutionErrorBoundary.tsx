import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  /** Куда уйти из сломанного решения. */
  onGoHome: () => void
}

type State = {
  failed: boolean
}

/* Граница ошибок одного решения (аудит 16 сентября, Б11).

   Лист тетради читает поля решения без защиты, и одна запись с битым полем
   роняла всё приложение до корневой заглушки «Страница не открылась»: вместе
   с решением пропадали очередь, меню и путь назад. Теперь падает только
   само решение, а вокруг остаётся рабочая страница. Сбрасывается сменой
   ключа - другим решением. */
export class SolutionErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Решение не отрисовалось', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <section className="route-page" role="alert" aria-labelledby="solution-crash-title">
        <header className="route-page-header">
          <h1 id="solution-crash-title">Решение не открылось</h1>
          <p>Запись этого решения повреждена, и показать её мы не можем. Остальные решения и очередь в порядке. Если решение оплачено - напиши в поддержку, разберёмся.</p>
        </header>
        <button className="route-primary-action" type="button" onClick={this.props.onGoHome}>
          На главную
        </button>
      </section>
    )
  }
}
