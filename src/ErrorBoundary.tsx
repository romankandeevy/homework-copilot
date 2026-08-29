import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
}

type State = {
  failed: boolean
}

// Без границы ошибок любой throw в рендере — например отказ загрузки ленивого
// чанка на плохой связи — оставлял пользователя с белым экраном без выхода.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Приложение упало на рендере', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <div className="app-crash" role="alert">
        <h1>Страница не открылась</h1>
        <p>Что-то сломалось на нашей стороне. Обнови страницу — обычно этого хватает.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Обновить страницу
        </button>
      </div>
    )
  }
}
