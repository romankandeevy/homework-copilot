import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { applySeoMetadata, getSeoMetadata } from './siteMetadata'

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
    expect(getSeoMetadata('/agreement').path).toBe('/terms')
  })

  it('updates one canonical and the complete social metadata set', () => {
    document.head.innerHTML = '<meta name="description" content="old"><meta name="robots" content="index"><link rel="canonical" href="https://example.com/">'
    const metadata = getSeoMetadata('/cookies')
    applySeoMetadata(metadata)

    expect(document.title).toBe(metadata.title)
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute('content', metadata.description)
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'index, follow')
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://www.homeworkcopilot.ru/cookies')
    expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1)
    expect(document.querySelector('meta[property="og:title"]')).toHaveAttribute('content', metadata.title)
    expect(document.querySelector('meta[name="twitter:description"]')).toHaveAttribute('content', metadata.description)
  })
})
