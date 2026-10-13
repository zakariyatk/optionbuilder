<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/http.php';
require_once __DIR__ . '/cache.php';

/**
 * Upstox Developer API client — the port of upstoxClient.js.
 *
 * OAuth2: the user approves on Upstox, which redirects back with a single-use
 * code we exchange for an access token. Tokens are day-scoped (they die around
 * 03:30 IST), so the user reconnects once per trading day. The token is stored
 * on disk so a request doesn't lose it between PHP processes — unlike Node,
 * there is no long-lived process to hold it in memory.
 */

const OB_UPSTOX_API = 'https://api.upstox.com/v2';
/** Candle history lives on v3, which takes any minute / hour / day interval. */
const OB_UPSTOX_API_V3 = 'https://api.upstox.com/v3';

const OB_INDEX_INSTRUMENT_KEYS = [
    'NIFTY' => 'NSE_INDEX|Nifty 50',
    'BANKNIFTY' => 'NSE_INDEX|Nifty Bank',
    'FINNIFTY' => 'NSE_INDEX|Nifty Fin Service',
    'MIDCPNIFTY' => 'NSE_INDEX|NIFTY MID SELECT',
];

function ob_upstox_configured(): bool
{
    return ob_config_get('upstox_api_key') !== ''
        && ob_config_get('upstox_api_secret') !== ''
        && ob_config_get('upstox_redirect_uri') !== '';
}

// ------------------------------------------------------------- token storage

function ob_token_file(): string
{
    return ob_data_dir() . '/upstox-token.json';
}

function ob_read_token(): ?array
{
    $f = ob_token_file();
    if (!is_file($f)) {
        return null;
    }
    $raw = @file_get_contents($f);
    if ($raw === false) {
        return null;
    }
    $t = json_decode($raw, true);
    return is_array($t) ? $t : null;
}

function ob_write_token(array $token): void
{
    // 0600: the token is equivalent to a broker session.
    @file_put_contents(ob_token_file(), json_encode($token), LOCK_EX);
    @chmod(ob_token_file(), 0600);
}

function ob_clear_token(): void
{
    @unlink(ob_token_file());
}

/** Next 03:30 IST after $from, as a unix timestamp. */
function ob_next_expiry_boundary(?int $from = null): int
{
    $from ??= time();
    $istOffset = 5 * 3600 + 1800;
    $ist = $from + $istOffset;
    // Midnight IST of the day $from falls in, then 03:30 on top.
    $boundaryIst = (int) (floor($ist / 86400) * 86400) + 3 * 3600 + 1800;
    $boundary = $boundaryIst - $istOffset;
    return $boundary > $from ? $boundary : $boundary + 86400;
}

function ob_has_valid_token(): bool
{
    $t = ob_read_token();
    if ($t === null || ($t['access_token'] ?? '') === '') {
        return false;
    }
    return time() < (int) ($t['expires_at'] ?? 0);
}

function ob_token_info(): ?array
{
    $t = ob_read_token();
    if ($t === null) {
        return null;
    }
    return [
        'user_name' => $t['user_name'] ?? null,
        // Milliseconds, to match what the JS frontend already expects.
        'issued_at' => (int) ($t['issued_at'] ?? 0) * 1000,
        'expires_at' => (int) ($t['expires_at'] ?? 0) * 1000,
    ];
}

// ----------------------------------------------------------------- oauth flow

function ob_upstox_auth_url(string $state): string
{
    return OB_UPSTOX_API . '/login/authorization/dialog?' . http_build_query([
        'client_id' => ob_config_get('upstox_api_key'),
        'redirect_uri' => ob_config_get('upstox_redirect_uri'),
        'response_type' => 'code',
        'state' => $state,
    ]);
}

function ob_upstox_exchange_code(string $code): array
{
    $body = http_build_query([
        'code' => $code,
        'client_id' => ob_config_get('upstox_api_key'),
        'client_secret' => ob_config_get('upstox_api_secret'),
        'redirect_uri' => ob_config_get('upstox_redirect_uri'),
        'grant_type' => 'authorization_code',
    ]);

    $res = ob_http_request('POST', OB_UPSTOX_API . '/login/authorization/token', [
        'Content-Type' => 'application/x-www-form-urlencoded',
        'Accept' => 'application/json',
    ], $body, 25);

    $json = json_decode($res['body'], true);
    if (!is_array($json) || ($json['access_token'] ?? '') === '') {
        throw new RuntimeException('Upstox token exchange failed: ' . substr($res['body'], 0, 300));
    }

    ob_write_token([
        'access_token' => $json['access_token'],
        'user_name' => $json['user_name'] ?? null,
        'issued_at' => time(),
        'expires_at' => ob_next_expiry_boundary(),
    ]);

    return $json;
}

// ------------------------------------------------------------ authed requests

final class ObNotAuthenticated extends RuntimeException
{
}

