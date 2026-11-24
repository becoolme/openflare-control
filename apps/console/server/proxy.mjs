/**
 * Streaming reverse proxy to the plane. Request and response bodies
 * flow through without buffering — bundle uploads can be hundreds of
 * MB and a buffered proxy would let a few parallel uploads exhaust the
 * console's memory. Plane keeps enforcing its own body-size limits at
 * the authoritative boundary.
 */
import { Readable } from 'node:stream'

// Hop-by-hop headers belong to the client↔console hop only; forwarding
// them corrupts the upstream request (a stale content-length or a
// client transfer-encoding desyncs the stream).
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'expect',
])

export function createProxy({ planeUrl, adminToken }) {
  const base = planeUrl.replace(/\/$/, '')
  return async function proxy(req, res, target) {
    const headers = {}
    for (const [key, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(key)) headers[key] = value
    }
    headers.authorization = `Bearer ${adminToken}`
    delete headers.host
    delete headers.cookie
    const init = { method: req.method, headers, redirect: 'manual' }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = Readable.toWeb(req)
      init.duplex = 'half'
    }
    let upstream
    try {
      upstream = await fetch(`${base}${target}`, init)
    } catch (error) {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({ data: null, error: { code: 'PLANE_UNAVAILABLE', message: String(error) } })
      )
      return
    }
    const out = {}
    upstream.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key)) out[key] = value
    })
    res.writeHead(upstream.status, out)
    if (upstream.body) {
      for await (const chunk of upstream.body) res.write(chunk)
    }
    res.end()
  }
}
