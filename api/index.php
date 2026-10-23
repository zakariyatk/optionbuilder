<?php
declare(strict_types=1);

/**
 * Front controller. Every request under the backend directory lands here via
 * .htaccess and is dispatched on its path.
 */

require_once __DIR__ . '/lib/config.php';
require_once __DIR__ . '/lib/respond.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/cache.php';
require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/symbols.php';
require_once __DIR__ . '/lib/upstox.php';
require_once __DIR__ . '/lib/chain.php';
require_once __DIR__ . '/lib/markets.php';
require_once __DIR__ . '/lib/us.php';
require_once __DIR__ . '/lib/india.php';
require_once __DIR__ . '/lib/news.php';
require_once __DIR__ . '/lib/report.php';
require_once __DIR__ . '/lib/drafts.php';
require_once __DIR__ . '/lib/candles.php';
require_once __DIR__ . '/lib/oi.php';
require_once __DIR__ . '/lib/portfolio.php';

// Errors must never leak into a JSON body as HTML.
ini_set('display_errors', '0');
error_reporting(E_ALL);

/**
 * Route path, independent of where the backend is mounted.
 *
 * The backend normally lives in an `api/` directory (…/Optionbuilder/api/), so
 * stripping the whole script directory would also eat the `/api` that the
 * routes below are written with. Keep that segment: the frontend uses the same
 * `/api/...` paths whether it is talking to this backend under a subfolder or
 * to the Node one on its own port in development.
 */
function ob_route_path(): string
{
    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');

    if (str_ends_with($base, '/api')) {
        $base = substr($base, 0, -4);
    }
    if ($base !== '' && str_starts_with($uri, $base)) {
        $uri = substr($uri, strlen($base));
    }
    return '/' . trim($uri, '/');
}

$path = ob_route_path();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Frontend is served from the same origin, so no cross-origin allowance is
// needed or wanted. Same-origin only is the safer default for a backend
// holding a broker token.
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('X-Frame-Options: DENY');

