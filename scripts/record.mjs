// Records the board in use against the live incident API (headless Chromium video).
// node scripts/record.mjs <boardUrl> <outDir>
// Writes <outDir>/board.webm and <outDir>/events.json (video-relative times, ack receipts).
import { chromium } from 'playwright';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [url, outDir = 'recordings'] = process.argv.slice(2);
if (!url) throw new Error('usage: record.mjs <boardUrl> [outDir]');
mkdirSync(outDir, { recursive: true });

const size = { width: 1280, height: 860 };
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: size,
  locale: 'en-GB',
  timezoneId: 'Europe/Berlin',
  recordVideo: { dir: outDir, size },
});
const t0 = Date.now(); // the video starts with the context's first page
const events = [];
const mmss = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const log = (what, extra = {}) => {
  const ms = Date.now() - t0;
  events.push({ at: mmss(ms), ms, what, ...extra });
  console.log(mmss(ms), what, JSON.stringify(extra));
};

const page = await context.newPage();
page.on('response', async (res) => {
  const u = new URL(res.url());
  if (u.pathname.endsWith('/ack')) {
    const body = await res.json().catch(() => null);
    log('ack-response', { requestedId: u.searchParams.get('id'), body });
  } else if (u.pathname.endsWith('/incidents')) {
    const body = await res.json().catch(() => null);
    const ids = body?.incidents?.map((i) => i.id) ?? [];
    const prev = events.findLast((e) => e.what === 'incidents');
    if (!prev || prev.ids.join() !== ids.join()) log('incidents', { ids });
  }
});

// Recording aids only (outside the board): a visible pointer and a caption line.
await page.addInitScript((t0) => {
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.id = 'rec-pointer';
    dot.style.cssText = 'position:fixed;z-index:99999;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(220,0,80,.55);border:2px solid #fff;box-shadow:0 0 0 1px #c00;pointer-events:none;left:-50px;top:-50px;transition:transform .1s';
    const cap = document.createElement('div');
    cap.id = 'rec-caption';
    cap.style.cssText = 'position:fixed;z-index:99998;left:0;right:0;bottom:0;padding:8px 16px;background:#111;color:#fff;font:14px system-ui;pointer-events:none';
    const clock = document.createElement('div');
    clock.id = 'rec-clock';
    clock.style.cssText = 'position:fixed;z-index:99999;right:12px;bottom:6px;color:#9f9;font:13px ui-monospace,monospace;pointer-events:none';
    const tick = () => { const s = Math.floor((Date.now() - t0) / 1000); clock.textContent = `rec ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
    setInterval(tick, 200); tick();
    document.body.append(dot, cap, clock);
    addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => (dot.style.transform = 'scale(.6)'), true);
    addEventListener('mouseup', () => (dot.style.transform = ''), true);
  });
}, t0);
const caption = (text) => page.evaluate((t) => { const c = document.getElementById('rec-caption'); if (c) c.textContent = t; }, text);
const rowIds = () => page.locator('[data-testid="incident-row"]').evaluateAll((els) => els.map((e) => e.dataset.id));
async function moveTo(locator, steps = 15) {
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps });
  return { x, y };
}

log('goto', { url });
await page.goto(url);
await caption('open-board: opening the board (en-GB, Europe/Berlin)');
await page.locator('[data-testid="incident-row"]').first().waitFor();
log('rows-visible', { ids: await rowIds(), build: await page.locator('meta[name="build"]').getAttribute('content') });
await caption(`open-board: ${await page.locator('[data-testid="incident-row"]').count()} incidents, newest first, local times · build ${(await page.locator('[data-testid="build-sha"]').textContent()).slice(0, 7)}`);
await page.waitForTimeout(1500);

// ack-incident, calm case: pick the 4th row and ack it.
const ids = await rowIds();
const target = ids[3];
await caption(`ack-incident: acking ${target}`);
const btn = page.locator(`[data-testid="incident-row"][data-id="${target}"] [data-testid="ack"]`);
await moveTo(btn);
await page.waitForTimeout(400);
log('click', { aimedAt: target });
await page.mouse.down(); await page.mouse.up();
await page.locator(`[data-id="${target}"] [data-testid="acked"]`).waitFor();
log('acked-mark', { id: target });
await page.waitForTimeout(1200);

// ack-incident, live case: aim at the top row while the board keeps refreshing.
const top = (await rowIds())[0];
await caption(`ack-incident: aiming at the top row ${top} while the board refreshes`);
const topBtn = page.locator(`[data-testid="incident-row"][data-id="${top}"] [data-testid="ack"]`);
await moveTo(topBtn, 25);
log('hover', { aimedAt: top });
const before = (await rowIds()).length;
// Hold the pointer there like a person about to click; click as a person would, ~250 ms after the next refresh lands.
await page.waitForFunction((n) => document.querySelectorAll('[data-testid="incident-row"]').length > n, before, { timeout: 20000, polling: 50 });
log('list-shifted', { ids: await rowIds() });
await page.waitForTimeout(250);
const under = await page.evaluate(() => {
  const d = document.getElementById('rec-pointer').getBoundingClientRect();
  const el = document.elementFromPoint(d.x + d.width / 2, d.y + d.height / 2);
  return el?.closest('[data-testid="incident-row"]')?.dataset.id ?? null;
});
log('click', { aimedAt: top, underPointer: under });
await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(800);
const ackedNow = await page.locator('[data-testid="acked"]').evaluateAll((els) => els.map((e) => e.closest('[data-testid="incident-row"]').dataset.id));
log('acked-rows', { ids: ackedNow });
await caption(`ack-incident: aimed at ${top}; the click acked ${under} — a new incident pushed the rows down`);
await page.mouse.move(80, 820, { steps: 10 });
await page.waitForTimeout(3500);

// watch-board: hands off, the board keeps itself current.
await caption('watch-board: hands off; new incidents keep arriving at the top, acked marks stay');
const watchStart = (await rowIds()).length;
await page.waitForFunction((n) => document.querySelectorAll('[data-testid="incident-row"]').length > n, watchStart, { timeout: 20000 });
log('watch-new-row', { ids: await rowIds() });
await page.waitForTimeout(3000);
log('end', { acked: await page.locator('[data-testid="acked"]').evaluateAll((els) => els.map((e) => e.closest('[data-testid="incident-row"]').dataset.id)) });

const video = page.video();
await context.close();
await browser.close();
const final = join(outDir, 'board.webm');
renameSync(await video.path(), final);
writeFileSync(join(outDir, 'events.json'), JSON.stringify({ url, t0: new Date(t0).toISOString(), events }, null, 2));
console.log('video:', final);
