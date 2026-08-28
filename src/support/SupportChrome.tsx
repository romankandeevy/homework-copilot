import { ArrowSquareOut, ChatCircleText } from '../ui/deferredIcons'
import './SupportCenter.css'

export function SupportLauncher({ onClick }: { onClick: () => void }) {
  return (
    <button className="support-launcher" type="button" onClick={onClick} aria-label="Открыть поддержку">
      <ChatCircleText size={22} weight="duotone" aria-hidden="true" />
      <span>Поддержка</span>
    </button>
  )
}

export function SiteFooter({ onOpenSupport }: { onOpenSupport?: () => void }) {
  return (
    <footer className="site-footer">
      <div className="site-footer-grid">
        <section className="site-footer-intro" aria-label="О Homework Copilot">
          <a className="site-footer-brand" href="/" aria-label="Homework Copilot, на главную">
            <span className="site-footer-mark" aria-hidden="true">H<span>C</span></span>
            <strong>Homework Copilot</strong>
          </a>
          <p>Находи условия по учебнику, сохраняй решения и собирай расписание в одном аккаунте.</p>
          <span className="site-footer-note"><i aria-hidden="true" />Решения помогают учиться. Проверяй ответ перед сдачей.</span>
        </section>

        <nav className="site-footer-column" aria-label="Сервис">
          <h2>Сервис</h2>
          <a href="/">Главная</a>
          <a href="/cdz">Учебники и ЦДЗ</a>
          <a href="/solutions">Решения</a>
          <a href="/schedule">Расписание</a>
        </nav>

        <nav className="site-footer-column" aria-label="Помощь">
          <h2>Помощь</h2>
          {onOpenSupport ? <button type="button" onClick={onOpenSupport}>Написать в поддержку</button> : <a href="/support">Написать в поддержку</a>}
          <a href="/support#faq">FAQ</a>
          <a className="site-footer-external" href="https://t.me/homeworkcopilot_roma_support_bot" target="_blank" rel="noopener noreferrer">Telegram-бот <ArrowSquareOut size={15} weight="bold" aria-hidden="true" /></a>
        </nav>

        <nav className="site-footer-column" aria-label="Документы">
          <h2>Документы</h2>
          <a href="/terms">Пользовательское соглашение</a>
          <a href="/privacy">Политика данных</a>
          <a href="/consent">Согласие на обработку данных</a>
          <a href="/cookies">Cookie и хранилище</a>
          <a href="/offer">Публичная оферта</a>
        </nav>
      </div>
      <div className="site-footer-meta">
        <span>© 2026 Homework Copilot</span>
        <span>Поддержка отвечает в личном кабинете</span>
      </div>
    </footer>
  )
}
