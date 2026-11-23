/**
 * Console service: serves the generated Nuxt SPA and proxies the plane's APIs
 * on the same origin. The admin token stays server-side; the browser never
 * receives it.
 *
 *   PLANE_URL=http://plane:8787 PLANE_ADMIN_TOKEN=... \
 *   CONSOLE_AUTH_PASSWORD=... node server/main.mjs
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { proxyTarget } from './proxyPath.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const built = resolve(here, '../public')
const generated = resolve(here, '../.output/public')
const publicDir = process.env.CONSOLE_PUBLIC_DIR ?? (existsSync(built) ? built : generated)
const port = Number(process.env.PORT ?? 8788)
const planeUrl = (process.env.PLANE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const adminToken = process.env.PLANE_ADMIN_TOKEN ?? ''
if (!adminToken) throw new Error('PLANE_ADMIN_TOKEN is required')
// The proxy injects the admin credential for ANY caller, so the console is a
// full management gateway — it must never serve an unauthenticated request.
// HTTP Basic is enough for an ops console: the browser holds the prompt and
// every static asset + proxied call is covered. /console-healthz stays open
// for liveness probes.
const authPassword = process.env.CONSOLE_AUTH_PASSWORD ?? ''
if (!authPassword) throw new Error('CONSOLE_AUTH_PASSWORD is required')
const expectedAuth = Buffer.from(
  `Basic ${Buffer.from(`admin:${authPassword}`).toString('base64')}`
)
const wantsAuth = (req) => {
  const got = Buffer.from(req.headers.authorization ?? '')
  return got.length !== expectedAuth.length || !timingSafeEqual(got, expectedAuth)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/')
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, '')
  const full = join(publicDir, rel === '/' ? 'index.html' : rel)
  if (full !== publicDir && !full.startsWith(publicDir + sep)) return null
  return full
}

function sendFile(req, res, file, status = 200) {
  if (!existsSync(file) || !statSync(file).isFile()) return false
  const type = MIME[extname(file)] ?? 'application/octet-stream'
  const etag = `W/"${statSync(file).size.toString(16)}-${statSync(file).mtimeMs.toString(16)}"`
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304).end()
    return true
  }
  res.writeHead(status, {
    'content-type': type,
    etag,
    'cache-control': file.includes('/_nuxt/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
  return true
}

async function proxy(req, res, target) {
  const headers = { ...req.headers, authorization: `Bearer ${adminToken}` }
  delete headers.host
  delete headers.cookie
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req)
  let upstream
  try {
    upstream = await fetch(`${planeUrl}${target}`, {
      method: req.method,
      headers,
      body,
      redirect: 'manual',
    })
  } catch (error) {
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({ data: null, error: { code: 'PLANE_UNAVAILABLE', message: String(error) } })
    )
    return
  }
  const out = {}
  upstream.headers.forEach((value, key) => {
    if (key !== 'transfer-encoding' && key !== 'connection') out[key] = value
  })
  res.writeHead(upstream.status, out)
  if (upstream.body) {
    for await (const chunk of upstream.body) res.write(chunk)
  }
  res.end()
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > 256 * 1024 * 1024) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolveBody(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  try {
    const url = req.url ?? '/'
    if (url === '/console-healthz') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
      return
    }
    if (wantsAuth(req)) {
      res
        .writeHead(401, { 'www-authenticate': 'Basic realm="openflare-console"' })
        .end('unauthorized')
      return
    }
    const target = proxyTarget(url)
    if (target) {
      await proxy(req, res, target)
      return
    }
    const file = safePath(url)
    if (file && sendFile(req, res, file)) return
    // SPA fallback (Nuxt generate emits 200.html for client routes).
    if (sendFile(req, res, join(publicDir, '200.html'), 200)) return
    if (sendFile(req, res, join(publicDir, 'index.html'), 200)) return
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
  } catch (error) {
    console.error('[openflare-console]', error)
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end('internal error')
    else res.end()
  }
})

server.listen(port, () => {
  console.log(`openflare-console listening on :${port} (plane ${planeUrl})`)
})
