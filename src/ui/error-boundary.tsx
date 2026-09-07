import { Component, createRef } from 'react'
import type { ReactNode } from 'react'

interface ErrorState {
  message: string | null
}

function errorMessage(cause: unknown): string {
  try {
    const message = cause instanceof Error ? cause.message : cause == null ? '' : String(cause)
    if (message.trim()) return message
  } catch {
    // Even a thrown object's message getter or string conversion can fail.
  }
  return 'An unexpected rendering error occurred.'
}

/** Last resort for descendant rendering failures; async actions handle their own errors. */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorState> {
  override state: ErrorState = { message: null }
  private heading = createRef<HTMLHeadingElement>()

  static getDerivedStateFromError(cause: unknown): ErrorState {
    return { message: errorMessage(cause) }
  }

  override componentDidCatch(): void {
    this.heading.current?.focus()
    // A failure before useScan settles must also be able to retire the splash.
    window.kondoReady?.()
  }

  override render(): ReactNode {
    if (this.state.message === null) return this.props.children

    return (
      <div className="app-shell error-boundary">
        <div className="titlebar" />
        <main className="app-content" aria-labelledby="render-error-title">
          <div className="hero">
            <h1 id="render-error-title" ref={this.heading} tabIndex={-1}>Kondo couldn’t display this view</h1>
          </div>
          <div className="error-recovery">
            <div role="alert" className="band band-pencil">
              <p className="render-error-message">{this.state.message}</p>
            </div>
            <p>Reload Kondo to try again. If this keeps happening, keep the error message and version below for troubleshooting.</p>
            <button type="button" className="btn btn-go" onClick={() => {
              if (window.kondoReload) window.kondoReload()
              else window.location.reload()
            }}>
              Reload Kondo
            </button>
            <p className="font-mono">Kondo v{__KONDO_VERSION__}</p>
          </div>
        </main>
      </div>
    )
  }
}
