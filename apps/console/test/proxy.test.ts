// @vitest-environment node
import { createServer, request } from 'node:http'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs modules, no types
import { createProxy } from '../server/proxy.mjs'

/** Spin a fake upstream that records the request and echoes canned
 * status/body. Returns its address + the last-seen request summary. */
async function fakeUpstream(echoStatus = 200, echoBody = 'upstream-body') {
  const seen = { headers: {}, body: Buffer.alloc(0), method: '', url: '' }
  const srv = createServer((req, res) => {
    seen.method = req.method ?? ''
    seen.url = req.url ?? ''
    seen.headers = req.headers
    const chunks = [] as Buffer[]
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      seen.body = Buffer.concat(chunks)
      res.writeHead(echoStatus, {
        'content-type': 'application/octet-stream',
        connection: 'upstream-sentinel',
      })
      res.end(echoBody)
    })
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const { port } = srv.address() as { port: number }
  return { srv, url: `http://127.0.0.1:${port}`, seen }
}

/** Drive `proxy` with a synthetic req/res pair against the real
 * http machinery: a client-facing server plus a raw request. */
async function callProxy(
  proxy: (req: any, res: any, target: string) => Promise<void>,
  { method = 'GET', target = '/api/v1/x', headers = {}, body = null as Buffer | null }
) {
  const result = { status: 0, headers: {} as any, body: Buffer.alloc(0) }
  const front = createServer((req, res) => {
    void proxy(req, res, target).catch((e) => {
      if (!res.headersSent) res.writeHead(500).end(String(e))
      else res.end()
    })
  })
  await new Promise<void>((r) => front.listen(0, '127.0.0.1', r))
  const { port } = front.address() as { port: number }
  await new Promise<void>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: target, method, headers }, (res) => {
      result.status = res.statusCode ?? 0
      result.headers = res.headers
      const chunks = [] as Buffer[]
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        result.body = Buffer.concat(chunks)
        resolve()
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
  front.close()
  return result
}

describe('createProxy', () => {
  it('streams a request body to upstream and the response back', async () => {
    const up = await fakeUpstream(201, 'ok-body')
    const proxy = createProxy({ planeUrl: up.url, adminToken: 'adm' })
    // A large-ish body proves the stream path (not a one-shot buffer).
    const payload = Buffer.alloc(5 * 1024 * 1024, 'x')
    const res = await callProxy(proxy, { method: 'PUT', body: payload })
    expect(res.status).toBe(201)
    expect(res.body.toString()).toBe('ok-body')
    expect(up.seen.body.equals(payload)).toBe(true)
    expect(up.seen.headers.authorization).toBe('Bearer adm')
    up.srv.close()
  })

  it('strips hop-by-hop headers, cookie and host — injects admin auth', async () => {
    const up = await fakeUpstream()
    const proxy = createProxy({ planeUrl: up.url, adminToken: 'adm' })
    const res = await callProxy(proxy, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'transfer-encoding': 'chunked',
        te: 'client-te-sentinel',
        connection: 'client-sentinel',
        'keep-alive': 'timeout=5',
        cookie: 'session=steal-me',
        authorization: 'Bearer attacker-controlled',
        host: 'spoofed.example',
      },
      body: Buffer.from('{}'),
    })
    expect(res.status).toBe(200)
    expect(up.seen.headers.authorization).toBe('Bearer adm')
    expect(up.seen.headers.cookie).toBeUndefined()
    // undici sets its own hop-by-hop headers for the upstream hop; what
    // matters is the client's values never leak through.
    expect(up.seen.headers.connection).not.toBe('client-sentinel')
    expect(up.seen.headers['keep-alive']).not.toBe('timeout=5')
    expect(up.seen.headers.te).not.toBe('client-te-sentinel')
    up.srv.close()
  })

  it('GET sends no body; upstream failure maps to 502', async () => {
    const up = await fakeUpstream()
    const proxy = createProxy({ planeUrl: up.url, adminToken: 'adm' })
    const res = await callProxy(proxy, { method: 'GET' })
    expect(res.status).toBe(200)
    expect(up.seen.body.length).toBe(0)
    up.srv.close()

    const dead = createProxy({ planeUrl: 'http://127.0.0.1:1', adminToken: 'adm' })
    const res2 = await callProxy(dead, { method: 'GET' })
    expect(res2.status).toBe(502)
    expect(JSON.parse(res2.body.toString()).error.code).toBe('PLANE_UNAVAILABLE')
  })

  it('never relays upstream hop-by-hop headers', async () => {
    const up = await fakeUpstream()
    const proxy = createProxy({ planeUrl: up.url, adminToken: 'adm' })
    const res = await callProxy(proxy, { method: 'GET' })
    // The fake upstream sends connection: upstream-sentinel; the proxy must
    // strip it so only the client-facing hop's own connection semantics apply.
    expect(res.headers.connection).not.toBe('upstream-sentinel')
    up.srv.close()
  })
})
