/**
 * Browser-reachable API surface. Only the management API is proxied; the
 * cell channel (`/api/internal/...`) must never be reachable through the
 * console (the proxy injects the admin token).
 */
export const PROXY_PREFIXES = ['/api/v1/']

/**
 * Normalize a console request URL to the path forwarded to the plane, or
 * `null` when it is not a management-API request. `new URL` collapses `..`
 * segments and `decodeURIComponent` catches encoded traversal before the
 * prefix check, so `/api/v1/../internal/...` cannot slip through.
 */
export function proxyTarget(url) {
  try {
    const parsed = new URL(url, 'http://console.local')
    const decoded = decodeURIComponent(parsed.pathname)
    if (decoded.split('/').includes('..')) return null
    if (!PROXY_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))) return null
    return parsed.pathname + parsed.search
  } catch {
    return null
  }
}
