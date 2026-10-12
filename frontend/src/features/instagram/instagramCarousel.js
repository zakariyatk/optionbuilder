/*
 * Instagram carousel export for the Daily Report tab.
 *
 * Draws a 7-slide 1440×1800 carousel with the Canvas 2D API — no libraries,
 * no network fonts, nothing to taint the canvas — plus a caption, with
 * optional upload to Google Drive. Opened from the report toolbar via
 * openInstagramCarousel(symbol).
 *
 * Kept as plain JS (typed by instagramCarousel.d.ts): it is a self-contained
 * renderer that predates the TypeScript rewrite and works as-is.
 *
 * window.ztInstagram stays exposed for the scheduled archiver, which drives
 * this page in a browser rather than reimplementing the renderer.
 */
import { APP_BASE } from '../../api/client';


// ------------------------------------------------------------------ config

// Derive the deploy base from this script's own URL so the export keeps
// working wherever the app is mounted (currently /app/Optionbuilder/).
var BASE = APP_BASE;

var W = 1600;            // design space — every coordinate below is in these units
var H = 2000;
var OUT_W = 1440;        // exported pixel width (Instagram re-encodes anything wider)
var OUT_H = 1800;

var FONT = '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif';

var BG = '#0a0b11';
var CARD = 'rgba(255,255,255,0.038)';
var CARD_LINE = 'rgba(255,255,255,0.09)';
var HAIRLINE = 'rgba(255,255,255,0.10)';
var WHITE = '#ffffff';
var MUTED = '#8b91a9';
var GREEN = '#22e08c';
var RED = '#ff5a6e';
var YELLOW = '#ffc24b';
var TEAL = '#2dd4bf';

var M = 96;              // left margin
var RM = W - M;          // right margin
var BRAND = 'ZAK TRADE · OPTION BUILDER';
var SOURCE = 'Source: adddots.com/app/Optionbuilder';

// Ambient colour wash per slide. Kept as data so the deck reads as a set
// without every slide looking identical.
var GLOWS = [
  [[210, 260, 760, '#5b46e0', 0.55], [1270, 300, 820, '#0e6b5c', 0.32], [900, 1620, 700, '#7b1f3f', 0.34], [1330, 1860, 620, '#136b45', 0.34]],
  [[210, 240, 720, '#5b46e0', 0.50], [1350, 220, 660, '#7b2340', 0.40], [260, 1700, 700, '#136b45', 0.40], [920, 1900, 620, '#3a2a7a', 0.30]],
  [[210, 240, 720, '#5b46e0', 0.48], [1340, 260, 680, '#7b2340', 0.34], [260, 1720, 700, '#136b45', 0.38], [960, 1880, 600, '#5b2a6a', 0.26]],
  [[250, 260, 760, '#3a46c8', 0.50], [1250, 300, 760, '#0e6b5c', 0.30], [1340, 1760, 700, '#8a5a12', 0.42], [300, 1820, 560, '#3a2a7a', 0.24]],
  [[250, 260, 760, '#3a46c8', 0.48], [1250, 300, 760, '#0e6b5c', 0.28], [1340, 1760, 700, '#8a5a12', 0.40], [300, 1820, 560, '#3a2a7a', 0.22]],
  [[210, 240, 720, '#5b46e0', 0.48], [1270, 250, 720, '#127a4e', 0.44], [260, 1760, 680, '#7b2340', 0.38], [1300, 1900, 560, '#3a2a7a', 0.24]],
  [[260, 250, 700, '#0e6b7a', 0.44], [720, 160, 620, '#3a46c8', 0.34], [1220, 1800, 720, '#6b3ad0', 0.46], [320, 1820, 600, '#8a5a12', 0.28]]
];

// ------------------------------------------------------------- tiny helpers

function el(tag, css, text) {
  var n = document.createElement(tag);
  if (css) n.style.cssText = css;
  if (text != null) n.textContent = text;
  return n;
}

function inr(n) {
  return Number(n).toLocaleString('en-IN');
}

/** Indian market convention: crore above 1e7, lakh above 1e5. */
function oiFmt(n) {
  n = Math.abs(Number(n) || 0);
  if (n >= 1e7) return (n / 1e7).toFixed(2) + ' Cr';
  if (n >= 1e5) return (n / 1e5).toFixed(2) + 'L';
  return inr(Math.round(n));
}

