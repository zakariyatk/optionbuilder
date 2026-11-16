// AddStock AI helper: runs the AI Trade page's Claude analysis on this PC.
//
// Credentials come from the Anthropic SDK's usual chain, so no key is
// stored here: ANTHROPIC_API_KEY if set, otherwise the profile from
// `ant auth login`. The prompt and answer schema are the server's
// (api/lib/ai_trade_spec.json), so both paths give the same kind of answer.
//
// Listens on 127.0.0.1 only. The AddStock page calls it from the browser;
// it answers only the origins below.

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(here, '..', 'api', 'lib', 'ai_trade_spec.json'), 'utf8'));

const PORT = Number(process.env.AI_HELPER_PORT || 8787);
const MODEL = process.env.AI_MODEL || spec.model;
const ORIGINS = new Set([
  'https://optionbuilder.adddots.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  // The Windows app (Tauri) loads the live site, so its origin is the site's.
  ...(process.env.AI_HELPER_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
]);
const MAX_BRIEF = 60_000;

const client = new Anthropic({ timeout: 180_000 });

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    // Chrome's Private Network Access: a public https page may call localhost only if we say so.
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    return true;
  }
  return !origin; // curl and other non-browser callers
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BRIEF * 2) {
        reject(new Error('Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function analyse({ symbol, tf, brief }) {
  const message = await client.beta.messages.create({
    model: MODEL,
    max_tokens: spec.max_tokens,
    // If a safety classifier declines, Anthropic re-runs it on a fallback model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: spec.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: brief }],
    output_config: { effort: spec.effort, format: { type: 'json_schema', schema: spec.schema } },
  });
  if (message.stop_reason === 'refusal') throw Object.assign(new Error('Claude declined to analyse this chart.'), { status: 422 });
  if (message.stop_reason === 'max_tokens') throw new Error('Claude ran out of room before finishing. Try again.');
  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const signal = JSON.parse(text);
  console.log(`${new Date().toLocaleTimeString()}  ${symbol} ${tf}  ${signal.action}  (${message.model}, ${message.usage.input_tokens}+${message.usage.output_tokens} tokens)`);
  return { signal, model: message.model, at: Date.now(), cached: false };
}

const server = createServer(async (req, res) => {
  if (!cors(req, res)) return send(res, 403, { error: 'Origin not allowed' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const path = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true, model: MODEL });
  if (req.method !== 'POST' || path !== '/analyse') return send(res, 404, { error: 'Not found' });

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: 'Send JSON: { symbol, tf, brief }' });
  }
  const brief = typeof body.brief === 'string' ? body.brief : '';
  if (!brief || brief.length > MAX_BRIEF) return send(res, 400, { error: 'brief is empty or too long' });
  try {
    send(res, 200, await analyse({ symbol: String(body.symbol || ''), tf: String(body.tf || ''), brief }));
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      send(res, 401, { error: 'Not signed in to Anthropic. Run "ant auth login" (or set ANTHROPIC_API_KEY), then restart the helper.' });
    } else if (err instanceof Anthropic.RateLimitError) {
      send(res, 503, { error: 'Claude rate limit reached. Try again in a minute.' });
    } else if (err instanceof Anthropic.APIError) {
      send(res, 502, { error: `Claude API error ${err.status ?? ''}: ${err.message}` });
    } else if (err instanceof Anthropic.AnthropicError) {
      // Raised before any request, e.g. no credentials found at all.
      send(res, 401, { error: `No Anthropic login on this PC. Run "ant auth login" (or set ANTHROPIC_API_KEY), then restart the helper. (${err.message})` });
    } else if (err instanceof SyntaxError) {
      send(res, 502, { error: 'Claude did not return a signal.' });
    } else {
      send(res, err.status || 500, { error: err.message || 'Analysis failed' });
    }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`AddStock AI helper on http://127.0.0.1:${PORT}  (model ${MODEL})`);
  console.log('Keep this window open while you use AI Trade with "This PC".');
});
