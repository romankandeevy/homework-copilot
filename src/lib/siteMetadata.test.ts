import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { applySeoMetadata, getSeoMetadata, legacyDocumentPaths, legalDocumentKind, legalDocumentKinds } from './siteMetadata'

describe('site metadata', () => {
  /* У задачи по фото в адресе служебный ключ, у задачи текстом - начало
     условия. Номер на вкладке - только настоящий номер из учебника. */
  it('names a solution tab by textbook number only', () => {
    expect(getSeoMetadata('/solutions/algebra/863', '863').title).toBe('Решение задачи № 863 - Homework Copilot')
    expect(getSeoMetadata('/solutions/geometry/photo-9807d724', 'photo-9807d724').title).toBe('Решение задачи - Homework Copilot')
    expect(getSeoMetadata('/solutions/algebra/x', '862. Решите неравенство').title).toBe('Решение задачи - Homework Copilot')
  })

  it('keeps private routes out of search and canonicalizes aliases', () => {
    expect(getSeoMetadata('/main').path).toBe('/app')
    expect(getSeoMetadata('/solutions/geometry/123', '123').robots).toBe('noindex, nofollow')
    expect(getSeoMetadata('/schedule').robots).toBe('noindex, nofollow')
    expect(getSeoMetadata('/agreement').path).toBe('/docs/terms')
  })

  /* Аудит 16 сентября 2026: `/app` и `/solutions` без скриптов пусты и из
     карты сайта убраны, адреса удалённого раздела ЦДЗ ведут на `/app`. */
  it('closes the empty app routes and sends the removed CDZ addresses to /app', () => {
    expect(getSeoMetadata('/app').robots).toBe('noindex, follow')
    expect(getSeoMetadata('/solutions').robots).toBe('noindex, nofollow')
    expect(['/cdz', '/tasks', '/textbooks'].map((path) => getSeoMetadata(path).path)).toEqual(['/app', '/app', '/app'])
    expect(getSeoMetadata('/admin').robots).toBe('noindex, nofollow')
  })

  /* С 14 сентября 2026 документы живут под /docs/. Прежние адреса уже в
     письмах и отметках согласия: они обязаны открывать тот же документ и
     объявлять каноническим новый адрес. */
  it('moves the documents under /docs/ and keeps the old addresses', () => {
    expect(legalDocumentKinds.map((kind) => getSeoMetadata(`/docs/${kind}`).path)).toEqual(legalDocumentKinds.map((kind) => `/docs/${kind}`))
    expect(Object.entries(legacyDocumentPaths).map(([legacy]) => getSeoMetadata(legacy).path)).toEqual(Object.values(legacyDocumentPaths))
    expect(getSeoMetadata('/privacy/').path).toBe('/docs/privacy')
    expect(legalDocumentKind('/terms')).toBe('terms')
    expect(legalDocumentKind('/agreement')).toBe('terms')
    expect(legalDocumentKind('/docs')).toBe('terms')
    expect(legalDocumentKind('/docs/contacts/')).toBe('contacts')
    expect(legalDocumentKind('/docs/unknown')).toBeNull()
    expect(legalDocumentKind('/app')).toBeNull()
    expect(getSeoMetadata('/docs/unknown').canonical).toBe(false)
  })

  it('updates one canonical and the complete social metadata set', () => {
    document.head.innerHTML = '<meta name="description" content="old"><meta name="robots" content="index"><link rel="canonical" href="https://example.com/">'
    const metadata = getSeoMetadata('/cookies')
    applySeoMetadata(metadata)

    expect(document.title).toBe(metadata.title)
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute('content', metadata.description)
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'index, follow')
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://www.homeworkcopilot.ru/docs/cookies')
    expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1)
    expect(document.querySelector('meta[property="og:title"]')).toHaveAttribute('content', metadata.title)
    expect(document.querySelector('meta[name="twitter:description"]')).toHaveAttribute('content', metadata.description)
  })
})
