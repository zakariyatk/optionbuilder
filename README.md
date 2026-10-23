# Option Builder · ADD DOTS

A workspace for building and analysing NSE options strategies: live option chains
via Upstox, payoff graphs at expiry and on any target date, position Greeks,
broker margin, and a daily market report with image and Instagram export.

Live at <https://optionbuilder.adddots.com/>.

## Features

- **Strategy Builder** – add legs from the chain (B / S), from 9 one-click templates
  (spreads, straddles, strangles, iron condor / butterfly) or by hand; options,
  futures and stock legs (covered calls).
- **Payoff chart** – expiry and Black-Scholes target-date curves, breakevens, zoom/pan.
- **Risk metrics** – max profit / loss, risk:reward, net credit/debit, live Upstox
  SPAN + exposure margin (or a labelled estimate), and Delta / Gamma / Theta / Vega.
- **Saved strategies** – the working strategy survives reloads; name and save up to 50.
- **Option chain** – ITM / ATM shading, unusual-activity detection (OI walls, volume
  surges, build-ups), IV and volume columns, manual-premium mode when offline.
- **Daily Report** – max-OI support/resistance for the monthly and December expiries,
  PCR, FII/DII flows, global cues with an India-centric sentiment read, condensed
  news; export as PNG/JPG or a 7-slide Instagram carousel (with Google Drive upload).
- Light / dark theme, mobile layout, keyboard and screen-reader friendly.

## Project layout

```
frontend/        React 19 + TypeScript + Vite + Tailwind v4 (the app)
  src/api/         typed client for the PHP backend
  src/domain/      pure logic: Black-Scholes, payoff, Greeks, chain analysis, templates (unit-tested)
  src/components/  UI
  src/features/    Daily Report, Instagram carousel
  src/store/       strategy state (zustand, persisted)
  mock/            offline backend with recorded market data for `npm run dev:mock`
api/             PHP 8.1+ backend: auth, Upstox OAuth, chain, margin, report data
deploy/          web-root .htaccess (security headers, caching)
scripts/         release packaging
```

## Develop

Requires Node 20+.

```bash
cd frontend
npm install
npm run dev:mock     # full UI on recorded data — no PHP, broker or market hours needed
npm run dev          # against a real backend (see below)
```

Open <http://localhost:5173/>. In mock mode any password opens the app.

To run against the real PHP backend locally:

```bash
# from the repo root, with PHP 8.1+ installed
php -S localhost:8080 -t . api/index.php
```

`npm run dev` proxies `/api` to `VITE_API_PROXY` (default
`http://localhost:8080`). With no password configured the backend allows
requests from localhost only.

### Quality checks

```bash
npm run typecheck   # TypeScript, strict
npm run lint        # ESLint
npm test            # Vitest — pricing, payoff, Greeks, chain analysis, templates
```

## Configure

Copy `api/config.example.php` and fill it in. Best location is **above the web
root** as `optionbuilder-config.php` (on Hostinger: `/home/<user>/domains/<domain>/optionbuilder-config.php`, next to `public_html`),
where it can never be served. `api/config.php` also works (blocked by `.htaccess`),
or point `OB_CONFIG_FILE` at it.

**Supabase sign-in (recommended).** Set `supabase_url`, `supabase_key` (the
project's publishable or anon key, never the secret one) and `allowed_emails`.
The login page then asks for an email and sends a sign-in code / magic link, and
the password login is switched off. The backend checks each Supabase access
token with Supabase and only lets in the listed addresses, so the project can
be shared with other apps. Accounts are never created from this app.

In the Supabase dashboard:
- Authentication → URL Configuration → **Redirect URLs**: add
  `https://optionbuilder.adddots.com/**` (and `http://localhost:5173/**` for development).
- Optional, for a typed code instead of only a link: Authentication → Emails →
  *Magic Link* template, include `{{ .Token }}`.
- Optional, Google: enable the Google provider (it needs a Google Cloud OAuth
  client with the Supabase callback URL), then set `supabase_google => true`.

To try it with the mock backend, set `MOCK_SUPABASE_URL` and `MOCK_SUPABASE_KEY`
before `npm run dev:mock`.

**Upstox without the daily login (optional).** Upstox access tokens die at
03:30 IST, so Connect is needed once per trading day. Set
`upstox_analytics_token` to a read-only Analytics Token (Upstox Developer Apps
→ Analytics → Generate Token, valid one year) and quotes, charts, the option
chain, OI and the daily report stay live without it. Broker margin still
needs Connect; until then the app shows its margin estimate.

**Password (fallback).** Used only while Supabase sign-in is not set up. Store a
password **hash**, not the password:

```bash
php -r "echo password_hash('your-password', PASSWORD_DEFAULT), PHP_EOL;"
```

## Release & deploy

```bash
cd frontend
npm run release
```

This type-checks, lints, tests, builds, and assembles `release/optionbuilder/`.
Upload its contents to `public_html/opbuilder/`, the folder of the
`optionbuilder.adddots.com` subdomain (pushes to `main` deploy there
automatically). The release never contains
`config.php` or anything from `api/data/`, so the live token and config on the
server are left alone.

The server needs PHP 8.1+ with cURL, and `api/data/` (or your `data_dir`) writable.

## Security model

- Supabase sign-in (email code / magic link, optional Google) limited to an email
  allowlist, the token checked server-side with Supabase, or a single shared password
  (bcrypt hash supported) when Google is not set up. Sessions expire after 12 h,
  5 failed logins per IP lock that IP out for 15 minutes.
- The backend refuses remote requests if no login method is configured.
- Upstox OAuth uses a `state` parameter bound to the session.
- POST routes require `X-Requested-With` and a same-origin `Origin` (CSRF), on top
  of `SameSite=Lax` session cookies.
- CSP, `X-Frame-Options: DENY`, `nosniff` and a strict referrer policy on all pages.
- Broker token and cache live in `api/data/` (blocked from the web) or a `data_dir`
  outside the web root.

*Option Builder is an analysis tool, not investment advice.*
