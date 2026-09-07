import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../src/ui/error-boundary'

const unexpectedError = 'An unexpected rendering error occurred.'

describe('ErrorBoundary error normalization', () => {
  it.each([
    ['an Error', new Error('The selected view failed'), 'The selected view failed'],
    ['a string', 'A thrown string', 'A thrown string'],
    ['a number', 42, '42'],
    ['a boolean', false, 'false'],
    ['an object', { detail: 'unknown' }, '[object Object]'],
    ['a custom string conversion', { toString: () => 'Custom failure' }, 'Custom failure'],
    ['null', null, unexpectedError],
    ['undefined', undefined, unexpectedError],
    ['an empty Error', new Error(''), unexpectedError],
    ['an empty string', '', unexpectedError],
    ['a whitespace-only Error', new Error(' \n\t'), unexpectedError],
    ['a whitespace-only string', ' \n\t', unexpectedError]
  ])('produces a nonempty message for %s', (_label, cause, message) => {
    expect(ErrorBoundary.getDerivedStateFromError(cause)).toEqual({ message })
  })

  it('recovers when converting an unknown thrown value also throws', () => {
    const cause = {
      toString() {
        throw new Error('String conversion failed')
      }
    }

    expect(ErrorBoundary.getDerivedStateFromError(cause)).toEqual({ message: unexpectedError })
  })
})

// Static rendering covers presentation only. Electron smoke exercises a real
// descendant render failure and the reload interaction in the mounted app.
describe('ErrorBoundary static presentation', () => {
  beforeEach(() => {
    vi.stubGlobal('__KONDO_VERSION__', '9.8.7-boundary-test')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders healthy children without fallback chrome', () => {
    const children = createElement('p', null, 'Healthy view')
    const markup = renderToStaticMarkup(createElement(ErrorBoundary, { children }))

    expect(markup).toBe('<p>Healthy view</p>')
  })

  it('renders an escaped error, app version, and reload button from recovery state', () => {
    const boundary = new ErrorBoundary({ children: createElement('p', null, 'Broken view') })
    expect(boundary.state).toEqual({ message: null })
    boundary.state = ErrorBoundary.getDerivedStateFromError(
      new Error('<script>alert("render failure")</script> & details')
    )

    const markup = renderToStaticMarkup(boundary.render())

    expect(markup).toContain('class="app-shell error-boundary"')
    expect(markup).toContain('role="alert"')
    expect(markup).toMatch(/<h1[^>]*>Kondo couldn’t display this view<\/h1>/)
    expect(markup).toContain('&lt;script&gt;alert(&quot;render failure&quot;)&lt;/script&gt; &amp; details')
    expect(markup).not.toContain('<script>')
    expect(markup).not.toContain('Broken view')
    expect(markup).toContain('9.8.7-boundary-test')
    expect(markup).toMatch(/<button\b[^>]*>Reload Kondo<\/button>/)
  })
})