function pct(v) {
  return (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%';
}

function money(v) {
  var s = Math.abs(Number(v)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v >= 0 ? '+' : '-') + '₹' + s + ' Cr';
}

function dayMonthYear(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

/** "Friday · 21 August 2026" — the session the whole deck reports on. */
function weekdayDate(d) {
  var wd = d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Asia/Kolkata' });
  return wd + ' · ' + dayMonthYear(d);
}

/** Calendar date in IST, as YYYY-MM-DD — toISOString() would use UTC and
 *  roll an evening report back to the previous day. */
function istDateKey(d) {
  var p = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return p;
}

/** "2026-08-25" -> "25 Aug 2026", parsed as a plain date (no timezone drift). */
function expiryLabel(iso) {
  if (!iso) return '—';
  var p = String(iso).split('-');
  if (p.length !== 3) return String(iso);
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** NSE hands back "21-Aug-2026"; the compact slot only has room for "21 Aug". */
function flowDate(s, withYear) {
  if (!s) return '';
  var p = String(s).split('-');
  if (p.length !== 3) return String(s);
  return withYear ? p[0] + ' ' + p[1] + ' ' + p[2] : p[0] + ' ' + p[1];
}

/**
 * Strike axis labels. Decided once per chart rather than per bar: mixing
 * "22k" and "22.50k" on the same axis reads as an inconsistency.
 */
function strikeLabeller(strikes) {
  var whole = strikes.every(function (v) { return v % 1000 === 0; });
  return function (v) {
    return whole ? (v / 1000) + 'k' : (v / 1000).toFixed(2) + 'k';
  };
}

function titleCase(s) {
  return String(s).replace(/\b[a-z]/g, function (ch) { return ch.toUpperCase(); });
}

// ---------------------------------------------------------- canvas drawing

function font(c, o) {
  c.font = (o.weight || 700) + ' ' + (o.size || 30) + 'px ' + FONT;
  try { c.letterSpacing = (o.tracking || 0) + 'px'; } catch (e) { /* older engines */ }
}

function measure(c, str, o) {
  c.save();
  font(c, o || {});
  var w = c.measureText(String(str)).width;
  c.restore();
  return w;
}

function ellipsize(c, str, max) {
  str = String(str);
  if (c.measureText(str).width <= max) return str;
  var lo = 0, hi = str.length;
  while (lo < hi) {
    var mid = (lo + hi + 1) >> 1;
    if (c.measureText(str.slice(0, mid) + '…').width <= max) lo = mid; else hi = mid - 1;
  }
  return str.slice(0, lo).replace(/[\s,.;:-]+$/, '') + '…';
}

/** Draws text and returns its measured width, so callers can flow inline. */
function T(c, str, x, y, o) {
  o = o || {};
  c.save();
  font(c, o);
  c.fillStyle = o.color || WHITE;
  c.textAlign = o.align || 'left';
  c.textBaseline = o.baseline || 'alphabetic';
  var s = String(str);
  if (o.maxWidth) s = ellipsize(c, s, o.maxWidth);
  if (o.glow) { c.shadowColor = o.glow; c.shadowBlur = o.glowBlur || 28; }
  c.fillText(s, x, y);
  var w = c.measureText(s).width;
  c.restore();
  return w;
}

/** Largest of `sizes` at which `str` fits `max`; the smallest if none do. */
function fitSize(c, str, max, sizes, weight) {
  for (var i = 0; i < sizes.length; i++) {
    if (measure(c, str, { size: sizes[i], weight: weight }) <= max) return sizes[i];
  }
  return sizes[sizes.length - 1];
}

function rr(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) { c.roundRect(x, y, w, h, r); return; }
  r = Math.min(r, w / 2, h / 2);
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function card(c, x, y, w, h, r, fill, stroke) {
  rr(c, x, y, w, h, r == null ? 28 : r);
  c.fillStyle = fill || CARD;
  c.fill();
  c.strokeStyle = stroke || CARD_LINE;
  c.lineWidth = 2;
  c.stroke();
}

function hexA(hex, a) {
  var h = hex.replace('#', '');
  var n = parseInt(h, 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

function glow(c, x, y, r, color, alpha) {
  var g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, hexA(color, alpha));
  g.addColorStop(0.55, hexA(color, alpha * 0.45));
  g.addColorStop(1, hexA(color, 0));
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
}

function background(c, idx) {
  c.fillStyle = BG;
  c.fillRect(0, 0, W, H);
  var g = GLOWS[idx % GLOWS.length];
  for (var i = 0; i < g.length; i++) glow(c, g[i][0], g[i][1], g[i][2], g[i][3], g[i][4]);

  // Faint dot grid — keeps the large flat areas from banding.
  c.save();
  c.fillStyle = 'rgba(255,255,255,0.035)';
  for (var y = 40; y < H; y += 40) {
    for (var x = 40; x < W; x += 40) c.fillRect(x, y, 2, 2);
  }
  c.restore();
}

function chrome(c, idx, total) {
  c.beginPath();
  c.arc(M + 8, 132, 8, 0, Math.PI * 2);
  c.fillStyle = TEAL;
  c.fill();
  T(c, BRAND, M + 34, 143, { size: 27, weight: 700, tracking: 2.4, color: '#c9cee4' });

  var pageTxt = (idx + 1) + ' / ' + total;
  var pw = measure(c, pageTxt, { size: 26, weight: 800 }) + 54;
  rr(c, RM - pw, 110, pw, 48, 24);
  c.fillStyle = YELLOW;
  c.fill();
  T(c, pageTxt, RM - pw / 2, 143, { size: 26, weight: 800, color: '#1c1400', align: 'center', baseline: 'middle' });

  c.strokeStyle = HAIRLINE;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(M, 1856);
  c.lineTo(RM, 1856);
  c.stroke();
}

function footer(c, left, right) {
  if (left) T(c, left, M, 1912, { size: 24, weight: 700, color: MUTED, maxWidth: 1020 });
  if (right) T(c, right, RM, 1912, { size: 24, weight: 700, color: MUTED, align: 'right' });
}

function heading(c, title, subtitle, y) {
  T(c, title, M, y, { size: 76, weight: 800, color: WHITE });
  if (subtitle) T(c, subtitle, M, y + 58, { size: 30, weight: 700, color: MUTED, maxWidth: RM - M });
}

/** Rounded pill sized to its own text. Returns its width. */
function pill(c, x, y, h, text, o) {
  o = o || {};
  var size = o.size || 30;
  var weight = o.weight || 700;
  var tw = measure(c, text, { size: size, weight: weight });
  var w = o.width || (tw + (o.padX || 34) * 2);
  rr(c, x, y, w, h, h / 2);
  c.fillStyle = o.fill || 'rgba(255,255,255,0.06)';
  c.fill();
  c.strokeStyle = o.stroke || CARD_LINE;
  c.lineWidth = 2;
  c.stroke();
  T(c, text, x + w / 2, y + h / 2 + 2, { size: size, weight: weight, color: o.color || WHITE, align: 'center', baseline: 'middle' });
  return w;
}

function placeholder(c, msg, y) {
  card(c, M, y, RM - M, 220);
  T(c, msg, W / 2, y + 110, { size: 32, weight: 700, color: MUTED, align: 'center', baseline: 'middle', maxWidth: RM - M - 120 });
}

// ------------------------------------------------------------------- model

function get(path) {
  return fetch(BASE + path, { credentials: 'same-origin' }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) throw new Error(j.error || ('Request failed: ' + r.status));
      return j;
    });
  });
}

function settle(p) {
  return p.then(function (v) { return { ok: true, value: v }; },
    function (e) { return { ok: false, error: String(e.message || e) }; });
}

function loadModel(symbol) {
  return Promise.all([
    settle(get('/api/report/max-oi?symbol=' + encodeURIComponent(symbol))),
    settle(get('/api/report/fii-dii')),
    settle(get('/api/report/global')),
    settle(get('/api/report/news')),
    settle(get('/api/spot?symbol=' + encodeURIComponent(symbol)))
  ]).then(function (r) {
    var oi = r[0].ok ? r[0].value : null;
    var flows = r[1].ok ? (r[1].value.data || []) : [];
    var global = r[2].ok ? r[2].value : null;
    var news = r[3].ok ? (r[3].value.items || []) : [];
    var spot = r[4].ok ? r[4].value : null;

    var fii = null, dii = null;
    for (var i = 0; i < flows.length; i++) {
      if (flows[i].category === 'FII') fii = flows[i];
      if (flows[i].category === 'DII') dii = flows[i];
    }

    var current = oi && oi.currentMonthly;
    var change = spot ? spot.price - spot.previousClose : null;
    var changePct = (spot && spot.previousClose) ? (change / spot.previousClose) * 100 : null;

    return {
      symbol: symbol,
      oiError: r[0].ok ? null : r[0].error,
      current: current || null,
      december: (oi && oi.december) || null,
      fii: fii,
      dii: dii,
      global: global,
      news: news,
      spot: spot,
      change: change,
      changePct: changePct,
      closeDate: spot && spot.marketTime ? new Date(spot.marketTime * 1000) : new Date(),
      pcr: current ? current.pcr : null,
      sentiment: global && global.sentiment ? global.sentiment.label : null
    };
  });
}

/** Human label for the index the report is about. */
function indexName(sym) {
  var map = { NIFTY: 'NIFTY 50', BANKNIFTY: 'BANK NIFTY', FINNIFTY: 'FIN NIFTY', MIDCPNIFTY: 'MIDCAP NIFTY' };
  return map[sym] || sym;
}

