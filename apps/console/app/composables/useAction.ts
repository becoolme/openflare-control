import { ConsoleApiError } from './useConsoleApi'

/**
 * Mutation runner: wraps a consoleApi call with pending state and toast
 * feedback. Every button that changes server state goes through this so
 * errors surface uniformly instead of dying in a promise.
 */
export function useAction() {
  const pending = ref(false)
  const { ok, err } = useToasts()

  async function run<T>(
    fn: () => Promise<T>,
    opts: { success?: string | ((r: T) => string); silent?: boolean } = {}
  ): Promise<T | undefined> {
    if (pending.value) return undefined
    pending.value = true
    try {
      const result = await fn()
      if (!opts.silent) {
        const msg = typeof opts.success === 'function' ? opts.success(result) : opts.success
        if (msg) ok(msg)
      }
      return result
    } catch (e) {
      const msg =
        e instanceof ConsoleApiError ? e.message : e instanceof Error ? e.message : String(e)
      err(msg)
      return undefined
    } finally {
      pending.value = false
    }
  }

  return { pending, run }
}