function ob_upstox_headers(): array
{
    $t = ob_read_token();
    if ($t === null || ($t['access_token'] ?? '') === '') {
        throw new ObNotAuthenticated('NOT_AUTHENTICATED');
    }
    return [
        'Accept' => 'application/json',
        'Authorization' => 'Bearer ' . $t['access_token'],
    ];
}

function ob_upstox_get(string $path, array $params = [], string $base = OB_UPSTOX_API): array
{
    $url = $base . $path . ($params ? '?' . http_build_query($params) : '');
    $res = ob_http_request('GET', $url, ob_upstox_headers(), null, 30);

    if ($res['status'] === 401) {
        ob_clear_token();
        throw new ObNotAuthenticated('NOT_AUTHENTICATED');
    }
    if ($res['status'] < 200 || $res['status'] >= 300) {
        throw new RuntimeException("Upstox $path failed ({$res['status']})");
    }

    $json = json_decode($res['body'], true);
    return is_array($json) ? $json : [];
}

function ob_upstox_post(string $path, array $payload): array
{
    $res = ob_http_request(
        'POST',
        OB_UPSTOX_API . $path,
        ob_upstox_headers() + ['Content-Type' => 'application/json'],
        json_encode($payload),
        30
    );

    if ($res['status'] === 401) {
        ob_clear_token();
        throw new ObNotAuthenticated('NOT_AUTHENTICATED');
    }
    if ($res['status'] < 200 || $res['status'] >= 300) {
        throw new RuntimeException("Upstox $path failed ({$res['status']})");
    }

    $json = json_decode($res['body'], true);
    return is_array($json) ? $json : [];
}

// ------------------------------------------------------- instrument key lookup

/**
 * Equities resolve from Upstox's gzipped NSE instruments master (~several MB),
 * cached for 12 hours. Indices short-circuit on the static map above.
 */
function ob_resolve_instrument_key(string $symbol): string
{
    $upper = strtoupper($symbol);
    if (isset(OB_INDEX_INSTRUMENT_KEYS[$upper])) {
        return OB_INDEX_INSTRUMENT_KEYS[$upper];
    }

    $index = ob_cached('instruments:nse', function (): array {
        $body = ob_get_text('https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz', [], 60);
        // cURL inflates when the server sets Content-Encoding; if it didn't,
        // the payload is still raw gzip, so decode defensively.
        if (strncmp($body, "\x1f\x8b", 2) === 0) {
            $inflated = @gzdecode($body);
            if ($inflated === false) {
                throw new RuntimeException('Could not decompress Upstox instruments file');
            }
            $body = $inflated;
        }

        $rows = json_decode($body, true);
        if (!is_array($rows)) {
            throw new RuntimeException('Unexpected instruments payload');
        }

        $map = [];
        foreach ($rows as $row) {
            $segment = $row['segment'] ?? '';
            if ($segment !== 'NSE_EQ' && $segment !== 'NSE_INDEX') {
                continue;
            }
            $ts = strtoupper((string) ($row['trading_symbol'] ?? $row['tradingsymbol'] ?? ''));
            if ($ts !== '' && !isset($map[$ts])) {
                $map[$ts] = $row['instrument_key'] ?? '';
            }
        }
        return $map;
    }, 12 * 3600);

    if (($index[$upper] ?? '') === '') {
        throw new RuntimeException("No Upstox instrument key found for symbol \"$symbol\"");
    }
    return $index[$upper];
}

// ----------------------------------------------------------------- market data

/** @return array{expiries: string[], lotSize: ?int} */
function ob_option_contracts(string $instrumentKey): array
{
    $json = ob_upstox_get('/option/contract', ['instrument_key' => $instrumentKey]);
    $contracts = $json['data'] ?? [];

    $expiries = [];
    $lotSize = null;
    foreach ($contracts as $c) {
        if (!empty($c['expiry'])) {
            $expiries[$c['expiry']] = true;
        }
        if ($lotSize === null && !empty($c['lot_size'])) {
            $lotSize = (int) $c['lot_size'];
        }
    }
    $expiries = array_keys($expiries);
    sort($expiries);

    return ['expiries' => $expiries, 'lotSize' => $lotSize];
}

function ob_option_chain_raw(string $instrumentKey, string $expiry): array
{
    $json = ob_upstox_get('/option/chain', [
        'instrument_key' => $instrumentKey,
        'expiry_date' => $expiry,
    ]);
    return $json['data'] ?? [];
}

/**
 * Real SPAN + exposure margin for a basket.
 * @param array<int,array{instrument_key:string,quantity:int,transaction_type:string,product:string}> $instruments
 */
function ob_upstox_margin(array $instruments): mixed
{
    $json = ob_upstox_post('/charges/margin', ['instruments' => $instruments]);
    return $json['data'] ?? null;
}
