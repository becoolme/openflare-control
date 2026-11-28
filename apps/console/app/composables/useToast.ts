import { useState } from '#imports'

export interface Toast {
  id: number
  kind: 'ok' | 'err'
  text: string
}

/**
 * Process-wide action feedback. Mutations report through `toast()`; the
 * layout-mounted <UiToasts/> renders them. Errors stay until dismissed —
 * a failed operation must never scroll away unnoticed.
 */
export function useToasts() {
  const toasts = useState<Toast[]>('console-toasts', () => [])
  let seq = 0
  function push(kind: Toast['kind'], text: string) {
    const id = ++seq
    toasts.value = [...toasts.value, { id, kind, text }]
    if (kind === 'ok') {
      setTimeout(() => dismiss(id), 4000)
    }
    return id
  }
  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }
  return {
    toasts,
    dismiss,
    ok: (text: string) => push('ok', text),
    err: (text: string) => push('err', text),
  }
}
