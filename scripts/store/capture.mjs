/* Store screenshots, step 1: the real app, driven through each page.

   Opens Option Builder on its recorded market data (cd frontend; npm run
   dev:mock -- --port 5174), signs in (the mock takes any password), builds an
   iron condor from the templates, saves it as a draft, and saves one raw
   screen per scene to out/raw, plus close-ups of the parts the layouts zoom in
   on. compose.mjs turns them into the store images. */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const raw = join(here, 'out', 'raw');
mkdirSync(raw, { recursive: true });
const APP = process.env.APP_URL || 'http://localhost:5174/';
const only = process.argv[2] || 'all';          /* desk | phone | all */

const browser = await chromium.launch({ channel: 'msedge' });

async function open(kind) {
  const desk = kind === 'desk';
  const ctx = await browser.newContext(desk
    ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }
    : { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('[' + kind + '] pageerror', e.message));
  await p.goto(APP + '#builder');
  await p.waitForTimeout(2500);
  const signIn = await p.$('text=Sign in');
  if (signIn) {
    await signIn.click();
    await p.waitForTimeout(1000);
    await p.fill('input[type=password]', 'demo');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(3000);
  }
  /* a clean start: no strategy or drafts from an earlier run */
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) { /* fine */ } });
  await p.reload();
  await p.waitForTimeout(3000);
  return { ctx, p };
}
const settle = (p, ms) => p.waitForTimeout(ms || 1500);
async function shot(p, name) {
  await settle(p);
  await p.screenshot({ path: join(raw, name + '.png') });
  console.log('saved', name);
}
async function go(p, page) {
  await p.evaluate((h) => { location.hash = h; window.scrollTo(0, 0); }, page);
  await settle(p, 3500);
}
/* the smallest element whose text has all of these in it */
function boxOf(p, words) {
  return p.evaluate((words) => {
    const els = [...document.querySelectorAll('section, div, article, aside, form')].filter((el) => {
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return false;
      const t = el.innerText || '';
      return words.every((w) => t.toLowerCase().includes(w.toLowerCase()));
    });
    els.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height);
    const el = els[0];
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  }, words);
}
async function closeUp(p, words, name, pad = 0) {
  const r = await boxOf(p, words);
  if (!r) { console.log('no close-up for', name); return; }
  await settle(p, 800);
  const r2 = await boxOf(p, words);
  await p.screenshot({ path: join(raw, name + '.png'), clip: { x: r2.x - pad, y: r2.y - pad, width: r2.width + pad * 2, height: r2.height + pad * 2 } });
  console.log('saved', name);
}

/* the iron condor, from the templates, with the payoff zoomed in on it */
async function buildCondor(p) {
  await go(p, 'builder');
  await p.click('button:has-text("Templates")');
  await settle(p, 600);
  await p.click('text=Iron condor');
  await settle(p, 2500);
  for (let i = 0; i < 3; i++) { await p.click('button[aria-label="Zoom in"]'); await settle(p, 300); }
  await p.evaluate(() => window.scrollTo(0, 0));
}
async function saveDraft(p) {
  /* the mock keeps drafts for as long as it runs: one is enough */
  if (await p.$('button:has-text("Drafts (")')) return;
  await p.click('button:has-text("Save to drafts")');
  await settle(p, 500);
  await p.fill('input[aria-label="Draft name"]', 'NIFTY iron condor');
  await p.click('form button[type=submit]');
  await settle(p, 1500);
}

async function desk() {
  const { ctx, p } = await open('desk');

  await buildCondor(p);
  await shot(p, 'd1-builder');

  await saveDraft(p);
  await go(p, 'drafts');
  await shot(p, 'd2-drafts');
  /* the draft opened: tracked live */
  await p.click('text=NIFTY iron condor');
  await settle(p, 3000);
  await shot(p, 'd2-draft-live');

  await go(p, 'chain');
  await shot(p, 'd3-chain');

  await go(p, 'oi');
  await shot(p, 'd4-oi');

  await go(p, 'chart');
  await shot(p, 'd5-chart');

  await go(p, 'report');
  await shot(p, 'd6-report');
  /* the first slide of its Instagram carousel */
  await p.click('button:has-text("Instagram post")');
  await settle(p, 4000);
  {
    const r = await p.evaluate(() => {
      const el = [...document.querySelectorAll('img, canvas, div')].filter((e) => e.offsetParent)
        .map((e) => ({ e, r: e.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 400 && r.width < 700 && r.height > 550 && r.height > r.width)
        .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0];
      return el && { x: el.r.left, y: el.r.top, width: el.r.width, height: el.r.height };
    });
    if (r) await p.screenshot({ path: join(raw, 'd6-instagram.png'), clip: r });
    else console.log('no Instagram slide found');
  }
  await p.keyboard.press('Escape');
  await settle(p, 600);

  await go(p, 'portfolio');
  await shot(p, 'd7-portfolio');
  await ctx.close();
}

async function phone() {
  const { ctx, p } = await open('phone');
  await buildCondor(p);
  await shot(p, 'p1-builder');
  await boxOf(p, ['max profit', 'vega']);
  await p.evaluate(() => window.scrollBy(0, -120));
  await shot(p, 'p2-metrics');
  await p.evaluate(() => window.scrollTo(0, 0));
  await saveDraft(p);
  await go(p, 'drafts');
  await p.click('text=NIFTY iron condor');
  await shot(p, 'p3-draft-live');
  for (const [pg, name] of [['drafts', 'p3-drafts'], ['chain', 'p4-chain'], ['chart', 'p5-chart'], ['oi', 'p6-oi'], ['report', 'p7-report'], ['portfolio', 'p8-portfolio']]) {
    await go(p, pg);
    await shot(p, name);
  }
  await ctx.close();
}

if (only === 'all' || only === 'desk') await desk();
if (only === 'all' || only === 'phone') await phone();
await browser.close();