function biasOf(pcrValue) {
  if (pcrValue == null) return { text: '—', color: MUTED };
  return pcrValue >= 1 ? { text: 'Bullish Tilt', color: YELLOW } : { text: 'Bearish Tilt', color: RED };
}

function sentimentColor(label) {
  if (!label) return MUTED;
  if (/risk-on|positive/i.test(label)) return GREEN;
  if (/risk-off|negative/i.test(label)) return RED;
  return YELLOW;
}

/**
 * The API returns every strike in a wide band around the money, which is far
 * more bars than a phone-sized slide can label. Keep the twelve carrying the
 * most interest — that always includes the two peaks the slide headlines.
 */
function pickBars(dist, limit) {
  if (!dist || !dist.length) return [];
  var rows = dist.slice();
  if (rows.length > limit) {
    rows.sort(function (a, b) { return (b.callOi + b.putOi) - (a.callOi + a.putOi); });
    rows = rows.slice(0, limit);
  }
  rows.sort(function (a, b) { return a.strike - b.strike; });
  return rows;
}

// ------------------------------------------------------------- slide 1 · cover

function slideCover(c, m) {
  pill(c, M, 524, 74, '📅  ' + weekdayDate(m.closeDate), { size: 30, fill: 'rgba(255,255,255,0.07)' });

  T(c, indexName(m.symbol), M, 700, { size: 36, weight: 700, tracking: 4, color: '#9aa1ba' });
  T(c, 'Postmarket', M, 830, { size: 118, weight: 800, color: '#eceaf8' });
  T(c, 'Report', M, 960, { size: 118, weight: 800, color: '#eceaf8' });

  var price = m.spot ? inr(Math.round(m.spot.price)) : '—';
  var pw = T(c, price, M, 1190, { size: 140, weight: 800, color: WHITE });

  if (m.change != null) {
    var up = m.change >= 0;
    var txt = (up ? '▲' : '▼') + '  ' + (up ? '+' : '') + m.change.toFixed(2) + ' (' + m.changePct.toFixed(2) + '%)';
    T(c, txt, M + pw + 48, 1172, { size: 46, weight: 800, color: up ? GREEN : RED });
  }

  // The date now lives in the pill above, so this line is just the label.
  T(c, 'Close', M, 1262, { size: 32, weight: 700, color: MUTED });

  var chips = [
    { label: 'SENTIMENT', value: m.sentiment ? titleCase(m.sentiment) : '—', color: sentimentColor(m.sentiment) },
    { label: 'BIAS', value: biasOf(m.pcr).text, color: biasOf(m.pcr).color }
  ];
  var x = M;
  for (var i = 0; i < chips.length; i++) {
    var vw = measure(c, chips[i].value, { size: 40, weight: 800 });
    var lw = measure(c, chips[i].label, { size: 24, weight: 700, tracking: 2 });
    var cw = Math.max(vw, lw) + 100;
    card(c, x, 1390, cw, 140, 26);
    T(c, chips[i].label, x + 50, 1442, { size: 24, weight: 700, tracking: 2, color: '#9aa1ba' });
    T(c, chips[i].value, x + 50, 1498, { size: 40, weight: 800, color: chips[i].color });
    x += cw + 28;
  }

  footer(c, SOURCE, 'Swipe for full breakdown →');
}

// -------------------------------------------------------- slide 2 · key levels

function slideLevels(c, m) {
  heading(c, '🔑  Key Levels', 'Where option OI is stacked for the current expiry', 700);

  var cur = m.current;
  if (!cur || !cur.maxCallOi || !cur.maxPutOi) {
    placeholder(c, m.oiError ? 'Open-interest data unavailable — connect Upstox' : 'Open-interest data unavailable', 860);
    footer(c, 'Highest Call OI = resistance · Highest Put OI = support', null);
    return;
  }

  var sup = cur.maxPutOi.strike;
  var res = cur.maxCallOi.strike;
  var spot = cur.spot != null ? cur.spot : (m.spot ? m.spot.price : sup);

  var cy = 860, ch = 300;
  card(c, M, cy, RM - M, ch, 30);

  T(c, 'SUPPORT · ' + inr(sup), M + 62, cy + 78, { size: 30, weight: 800, tracking: 1.5, color: GREEN });
  T(c, 'RESISTANCE · ' + inr(res), RM - 62, cy + 78, { size: 30, weight: 800, tracking: 1.5, color: RED, align: 'right' });

  var bx = M + 62, bw = (RM - 62) - bx, by = cy + 120, bh = 24;
  var g = c.createLinearGradient(bx, 0, bx + bw, 0);
  g.addColorStop(0, '#22e08c');
  g.addColorStop(0.5, '#d8d24a');
  g.addColorStop(1, '#ff5a6e');
  rr(c, bx, by, bw, bh, bh / 2);
  c.fillStyle = g;
  c.fill();

  // Marker position, clamped so it never rides off the end of the track.
  var span = res - sup;
  var frac = span > 0 ? (spot - sup) / span : 0.5;
  frac = Math.max(0.02, Math.min(0.98, frac));
  var kx = bx + bw * frac, ky = by + bh / 2;
  c.beginPath();
  c.arc(kx, ky, 30, 0, Math.PI * 2);
  c.fillStyle = '#0b0d14';
  c.fill();
  c.lineWidth = 7;
  c.strokeStyle = WHITE;
  c.stroke();

  T(c, 'Spot ' + inr(Math.round(spot)), W / 2, cy + 232, { size: 42, weight: 800, color: WHITE, align: 'center' });

  var half = (RM - M - 40) / 2;
  var ly = 1210, lh = 260;

  card(c, M, ly, half, lh, 30);
  T(c, 'PCR', M + 52, ly + 62, { size: 26, weight: 700, tracking: 2, color: '#9aa1ba' });
  T(c, cur.pcr == null ? '—' : cur.pcr.toFixed(2), M + 52, ly + 156, { size: 76, weight: 800, color: cur.pcr >= 1 ? GREEN : RED });
  T(c, cur.pcr == null ? 'Put/call ratio' : (cur.pcr >= 1 ? 'Bullish tilt' : 'Bearish tilt'), M + 52, ly + 208, { size: 28, weight: 700, color: WHITE });

  var fx = M + half + 40;
  card(c, fx, ly, half, lh, 30);
  T(c, 'FII / DII NET', fx + 52, ly + 62, { size: 26, weight: 700, tracking: 2, color: '#9aa1ba' });
  if (m.fii && m.dii) {
    var fTxt = (m.fii.net >= 0 ? '+' : '-') + Math.abs(Math.round(m.fii.net));
    var dTxt = (m.dii.net >= 0 ? '+' : '-') + Math.abs(Math.round(m.dii.net));
    var w1 = T(c, fTxt, fx + 52, ly + 150, { size: 60, weight: 800, color: m.fii.net >= 0 ? GREEN : RED });
    var w2 = T(c, ' / ', fx + 52 + w1, ly + 150, { size: 60, weight: 800, color: WHITE });
    T(c, dTxt, fx + 52 + w1 + w2, ly + 150, { size: 60, weight: 800, color: m.dii.net >= 0 ? GREEN : RED });
    T(c, '₹ crore · ' + flowDate(m.fii.date), fx + 52, ly + 206, { size: 26, weight: 700, color: MUTED });
  } else {
    T(c, '—', fx + 52, ly + 150, { size: 60, weight: 800, color: MUTED });
    T(c, '₹ crore', fx + 52, ly + 206, { size: 26, weight: 700, color: MUTED });
  }

  footer(c, 'Highest Call OI = resistance · Highest Put OI = support', null);
}

