import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { readBody, readJson } from './admin/context.js'

/** readBody must enforce the cap while streaming: a body with no honest
 * content-length never gets a chance to be buffered whole. */
const app = new Hono()
app.post('/echo', async (c) => {
  try {
    const body = await readBody(c, 16)
    return c.json({ n: body.length })
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    return c.json({ status }, status as 400)
  }
})
app.post('/json', async (c) => {
  try {
    return c.json({ data: await readJson(c, 32) })
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    return c.json({ status }, status as 400)
  }
})

function streamOf(...sizes: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const size of sizes) controller.enqueue(new Uint8Array(size).fill(120))
      controller.close()
    },
  })
}

describe('readBody', () => {
  it('reads bodies within the cap', async () => {
    const res = await app.request('/echo', { method: 'POST', body: 'hello' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ n: 5 })
  })

  it('rejects a declared oversize before reading', async () => {
    const res = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-length': '9999' },
      body: 'x',
    })
    expect(res.status).toBe(413)
  })

  it('aborts a chunked stream that crosses the cap mid-read', async () => {
    const res = await app.request('/echo', {
      method: 'POST',
      body: streamOf(8, 8, 8), // 24 > 16, no content-length
      // @ts-expect-error — RequestInit.duplex is required for stream bodies
      duplex: 'half',
    })
    expect(res.status).toBe(413)
  })

  it('lets readJson parse a streamed body and reject invalid JSON', async () => {
    const ok = await app.request('/json', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"a":1}'))
          controller.close()
        },
      }),
      // @ts-expect-error — RequestInit.duplex is required for stream bodies
      duplex: 'half',
    })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ data: { a: 1 } })
    const bad = await app.request('/json', { method: 'POST', body: '{nope' })
    expect(bad.status).toBe(400)
  })
})
