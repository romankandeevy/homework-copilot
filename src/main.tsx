import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const rootElement = document.getElementById('root')!

rootElement.replaceChildren()

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

try {
  if (window.sessionStorage.getItem('homework-copilot:startup-submit') === '1') {
    let attempts = 0
    const submitWhenReady = () => {
      const button = rootElement.querySelector<HTMLButtonElement>('.copy-task-submit')
      if (button && !button.disabled) {
        window.sessionStorage.removeItem('homework-copilot:startup-submit')
        button.click()
        return
      }
      attempts += 1
      if (attempts < 20) window.setTimeout(submitWhenReady, 50)
    }
    window.setTimeout(submitWhenReady, 0)
  }
} catch {}