// ------------------------------------------------- slides 3 & 4 · open interest

function slideOi(c, m, summary, subtitle, pageFooter) {
  heading(c, '📊  Open Interest', subtitle, 700);

  if (!summary || !summary.maxCallOi || !summary.maxPutOi) {
    placeholder(c, m.oiError ? 'Connect Upstox to load open-interest data' : 'No open interest for this expiry', 860);
    footer(c, pageFooter, null);
    return;
  }

  var half = (RM - M - 40) / 2;
  var ty = 860, th = 250;

  peakCard(c, M, ty, half, th, {
    dot: RED, label: 'HIGHEST CALL OI · RESISTANCE', tint: 'rgba(255,90,110,0.30)',
    strike: summary.maxCallOi.strike, oi: summary.maxCallOi.oi,
    ltp: summary.maxCallOi.ltp, delta: summary.maxCallOi.oiChange
  });
  peakCard(c, M + half + 40, ty, half, th, {
    dot: '#9ade4a', label: 'HIGHEST PUT OI · SUPPORT', tint: 'rgba(34,224,140,0.30)',
    strike: summary.maxPutOi.strike, oi: summary.maxPutOi.oi,
    ltp: summary.maxPutOi.ltp, delta: summary.maxPutOi.oiChange
  });

  oiChart(c, m, summary, 1160, 520);

  var py = 1720, ph = 88;
  totalPill(c, M, py, half, ph, 'Total Call OI', oiFmt(summary.totalCallOi), RED);
  totalPill(c, M + half + 40, py, half, ph, 'Total Put OI', oiFmt(summary.totalPutOi), GREEN);

  footer(c, pageFooter, null);
}

function peakCard(c, x, y, w, h, o) {
  card(c, x, y, w, h, 28, CARD, o.tint);
  c.beginPath();
  c.arc(x + 52, y + 60, 11, 0, Math.PI * 2);
  c.fillStyle = o.dot;
  c.fill();
  T(c, o.label, x + 76, y + 70, { size: 24, weight: 800, tracking: 1.6, color: '#b9bfd4', maxWidth: w - 130 });
  T(c, inr(o.strike), x + 42, y + 148, { size: 58, weight: 800, color: WHITE });
  T(c, 'OI ' + oiFmt(o.oi) + '  ·  LTP ₹' + Number(o.ltp).toFixed(2), x + 42, y + 192, { size: 26, weight: 700, color: MUTED });
  var up = o.delta >= 0;
  T(c, (up ? '▲' : '▼') + '  ' + (up ? 'added ' : 'shed ') + oiFmt(o.delta), x + 42, y + 234, { size: 26, weight: 800, color: up ? GREEN : RED });
}

function totalPill(c, x, y, w, h, label, value, color) {
  card(c, x, y, w, h, h / 2);
  T(c, label, x + 46, y + h / 2 + 2, { size: 30, weight: 800, color: WHITE, baseline: 'middle' });
  T(c, value, x + w - 46, y + h / 2 + 2, { size: 32, weight: 800, color: color, align: 'right', baseline: 'middle' });
}

function oiChart(c, m, summary, y, h) {
  var x = M, w = RM - M;
  card(c, x, y, w, h, 30);

  var spot = summary.spot != null ? summary.spot : (m.spot ? m.spot.price : null);
  c.beginPath();
  c.arc(x + 52, y + 52, 9, 0, Math.PI * 2);
  c.fillStyle = GREEN;
  c.fill();
  T(c, 'PUT OI', x + 72, y + 60, { size: 26, weight: 800, tracking: 1.6, color: '#b9bfd4' });
  T(c, 'SPOT ' + (spot == null ? '—' : inr(Math.round(spot))), x + w / 2, y + 60, { size: 26, weight: 800, tracking: 1.6, color: '#b9bfd4', align: 'center' });
  var cw = measure(c, 'CALL OI', { size: 26, weight: 800, tracking: 1.6 });
  T(c, 'CALL OI', x + w - 52, y + 60, { size: 26, weight: 800, tracking: 1.6, color: '#b9bfd4', align: 'right' });
  c.beginPath();
  c.arc(x + w - 52 - cw - 20, y + 52, 9, 0, Math.PI * 2);
  c.fillStyle = RED;
  c.fill();

  var bars = pickBars(summary.distribution, 12);
  if (!bars.length) {
    T(c, 'No strike-wise distribution available', x + w / 2, y + h / 2, { size: 30, weight: 700, color: MUTED, align: 'center', baseline: 'middle' });
    return;
  }

  var px = x + 56, pw = w - 112;
  var pTop = y + 110, pH = 268, baseY = pTop + pH;

  var maxOi = 0;
  for (var i = 0; i < bars.length; i++) maxOi = Math.max(maxOi, bars[i].callOi, bars[i].putOi);
  if (maxOi <= 0) maxOi = 1;

  var slot = pw / bars.length;
  var bw = Math.min(30, slot * 0.32);
  var peakCall = summary.maxCallOi ? summary.maxCallOi.strike : null;
  var peakPut = summary.maxPutOi ? summary.maxPutOi.strike : null;
  var label = strikeLabeller(bars.map(function (b) { return b.strike; }));

  for (var j = 0; j < bars.length; j++) {
    var b = bars[j];
    var mid = px + slot * (j + 0.5);
    drawBar(c, mid - bw - 3, baseY, bw, (b.putOi / maxOi) * pH, GREEN, b.strike === peakPut);
    drawBar(c, mid + 3, baseY, bw, (b.callOi / maxOi) * pH, RED, b.strike === peakCall);

    var isPeak = (b.strike === peakCall || b.strike === peakPut);
    c.save();
    c.translate(mid, baseY + 22);
    c.rotate(-Math.PI / 2);
    T(c, label(b.strike), 0, 8, {
      size: 24, weight: isPeak ? 800 : 700,
      color: isPeak ? WHITE : '#7f869e', align: 'right'
    });
    c.restore();
  }
}

function drawBar(c, x, baseY, w, h, color, highlight) {
  h = Math.max(h, 5);
  c.save();
  if (highlight) { c.shadowColor = color; c.shadowBlur = 26; }
  rr(c, x, baseY - h, w, h, Math.min(6, w / 2));
  c.fillStyle = color;
  c.fill();
  c.restore();
}

// ------------------------------------------------------- slide 5 · global cues

