import { useLayoutEffect, useRef, type KeyboardEvent } from 'react'

/** An inline question keeps focus on its safe answer and returns it on cancel. */
export function useConfirmationFocus(open: boolean, onCancel: () => void, focusKey?: string | null) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const openerId = useRef<string | null>(null)
  const restoring = useRef(false)

  const rememberFocus = (id?: string): void => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    openerId.current = id ?? null
  }

  useLayoutEffect(() => {
    if (open) {
      cancelRef.current?.focus()
    } else if (restoring.current) {
      // A conditional trigger was replaced by the question, so its new node
      // is found by id. Persistent triggers can retain their original node.
      const target = openerId.current === null ? opener.current : document.getElementById(openerId.current)
      if (target?.isConnected) target.focus()
      restoring.current = false
    }
  }, [open, focusKey])

  const cancel = (): void => {
    restoring.current = true
    onCancel()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancel()
    }
  }

  return { cancelRef, rememberFocus, cancel, onKeyDown }
}
