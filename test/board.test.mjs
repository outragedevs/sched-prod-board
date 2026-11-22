// Browser tests for the board against a mocked incident API (no calls to the course).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const MOCK_API = 'https://mock.invalid/api';
let server, base, browser;

before(async () => {
  server = await serve('app', 0);
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

const inc = (id, minutesAgo, extra = {}) => ({
  id,
  service: 'calendar-sync',
  region: 'eu-west',
  summary: `summary ${id}`,
  severity: 'sev2',
  openedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  ...extra,
});

/** Opens the board with a scripted API. `state.incidents` is what /incidents returns right now. */
async function openBoard({ state, delayFirstMs = 0, context: ctxOpts = {} } = {}) {
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const calls = { incidents: [], ack: [] };
  await page.route(`${base}/config.js`, (r) =>
    r.fulfill({ contentType: 'text/javascript', body: `export const API='${MOCK_API}'; export const SESSION='test-session';` }),
  );
  let n = 0;
  await page.route(`${MOCK_API}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/incidents')) {
      calls.incidents.push(url);
      if (n++ === 0 && delayFirstMs) await new Promise((r) => setTimeout(r, delayFirstMs));
      return route.fulfill({
        json: { updatedAt: new Date().toISOString(), incidents: state.incidents, cursor: `c${n}` },
        headers: { 'access-control-allow-origin': '*' },
      });
    }
    if (url.pathname.endsWith('/ack')) {
      calls.ack.push(url);
      const id = url.searchParams.get('id');
      return route.fulfill({
        json: { id, ackedAt: new Date().toISOString(), receipt: `rcpt-${id}` },
        headers: { 'access-control-allow-origin': '*' },
      });
    }
    return route.abort();
  });
  await page.goto(base + '/');
  return { page, context, calls };
}

const rowIds = (page) => page.locator('[data-testid="incident-row"]').evaluateAll((els) => els.map((e) => e.dataset.id));

test('SCHED-4512: loader shows on open and is gone once incidents are on screen', async () => {
  const state = { incidents: [inc('INC-1', 5)] };
  const { page, context } = await openBoard({ state, delayFirstMs: 800 });
  await page.locator('[data-testid="loader"]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-testid="incident-row"]').count(), 0);
  await page.locator('[data-testid="incident-row"]').first().waitFor();
  assert.equal(await page.locator('[data-testid="loader"]').count(), 0);
  await context.close();
});

test('empty state shows when there are no incidents', async () => {
  const { page, context } = await openBoard({ state: { incidents: [] } });
  await page.locator('[data-testid="empty"]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-testid="loader"]').count(), 0);
  await context.close();
});

test('SCHED-4511 + 4513: a new incident shows at the top without a reload', async () => {
  const state = { incidents: [inc('INC-2', 3), inc('INC-1', 10)] };
  const { page, context, calls } = await openBoard({ state });
  await page.locator('[data-testid="incident-row"]').first().waitFor();
  assert.deepEqual(await rowIds(page), ['INC-2', 'INC-1']);
  const navs = [];
  page.on('framenavigated', (f) => navs.push(f.url()));
  state.incidents = [inc('INC-3', 0), ...state.incidents];
  await page.waitForFunction(() => document.querySelector('[data-testid="incident-row"]')?.dataset.id === 'INC-3', null, { timeout: 4000 });
  assert.deepEqual(await rowIds(page), ['INC-3', 'INC-2', 'INC-1']);
  assert.equal(navs.length, 0, 'no reload');
  // The refresh passes the cursor from the previous answer.
  assert.ok(calls.incidents.slice(1).every((u) => u.searchParams.get('since')?.startsWith('c')));
  await context.close();
});

test('SCHED-4513: refresh runs about every 2 seconds', async () => {
  const { page, context, calls } = await openBoard({ state: { incidents: [inc('INC-1', 1)] } });
  await page.locator('[data-testid="incident-row"]').first().waitFor();
  const start = calls.incidents.length;
  await page.waitForTimeout(6500);
  const extra = calls.incidents.length - start;
  assert.ok(extra >= 2 && extra <= 4, `expected ~3 refreshes in 6.5s, got ${extra}`);
  await context.close();
});

test('SCHED-4511: Ack on a row acks that incident and marks the row; mark survives refreshes', async () => {
  const state = { incidents: [inc('INC-2', 3), inc('INC-1', 10)] };
  const { page, context, calls } = await openBoard({ state });
  const row = page.locator('[data-testid="incident-row"][data-id="INC-1"]');
  await row.locator('[data-testid="ack"]').click();
  await row.locator('[data-testid="acked"]').waitFor();
  assert.equal(calls.ack.length, 1);
  assert.equal(calls.ack[0].searchParams.get('id'), 'INC-1');
  assert.equal(calls.ack[0].searchParams.get('t'), 'test-session');
  assert.ok(calls.ack[0].searchParams.get('cursor'));
  assert.equal(await row.locator('[data-testid="ack"]').count(), 0);
  // Other rows untouched.
  assert.equal(await page.locator('[data-id="INC-2"] [data-testid="ack"]').count(), 1);
  state.incidents = [inc('INC-3', 0), ...state.incidents];
  await page.locator('[data-id="INC-3"]').waitFor();
  await page.waitForTimeout(2500);
  assert.equal(await row.locator('[data-testid="acked"]').count(), 1);
  await context.close();
});

test('incident text is shown as text, not HTML', async () => {
  const state = { incidents: [inc('INC-9', 1, { summary: '<img src=x onerror="window.pwned=1">' })] };
  const { page, context } = await openBoard({ state });
  await page.locator('[data-testid="incident-row"]').first().waitFor();
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  assert.match(await page.locator('.what').first().textContent(), /<img src=x/);
  await context.close();
});

test('SCHED-4514: Auckland and Berlin viewers each see their own zone and order; UTC kept in datetime', async () => {
  const iso = '2026-11-12T03:03:00.000Z';
  const state = { incidents: [inc('INC-1', 0, { openedAt: iso })] };
  const seen = {};
  for (const [name, ctx] of Object.entries({
    auckland: { locale: 'en-NZ', timezoneId: 'Pacific/Auckland' },
    berlin: { locale: 'de-DE', timezoneId: 'Europe/Berlin' },
  })) {
    const { page, context } = await openBoard({ state, context: ctx });
    const t = page.locator('[data-testid="incident-row"] time').first();
    await t.waitFor();
    assert.equal(await t.getAttribute('datetime'), iso);
    seen[name] = (await t.textContent()).trim();
    await context.close();
  }
  assert.equal(seen.auckland, '12/11, 04:03 pm');
  assert.equal(seen.berlin, '12.11., 04:03');
});

test('R6: build placeholder hooks exist (stamped by scripts/build.mjs)', async () => {
  const { page, context } = await openBoard({ state: { incidents: [] } });
  assert.equal(await page.locator('meta[name="build"]').getAttribute('content'), 'dev');
  assert.equal(await page.locator('[data-testid="build-sha"]').textContent(), 'dev');
  await context.close();
});