function slideGlobal(c, m) {
  heading(c, '🌐  Global Cues', "Overnight & morning moves shaping today's open", 660);

  var s = m.global && m.global.sentiment;
  if (s) {
    var avg = s.equityAvg == null ? '—' : pct(s.equityAvg);
    var px = M;
    var h = 76, y = 760;
    var label = 'Overall:   ' + s.label + '   ·  global equities avg ' + avg;
    var pw = measure(c, label, { size: 30, weight: 700 }) + 68;
    rr(c, px, y, pw, h, h / 2);
    c.fillStyle = 'rgba(255,255,255,0.06)';
    c.fill();
    c.strokeStyle = CARD_LINE;
    c.lineWidth = 2;
    c.stroke();

    // Drawn in three runs so the sentiment word can carry its own colour.
    var w1 = T(c, 'Overall:   ', px + 34, y + h / 2 + 2, { size: 30, weight: 700, color: WHITE, baseline: 'middle' });
    var w2 = T(c, s.label, px + 34 + w1, y + h / 2 + 2, { size: 30, weight: 800, color: sentimentColor(s.label), baseline: 'middle' });
    T(c, '   ·  global equities avg ' + avg, px + 34 + w1 + w2, y + h / 2 + 2, { size: 30, weight: 700, color: MUTED, baseline: 'middle' });
  }

  var groups = (m.global && m.global.groups) || [];
  if (!groups.length) {
    placeholder(c, 'Global market data unavailable', 900);
    footer(c, 'Rise in crude / USD-INR / VIX reads as a negative for India', null);
    return;
  }

  // Regional-indicator flags have no glyph in Segoe UI Emoji and fall back to
  // bare letters on Windows, so the US card gets a landmark instead.
  var icons = ['🗽', '🌏', '🪙', '⚡'];
  var half = (RM - M - 40) / 2;
  var rowH = 320;

  for (var i = 0; i < Math.min(groups.length, 4); i++) {
    var gx = M + (i % 2) * (half + 40);
    var gy = 900 + Math.floor(i / 2) * (rowH + 40);
    groupCard(c, gx, gy, half, rowH, groups[i], icons[i]);
  }

  footer(c, 'Rise in crude / USD-INR / VIX reads as a negative for India', null);
}

function groupCard(c, x, y, w, h, group, icon) {
  card(c, x, y, w, h, 28);
  T(c, icon + '  ' + group.group.toUpperCase(), x + 40, y + 64, { size: 24, weight: 800, tracking: 1.6, color: '#b9bfd4', maxWidth: w - 80 });

  var items = group.items || [];
  var n = Math.max(items.length, 1);
  var top = y + 128;
  // Spread the rows down the card rather than bunching them under the label.
  var gap = n > 1 ? Math.min(64, (h - 170) / (n - 1)) : 0;

  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var yy = top + gap * i;
    T(c, it.name, x + 40, yy, { size: 32, weight: 700, color: it.ok ? WHITE : MUTED, maxWidth: w * 0.5 });
    if (!it.ok) {
      T(c, '—', x + w - 40, yy, { size: 32, weight: 800, color: MUTED, align: 'right' });
      continue;
    }
    // Colour is from India's point of view: a rise in crude, the rupee rate
    // or a volatility index is a headwind, so it reads red even when green
    // on its own chart.
    var good = it.inverseForIndia ? (it.changePct < 0) : (it.changePct > 0);
    var col = it.changePct === 0 ? MUTED : (good ? GREEN : RED);
    var vw = T(c, pct(it.changePct), x + w - 40, yy, { size: 32, weight: 800, color: col, align: 'right' });
    T(c, good ? '▲' : '▼', x + w - 40 - vw - 16, yy, { size: 28, weight: 800, color: col, align: 'right' });
  }
}

// ------------------------------------------------- slide 6 · institutional flows

function slideFlows(c, m) {
  var when = m.fii ? flowDate(m.fii.date, true) : (m.dii ? flowDate(m.dii.date, true) : '');
  heading(c, '🏦  Institutional Flows', 'Cash-market activity, ₹ crore · Source: NSE' + (when ? ' · ' + when : ''), 660);

  if (!m.fii && !m.dii) {
    placeholder(c, 'FII / DII activity unavailable', 860);
    footer(c, 'Bar length scaled to relative flow size', null);
    return;
  }

  var peak = Math.max(Math.abs(m.fii ? m.fii.net : 0), Math.abs(m.dii ? m.dii.net : 0), 1);
  flowCard(c, M, 840, RM - M, 280, 'DII', m.dii, peak);
  flowCard(c, M, 1160, RM - M, 280, 'FII', m.fii, peak);

  pill(c, M, 1500, 92, '💡  ' + flowInsight(m), { size: 32, weight: 800 });
  footer(c, 'Bar length scaled to relative flow size', null);
}

function flowCard(c, x, y, w, h, name, row, peak) {
  card(c, x, y, w, h, 30);
  T(c, name, x + 52, y + 88, { size: 36, weight: 800, color: WHITE });

  if (!row) {
    T(c, '—', x + w - 52, y + 88, { size: 56, weight: 800, color: MUTED, align: 'right' });
    return;
  }

  var buying = row.net >= 0;
  T(c, money(row.net), x + w - 52, y + 88, { size: 58, weight: 800, color: buying ? GREEN : RED, align: 'right' });

  var bx = x + 52, bw = w - 104, by = y + 132, bh = 28;
  rr(c, bx, by, bw, bh, bh / 2);
  c.fillStyle = 'rgba(255,255,255,0.06)';
  c.fill();

  var fw = Math.max(bw * (Math.abs(row.net) / peak), bh);
  var g = c.createLinearGradient(bx, 0, bx + fw, 0);
  if (buying) { g.addColorStop(0, '#22e08c'); g.addColorStop(1, '#3ec7ff'); }
  else { g.addColorStop(0, '#ff5a6e'); g.addColorStop(1, '#ffa04b'); }
  rr(c, bx, by, fw, bh, bh / 2);
  c.fillStyle = g;
  c.fill();

  T(c, buying ? 'Net buyers' : 'Net sellers', bx, y + 218, { size: 28, weight: 700, color: MUTED });
}

function flowInsight(m) {
  if (!m.fii || !m.dii) return 'Partial institutional data for this session';
  var f = m.fii.net, d = m.dii.net;
  if (d > 0 && f < 0) {
    return d >= Math.abs(f)
      ? 'DIIs absorbed the FII selling today — net domestic support'
      : 'DIIs bought, but not enough to cover the FII outflow';
  }
  if (d > 0 && f > 0) return 'Both FIIs and DIIs were net buyers — broad institutional demand';
  if (d < 0 && f < 0) return 'Both FIIs and DIIs were net sellers — institutions stepped back';
  if (f > 0 && d < 0) return 'FIIs bought while DIIs booked profits';
  return 'Institutional flows were close to flat';
}

// --------------------------------------------------------- slide 7 · news