try {
    // A config file that doesn't parse to settings stops everything, loudly.
    ob_require_valid_config();
    // Refuse to serve a public deployment that has no password configured.
    ob_require_configured_password();
    // Every POST must come from this app's own pages.
    ob_require_same_origin();

    // ------------------------------------------------------------- public
    if ($path === '/api/health') {
        ob_json(['ok' => true]);
    }

    if ($path === '/api/session' && $method === 'GET') {
        ob_json([
            'authRequired' => !ob_auth_disabled(),
            'loggedIn' => ob_is_logged_in(),
            // Public by design: the browser needs it to start a Supabase sign-in.
            'supabase' => ob_supabase_public_config(),
            'passwordLogin' => ob_password_login_enabled(),
        ]);
    }

    if ($path === '/api/login/supabase' && $method === 'POST') {
        $lockedFor = ob_login_locked_for();
        if ($lockedFor > 0) {
            header('Retry-After: ' . $lockedFor);
            ob_error('Too many attempts. Try again in ' . (int) ceil($lockedFor / 60) . ' min.', 429);
        }

        $accessToken = (string) (ob_body()['access_token'] ?? '');
        if (!ob_login_supabase($accessToken)) {
            ob_login_record_failure();
            ob_error('This account is not allowed to open Option Builder', 401);
        }
        ob_login_clear_failures();
        ob_json(['ok' => true]);
    }

    if ($path === '/api/login' && $method === 'POST') {
        $lockedFor = ob_login_locked_for();
        if ($lockedFor > 0) {
            header('Retry-After: ' . $lockedFor);
            ob_error('Too many attempts. Try again in ' . (int) ceil($lockedFor / 60) . ' min.', 429);
        }

        $password = (string) (ob_body()['password'] ?? '');
        if (!ob_login($password)) {
            ob_login_record_failure();
            // Slow brute force without making a real attempt feel broken.
            usleep(400_000);
            ob_error('Incorrect password', 401);
        }
        ob_login_clear_failures();
        ob_json(['ok' => true]);
    }

    // ----------------------------------------------------- everything below
    if (!ob_is_logged_in()) {
        ob_error('LOGIN_REQUIRED', 401);
    }

    if ($path === '/api/logout' && $method === 'POST') {
        ob_logout_session();
        ob_json(['ok' => true]);
    }

    // --------------------------------------------------------- upstox auth
    if ($path === '/api/auth/status') {
        ob_json([
            'configured' => ob_upstox_configured(),
            'authenticated' => ob_has_valid_token(),
            // Quotes, candles and chains work: today's login or the 1-year analytics token.
            'marketData' => ob_has_market_data(),
            'analytics' => ob_analytics_token() !== '',
            'token' => ob_token_info(),
            'loginUrl' => ob_upstox_configured() ? '/api/auth/upstox/login' : null,
        ]);
    }

    if ($path === '/api/auth/upstox/login') {
        if (!ob_upstox_configured()) {
            http_response_code(400);
            exit('Upstox is not configured. Fill in the config file.');
        }
        // OAuth `state`: binds the callback to this browser session, so nobody
        // can trick the app into storing *their* broker account's token.
        ob_session_start();
        $state = bin2hex(random_bytes(16));
        $_SESSION['ob_oauth_state'] = $state;
        header('Location: ' . ob_upstox_auth_url($state), true, 302);
        exit;
    }

    if ($path === '/api/auth/upstox/callback') {
        $code = ob_query('code');
        if ($code === null) {
            http_response_code(400);
            exit('Missing authorization code from Upstox.');
        }
        ob_session_start();
        $expected = (string) ($_SESSION['ob_oauth_state'] ?? '');
        unset($_SESSION['ob_oauth_state']);
        if ($expected === '' || !hash_equals($expected, (string) ob_query('state'))) {
            http_response_code(400);
            exit('Upstox login could not be verified (state mismatch). Start again from the app.');
        }
        try {
            ob_upstox_exchange_code($code);
            ob_cache_clear();
            header('Content-Type: text/html; charset=utf-8');
            exit('<!doctype html><meta charset="utf-8"><title>Upstox connected</title>'
                . '<body style="font:16px system-ui;padding:40px;max-width:32rem">'
                . '<h2>Upstox connected</h2><p>Live option chain and broker margins are now enabled. '
                . 'You can close this tab and return to the app.</p></body>');
        } catch (Throwable $e) {
            http_response_code(502);
            exit('Upstox authorization failed: ' . htmlspecialchars($e->getMessage(), ENT_QUOTES));
        }
    }

    if ($path === '/api/auth/logout' && $method === 'POST') {
        ob_clear_token();
        ob_cache_clear();
        ob_json(['ok' => true]);
    }

    // --------------------------------------------------------- market data
    if ($path === '/api/symbols') {
        ob_json(['indices' => OB_INDEX_SYMBOLS, 'all' => ob_all_symbols()]);
    }

    if ($path === '/api/spot') {
        $symbol = strtoupper(ob_query('symbol') ?? '');
        if ($symbol === '') {
            ob_error('symbol query param is required', 400);
        }
        try {
            ob_json(ob_cached("spot:$symbol", fn() => ob_spot_price($symbol), OB_TTL_QUOTE));
        } catch (Throwable $e) {
            ob_error('Failed to fetch spot price', 502, $e->getMessage());
        }
    }

    // Watchlist: spot quotes for up to 30 symbols, sharing the per-symbol spot cache.
    if ($path === '/api/watch') {
        $symbols = array_values(array_unique(array_filter(
            array_map(static fn(string $v): string => strtoupper(trim($v)), explode(',', ob_query('symbols') ?? '')),
            static fn(string $v): bool => ob_symbol_ok($v)
        )));
        if (!$symbols || count($symbols) > 30) {
            ob_error('symbols must list 1–30 symbols', 400);
        }
        // Upstox when connected (live NSE), else the Yahoo spot feed. Neither
        // falls back to an old snapshot for long: a list that silently stops
        // moving is worse than a "—" for a symbol that can't be quoted.
        $live = [];
        // US symbols always come from Yahoo; Upstox has no US market data.
        $nse = array_values(array_filter($symbols, static fn(string $s): bool => !ob_is_us($s)));
        if ($nse && ob_has_market_data()) {
            try {
                $live = ob_cached('watch:' . md5(implode(',', $nse)), fn() => ob_upstox_watch_quotes($nse), 2, 0);
            } catch (Throwable) {
                $live = [];
            }
        }
        $quotes = [];
        $missing = [];
        foreach ($symbols as $symbol) {
            $quote = $live[$symbol] ?? ob_cache_get("spot:$symbol", OB_TTL_WATCH);
            if ($quote !== null) {
                $quotes[$symbol] = $quote;
            } else {
                $missing[] = $symbol;
            }
        }
        if ($missing) {
            $fetched = ob_spot_prices($missing);
            foreach ($missing as $symbol) {
                if (isset($fetched[$symbol])) {
                    ob_cache_put("spot:$symbol", $fetched[$symbol]);
                }
                // One bad or unlisted symbol shouldn't blank the whole list.
                $quotes[$symbol] = $fetched[$symbol] ?? ob_cache_get("spot:$symbol", OB_MAX_STALE_QUOTE) ?? ['symbol' => $symbol, 'error' => true];
            }
        }
        ob_json(['quotes' => array_map(static fn(string $s): array => $quotes[$s], $symbols)]);
    }

    if ($path === '/api/candles') {
        $symbol = strtoupper(ob_query('symbol') ?? '');
        $tf = ob_query('tf') ?? '15m';
        if (!ob_symbol_ok($symbol) || !isset(OB_CANDLE_TIMEFRAMES[$tf])) {
            ob_error('symbol and a valid tf are required', 400);
        }
        // US symbols chart from Yahoo, so they work without a broker login.
        if (ob_is_us($symbol)) {
            try {
                $ttl = OB_CANDLE_TIMEFRAMES[$tf][3];
                ob_json(['symbol' => $symbol, 'tf' => $tf, 'candles' => ob_cached("candles:$symbol:$tf", fn() => ob_yahoo_candles($symbol, $tf), $ttl)]);
            } catch (Throwable $e) {
                ob_error('Failed to fetch candles', 502, $e->getMessage());
            }
        }
        if (!ob_has_market_data()) {
            ob_error('NOT_AUTHENTICATED', 401);
        }
        try {
            $ttl = OB_CANDLE_TIMEFRAMES[$tf][3];
            ob_json(['symbol' => $symbol, 'tf' => $tf, 'candles' => ob_cached("candles:$symbol:$tf", fn() => ob_candles($symbol, $tf), $ttl)]);
        } catch (ObNotAuthenticated) {
            ob_error('NOT_AUTHENTICATED', 401);
        } catch (Throwable $e) {
            ob_error('Failed to fetch candles', 502, $e->getMessage());
        }
    }

    if ($path === '/api/oi-intraday') {
        $symbol = strtoupper(ob_query('symbol') ?? '');
        $expiry = ob_query('expiry') ?? '';
        $min = (float) (ob_query('min') ?? 0);
        $max = (float) (ob_query('max') ?? 0);
        if (!preg_match('/^[A-Z0-9&_\-]{1,20}$/', $symbol) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $expiry) || !($max > $min)) {
            ob_error('symbol, expiry and a min < max strike range are required', 400);
        }
        if (!ob_has_market_data()) {
            ob_error('NOT_AUTHENTICATED', 401);
        }
        try {
            ob_json(ob_cached("oi:$symbol:$expiry:$min:$max", fn() => ob_oi_intraday($symbol, $expiry, $min, $max), 60));
        } catch (ObNotAuthenticated) {
            ob_error('NOT_AUTHENTICATED', 401);
        } catch (InvalidArgumentException $e) {
            ob_error($e->getMessage(), 400);
        } catch (Throwable $e) {
            ob_error('Failed to build OI history', 502, $e->getMessage());
        }
    }

    if ($path === '/api/option-chain') {
        $symbol = strtoupper(ob_query('symbol') ?? '');
        $expiry = ob_query('expiry');
        if ($symbol === '') {
            ob_error('symbol query param is required', 400);
        }
        if (!ob_has_market_data()) {
            ob_error('Failed to fetch option chain', 502, 'NOT_AUTHENTICATED');
        }

        try {
            $key = "chain:$symbol:" . ($expiry ?? 'default');
            ob_json(ob_cached($key, function () use ($symbol, $expiry) {
                $instrumentKey = ob_resolve_instrument_key($symbol);
                ['expiries' => $expiries, 'lotSize' => $lotSize] = ob_option_contracts($instrumentKey);
                $target = ($expiry !== null && in_array($expiry, $expiries, true)) ? $expiry : ($expiries[0] ?? null);
                if ($target === null) {
                    throw new RuntimeException("No option expiries returned for $symbol");
                }
                $data = ob_option_chain_raw($instrumentKey, $target);
                return ob_reshape_chain($data, $symbol, $expiries, $target, $lotSize);
            }, OB_TTL_QUOTE));
        } catch (ObNotAuthenticated) {
            ob_error('Failed to fetch option chain', 502, 'NOT_AUTHENTICATED');
        } catch (Throwable $e) {
            ob_error('Failed to fetch option chain', 502, $e->getMessage());
        }
    }

    if ($path === '/api/margin' && $method === 'POST') {
        $legs = ob_body()['legs'] ?? [];
        if (!is_array($legs) || !$legs) {
            ob_error('legs array is required', 400);
        }
        if (!ob_has_valid_token()) {
            ob_error('NOT_AUTHENTICATED', 401);
        }

        $instruments = [];
        foreach ($legs as $leg) {
            if (($leg['instrumentKey'] ?? '') === '') {
                continue;
            }
            $instruments[] = [
                'instrument_key' => (string) $leg['instrumentKey'],
                'quantity' => abs((int) ($leg['quantity'] ?? 0)),
                'transaction_type' => (($leg['action'] ?? '') === 'SELL') ? 'SELL' : 'BUY',
                'product' => 'D',
            ];
        }
        if (!$instruments) {
            ob_error('No legs carried an Upstox instrument key', 400);
        }

        try {
            ob_json(ob_upstox_margin($instruments));
        } catch (ObNotAuthenticated) {
            ob_error('NOT_AUTHENTICATED', 401);
        } catch (Throwable $e) {
            ob_error('Failed to fetch margin', 502, $e->getMessage());
        }
    }

    if ($path === '/api/quotes') {
        $keys = array_values(array_unique(array_filter(
            array_map('trim', explode(',', ob_query('keys') ?? '')),
            static fn(string $k): bool => (bool) preg_match('/^[A-Za-z_]+\|[\w\- ]{1,48}$/', $k)
        )));
        if (!$keys || count($keys) > 200) {
            ob_error('keys must list 1–200 instrument keys', 400);
        }
        if (!ob_has_market_data()) {
            ob_error('NOT_AUTHENTICATED', 401);
        }
        sort($keys);
        try {
            $quotes = ob_cached('ltp:' . md5(implode(',', $keys)), fn() => ob_upstox_ltp($keys), 5);
            ob_json(['quotes' => (object) $quotes, 'at' => (int) round(microtime(true) * 1000)]);
        } catch (ObNotAuthenticated) {
            ob_error('NOT_AUTHENTICATED', 401);
        } catch (Throwable $e) {
            ob_error('Failed to fetch quotes', 502, $e->getMessage());
        }
    }

    if ($path === '/api/positions') {
        if (!ob_has_valid_token()) {
            ob_error('NOT_AUTHENTICATED', 401);
        }
        try {
            ob_json(['positions' => ob_upstox_positions(), 'at' => (int) round(microtime(true) * 1000)]);
        } catch (ObNotAuthenticated) {
            ob_error('NOT_AUTHENTICATED', 401);
        } catch (Throwable $e) {
            ob_error('Failed to fetch positions', 502, $e->getMessage());
        }
    }

    // ---------------------------------------------------- draft portfolios
    if ($path === '/api/drafts' && $method === 'GET') {
        ob_json(['drafts' => ob_drafts_read()]);
    }

    if ($path === '/api/drafts' && $method === 'POST') {
        try {
            $draft = ob_draft_create(ob_body());
        } catch (InvalidArgumentException $e) {
            ob_error($e->getMessage(), 400);
        }
        $drafts = ob_drafts_read();
        if (count($drafts) >= OB_MAX_DRAFTS) {
            ob_error('Draft limit reached (' . OB_MAX_DRAFTS . '). Delete some old drafts first.', 409);
        }
        array_unshift($drafts, $draft);
        ob_drafts_write($drafts);
        ob_json(['draft' => $draft], 201);
    }

    if ($path === '/api/drafts/update' && $method === 'POST') {
        $body = ob_body();
        $id = (string) ($body['id'] ?? '');
        $drafts = ob_drafts_read();
        foreach ($drafts as $i => $d) {
            if (($d['id'] ?? '') === $id) {
                try {
                    $drafts[$i] = ob_draft_patch($d, $body);
                } catch (InvalidArgumentException $e) {
                    ob_error($e->getMessage(), 400);
                }
                ob_drafts_write($drafts);
                ob_json(['draft' => $drafts[$i]]);
            }
        }
        ob_error('Draft not found', 404);
    }

    if ($path === '/api/drafts/delete' && $method === 'POST') {
        $id = (string) (ob_body()['id'] ?? '');
        $drafts = ob_drafts_read();
        $left = array_values(array_filter($drafts, static fn(array $d): bool => ($d['id'] ?? '') !== $id));
        if (count($left) === count($drafts)) {
            ob_error('Draft not found', 404);
        }
        ob_drafts_write($left);
        ob_json(['ok' => true]);
    }

    // ----------------------------------------------------------- portfolios
    if ($path === '/api/portfolios' && $method === 'GET') {
        ob_json(['portfolios' => ob_portfolios_read()]);
    }

    if ($path === '/api/portfolios' && $method === 'POST') {
        try {
            $portfolio = ob_portfolio_create(ob_body());
        } catch (InvalidArgumentException $e) {
            ob_error($e->getMessage(), 400);
        }
        $portfolios = ob_portfolios_read();
        if (count($portfolios) >= OB_MAX_PORTFOLIOS) {
            ob_error('Portfolio limit reached (' . OB_MAX_PORTFOLIOS . ').', 409);
        }
        $portfolios[] = $portfolio;
        ob_portfolios_write($portfolios);
        ob_json(['portfolio' => $portfolio], 201);
    }

    if ($path === '/api/portfolios/update' && $method === 'POST') {
        $body = ob_body();
        $id = (string) ($body['id'] ?? '');
        $portfolios = ob_portfolios_read();
        foreach ($portfolios as $i => $p) {
            if (($p['id'] ?? '') === $id) {
                try {
                    $portfolios[$i] = ob_portfolio_patch($p, $body);
                } catch (InvalidArgumentException $e) {
                    ob_error($e->getMessage(), 400);
                }
                ob_portfolios_write($portfolios);
                ob_json(['portfolio' => $portfolios[$i]]);
            }
        }
        ob_error('Portfolio not found', 404);
    }

    if ($path === '/api/portfolios/delete' && $method === 'POST') {
        $id = (string) (ob_body()['id'] ?? '');
        $portfolios = ob_portfolios_read();
        $left = array_values(array_filter($portfolios, static fn(array $p): bool => ($p['id'] ?? '') !== $id));
        if (count($left) === count($portfolios)) {
            ob_error('Portfolio not found', 404);
        }
        ob_portfolios_write($left);
        ob_json(['ok' => true]);
    }

    // Daily closes for holdings and benchmarks, for the performance chart.
    if ($path === '/api/history') {
        $keys = array_values(array_unique(array_filter(
            array_map(static fn(string $v): string => strtoupper(trim($v)), explode(',', ob_query('symbols') ?? '')),
            static fn(string $v): bool => ob_symbol_ok($v)
        )));
        $range = ob_query('range') ?? '5y';
        if (!$keys || count($keys) > 40 || !in_array($range, ['1y', '2y', '5y', '10y', 'max'], true)) {
            ob_error('symbols must list 1–40 symbols and range must be 1y, 2y, 5y, 10y or max', 400);
        }
        $series = [];
        $missing = [];
        foreach ($keys as $key) {
            // A day's closes don't change intraday enough to matter here; 6h keeps Yahoo calls rare.
            $hit = ob_cache_get("history:$key:$range", 6 * 3600);
            if ($hit !== null) {
                $series[$key] = $hit;
            } else {
                $missing[] = $key;
            }
        }
        if ($missing) {
            $fetched = ob_price_history($missing, $range);
            foreach ($missing as $key) {
                if (isset($fetched[$key])) {
                    ob_cache_put("history:$key:$range", $fetched[$key]);
                    $series[$key] = $fetched[$key];
                } elseif (($stale = ob_cache_get("history:$key:$range", 7 * 86400)) !== null) {
                    $series[$key] = $stale;
                }
            }
        }
        ob_json(['series' => (object) $series]);
    }

    // US stocks and ETFs by name or ticker, for charts, watchlists and portfolios.
    if ($path === '/api/search') {
        $q = trim((string) (ob_query('q') ?? ''));
        if ($q === '' || mb_strlen($q) > 40) {
            ob_error('q must be 1–40 characters', 400);
        }
        try {
            // market=in: every NSE stock and ETF, from the cached instruments list (no per-query cache needed).
            if (ob_query('market') === 'in') {
                ob_json(['results' => ob_india_search($q)]);
            }
            ob_json(['results' => ob_cached('search:us:' . mb_strtolower($q), fn() => ob_us_search($q), 86400)]);
        } catch (Throwable $e) {
            ob_error('Search failed', 502, $e->getMessage());
        }
    }

    if ($path === '/api/futures') {
        $symbol = strtoupper(ob_query('symbol') ?? '');
        if (!preg_match('/^[A-Z0-9&_\-]{1,20}$/', $symbol)) {
            ob_error('symbol query param is required', 400);
        }
        try {
            $today = gmdate('Y-m-d', time() + 19800);
            $contracts = array_values(array_filter(
                ob_futures_index()[$symbol] ?? [],
                static fn(array $c): bool => $c['expiry'] >= $today
            ));
            ob_json(['symbol' => $symbol, 'contracts' => $contracts]);
        } catch (Throwable $e) {
            ob_error('Failed to load futures contracts', 502, $e->getMessage());
        }
    }

    // ------------------------------------------------------- daily report
    if ($path === '/api/report/max-oi') {
        $symbol = strtoupper(ob_query('symbol') ?? 'NIFTY');
        if (!ob_has_market_data()) {
            ob_error('NOT_AUTHENTICATED', 401);
        }

        try {
            ob_json(ob_cached("maxoi:$symbol", function () use ($symbol) {
                $instrumentKey = ob_resolve_instrument_key($symbol);
                ['expiries' => $expiries] = ob_option_contracts($instrumentKey);

                $monthly = ob_current_monthly_expiry($expiries);
                $december = ob_december_monthly_expiry($expiries, (int) gmdate('Y'));

                $load = static function (?string $exp) use ($instrumentKey, $symbol, $expiries): ?array {
                    if ($exp === null) {
                        return null;
                    }
                    $shaped = ob_reshape_chain(ob_option_chain_raw($instrumentKey, $exp), $symbol, $expiries, $exp, null);
                    return ob_max_oi_summary($shaped['rows'], $exp, $shaped['underlyingValue']);
                };

                $current = $load($monthly);
                // Same expiry for both slots when run in December — don't fetch twice.
                $dec = ($monthly === $december) ? $current : $load($december);

                return ['symbol' => $symbol, 'currentMonthly' => $current, 'december' => $dec];
            }, OB_TTL_REPORT));
        } catch (ObNotAuthenticated) {
            ob_error('NOT_AUTHENTICATED', 401);
        } catch (Throwable $e) {
            ob_error('Failed to build max-OI report', 502, $e->getMessage());
        }
    }

    if ($path === '/api/report/fii-dii') {
        try {
            ob_json(['data' => ob_cached('fiidii', fn() => ob_fii_dii(), OB_TTL_DAILY)]);
        } catch (Throwable $e) {
            ob_error('Failed to fetch FII/DII activity', 502, $e->getMessage());
        }
    }

    if ($path === '/api/report/global') {
        try {
            ob_json(ob_cached('global', fn() => ob_global_markets(), 300));
        } catch (Throwable $e) {
            ob_error('Failed to fetch global markets', 502, $e->getMessage());
        }
    }

    if ($path === '/api/report/news') {
        try {
            ob_json(['items' => ob_cached('news', fn() => ob_market_news(12), OB_TTL_DAILY)]);
        } catch (Throwable $e) {
            ob_error('Failed to fetch market news', 502, $e->getMessage());
        }
    }

    ob_error('Not found: ' . $path, 404);
} catch (Throwable $e) {
    // Last-resort net: never emit a stack trace to the client.
    error_log('Option Builder: ' . $e->getMessage());
    ob_error('Server error', 500);
}
