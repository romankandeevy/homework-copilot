import { currentApplicationPath } from '../lib/appPath'
import './SiteFooter.css'

type FooterLink = { href: string; label: string }

// Только запущенное. «ЦДЗ» отсюда убран: пункт обещал учебники, которых в
// продукте нет, и вёл на заглушку «раздел закрыт».
const serviceLinks: FooterLink[] = [
  { href: '/app', label: 'Решить задачу' },
  { href: '/solutions', label: 'Мои решения' },
  { href: '/chat', label: 'ИИ-чат' },
  { href: '/schedule', label: 'Расписание' },
]

const documentLinks: FooterLink[] = [
  { href: '/terms', label: 'Пользовательское соглашение' },
  { href: '/privacy', label: 'Политика данных' },
  { href: '/consent', label: 'Согласие на обработку данных' },
  { href: '/cookies', label: 'Cookie и хранилище' },
  { href: '/offer', label: 'Публичная оферта' },
  { href: '/contacts', label: 'Реквизиты и контакты' },
]

/* Ссылка на открытую сейчас страницу помечена `aria-current`. Это
   единственное место подвала с кобальтом: узел «ты здесь», как в навигации. */
function FooterLinks({ links }: { links: FooterLink[] }) {
  const path = currentApplicationPath()
  return links.map(({ href, label }) => (
    <a key={href} href={href} aria-current={href === path ? 'page' : undefined}>{label}</a>
  ))
}

/* Подвал двух видов.

   Полный - на витрине и на страницах документов: там он и есть содержание
   страницы. В рабочем приложении он был вреден: замер 8 сентября на экране
   375×812 дал 998 пикселей подвала при вьюпорте 812. Рабочий подвал - одна
   строка. Документы никуда не деваются: каждая юридическая страница
   перечисляет все остальные, поэтому одной ссылки хватает, чтобы дойти до
   любой.

   13 сентября подвал перерисован. Он был парящей карточкой с тенью, с
   контурной монограммой в семь с половиной рем жирным начертанием,
   кобальтовой кнопкой поддержки и кобальтовой галочкой у каждой ссылки, то
   есть нарушал сразу три правила DESIGN.md: тень у неподнятого, вес больше
   400 у дисплейного шрифта, кобальт как украшение. Теперь это нижнее поле
   страницы: плоское, отделено линией, знак того же размера, что в шапке. */
export function SiteFooter({ onOpenSupport, compact = false }: { onOpenSupport?: () => void; compact?: boolean }) {
  if (compact) {
    return (
      <footer className="site-footer is-compact">
        {/* Ссылки - в начале строки, а не в правом углу. Правый нижний угол
            при первом заходе занят уведомлением о хранении данных: 13 сентября
            оно легло поверх «Поддержки», и гость не мог по ней нажать. */}
        <nav className="site-footer-compact-links" aria-label="Служебные ссылки">
          <a href="/terms">Документы</a>
          {/* Реквизиты исполнителя - на каждой странице, как требует модерация оплаты. */}
          <a href="/contacts">Реквизиты</a>
          {/* Ссылки на поддержку здесь нет, когда рядом уже висит плавающая
              кнопка: два входа в одно окно на одном экране - это дубль. */}
          {onOpenSupport && <button type="button" onClick={onOpenSupport}>Поддержка</button>}
        </nav>
        <div className="site-footer-compact-meta">
          <p className="site-footer-disclaimer">Решения помогают разобраться, а не заменяют работу над задачей.</p>
          <span>© 2026 Homework Copilot</span>
        </div>
      </footer>
    )
  }

  return (
    <footer className="site-footer">
      <div className="site-footer-main">
        <div className="site-footer-about">
          <a className="site-footer-brand" href="/">
            <span className="brand-mark" aria-hidden="true"><span>H</span><span>C</span></span>
            <span className="brand-name"><span>Homework</span> <span className="brand-name-accent">Copilot</span></span>
          </a>
          {/* Подпись - та же, что заголовок витрины: подвал её договаривает, а
              не придумывает второе обещание. */}
          <p className="site-footer-slogan">Сфоткал. Понял. Сдал.</p>
          <p>Условие фотографией или текстом - и понятная запись для тетради: дано, решение, ответ.</p>
        </div>

        <nav className="site-footer-column" aria-label="Сервис">
          <h2>Сервис</h2>
          <FooterLinks links={serviceLinks} />
        </nav>

        {/* Вход в окно поддержки здесь один: раньше «Написать в поддержку»
            стояло дважды - крупной кнопкой и строкой в этой колонке. */}
        <nav className="site-footer-column" aria-label="Помощь">
          <h2>Помощь</h2>
          <a href="/support#faq">Частые вопросы</a>
          {onOpenSupport
            ? <button type="button" onClick={onOpenSupport}>Написать в поддержку</button>
            : <a href="/support">Написать в поддержку</a>}
        </nav>

        <nav className="site-footer-column is-documents" aria-label="Документы">
          <h2>Документы</h2>
          <FooterLinks links={documentLinks} />
        </nav>
      </div>

      <div className="site-footer-meta">
        <span>© 2026 Homework Copilot</span>
        <span className="site-footer-disclaimer">Решения помогают разобраться, а не заменяют работу над задачей.</span>
      </div>
    </footer>
  )
}