function slideNews(c, m) {
  heading(c, '📰  Key Market News', "Headlines moving sentiment into tomorrow's session", 660);

  var items = (m.news || []).slice(0, 4);
  var y = 800, h = 480;
  card(c, M, y, RM - M, h, 30);

  if (!items.length) {
    T(c, 'No headlines available', W / 2, y + h / 2, { size: 32, weight: 700, color: MUTED, align: 'center', baseline: 'middle' });
  } else {
    var rowH = h / items.length;
    for (var i = 0; i < items.length; i++) {
      var ry = y + rowH * i;
      if (i > 0) {
        c.strokeStyle = HAIRLINE;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(M + 48, ry);
        c.lineTo(RM - 48, ry);
        c.stroke();
      }
      var tag = items[i].tag || 'MARKET';
      var tw = measure(c, tag, { size: 24, weight: 800, tracking: 1.2 }) + 42;
      rr(c, M + 52, ry + rowH / 2 - 22, tw, 44, 10);
      c.fillStyle = YELLOW;
      c.fill();
      T(c, tag, M + 52 + tw / 2, ry + rowH / 2 + 2, { size: 24, weight: 800, tracking: 1.2, color: '#1c1400', align: 'center', baseline: 'middle' });

      // Headlines arrive clipped to ~66 characters, which still overruns the
      // widest tag. Step the type down before resorting to an ellipsis.
      var headline = items[i].point || items[i].title;
      var tx = M + 52 + tw + 28;
      var avail = (RM - 52) - tx;
      T(c, headline, tx, ry + rowH / 2 + 2, {
        size: fitSize(c, headline, avail, [32, 30, 28, 26], 800),
        weight: 800, color: WHITE, baseline: 'middle', maxWidth: avail
      });
    }
  }

  T(c, 'Follow for daily ' + indexName(m.symbol) + ' reports', W / 2, 1400, { size: 50, weight: 800, color: WHITE, align: 'center' });
  var cta = '🔔  New report every trading day';
  var pw = measure(c, cta, { size: 32, weight: 700 }) + 68;
  pill(c, W / 2 - pw / 2, 1445, 84, cta, { size: 32 });

  footer(c, SOURCE + ' · Daily Report', null);
}

// ------------------------------------------------------------- slide runner

function slideDefs(m) {
  var curSub = 'Current monthly expiry · ' + expiryLabel(m.current && m.current.expiry);
  var decExpiry = m.december && m.december.expiry;
  var decYear = decExpiry ? decExpiry.slice(0, 4) : String(new Date().getFullYear());
  var decSub = 'December ' + decYear + ' expiry · year-end · ' + expiryLabel(decExpiry);

  return [
    { name: 'cover', draw: function (c) { slideCover(c, m); } },
    { name: 'levels', draw: function (c) { slideLevels(c, m); } },
    {
      name: 'oi-current',
      draw: function (c) {
        slideOi(c, m, m.current, curSub, m.current && m.current.pcr != null
          ? 'PCR ' + m.current.pcr.toFixed(2) + ' · ' + (m.current.pcr >= 1 ? 'Bullish tilt' : 'Bearish tilt') : null);
      }
    },
    {
      name: 'oi-december',
      draw: function (c) {
        slideOi(c, m, m.december, decSub, m.december && m.december.pcr != null
          ? 'PCR ' + m.december.pcr.toFixed(2) + ' · ' + (m.december.pcr >= 1 ? 'Bullish tilt' : 'Bearish tilt') : null);
      }
    },
    { name: 'global', draw: function (c) { slideGlobal(c, m); } },
    { name: 'flows', draw: function (c) { slideFlows(c, m); } },
    { name: 'news', draw: function (c) { slideNews(c, m); } }
  ];
}

function renderSlide(def, idx, total) {
  var cv = document.createElement('canvas');
  cv.width = OUT_W;
  cv.height = OUT_H;
  var c = cv.getContext('2d');
  c.scale(OUT_W / W, OUT_H / H);
  c.textBaseline = 'alphabetic';
  background(c, idx);
  chrome(c, idx, total);
  def.draw(c);
  return cv;
}

// ------------------------------------------------------------------ caption

function buildCaption(m) {
  var lines = [];
  var chg = m.change == null ? '' : ' ' + (m.change >= 0 ? '▲ +' : '▼ ') + m.change.toFixed(2) + ' (' + m.changePct.toFixed(2) + '%)';
  lines.push(indexName(m.symbol) + ' Postmarket Report — ' + dayMonthYear(m.closeDate));
  lines.push('');
  lines.push('Close: ' + (m.spot ? inr(Math.round(m.spot.price)) : '—') + chg);

  if (m.current && m.current.maxCallOi && m.current.maxPutOi) {
    lines.push('Support ' + inr(m.current.maxPutOi.strike) + ' · Resistance ' + inr(m.current.maxCallOi.strike));
    if (m.current.pcr != null) {
      lines.push('PCR ' + m.current.pcr.toFixed(2) + ' — ' + (m.current.pcr >= 1 ? 'bullish tilt' : 'bearish tilt'));
    }
  }
  if (m.fii && m.dii) {
    lines.push('FII ' + money(m.fii.net) + ' · DII ' + money(m.dii.net));
  }
  if (m.sentiment) lines.push('Global cues: ' + m.sentiment);

  lines.push('');
  lines.push('Swipe for the full breakdown — key levels, open interest, global cues, institutional flows and the headlines that matter.');
  lines.push('');
  lines.push('Full report: adddots.com/app/Optionbuilder');
  lines.push('');
  lines.push('Educational content only. Not investment advice.');
  lines.push('');
  lines.push('#nifty50 #nifty #optiontrading #stockmarketindia #nse #optionchain #openinterest #niftyanalysis #tradingindia #zaktrade');
  return lines.join('\n');
}

// ------------------------------------------------------------ google drive

/**
 * Uploads the finished deck to Drive.
 *
 * Scope is drive.file — per-file access to what this app itself creates.
 * That is the least privilege that works, and it means the page can never
 * read the rest of the user's Drive. The consequence is that it cannot see
 * a folder created by hand in the Drive UI, so the app makes and remembers
 * its own. Moving that folder in Drive is safe: the id does not change.
 */
var DRIVE_FOLDER = 'Market Report';
var DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
var CLIENT_ID_KEY = 'zt-google-client-id';

function driveClientId() {
  try {
    return window.ZT_GOOGLE_CLIENT_ID || localStorage.getItem(CLIENT_ID_KEY) || '';
  } catch (e) {
    return window.ZT_GOOGLE_CLIENT_ID || '';
  }
}

function setDriveClientId(id) {
  try { localStorage.setItem(CLIENT_ID_KEY, id); } catch (e) { /* private mode */ }
}

/** Google Identity Services, loaded on demand rather than on every page view. */
function loadGis() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) {
    return Promise.resolve();
  }
  return new Promise(function (resolve, reject) {
    var existing = document.querySelector('script[data-zt-gis]');
    if (existing) {
      existing.addEventListener('load', function () { resolve(); });
      existing.addEventListener('error', function () { reject(new Error('Could not load Google sign-in')); });
      return;
    }
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.setAttribute('data-zt-gis', '1');
    s.onload = function () { resolve(); };
    s.onerror = function () { reject(new Error('Could not load Google sign-in')); };
    document.head.appendChild(s);
  });
}

