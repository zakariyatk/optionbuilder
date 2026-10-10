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
require_once __DIR__ . '/lib/news.php';
require_once __DIR__ . '/lib/report.php';

// Errors must never leak into a JSON body as HTML.
ini_set('display_errors', '0');
error_reporting(E_ALL);

/**
 * Route path, independent of where the backend is mounted.
 *
 * The backend normally lives in an `api/` directory (…/optionbuilder/api/), so
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
    // Refuse to serve a public deployment that has no password configured.
    ob_require_configured_password();
    // Every POST must come from this app's own pages.
    ob_require_same_origin();

    // ------------------------------------------------------------- public
    if ($path === '/api/health') {
        ob_json(['ok' => true]);
    }

    if ($path === '/api/session' && $method === 'GET') {
        ob_json(['authRequired' => !ob_auth_disabled(), 'loggedIn' => ob_is_logged_in()]);
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

    if ($path === '/api/option-chain') {
        $symbol = strtoupper(ob_query('symbol') ?? '');
        $expiry = ob_query('expiry');
        if ($symbol === '') {
            ob_error('symbol query param is required', 400);
        }
        if (!ob_has_valid_token()) {
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

    // ------------------------------------------------------- daily report
    if ($path === '/api/report/max-oi') {
        $symbol = strtoupper(ob_query('symbol') ?? 'NIFTY');
        if (!ob_has_valid_token()) {
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
