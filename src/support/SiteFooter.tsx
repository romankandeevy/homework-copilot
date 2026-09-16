import { currentApplicationPath } from '../lib/appPath'
import { contactEmail, contactPhone, contactPhoneHref, sellerFullName, sellerInnClause } from '../lib/seller'
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
  { href: '/docs/terms', label: 'Пользовательское соглашение' },
  { href: '/docs/privacy', label: 'Политика данных' },
  { href: '/docs/consent', label: 'Согласие на обработку данных' },
  { href: '/docs/cookies', label: 'Cookie и хранилище' },
  { href: '/docs/offer', label: 'Публичная оферта' },
  { href: '/docs/contacts', label: 'Реквизиты и контакты' },
]

/* Ссылка на открытую сейчас страницу помечена `aria-current`. Это
   единственное место подвала с кобальтом: узел «ты здесь», как в навигации. */
function FooterLinks({ links }: { links: FooterLink[] }) {
  const path = currentApplicationPath()
  return links.map(({ href, label }) => (
    <a key={href} href={href} aria-current={href === path ? 'page' : undefined}>{label}</a>
  ))
}

/* Подвал один на всех страницах: витрина, приложение, решения, чат,
   расписание, документы, 404. До 14 сентября в приложении стоял короткий
   рабочий подвал в одну строку, и владелец, открыв разные разделы, увидел два
   разных подвала - «на каждой странице, независимо, что это за страница,
   должен быть одинаковый подвал». Свои ссылки на документы остаются только у
   окон профиля и баланса.

   13 сентября подвал перерисован. Он был парящей карточкой с тенью, с
   контурной монограммой в семь с половиной рем жирным начертанием,
   кобальтовой кнопкой поддержки и кобальтовой галочкой у каждой ссылки, то
   есть нарушал сразу три правила DESIGN.md: тень у неподнятого, вес больше
   400 у дисплейного шрифта, кобальт как украшение. Теперь это нижнее поле
   страницы: плоское, отделено линией, знак того же размера, что в шапке.

   `onOpenSupport` есть только внутри приложения: там окно поддержки
   открывается на месте. Витрина и документы ведут на /support. */
export function SiteFooter({ onOpenSupport }: { onOpenSupport?: () => void }) {
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
        {/* Продавец - в подвале каждой страницы, а не только на
            /docs/contacts: модерация Робокассы требует «Самозанятый ФИО,
            ИНН» и не скрытые почту и телефон прямо в подвале (аудит 16
            сентября 2026, А2). Константы - `src/lib/seller.ts`, те же, что
            в документах. */}
        <p className="site-footer-seller">
          <span>Самозанятый {sellerFullName}{sellerInnClause}</span>{' '}
          <span><span className="site-footer-seller-dot" aria-hidden="true">· </span><a href={`mailto:${contactEmail}`}>{contactEmail}</a></span>{' '}
          <span><span className="site-footer-seller-dot" aria-hidden="true">· </span><a href={contactPhoneHref}>{contactPhone}</a></span>
        </p>
      </div>
    </footer>
  )
}
