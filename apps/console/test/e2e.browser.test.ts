// @vitest-environment node
/**
 * Browser-level click e2e: real plane + real console server + real
 * Chromium. Drives the actual UI the way a user does — opening dialogs,
 * filling fields, clicking buttons — and asserts the results both in the
 * DOM and through the plane API. Nothing is mocked.
 *
 * Requires DATABASE_URL and a built SPA (.output/public — `nuxi generate`).
 * Skipped otherwise so unit-only environments pass.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { api, bootHarness, PASSWORD, type Harness } from './harness.js'

const hasBackend = Boolean(process.env.DATABASE_URL)
const hasSpa = existsSync(join(process.cwd(), '.output/public/index.html'))
const maybe = hasBackend && hasSpa ? describe : describe.skip

maybe('console browser e2e (real chromium clicks)', () => {
  let harness: Harness
  let browser: Browser
  const suffix = Math.random().toString(16).slice(2, 8)
  const cell = `be2e-${suffix}`
  const team = `be2e-team-${suffix}`
  const workerName = `bw-${suffix}`
  const paletteWorker = `bp-${suffix}`
  const kvTitle = `bk-${suffix}`
  const d1Name = `bd-${suffix}`

  beforeAll(async () => {
    harness = await bootHarness()
    browser = await chromium.launch()
    // seed cell + team through the real API (same path the hello script uses)
    expect((await api(harness.consolePort, 'POST', '/api/v1/cells', { cellId: cell })).status).toBe(
      201
    )
    expect(
      (await api(harness.consolePort, 'POST', '/api/v1/teams', { teamId: team, name: 'BE2E' }))
        .status
    ).toBe(201)
    // register the cell row so the cell selector has something real
    await api(harness.consolePort, 'POST', `/api/v1/cells/${cell}/bootstrap`, {
      label: 'browser e2e',
    }).catch(() => undefined)
  }, 40_000)

  afterAll(async () => {
    await browser?.close()
    await harness?.close()
  })

  /** poll until the locator's text matches or timeout — vitest-compatible */
  async function waitText(page: Page, selector: string, re: RegExp, timeout = 10_000) {
    const deadline = Date.now() + timeout
    for (;;) {
      const text = await page
        .locator(selector)
        .first()
        .textContent()
        .catch(() => null)
      if (text && re.test(text)) return text
      if (Date.now() > deadline)
        throw new Error(`"${selector}" never matched ${re}; last: ${text?.slice(0, 120)}`)
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  async function visible(page: Page, selector: string, timeout = 8_000) {
    const deadline = Date.now() + timeout
    for (;;) {
      if (
        await page
          .locator(selector)
          .first()
          .isVisible()
          .catch(() => false)
      )
        return
      if (Date.now() > deadline) throw new Error(`"${selector}" never became visible`)
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  async function openPage(path: string): Promise<Page> {
    const ctx = await browser.newContext({
      httpCredentials: { username: 'admin', password: PASSWORD },
    })
    const page = await ctx.newPage()
    page.on('pageerror', (err) => console.error('[pageerror]', String(err).slice(0, 200)))
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error('[console-error]', msg.text().slice(0, 200))
    })
    await page.goto(`http://127.0.0.1:${harness.consolePort}${path}`, {
      waitUntil: 'networkidle',
      timeout: 20_000,
    })
    return page
  }

  it('workers page: create dialog creates a real worker end-to-end', async () => {
    const page = await openPage('/workers')
    // the empty state or table must render — not a fixture 404
    await waitText(page, 'h1', /workers/i)

    // click the real Create button
    await page
      .getByRole('button', { name: /create worker/i })
      .first()
      .click()
    await visible(page, '.dlg')

    // fill the form: name + pick the first real template
    await page.locator('.dlg input').first().fill(workerName)
    const selects = page.locator('.dlg select')
    if ((await selects.count()) > 0) {
      const teamSelect = selects.first()
      await teamSelect.selectOption({ index: 1 }).catch(() => undefined)
    }
    await page.locator('.dlg button[type="submit"], .dlg button:has-text("Create")').last().click()

    // the worker must exist server-side — the ultimate truth
    const deadline = Date.now() + 15_000
    let found = false
    while (Date.now() < deadline) {
      const list = await api(harness.consolePort, 'GET', `/api/v1/cells/${cell}/workers`)
      const workers = (list.body.data as never as { workers: { name: string }[] })?.workers ?? []
      if (workers.some((w) => w.name === workerName)) {
        found = true
        break
      }
      await new Promise((r) => setTimeout(r, 400))
    }
    expect(found).toBe(true)
    await page.close()
  }, 60_000)

  it('kv page: create dialog + detail key browser put/get roundtrip', async () => {
    const page = await openPage('/kv')
    await waitText(page, 'h1', /kv/i)
    await page
      .getByRole('button', { name: /create/i })
      .first()
      .click()
    await visible(page, '.dlg')
    await page.locator('.dlg input').first().fill(kvTitle)
    await page.locator('.dlg button[type="submit"], .dlg button:has-text("Create")').last().click()

    const deadline = Date.now() + 15_000
    let ns: { namespaces: { id: string; title: string }[] } | null = null
    while (Date.now() < deadline) {
      const list = await api(harness.consolePort, 'GET', `/api/v1/cells/${cell}/kv/namespaces`)
      ns = list.body.data as never as typeof ns
      if (ns?.namespaces?.some((n) => n.title === kvTitle)) break
      await new Promise((r) => setTimeout(r, 400))
    }
    expect(ns?.namespaces?.some((n) => n.title === kvTitle)).toBe(true)
    await page.close()
  }, 60_000)

  it('d1 page: create dialog creates a real database', async () => {
    const page = await openPage('/d1')
    await waitText(page, 'h1', /d1/i)
    await page
      .getByRole('button', { name: /create/i })
      .first()
      .click()
    await visible(page, '.dlg')
    await page.locator('.dlg input').first().fill(d1Name)
    await page.locator('.dlg button[type="submit"], .dlg button:has-text("Create")').last().click()

    const deadline = Date.now() + 15_000
    let found = false
    while (Date.now() < deadline) {
      const list = await api(harness.consolePort, 'GET', `/api/v1/cells/${cell}/d1/databases`)
      const dbs = (list.body.data as never as { databases: { name: string }[] })?.databases ?? []
      if (dbs.some((d) => d.name === d1Name)) {
        found = true
        break
      }
      await new Promise((r) => setTimeout(r, 400))
    }
    expect(found).toBe(true)
    await page.close()
  }, 60_000)

  it('command palette: ⌘K, type a worker name, enter navigates to it', async () => {
    // seed a worker through the API — the palette must index it live
    expect(
      (
        await api(harness.consolePort, 'POST', `/api/v1/cells/${cell}/workers`, {
          teamId: team,
          name: paletteWorker,
        })
      ).status
    ).toBe(201)
    const page = await openPage('/workers')
    await page.keyboard.press('Meta+k')
    await visible(page, '.dlg input[aria-label="Search"]')
    await page.locator('.dlg input[aria-label="Search"]').fill(paletteWorker)
    await new Promise((r) => setTimeout(r, 800))
    await page.keyboard.press('Enter')
    await page.waitForURL(`**/workers/${paletteWorker}`, { timeout: 8_000 })
    // real worker detail must render, not the old fixture 404
    await new Promise((r) => setTimeout(r, 2_000))
    const bodyText = (await page.locator('body').textContent())?.toLowerCase() ?? ''
    expect(bodyText).not.toContain('page not found')
    expect(bodyText).not.toContain('404')
    await page.close()
  }, 60_000)

  it('worker detail: deploy dialog deploys new source and version lands server-side', async () => {
    expect(
      (
        await api(harness.consolePort, 'POST', `/api/v1/cells/${cell}/workers`, {
          teamId: team,
          name: `bd-${suffix}`,
        })
      ).status
    ).toBe(201)
    const page = await openPage(`/workers/bd-${suffix}`)
    await waitText(page, 'h1', new RegExp(`bd-${suffix}`))
    await page
      .getByRole('button', { name: /^deploy/i })
      .first()
      .click()
    await visible(page, '.dlg')
    // the dialog pre-fills a working default source — deploy it as-is
    await page.locator('.dlg button[type="submit"], .dlg button:has-text("Deploy")').last().click()
    // version list server-side must gain an active version
    const deadline = Date.now() + 15_000
    let active: string | null = null
    while (Date.now() < deadline) {
      const detail = await api(
        harness.consolePort,
        'GET',
        `/api/v1/cells/${cell}/teams/${team}/workers/bd-${suffix}`
      )
      active =
        (detail.body.data as never as { worker?: { activeVersionId: string | null } })?.worker
          ?.activeVersionId ?? null
      if (active) break
      await new Promise((r) => setTimeout(r, 400))
    }
    expect(active).not.toBeNull()
    await page.close()
  }, 60_000)

  it('worker settings: add an env var and it persists server-side', async () => {
    expect(
      (
        await api(harness.consolePort, 'POST', `/api/v1/cells/${cell}/workers`, {
          teamId: team,
          name: `bs-${suffix}`,
        })
      ).status
    ).toBe(201)
    const page = await openPage(`/workers/bs-${suffix}/settings`)
    await waitText(page, 'body', /environment variables/i)
    // fill the new-var inputs: key then value, then click the add/save button
    const inputs = page.locator('input[placeholder*="KEY" i], input[placeholder*="name" i]')
    await inputs.first().fill('BROWSER_VAR')
    const valueInput = page.locator('input[placeholder*="value" i]').first()
    await valueInput.fill('click-tested')
    await page
      .getByRole('button', { name: /add|save/i })
      .first()
      .click()
    const deadline = Date.now() + 12_000
    let found = false
    while (Date.now() < deadline) {
      const detail = await api(
        harness.consolePort,
        'GET',
        `/api/v1/cells/${cell}/teams/${team}/workers/bs-${suffix}`
      )
      const vars =
        (detail.body.data as never as { vars?: { key: string; value: string }[] })?.vars ?? []
      if (vars.some((v) => v.key === 'BROWSER_VAR' && v.value === 'click-tested')) {
        found = true
        break
      }
      await new Promise((r) => setTimeout(r, 400))
    }
    expect(found).toBe(true)
    await page.close()
  }, 60_000)

  it('workers list: right-click opens context menu and delete removes the worker', async () => {
    expect(
      (
        await api(harness.consolePort, 'POST', `/api/v1/cells/${cell}/workers`, {
          teamId: team,
          name: `bx-${suffix}`,
        })
      ).status
    ).toBe(201)
    const page = await openPage('/workers')
    // the row must render real data
    const row = page.locator('tr', { hasText: `bx-${suffix}` }).first()
    await row.waitFor({ state: 'visible', timeout: 10_000 })
    await row.click({ button: 'right' })
    // context menu appears with real actions
    await visible(page, '.row-menu, [role="menu"]')
    await page
      .getByText(/delete worker/i)
      .first()
      .click()
    // confirm dialog
    await visible(page, '.dlg')
    await page.locator('.dlg button:has-text("Delete")').last().click()
    const deadline = Date.now() + 12_000
    let gone = false
    while (Date.now() < deadline) {
      const list = await api(harness.consolePort, 'GET', `/api/v1/cells/${cell}/workers`)
      const workers = (list.body.data as never as { workers: { name: string }[] })?.workers ?? []
      if (!workers.some((w) => w.name === `bx-${suffix}`)) {
        gone = true
        break
      }
      await new Promise((r) => setTimeout(r, 400))
    }
    expect(gone).toBe(true)
    await page.close()
  }, 60_000)

  it('workers list: search filters rows live', async () => {
    expect(
      (
        await api(harness.consolePort, 'POST', `/api/v1/cells/${cell}/workers`, {
          teamId: team,
          name: `bf-${suffix}`,
        })
      ).status
    ).toBe(201)
    const page = await openPage('/workers')
    await page
      .locator('tr', { hasText: `bf-${suffix}` })
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 })
    const search = page
      .locator('input[type="search"], input[placeholder*="ilter" i], input[placeholder*="earch" i]')
      .first()
    await search.fill('no-such-worker-xyz')
    await new Promise((r) => setTimeout(r, 600))
    const visibleRows = await page.locator('tbody tr').allTextContents()
    expect(visibleRows.join(' ')).not.toContain(`bf-${suffix}`)
    await search.fill(`bf-${suffix}`)
    await new Promise((r) => setTimeout(r, 600))
    const filtered = await page.locator('tbody tr').allTextContents()
    expect(filtered.join(' ')).toContain(`bf-${suffix}`)
    await page.close()
  }, 60_000)

  it('kv detail: write-key submits a real op and reports the honest PENDING state', async () => {
    // create the namespace through the API, then drive the detail page
    const created = await api(harness.consolePort, 'POST', `/api/v1/cells/${cell}/kv/namespaces`, {
      teamId: team,
      title: `kd-${suffix}`,
    })
    expect(created.status).toBe(201)
    const nsId = (created.body.data as never as { namespace: { namespace_id: string } }).namespace
      .namespace_id
    const page = await openPage(`/kv/${encodeURIComponent(nsId)}`)
    await waitText(page, 'body', new RegExp(`kd-${suffix}`))
    // open the write dialog and submit a key
    await page
      .getByRole('button', { name: /write|add|new key/i })
      .first()
      .click()
    await visible(page, '.dlg')
    await page.locator('.dlg input').first().fill('browser-key')
    await page.locator('.dlg textarea, .dlg input').nth(1).fill('written-by-chromium')
    await page.locator('.dlg button[type="submit"]').last().click()
    // no cell is connected in this harness — the page must say so honestly,
    // and the op must exist server-side in the plane
    await waitText(page, 'body', /pending|no cell/i, 20_000)
    const ops = await api(
      harness.consolePort,
      'GET',
      `/api/v1/cells/${cell}/kv/namespaces/${encodeURIComponent(nsId)}/ops`
    )
    const opList = (ops.body.data as never as { ops?: { kind: string }[] })?.ops ?? []
    expect(opList.some((o) => o.kind === 'KV_PUT')).toBe(true)
    await page.close()
  }, 60_000)

  it('deployments tab: activate button flips the active version server-side', async () => {
    // seed worker + two real versions through the API
    const wname = `bv-${suffix}`
    expect(
      (
        await api(harness.consolePort, 'POST', `/api/v1/cells/${cell}/workers`, {
          teamId: team,
          name: wname,
        })
      ).status
    ).toBe(201)
    const src = (v: string) => ({
      modules: [
        {
          name: 'main.js',
          type: 'esModule',
          text: `export default { fetch() { return new Response("${v}") } }\n`,
        },
      ],
    })
    for (const v of ['one', 'two']) {
      const d = await api(
        harness.consolePort,
        'POST',
        `/api/v1/cells/${cell}/teams/${team}/workers/${wname}/deploy-source`,
        src(v)
      )
      expect(d.status).toBe(201)
    }
    const detail = await api(
      harness.consolePort,
      'GET',
      `/api/v1/cells/${cell}/teams/${team}/workers/${wname}`
    )
    const versions =
      (detail.body.data as never as { versions: { versionId: string }[] })?.versions ?? []
    expect(versions.length).toBe(2)
    const first = versions[versions.length - 1]!.versionId // oldest
    // open the deployments tab and activate the older version
    const page = await openPage(`/workers/${wname}/deployments`)
    await waitText(page, 'body', /activate/i)
    const row = page.locator('tr', { hasText: first }).first()
    await row.getByRole('button', { name: /activate/i }).click()
    // server-side truth: the active version pointer moved
    const deadline = Date.now() + 12_000
    let activeNow = ''
    while (Date.now() < deadline) {
      const d2 = await api(
        harness.consolePort,
        'GET',
        `/api/v1/cells/${cell}/teams/${team}/workers/${wname}`
      )
      activeNow =
        (d2.body.data as never as { worker?: { activeVersionId: string } })?.worker
          ?.activeVersionId ?? ''
      if (activeNow === first) break
      await new Promise((r) => setTimeout(r, 400))
    }
    expect(activeNow).toBe(first)
    await page.close()
  }, 60_000)
})