var driveTokenCache = { token: null, expires: 0 };

function driveToken() {
  // Access tokens last an hour; reuse within the session so a second save
  // does not pop the consent window again.
  if (driveTokenCache.token && Date.now() < driveTokenCache.expires - 60000) {
    return Promise.resolve(driveTokenCache.token);
  }
  var id = driveClientId();
  if (!id) return Promise.reject(new Error('NO_CLIENT_ID'));

  return loadGis().then(function () {
    return new Promise(function (resolve, reject) {
      var client = window.google.accounts.oauth2.initTokenClient({
        client_id: id,
        scope: DRIVE_SCOPE,
        callback: function (resp) {
          if (resp && resp.access_token) {
            driveTokenCache.token = resp.access_token;
            driveTokenCache.expires = Date.now() + (Number(resp.expires_in || 3600) * 1000);
            resolve(resp.access_token);
          } else {
            reject(new Error(resp && resp.error ? resp.error : 'Authorisation was cancelled'));
          }
        },
        error_callback: function (err) {
          reject(new Error(err && err.type ? err.type : 'Authorisation failed'));
        }
      });
      client.requestAccessToken({ prompt: '' });
    });
  });
}

function driveFetch(token, url, opts) {
  opts = opts || {};
  opts.headers = opts.headers || {};
  opts.headers.Authorization = 'Bearer ' + token;
  return fetch(url, opts).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) {
        throw new Error((j.error && j.error.message) || ('Drive request failed: ' + r.status));
      }
      return j;
    });
  });
}

/** Existing folder of this name owned by the app, or a new one. */
function driveEnsureFolder(token, name, parentId) {
  var q = "mimeType='application/vnd.google-apps.folder' and trashed=false and name='" +
    String(name).replace(/'/g, "\\'") + "'" +
    (parentId ? " and '" + parentId + "' in parents" : '');
  var url = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) +
    '&fields=' + encodeURIComponent('files(id,name)') + '&pageSize=10';

  return driveFetch(token, url).then(function (res) {
    if (res.files && res.files.length) return res.files[0].id;
    var meta = { name: name, mimeType: 'application/vnd.google-apps.folder' };
    if (parentId) meta.parents = [parentId];
    return driveFetch(token, 'https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta)
    }).then(function (f) { return f.id; });
  });
}

function driveUpload(token, name, mime, blob, folderId) {
  var boundary = '-------zt' + Date.now() + Math.random().toString(16).slice(2);
  var meta = { name: name, parents: [folderId] };
  var body = new Blob([
    '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(meta),
    '\r\n--' + boundary + '\r\nContent-Type: ' + mime + '\r\n\r\n',
    blob,
    '\r\n--' + boundary + '--\r\n'
  ], { type: 'multipart/related; boundary=' + boundary });

  return driveFetch(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
    body: body
  });
}

function canvasBlob(canvas) {
  return new Promise(function (resolve) {
    canvas.toBlob(function (b) { resolve(b); }, 'image/png');
  });
}

/** Overwrite rather than duplicate when the same day is saved twice. */
function driveClearDay(token, folderId) {
  var q = "'" + folderId + "' in parents and trashed=false";
  var url = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) +
    '&fields=' + encodeURIComponent('files(id)') + '&pageSize=100';
  return driveFetch(token, url).then(function (res) {
    var files = res.files || [];
    return files.reduce(function (chain, f) {
      return chain.then(function () {
        return driveFetch(token, 'https://www.googleapis.com/drive/v3/files/' + f.id, { method: 'DELETE' })
          .catch(function () { /* already gone */ });
      });
    }, Promise.resolve());
  }).catch(function () { /* listing failed; upload anyway */ });
}

function saveToDrive(onStatus) {
  if (!S.slides.length || !S.model) return Promise.reject(new Error('Nothing to save yet'));
  var m = S.model;
  var stem = fileStem(m);
  var dayName = istDateKey(m.closeDate) + ' ' + (m.symbol || 'NIFTY');
  var token, dayFolder;

  onStatus('Connecting to Google Drive…');
  return driveToken().then(function (t) {
    token = t;
    onStatus('Opening the ' + DRIVE_FOLDER + ' folder…');
    return driveEnsureFolder(token, DRIVE_FOLDER, null);
  }).then(function (rootId) {
    return driveEnsureFolder(token, dayName, rootId);
  }).then(function (id) {
    dayFolder = id;
    return driveClearDay(token, dayFolder);
  }).then(function () {
    // Sequential: seven parallel multipart uploads reliably trip Drive's
    // per-user rate limit, and the progress readout is more useful anyway.
    return S.slides.reduce(function (chain, cv, i) {
      return chain.then(function () {
        onStatus('Uploading slide ' + (i + 1) + ' of ' + S.slides.length + '…');
        return canvasBlob(cv).then(function (blob) {
          return driveUpload(token, stem + '-' + (i + 1) + '.png', 'image/png', blob, dayFolder);
        });
      });
    }, Promise.resolve());
  }).then(function () {
    onStatus('Uploading caption…');
    var blob = new Blob([buildCaption(m)], { type: 'text/plain;charset=utf-8' });
    return driveUpload(token, stem + '-caption.txt', 'text/plain', blob, dayFolder);
  }).then(function () {
    return { folderId: dayFolder, name: dayName };
  });
}

// --------------------------------------------------------------------- UI

var S = {
  open: false,
  slides: [],
  index: 0,
  model: null
};

function symbolFromDom() {
  var nodes = document.querySelectorAll('div,h1,h2,h3,span');
  for (var i = 0; i < nodes.length; i++) {
    var t = (nodes[i].textContent || '').trim();
    var mm = /^Open interest\s+—\s+([A-Z0-9]+)$/.exec(t);
    if (mm) return mm[1];
  }
  return 'NIFTY';
}

function download(canvas, filename) {
  canvas.toBlob(function (blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }, 'image/png');
}

function fileStem(m) {
  return (m.symbol || 'NIFTY').toLowerCase() + '-postmarket-' + istDateKey(m.closeDate);
}

var ui = {};

