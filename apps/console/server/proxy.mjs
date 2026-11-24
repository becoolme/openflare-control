/**
 * Streaming reverse proxy to the plane. Request and response bodies
 * flow through without buffering — bundle uploads can be hundreds of
 * MB and a buffered proxy would let a few parallel uploads exhaust the
 * console's memory. Plane keeps enforcing its own body-size limits at
 * the authoritative boundary.
 */
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

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
    // undici transparently decodes compressed bodies; asking for identity
    // keeps the bytes we forward identical to what the headers describe.
    headers['accept-encoding'] = 'identity'
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
    // The streamed body no longer matches a negotiated length/encoding —
    // forwarding either desyncs the client's framing.
    delete out['content-length']
    delete out['content-encoding']
    res.writeHead(upstream.status, out)
    // pipeline applies backpressure both ways and ends `res` — a slow
    // client can't pile the whole response up in memory.
    if (upstream.body) {
      try {
        await pipeline(Readable.fromWeb(upstream.body), res)
      } catch {
        if (!res.headersSent) res.writeHead(502).end()
        else res.destroy()
      }
      return
    }
    res.end()
  }
}
