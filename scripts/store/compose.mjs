/* Store screenshots, step 2: the layouts.

   Takes the real app screens capture.mjs saved in out/raw and lays each one
   out as a store image: a headline, the screen in a laptop or phone, a
   round icon badge and, for some, a zoomed-in card of the part that matters.
   Writes PNGs to out/microsoft-store (1920 x 1080) and out/google-play
   (1080 x 1920 phone screenshots and the 1024 x 500 feature graphic). */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
const raw = join(out, 'raw');
const html = join(out, 'html');
for (const d of [html, join(out, 'microsoft-store'), join(out, 'google-play')]) mkdirSync(d, { recursive: true });

const LOGO = readFileSync(join(here, '../../frontend/public/favicon.svg'), 'utf8').replace(/<\?xml.*?\?>/s, '');
const img = (n) => pathToFileURL(join(raw, n + '.png')).href;

/* ---------------- icons for the round badges ---------------- */
const I = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
const ICON = {
  builder: I('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
  greeks: I('<path d="M3 20h18"/><path d="M5 16l4-6 4 3 6-9"/><circle cx="19" cy="4" r="1.4"/>'),
  drafts: I('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M8 14l3-3 2 2 3-3"/>'),
  chain: I('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M12 4v16"/>'),
  oi: I('<path d="M4 20V10M9 20V4M14 20v-7M19 20V8"/>'),
  chart: I('<path d="M6 4v16M6 8h-2v6h2M12 6v12M12 9h-2v5h2M18 3v15M18 6h-2v8h2"/>'),
  report: I('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  portfolio: I('<path d="M12 3v9l7.8 4.5A9 9 0 1 1 12 3z"/><path d="M15 3.5a9 9 0 0 1 5.5 8.5H15z"/>')
};

/* ---------------- the look ---------------- */
const BLUE = '#7B61FF';
const BASE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=block');
* { box-sizing: border-box; margin: 0; padding: 0 }
html, body { width: var(--w); height: var(--h); overflow: hidden }
body { font-family: Inter, 'Segoe UI', Arial, sans-serif; -webkit-font-smoothing: antialiased; position: relative }
.dark { background: #07080B; color: #fff }
.dark .glow { position: absolute; inset: 0; background:
  radial-gradient(60% 55% at 50% 72%, rgba(123,97,255,.34), rgba(123,97,255,0) 70%),
  radial-gradient(40% 40% at 88% 8%, rgba(123,97,255,.16), rgba(123,97,255,0) 70%) }
.dark .grid { position: absolute; inset: 0; opacity: .5;
  background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
  background-size: 64px 64px; -webkit-mask-image: radial-gradient(70% 70% at 50% 40%, #000, transparent) }
.light { background: #F4F6FA; color: #0A0B0F }
.light .glow { position: absolute; inset: 0; background:
  radial-gradient(60% 55% at 50% 78%, rgba(123,97,255,.20), rgba(123,97,255,0) 70%),
  linear-gradient(180deg, #FFFFFF 0%, #EEF1F7 100%) }
.light .grid { position: absolute; inset: 0; opacity: .7;
  background-image: linear-gradient(rgba(10,11,15,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(10,11,15,.04) 1px, transparent 1px);
  background-size: 64px 64px; -webkit-mask-image: radial-gradient(70% 70% at 50% 40%, #000, transparent) }
.brand { display: inline-flex; align-items: center; gap: 12px; font-weight: 700; letter-spacing: .02em }
.brand svg { display: block; border-radius: 22% }
.dark .brand svg rect { fill: #000 } .dark .brand svg { box-shadow: 0 0 0 1.5px rgba(255,255,255,.25) }
h1 { font-weight: 800; letter-spacing: -.035em; line-height: 1.02 }
h1 em { font-style: normal; color: ${BLUE} }
.sub { font-weight: 500; letter-spacing: -.005em }
.dark .sub { color: #A9B0C0 } .light .sub { color: #4A5163 }
.badge { position: absolute; border-radius: 50%; display: flex; align-items: center; justify-content: center; z-index: 5 }
.dark .badge { background: #fff; color: #07080B; box-shadow: 0 0 0 10px rgba(123,97,255,.22), 0 24px 60px rgba(0,0,0,.55) }
.light .badge { background: #0A0B0F; color: #fff; box-shadow: 0 0 0 10px rgba(123,97,255,.18), 0 24px 60px rgba(10,20,60,.30) }
.badge svg { width: 52%; height: 52% }
.badge::after { content: ''; position: absolute; right: 6%; bottom: 6%; width: 18%; height: 18%; border-radius: 50%; background: ${BLUE};
  box-shadow: 0 0 0 5px var(--bgc) }
.dark { --bgc: #07080B } .light { --bgc: #F4F6FA }
.card { position: absolute; z-index: 6; border-radius: 18px; overflow: hidden; background-repeat: no-repeat; background-color: #fff;
  box-shadow: 0 2px 0 rgba(255,255,255,.6) inset, 0 30px 80px rgba(5,10,30,.45), 0 0 0 1px rgba(10,11,15,.08) }
.dark .card { box-shadow: 0 40px 100px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.12), 0 0 0 7px rgba(123,97,255,.25) }
.light .card { box-shadow: 0 40px 90px rgba(10,20,60,.28), 0 0 0 1px rgba(10,11,15,.08), 0 0 0 7px rgba(123,97,255,.14) }
.pill { display: inline-flex; align-items: center; gap: 10px; padding: 9px 18px 9px 14px; border-radius: 999px; font-weight: 600; font-size: 20px; letter-spacing: .01em }
.dark .pill { background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.14); color: #DCE3F5 }
.light .pill { background: #fff; border: 1px solid rgba(10,11,15,.10); color: #2A3040; box-shadow: 0 6px 18px rgba(10,20,60,.06) }
.pill i { width: 9px; height: 9px; border-radius: 50%; background: ${BLUE}; box-shadow: 0 0 0 4px rgba(123,97,255,.22) }
`;

/* a crop of a raw screen as a card: box in CSS px of the capture, which is
   at `dpr` device pixels per CSS px; shown `k` times its CSS size */
function card(name, box, dpr, rawW, rawH, k, pos) {
  const w = box.w * k, h = box.h * k;
  const bw = rawW / dpr * k, bh = rawH / dpr * k;
  return `<div class="card" style="left:${pos.x}px;top:${pos.y}px;width:${w}px;height:${h}px;
    background-image:url('${img(name)}');background-size:${bw}px ${bh}px;background-position:${-box.x * k}px ${-box.y * k}px"></div>`;
}
function cardImg(name, w, h, pos) {
  return `<div class="card" style="left:${pos.x}px;top:${pos.y}px;width:${w}px;height:${h}px;background:#fff url('${img(name)}') 0 0 / ${w}px ${h}px no-repeat"></div>`;
}
function closeUp(name, w, pos) {
  return `<img class="card" src="${img(name)}" style="left:${pos.x}px;top:${pos.y}px;width:${w}px;height:auto" alt="">`;
}
const badge = (icon, x, y, d) => `<div class="badge" style="left:${x}px;top:${y}px;width:${d}px;height:${d}px">${ICON[icon]}</div>`;

/* ---------------- Microsoft Store: 1920 x 1080, a laptop ---------------- */

function laptop(screen, x, y, w) {
  const sw = w, sh = w * 10 / 16, bez = 18;
  return `
  <div style="position:absolute;left:${x}px;top:${y}px;width:${sw + bez * 2}px;z-index:2">
    <div style="background:linear-gradient(180deg,#24262C,#0E0F12);border-radius:26px 26px 6px 6px;padding:${bez}px ${bez}px ${bez + 8}px;
      box-shadow:0 0 0 1.5px #3A3D45 inset, 0 50px 120px rgba(0,0,0,.45)">
      <div style="width:${sw}px;height:${sh}px;border-radius:6px;overflow:hidden;background:#fff url('${img(screen)}') 0 0 / ${sw}px ${sh}px no-repeat"></div>
    </div>
    <div style="margin:0 -${Math.round(w * 0.07)}px;height:26px;border-radius:2px 2px 22px 22px;
      background:linear-gradient(180deg,#E9ECF2 0%,#C9CED8 55%,#9EA4B0 100%);box-shadow:0 18px 40px rgba(0,0,0,.35)">
      <div style="width:16%;height:9px;margin:0 auto;border-radius:0 0 10px 10px;background:#B4BAC6"></div>
    </div>
  </div>`;
}

function deskSlide(o) {
  const head = `
    <div style="position:absolute;left:0;right:0;top:62px;text-align:center;z-index:3">
      <div class="pill"><i></i>${o.eyebrow}</div>
      <h1 style="font-size:${o.hsize || 76}px;margin-top:22px">${o.title}</h1>
      ${o.sub ? '<p class="sub" style="font-size:27px;margin-top:16px">' + o.sub + '</p>' : ''}
    </div>`;
  const body = o.body || laptop(o.screen, 412, 318, 1060);
  return page(1920, 1080, o.theme, head + body + (o.extra || ''));
}

function page(w, h, theme, inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>:root{--w:${w}px;--h:${h}px}${BASE_CSS}</style></head>
  <body class="${theme}"><div class="glow"></div><div class="grid"></div>${inner}</body></html>`;
}

const DESK = [
  { file: '01-strategy-builder', theme: 'dark', screen: 'd1-builder', eyebrow: 'AddStock',
    title: 'Your Stocks.<br><em>Your Strategy.</em>', hsize: 72,
    extra: badge('builder', 300, 500, 168) },
  { file: '02-drafts', theme: 'light', screen: 'd2-draft-live', eyebrow: 'Draft portfolios',
    title: 'Track every strategy <em>live.</em>', sub: 'Save a strategy to drafts and follow its P&amp;L, leg by leg.',
    extra: badge('drafts', 300, 500, 168) },
  { file: '03-option-chain', theme: 'dark', screen: 'd3-chain', eyebrow: 'Option chain',
    title: 'The full option chain, <em>at a glance.</em>', sub: 'OI, volume, IV and unusual activity, with Buy and Sell on every strike.',
    extra: badge('chain', 300, 500, 168) },
  { file: '04-open-interest', theme: 'light', screen: 'd4-oi', eyebrow: 'Open interest',
    title: 'Read the market’s <em>open interest.</em>', sub: 'OI and OI change by strike, across expiries, for any part of the day.',
    extra: badge('oi', 300, 500, 168) },
  { file: '05-charts', theme: 'dark', screen: 'd5-chart', eyebrow: 'Charts',
    title: 'Charts with <em>indicators and drawings.</em>', sub: 'Candles on every timeframe, a watchlist and alerts.',
    extra: badge('chart', 300, 500, 168) },
  { file: '06-daily-report', theme: 'light', screen: 'd6-report', eyebrow: 'Daily report',
    title: 'A daily market report, <em>ready to share.</em>', sub: 'Levels, PCR, FII/DII flows and global cues. Export as an image or Instagram post.',
    extra: badge('report', 300, 500, 168) + closeUp('d6-instagram', 400, { x: 1410, y: 420 }) },
  { file: '07-portfolio', theme: 'dark', screen: 'd7-portfolio', eyebrow: 'Portfolio',
    title: 'Your portfolio, <em>India and US.</em>', sub: 'Holdings, P&amp;L, allocation and benchmarks in one view.',
    extra: badge('portfolio', 300, 500, 168) }
];

/* ---------------- Google Play: 1080 x 1920, a phone ---------------- */

function phone(screen, x, y, w) {
  const sh = w * 2402 / 1082, bez = 16, SB = 46;
  return `
  <div style="position:absolute;left:${x}px;top:${y}px;width:${w + bez * 2}px;padding:${bez}px;border-radius:78px;z-index:2;
    background:linear-gradient(160deg,#2A2D35,#0B0C0F 60%);box-shadow:0 0 0 2px #3E424C inset, 0 0 0 1px rgba(255,255,255,.08), 0 60px 140px rgba(0,0,0,.5)">
    <div style="position:relative;width:${w}px;height:${sh}px;border-radius:62px;overflow:hidden;background:#F3F4F8 url('${img(screen)}') 0 ${SB}px / ${w}px ${sh}px no-repeat">
      <div style="position:absolute;left:0;right:0;top:0;height:${SB}px;background:#F3F4F8;display:flex;align-items:center;justify-content:space-between;
        padding:4px 44px 0 50px;font:600 19px Inter,'Segoe UI',sans-serif;color:#0A0B0F">
        <span>9:41</span>
        <span style="display:flex;gap:7px;align-items:center">
          <svg width="20" height="14" viewBox="0 0 20 14"><rect x="0" y="9" width="3.5" height="5" rx="1" fill="#0A0B0F"/><rect x="5.5" y="6" width="3.5" height="8" rx="1" fill="#0A0B0F"/><rect x="11" y="3" width="3.5" height="11" rx="1" fill="#0A0B0F"/><rect x="16.5" y="0" width="3.5" height="14" rx="1" fill="#0A0B0F"/></svg>
          <svg width="18" height="14" viewBox="0 0 18 14"><path d="M9 13.5l3-3.6a4.6 4.6 0 0 0-6 0zM2.6 6.9a9.6 9.6 0 0 1 12.8 0l-1.9 2.3a6.7 6.7 0 0 0-9 0zM0 3.8a13.6 13.6 0 0 1 18 0l-1.9 2.2a10.7 10.7 0 0 0-14.2 0z" fill="#0A0B0F"/></svg>
          <svg width="28" height="14" viewBox="0 0 28 14"><rect x=".5" y=".5" width="23" height="13" rx="3.5" fill="none" stroke="#0A0B0F" opacity=".45"/><rect x="2.5" y="2.5" width="16" height="9" rx="2" fill="#0A0B0F"/><rect x="25" y="4.5" width="2" height="5" rx="1" fill="#0A0B0F" opacity=".45"/></svg>
        </span>
      </div>
      <div style="position:absolute;left:50%;top:13px;width:22px;height:22px;margin-left:-11px;border-radius:50%;background:#0B0C0F;box-shadow:0 0 0 3px #1B1D22"></div>
    </div>
  </div>`;
}

function phoneSlide(o) {
  const head = `
    <div style="position:absolute;left:70px;right:70px;top:110px;z-index:3">
      <div class="pill" style="font-size:26px;padding:11px 22px 11px 16px"><i></i>${o.eyebrow}</div>
      <h1 style="font-size:${o.hsize || 98}px;margin-top:30px">${o.title}</h1>
      <p class="sub" style="font-size:36px;margin-top:22px;line-height:1.35">${o.sub}</p>
    </div>`;
  return page(1080, 1920, o.theme, head + phone(o.screen, 230, o.top || 640, 588) + (o.extra || ''));
}

const PHONE = [
  { file: '01-strategy-builder', theme: 'dark', screen: 'p1-builder', eyebrow: 'AddStock', title: 'Your Stocks.<br><em>Your Strategy.</em>',
    sub: 'See the payoff before you trade.', extra: badge('builder', 92, 1040, 168) },
  { file: '02-greeks', theme: 'light', screen: 'p2-metrics', eyebrow: 'Risk &amp; Greeks', title: 'Know your risk<br><em>to the rupee.</em>',
    sub: 'Max profit and loss, breakevens, margin and Greeks.', extra: badge('greeks', 92, 1040, 168) },
  { file: '03-drafts', theme: 'dark', screen: 'p3-draft-live', eyebrow: 'Draft portfolios', title: 'Track strategies<br><em>live.</em>',
    sub: 'Save to drafts and follow the P&amp;L.', extra: badge('drafts', 92, 1040, 168) },
  { file: '04-option-chain', theme: 'light', screen: 'p4-chain', eyebrow: 'Option chain', title: 'The option chain<br><em>in your pocket.</em>',
    sub: 'OI, volume and IV on every strike.', extra: badge('chain', 92, 1040, 168) },
  { file: '05-charts', theme: 'dark', screen: 'p5-chart', eyebrow: 'Charts', title: 'Charts that<br><em>keep up.</em>',
    sub: 'Candles, indicators and drawings.', extra: badge('chart', 92, 1040, 168) },
  { file: '06-open-interest', theme: 'light', screen: 'p6-oi', eyebrow: 'Open interest', title: 'Follow the<br><em>open interest.</em>',
    sub: 'OI change by strike, across expiries.', extra: badge('oi', 92, 1040, 168) },
  { file: '07-daily-report', theme: 'dark', screen: 'p7-report', eyebrow: 'Daily report', title: 'Your market<br><em>morning brief.</em>',
    sub: 'Levels, flows and global cues, ready to share.', extra: badge('report', 92, 1040, 168) },
  { file: '08-portfolio', theme: 'light', screen: 'p8-portfolio', eyebrow: 'Portfolio', title: 'Your portfolio,<br><em>in one place.</em>',
    sub: 'India and US holdings, P&amp;L and allocation.', extra: badge('portfolio', 92, 1040, 168) }
];

/* ---------------- Google Play feature graphic: 1024 x 500 ---------------- */

function feature() {
  const inner = `
    <div style="position:absolute;left:64px;top:90px;z-index:3;width:420px">
      <div class="brand" style="font-size:22px;gap:14px">${LOGO.replace('<svg ', '<svg width="58" height="58" ')}<span>AddStock</span></div>
      <h1 style="font-size:46px;margin-top:28px;white-space:nowrap">Your Stocks.<br><em>Your Strategy.</em></h1>
      <p class="sub" style="font-size:20px;margin-top:18px;max-width:370px;line-height:1.4">See the payoff before you trade, on live NSE data.</p>
    </div>
    <div style="position:absolute;left:520px;top:70px;width:620px;height:400px;border-radius:16px;overflow:hidden;z-index:2;
      background:#fff url('${img('d1-builder')}') 0 0 / 640px 400px no-repeat;box-shadow:0 0 0 1px rgba(255,255,255,.14), 0 40px 90px rgba(0,0,0,.6)"></div>
    <div style="position:absolute;left:478px;top:150px;width:170px;padding:8px;border-radius:30px;z-index:4;
      background:linear-gradient(160deg,#2A2D35,#0B0C0F 60%);box-shadow:0 0 0 1.5px #3E424C inset, 0 30px 70px rgba(0,0,0,.6)">
      <div style="width:154px;height:${154 * 2402 / 1082}px;border-radius:23px;background:#fff url('${img('p1-builder')}') 0 0 / 154px ${154 * 2402 / 1082}px no-repeat"></div>
    </div>`;
  return page(1024, 500, 'dark', inner);
}

/* ---------------- render ---------------- */

const browser = await chromium.launch({ channel: 'msedge' });
async function render(htmlText, w, h, to) {
  const f = join(html, to.split(/[\\/]/).pop().replace('.png', '.html'));
  writeFileSync(f, htmlText);
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.goto(pathToFileURL(f).href, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  await p.screenshot({ path: to });
  await p.close();
  console.log('wrote', to);
}
for (const s of DESK) await render(deskSlide(s), 1920, 1080, join(out, 'microsoft-store', s.file + '.png'));
for (const s of PHONE) await render(phoneSlide(s), 1080, 1920, join(out, 'google-play', 'phone-' + s.file + '.png'));
await render(feature(), 1024, 500, join(out, 'google-play', 'feature-graphic.png'));
await browser.close();