function buildModal() {
  var wrap = el('div', 'position:fixed;inset:0;z-index:99999;background:rgba(4,5,9,.86);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:' + FONT);

  var panel = el('div', 'background:#0f1118;border:1px solid rgba(255,255,255,.12);border-radius:18px;width:min(1100px,100%);max-height:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6)');

  var head = el('div', 'display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.10)');
  head.appendChild(el('div', 'font-size:15px;font-weight:700;color:#fff', 'Instagram carousel'));
  ui.status = el('div', 'font-size:12px;color:#8b91a9;margin-right:auto', 'Loading report data…');
  head.appendChild(ui.status);

  ui.btnDrive = el('button', btnCss('#3ec7ff', '#03131c'), 'Save to Drive');
  ui.btnDrive.title = 'Upload the 7 slides and the caption to Google Drive';
  ui.btnAll = el('button', btnCss('#22e08c', '#04120b'), 'Download all 7');
  ui.btnOne = el('button', btnCss(), 'Download this slide');
  ui.btnCap = el('button', btnCss(), 'Copy caption');
  var close = el('button', btnCss(), '✕');
  close.title = 'Close';
  head.appendChild(ui.btnDrive);
  head.appendChild(ui.btnAll);
  head.appendChild(ui.btnOne);
  head.appendChild(ui.btnCap);
  head.appendChild(close);
  panel.appendChild(head);

  var body = el('div', 'display:flex;gap:16px;padding:16px;overflow:auto;align-items:flex-start');
  ui.stage = el('div', 'flex:1;display:flex;align-items:center;justify-content:center;min-height:200px');
  ui.rail = el('div', 'width:110px;display:flex;flex-direction:column;gap:8px;flex:0 0 auto');
  body.appendChild(ui.stage);
  body.appendChild(ui.rail);
  panel.appendChild(body);

  wrap.appendChild(panel);

  close.onclick = closeModal;
  wrap.addEventListener('click', function (e) { if (e.target === wrap) closeModal(); });

  ui.btnAll.onclick = function () {
    if (!S.slides.length) return;
    var stem = fileStem(S.model);
    S.slides.forEach(function (cv, i) {
      setTimeout(function () { download(cv, stem + '-' + (i + 1) + '.png'); }, i * 320);
    });
    ui.status.textContent = 'Downloading 7 slides…';
  };
  ui.btnOne.onclick = function () {
    if (!S.slides.length) return;
    download(S.slides[S.index], fileStem(S.model) + '-' + (S.index + 1) + '.png');
  };
  ui.btnDrive.onclick = function () {
    if (!S.slides.length) return;
    if (!driveClientId()) {
      var id = window.prompt(
        'Paste your Google OAuth Client ID.\n\n' +
        'Create one free at console.cloud.google.com — APIs & Services →\n' +
        'Credentials → Create credentials → OAuth client ID → Web application,\n' +
        'with https://adddots.com as an authorised JavaScript origin.\n\n' +
        'It looks like 1234567890-abc123.apps.googleusercontent.com and is\n' +
        'stored in this browser only.', '');
      if (!id) return;
      setDriveClientId(id.trim());
    }
    ui.btnDrive.disabled = true;
    var restore = ui.btnDrive.textContent;
    ui.btnDrive.textContent = 'Saving…';
    saveToDrive(function (msg) { ui.status.textContent = msg; }).then(function (res) {
      ui.status.textContent = 'Saved to Drive → ' + DRIVE_FOLDER + ' / ' + res.name;
      ui.btnDrive.textContent = 'Saved ✓';
      setTimeout(function () {
        ui.btnDrive.textContent = restore;
        ui.btnDrive.disabled = false;
      }, 2500);
    }).catch(function (e) {
      var msg = String(e.message || e);
      if (msg === 'NO_CLIENT_ID') msg = 'No Google Client ID set.';
      ui.status.textContent = 'Drive save failed: ' + msg;
      ui.btnDrive.textContent = restore;
      ui.btnDrive.disabled = false;
    });
  };

  ui.btnCap.onclick = function () {
    if (!S.model) return;
    var txt = buildCaption(S.model);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () {
        ui.btnCap.textContent = 'Caption copied';
        setTimeout(function () { ui.btnCap.textContent = 'Copy caption'; }, 1800);
      });
    } else {
      window.prompt('Caption', txt);
    }
  };

  ui.wrap = wrap;
  return wrap;
}

function btnCss(bg, fg) {
  return 'border:1px solid rgba(255,255,255,.16);background:' + (bg || 'transparent') +
    ';color:' + (fg || '#e6e8f0') + ';border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit';
}

function showSlide(i) {
  S.index = i;
  ui.stage.innerHTML = '';
  var cv = S.slides[i];
  cv.style.cssText = 'max-height:calc(100vh - 220px);max-width:100%;height:auto;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.5)';
  ui.stage.appendChild(cv);
  Array.prototype.forEach.call(ui.rail.children, function (t, n) {
    t.style.outline = n === i ? '2px solid #22e08c' : '1px solid rgba(255,255,255,.14)';
  });
}

function openModal(symbolArg) {
  if (S.open) return;
  S.open = true;
  document.body.appendChild(buildModal());
  document.addEventListener('keydown', onKey);

  var symbol = symbolArg || symbolFromDom();
  loadModel(symbol).then(function (m) {
    S.model = m;
    var defs = slideDefs(m);
    S.slides = defs.map(function (d, i) { return renderSlide(d, i, defs.length); });

    ui.rail.innerHTML = '';
    S.slides.forEach(function (cv, i) {
      var t = el('img', 'width:100%;border-radius:6px;cursor:pointer;display:block;border:1px solid rgba(255,255,255,.14)');
      t.src = cv.toDataURL('image/png');
      t.onclick = function () { showSlide(i); };
      ui.rail.appendChild(t);
    });
    showSlide(0);

    var warn = [];
    if (!m.current) warn.push('open interest');
    if (!m.fii && !m.dii) warn.push('FII/DII');
    if (!m.global) warn.push('global cues');
    if (!m.news.length) warn.push('news');
    ui.status.textContent = warn.length
      ? '7 slides · 1440×1800 · missing: ' + warn.join(', ')
      : '7 slides · 1440×1800 · ready';
  }).catch(function (e) {
    ui.status.textContent = 'Failed: ' + String(e.message || e);
  });
}

function closeModal() {
  if (!S.open) return;
  S.open = false;
  document.removeEventListener('keydown', onKey);
  if (ui.wrap && ui.wrap.parentNode) ui.wrap.parentNode.removeChild(ui.wrap);
  S.slides = [];
  S.index = 0;
}

function onKey(e) {
  if (e.key === 'Escape') closeModal();
  if (!S.slides.length) return;
  if (e.key === 'ArrowRight') showSlide(Math.min(S.index + 1, S.slides.length - 1));
  if (e.key === 'ArrowLeft') showSlide(Math.max(S.index - 1, 0));
}

/**
 * Small surface for the scheduled archiver, which drives this page in a
 * browser rather than reimplementing the renderer. closeDate() is what lets
 * it tell a real session from a market holiday serving yesterday's close.
 */
window.ztInstagram = {
  open: openModal,
  close: closeModal,
  ready: function () { return S.slides.length; },
  symbol: function () { return S.model ? S.model.symbol : null; },
  stem: function () { return S.model ? fileStem(S.model) : null; },
  closeDate: function () { return S.model ? istDateKey(S.model.closeDate) : null; },
  hasOi: function () { return !!(S.model && S.model.current); },
  caption: function () { return S.model ? buildCaption(S.model) : null; }
};

export { openModal as openInstagramCarousel, closeModal as closeInstagramCarousel };
