<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/http.php';
require_once __DIR__ . '/cache.php';

/**
 * Zerodha Kite Connect client, used instead of Upstox when the config picks
 * 'broker' => 'zerodha' (or only Kite keys are filled in).
 *
 * Each function here mirrors an Upstox one in upstox.php and returns data in
 * the same shape, so the routes and the frontend never branch on broker:
 *
 *   - Login: Kite redirects back with a single-use request_token, exchanged
 *     (with a SHA-256 checksum of key + token + secret) for an access token
 *     that lives until 06:00 IST the next morning.
 *   - Kite has no option-chain endpoint. The chain is built from the NFO
 *     instruments dump plus one /quote call for every strike of the expiry.
 *     Kite also returns no IV or Greeks, so IV is solved here from each
 *     strike's price (Black-Scholes), and the frontend derives Greeks from it
 *     as it already does when a broker sends none.
 *   - Kite's quote has no previous-day OI. OI change is measured against the
 *     last OI this server saw on an earlier day (kite-oi-history.json), so it
 *     reads 0 until the app has been used on one trading day before.
 *
 * Instrument keys are "EXCHANGE|TRADINGSYMBOL" (e.g. "NFO|NIFTY25N2524000CE"),
 * which Kite calls "NFO:NIFTY25N2524000CE".
 *
 * Market data (quotes, candles, the chain) needs the paid Kite Connect plan;
 * the free Personal plan can log in and fetch margins only.
 */

const OB_KITE_API = 'https://api.kite.trade';
const OB_KITE_LOGIN = 'https://kite.zerodha.com/connect/login';

/** App index symbol → Kite NSE tradingsymbol. */
const OB_KITE_INDEX_SYMBOLS = [
    'NIFTY' => 'NIFTY 50',
    'BANKNIFTY' => 'NIFTY BANK',
    'FINNIFTY' => 'NIFTY FIN SERVICE',
    'MIDCPNIFTY' => 'NIFTY MID SELECT',
    'INDIAVIX' => 'INDIA VIX',
];

/** Kite allows about 3 historical-candle requests a second and 1 quote request a second. */
const OB_KITE_HISTORY_PER_SECOND = 3;
/** Most instruments in one /quote call; /quote/ltp and /quote/ohlc take 1000. */
const OB_KITE_QUOTE_BATCH = 500;
/** Risk-free rate for the IV solver — keep in step with RISK_FREE_RATE in frontend/src/domain/blackScholes.ts. */
const OB_KITE_RATE = 0.07;

function ob_kite_configured(): bool
{
    return trim((string) ob_config_get('kite_api_key', '')) !== ''
        && trim((string) ob_config_get('kite_api_secret', '')) !== '';
}

function ob_kite_api_key(): string
{
    return trim((string) ob_config_get('kite_api_key', ''));
}

// ----------------------------------------------------------------- login flow

function ob_kite_auth_url(string $state): string
{
    // redirect_params come back on the redirect URL registered on the Kite app.
    return OB_KITE_LOGIN . '?' . http_build_query([
        'v' => 3,
        'api_key' => ob_kite_api_key(),
        'redirect_params' => http_build_query(['state' => $state]),
    ]);
}

function ob_kite_exchange_token(string $requestToken): array
{
    $key = ob_kite_api_key();
    $secret = trim((string) ob_config_get('kite_api_secret', ''));
    $body = http_build_query([
        'api_key' => $key,
        'request_token' => $requestToken,
        'checksum' => hash('sha256', $key . $requestToken . $secret),
    ]);

    $res = ob_http_request('POST', OB_KITE_API . '/session/token', [
        'X-Kite-Version' => '3',
        'Content-Type' => 'application/x-www-form-urlencoded',
        'Accept' => 'application/json',
    ], $body, 25);

    $json = json_decode($res['body'], true);
    $data = is_array($json) ? ($json['data'] ?? null) : null;
    if (!is_array($data) || ($data['access_token'] ?? '') === '') {
        $msg = is_array($json) ? (string) ($json['message'] ?? '') : '';
        throw new RuntimeException('Zerodha token exchange failed: ' . ($msg !== '' ? $msg : substr($res['body'], 0, 300)));
    }

    ob_write_token([
        'access_token' => $data['access_token'],
        'user_name' => $data['user_name'] ?? $data['user_shortname'] ?? null,
        'issued_at' => time(),
        // Kite access tokens are flushed at 06:00 IST every day.
        'expires_at' => ob_next_expiry_boundary(null, 6 * 3600),
    ]);

    return $data;
}

// ------------------------------------------------------------ authed requests

function ob_kite_headers(): array
{
    $t = ob_read_token();
    $token = (string) ($t['access_token'] ?? '');
    if ($token === '') {
        throw new ObNotAuthenticated('NOT_AUTHENTICATED');
    }
    // Past 06:00 it is sent anyway; Kite's TokenException then clears it.
    return [
        'X-Kite-Version' => '3',
        'Accept' => 'application/json',
        'Authorization' => 'token ' . ob_kite_api_key() . ':' . $token,
    ];
}

/** Headers for the instruments dump: authenticated when a login exists, else just the version. */
function ob_kite_soft_headers(): array
{
    try {
        return ob_kite_headers();
    } catch (ObNotAuthenticated) {
        return ['X-Kite-Version' => '3'];
    }
}

/**
 * Turns a Kite response into its decoded body, or the right exception.
 * Kite says 403 TokenException for an expired login (not 401).
 */
function ob_kite_check(array $res, string $path): array
{
    $json = json_decode($res['body'], true);
    $type = is_array($json) ? (string) ($json['error_type'] ?? '') : '';
    $message = is_array($json) ? (string) ($json['message'] ?? '') : '';

    if ($res['status'] === 401 || $type === 'TokenException') {
        ob_clear_token();
        throw new ObNotAuthenticated('NOT_AUTHENTICATED');
    }
    if ($type === 'PermissionException') {
        throw new RuntimeException('Zerodha refused ' . $path . ' — market data needs the paid Kite Connect plan'
            . ($message !== '' ? " ($message)" : ''));
    }
    if ($res['status'] === 429) {
        throw new RuntimeException("Zerodha rate limit hit on $path — try again in a moment");
    }
    if ($res['status'] < 200 || $res['status'] >= 300) {
        throw new RuntimeException("Zerodha $path failed ({$res['status']})" . ($message !== '' ? ": $message" : ''));
    }
    return is_array($json) ? $json : [];
}

/** Query string with repeated keys (i=NSE:A&i=NSE:B), which http_build_query can't produce. */
function ob_kite_query(array $params): string
{
    $parts = [];
    foreach ($params as $k => $v) {
        foreach ((array) $v as $one) {
            $parts[] = rawurlencode((string) $k) . '=' . rawurlencode((string) $one);
        }
    }
    return implode('&', $parts);
}

function ob_kite_get(string $path, array $params = []): array
{
    $url = OB_KITE_API . $path . ($params ? '?' . ob_kite_query($params) : '');
    return ob_kite_check(ob_http_request('GET', $url, ob_kite_headers(), null, 30), $path);
}

function ob_kite_post_json(string $path, mixed $payload, array $params = []): array
{
    $url = OB_KITE_API . $path . ($params ? '?' . ob_kite_query($params) : '');
    $res = ob_http_request('POST', $url, ob_kite_headers() + ['Content-Type' => 'application/json'], json_encode($payload), 30);
    return ob_kite_check($res, $path);
}

// ------------------------------------------------------------ instrument keys

/** "NFO|NIFTY25N2524000CE" → "NFO:NIFTY25N2524000CE". */
function ob_kite_instrument(string $key): string
{
    $parts = explode('|', $key, 2);
    return count($parts) === 2 ? $parts[0] . ':' . $parts[1] : $key;
}

/** Kite's "NSE:NIFTY 50" → our "NSE|NIFTY 50". */
function ob_kite_key(string $instrument): string
{
    $parts = explode(':', $instrument, 2);
    return count($parts) === 2 ? $parts[0] . '|' . $parts[1] : $instrument;
}

/**
 * Rows of a Kite instruments dump (gzipped CSV) as associative arrays.
 * @return list<array<string,string>>
 */
function ob_kite_instruments(string $exchange): array
{
    $body = ob_get_text(OB_KITE_API . '/instruments/' . rawurlencode($exchange), ob_kite_soft_headers(), 90);
    if (strncmp($body, "\x1f\x8b", 2) === 0) {
        $inflated = @gzdecode($body);
        if ($inflated === false) {
            throw new RuntimeException("Could not decompress Zerodha $exchange instruments file");
        }
        $body = $inflated;
    }
    $lines = preg_split('/\r?\n/', trim($body)) ?: [];
    $header = str_getcsv((string) array_shift($lines));
    if (!in_array('tradingsymbol', $header, true)) {
        throw new RuntimeException("Unexpected Zerodha $exchange instruments payload");
    }
    $rows = [];
    $n = count($header);
    foreach ($lines as $line) {
        $cells = str_getcsv($line);
        if (count($cells) === $n) {
            $rows[] = array_combine($header, $cells);
        }
    }
    return $rows;
}

/**
 * NSE F&O contracts grouped by underlying (Kite's `name`, e.g. NIFTY, RELIANCE):
 *   opt: expiry => list of [strike, 'CE'|'PE', tradingsymbol, lot]
 *   fut: list of [expiry, tradingsymbol, lot]
 * The full map is cached for 12 h; each underlying is cached on its own as
 * well, so a chain request doesn't decode every contract in the market.
 */
function ob_kite_nfo(string $underlying): array
{
    $underlying = strtoupper($underlying);
    return ob_cached("kite:nfo:$underlying", static function () use ($underlying): array {
        $all = ob_cached('kite:nfo', static function (): array {
            $map = [];
            foreach (ob_kite_instruments('NFO') as $row) {
                $name = strtoupper($row['name'] ?? '');
                $type = $row['instrument_type'] ?? '';
                $expiry = $row['expiry'] ?? '';
                if ($name === '' || $expiry === '') {
                    continue;
                }
                $lot = (int) ($row['lot_size'] ?? 1);
                if ($type === 'CE' || $type === 'PE') {
                    $map[$name]['opt'][$expiry][] = [(float) $row['strike'], $type, $row['tradingsymbol'], $lot];
                } elseif ($type === 'FUT') {
                    $map[$name]['fut'][] = [$expiry, $row['tradingsymbol'], $lot];
                }
            }
            return $map;
        }, 12 * 3600);
        return $all[$underlying] ?? ['opt' => [], 'fut' => []];
    }, 12 * 3600);
}

/** NSE cash-market tradingsymbols (equities and indices) Kite knows, as a set. */
function ob_kite_nse_symbols(): array
{
    return ob_cached('kite:nse', static function (): array {
        $set = [];
        foreach (ob_kite_instruments('NSE') as $row) {
            $ts = strtoupper($row['tradingsymbol'] ?? '');
            if ($ts !== '') {
                $set[$ts] = 1;
            }
        }
        return $set;
    }, 12 * 3600);
}

/** Nearest MCX future on an underlying that hasn't expired, as an instrument key. */
function ob_kite_mcx_front_future(string $underlying): string
{
    $futures = ob_cached('kite:mcx-fut', static function (): array {
        $wanted = array_flip(OB_MCX_SYMBOLS);
        $map = [];
        foreach (ob_kite_instruments('MCX') as $row) {
            $name = strtoupper($row['name'] ?? '');
            if (($row['instrument_type'] ?? '') === 'FUT' && isset($wanted[$name]) && ($row['expiry'] ?? '') !== '') {
                $map[$name][] = [$row['expiry'], $row['tradingsymbol']];
            }
        }
        foreach ($map as &$list) {
            usort($list, static fn(array $a, array $b): int => strcmp($a[0], $b[0]));
        }
        return $map;
    }, 12 * 3600);

    $today = gmdate('Y-m-d', time() + 19800);
    foreach ($futures[$underlying] ?? [] as [$expiry, $ts]) {
        if ($expiry >= $today) {
            return "MCX|$ts";
        }
    }
    throw new RuntimeException("No live MCX future found for \"$underlying\"");
}

function ob_kite_resolve_instrument_key(string $symbol): string
{
    $upper = strtoupper($symbol);
    if (isset(OB_KITE_INDEX_SYMBOLS[$upper])) {
        return 'NSE|' . OB_KITE_INDEX_SYMBOLS[$upper];
    }
    if (ob_is_mcx($upper)) {
        return ob_kite_mcx_front_future(OB_MCX_SYMBOLS[$upper]);
    }
    if (!isset(ob_kite_nse_symbols()[$upper])) {
        throw new RuntimeException("No Zerodha instrument found for symbol \"$symbol\"");
    }
    return "NSE|$upper";
}

/** The F&O underlying name for an underlying's instrument key ("NSE|NIFTY 50" → "NIFTY"). */
function ob_kite_underlying_name(string $instrumentKey): string
{
    $ts = explode('|', $instrumentKey, 2)[1] ?? $instrumentKey;
    $index = array_search($ts, OB_KITE_INDEX_SYMBOLS, true);
    return $index !== false ? (string) $index : strtoupper($ts);
}

/**
 * Kite's numeric instrument_token for each key (needed for candles), looked up
 * with one /quote/ltp call and cached for a day — tokens only change on expiry.
 *
 * @param array<string,string> $keys id => instrument key
 * @return array<string,int> id => token (ids Kite didn't recognise are left out)
 */
function ob_kite_tokens(array $keys): array
{
    $tokens = [];
    $missing = [];
    foreach (array_unique(array_values($keys)) as $key) {
        $hit = ob_cache_get("kite:tok:$key", 86400);
        if ($hit !== null) {
            $tokens[$key] = (int) $hit;
        } else {
            $missing[] = $key;
        }
    }
    foreach (array_chunk($missing, 1000) as $batch) {
        $res = ob_kite_get('/quote/ltp', ['i' => array_map('ob_kite_instrument', $batch)]);
        foreach (($res['data'] ?? []) as $instrument => $q) {
            if (isset($q['instrument_token'])) {
                $key = ob_kite_key((string) $instrument);
                $tokens[$key] = (int) $q['instrument_token'];
                ob_cache_put("kite:tok:$key", $tokens[$key]);
            }
        }
    }
    $out = [];
    foreach ($keys as $id => $key) {
        if (isset($tokens[$key])) {
            $out[$id] = $tokens[$key];
        }
    }
    return $out;
}

/**
 * Full quotes (price, OI, depth) for many instruments, keyed by instrument key.
 * @param list<string> $keys
 */
function ob_kite_full_quotes(array $keys): array
{
    $out = [];
    foreach (array_chunk(array_values(array_unique($keys)), OB_KITE_QUOTE_BATCH) as $n => $batch) {
        if ($n > 0) {
            usleep(1_050_000); // one /quote a second
        }
        $res = ob_kite_get('/quote', ['i' => array_map('ob_kite_instrument', $batch)]);
        foreach (($res['data'] ?? []) as $instrument => $q) {
            $out[ob_kite_key((string) $instrument)] = $q;
        }
    }
    return $out;
}

// ----------------------------------------------------------------- market data

/** @return array{expiries: string[], lotSize: ?int} */
function ob_kite_option_contracts(string $instrumentKey): array
{
    $opt = ob_kite_nfo(ob_kite_underlying_name($instrumentKey))['opt'] ?? [];
    $today = gmdate('Y-m-d', time() + 19800);
    $expiries = array_values(array_filter(array_keys($opt), static fn(string $e): bool => $e >= $today));
    sort($expiries);
    $lotSize = null;
    foreach ($expiries as $e) {
        if (!empty($opt[$e][0][3])) {
            $lotSize = (int) $opt[$e][0][3];
            break;
        }
    }
    return ['expiries' => $expiries, 'lotSize' => $lotSize];
}

/**
 * One expiry's chain, in the shape Upstox's /option/chain returns, so
 * ob_reshape_chain() (chain.php) handles both brokers.
 */
function ob_kite_option_chain_raw(string $instrumentKey, string $expiry): array
{
    $contracts = ob_kite_nfo(ob_kite_underlying_name($instrumentKey))['opt'][$expiry] ?? [];
    if (!$contracts) {
        return [];
    }
    $keys = [$instrumentKey];
    foreach ($contracts as [, , $ts]) {
        $keys[] = "NFO|$ts";
    }
    $quotes = ob_kite_full_quotes($keys);
    $spot = isset($quotes[$instrumentKey]['last_price']) ? (float) $quotes[$instrumentKey]['last_price'] : null;

    $oiNow = [];
    foreach ($contracts as [, , $ts]) {
        if (isset($quotes["NFO|$ts"]['oi'])) {
            $oiNow["NFO|$ts"] = (float) $quotes["NFO|$ts"]['oi'];
        }
    }
    $prevOi = ob_kite_prev_oi($oiNow);
    $years = ob_kite_years_to_expiry($expiry);

    $byStrike = [];
    foreach ($contracts as [$strike, $type, $ts]) {
        $key = "NFO|$ts";
        $q = $quotes[$key] ?? null;
        if ($q === null) {
            continue;
        }
        $ltp = (float) ($q['last_price'] ?? 0);
        $bid = (float) ($q['depth']['buy'][0]['price'] ?? 0);
        $ask = (float) ($q['depth']['sell'][0]['price'] ?? 0);
        $price = ($bid > 0 && $ask > 0) ? ($bid + $ask) / 2 : $ltp;
        $oi = (float) ($q['oi'] ?? 0);
        $side = [
            'instrument_key' => $key,
            'market_data' => [
                'ltp' => $ltp,
                'close_price' => (float) ($q['ohlc']['close'] ?? 0),
                'oi' => $oi,
                'prev_oi' => $prevOi[$key] ?? $oi,
                'volume' => (float) ($q['volume'] ?? 0),
                'bid_price' => $bid,
                'ask_price' => $ask,
            ],
            'option_greeks' => [
                'iv' => $spot === null ? 0.0 : ob_kite_implied_vol($type === 'CE', $price, $spot, (float) $strike, $years),
            ],
        ];
        $k = (string) $strike;
        $byStrike[$k]['strike_price'] = (float) $strike;
        $byStrike[$k]['underlying_spot_price'] = $spot;
        $byStrike[$k][$type === 'CE' ? 'call_options' : 'put_options'] = $side;
    }
    return array_values($byStrike);
}

/**
 * Previous-day OI per instrument, from what this server last saw on an
 * earlier day. Instruments seen for the first time get none (change 0).
 *
 * @param array<string,float> $oiNow key => current OI
 * @return array<string,float> key => previous OI
 */
function ob_kite_prev_oi(array $oiNow): array
{
    if (!$oiNow) {
        return [];
    }
    $file = ob_data_dir() . '/kite-oi-history.json';
    $today = gmdate('Y-m-d', time() + 19800);
    $fh = @fopen($file, 'c+');
    if ($fh === false) {
        return [];
    }
    flock($fh, LOCK_EX);
    $hist = json_decode((string) stream_get_contents($fh), true);
    $hist = is_array($hist) ? $hist : [];

    $prev = [];
    foreach ($oiNow as $key => $oi) {
        $e = $hist[$key] ?? null;
        if (is_array($e) && ($e['d'] ?? '') !== $today) {
            // First sight today: the last OI seen on an earlier day is the baseline.
            $e = ['d' => $today, 'oi' => $oi, 'p' => (float) ($e['oi'] ?? $oi)];
        } elseif (is_array($e)) {
            $e['oi'] = $oi;
        } else {
            $e = ['d' => $today, 'oi' => $oi, 'p' => null];
        }
        $hist[$key] = $e;
        if ($e['p'] !== null) {
            $prev[$key] = (float) $e['p'];
        }
    }
    // Expired contracts drop out after ten days unseen.
    $cutoff = gmdate('Y-m-d', time() + 19800 - 10 * 86400);
    $hist = array_filter($hist, static fn($e): bool => is_array($e) && ($e['d'] ?? '') >= $cutoff);

    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, (string) json_encode($hist));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    @chmod($file, 0600);
    return $prev;
}

/** Years until 15:30 IST on the expiry date. */
function ob_kite_years_to_expiry(string $expiry): float
{
    $close = DateTimeImmutable::createFromFormat('Y-m-d H:i', "$expiry 15:30", new DateTimeZone('Asia/Kolkata'));
    if ($close === false) {
        return 0.0;
    }
    return max(0.0, ($close->getTimestamp() - time()) / (365 * 86400));
}

function ob_kite_norm_cdf(float $x): float
{
    // Abramowitz-Stegun 7.1.26 via erf; accurate to ~1e-7, plenty for an IV.
    $t = 1 / (1 + 0.3275911 * abs($x) / M_SQRT2);
    $y = 1 - ((((1.061405429 * $t - 1.453152027) * $t + 1.421413741) * $t - 0.284496736) * $t + 0.254829592) * $t * exp(-$x * $x / 2);
    return $x >= 0 ? (1 + $y) / 2 : (1 - $y) / 2;
}

function ob_kite_bs_price(bool $call, float $s, float $k, float $t, float $vol): float
{
    $d1 = (log($s / $k) + (OB_KITE_RATE + $vol * $vol / 2) * $t) / ($vol * sqrt($t));
    $d2 = $d1 - $vol * sqrt($t);
    $df = exp(-OB_KITE_RATE * $t);
    return $call
        ? $s * ob_kite_norm_cdf($d1) - $k * $df * ob_kite_norm_cdf($d2)
        : $k * $df * ob_kite_norm_cdf(-$d2) - $s * ob_kite_norm_cdf(-$d1);
}

/** Implied volatility in percent (like Upstox's), or 0 when the price can't carry one. */
function ob_kite_implied_vol(bool $call, float $price, float $spot, float $strike, float $years): float
{
    if ($price <= 0 || $spot <= 0 || $strike <= 0 || $years <= 0) {
        return 0.0;
    }
    $lo = 0.005;
    $hi = 5.0;
    if ($price <= ob_kite_bs_price($call, $spot, $strike, $years, $lo) || $price >= ob_kite_bs_price($call, $spot, $strike, $years, $hi)) {
        return 0.0;
    }
    // Price rises with vol, so bisection always converges.
    for ($i = 0; $i < 60; $i++) {
        $mid = ($lo + $hi) / 2;
        if (ob_kite_bs_price($call, $spot, $strike, $years, $mid) < $price) {
            $lo = $mid;
        } else {
            $hi = $mid;
        }
        if ($hi - $lo < 1e-5) {
            break;
        }
    }
    return round(($lo + $hi) / 2 * 100, 2);
}

/**
 * Real SPAN + exposure margin for a basket, in the fields the frontend reads
 * from Upstox (final_margin includes the hedge benefit).
 *
 * @param array<int,array{instrument_key:string,quantity:int,transaction_type:string}> $instruments
 */
function ob_kite_margin(array $instruments): array
{
    $orders = [];
    foreach ($instruments as $i) {
        [$exchange, $ts] = array_pad(explode('|', $i['instrument_key'], 2), 2, '');
        $orders[] = [
            'exchange' => $exchange,
            'tradingsymbol' => $ts,
            'transaction_type' => $i['transaction_type'],
            'variety' => 'regular',
            'product' => $exchange === 'NSE' ? 'CNC' : 'NRML',
            'order_type' => 'MARKET',
            'quantity' => $i['quantity'],
            'price' => 0,
            'trigger_price' => 0,
        ];
    }
    $json = ob_kite_post_json('/margins/basket', $orders, ['consider_positions' => 'false', 'mode' => 'compact']);
    $data = $json['data'] ?? [];
    return [
        'required_margin' => isset($data['initial']['total']) ? (float) $data['initial']['total'] : null,
        'final_margin' => isset($data['final']['total']) ? (float) $data['final']['total'] : null,
    ];
}

/**
 * Last traded price per instrument key.
 * @param list<string> $keys
 * @return array<string,float>
 */
function ob_kite_ltp(array $keys): array
{
    $out = [];
    foreach (array_chunk($keys, 1000) as $batch) {
        $res = ob_kite_get('/quote/ltp', ['i' => array_map('ob_kite_instrument', $batch)]);
        foreach (($res['data'] ?? []) as $instrument => $q) {
            if (is_numeric($q['last_price'] ?? null)) {
                $out[ob_kite_key((string) $instrument)] = (float) $q['last_price'];
            }
        }
    }
    return $out;
}

/**
 * Watchlist quotes, shaped like the spot quote.
 * @param list<string> $symbols
 * @return array<string, array> keyed by symbol
 */
function ob_kite_watch_quotes(array $symbols): array
{
    $keys = [];
    foreach ($symbols as $s) {
        try {
            $keys[ob_kite_resolve_instrument_key($s)] = $s;
        } catch (Throwable) {
            // Unknown symbol: left for the caller's fallback.
        }
    }
    if (!$keys) {
        return [];
    }
    $res = ob_kite_get('/quote/ohlc', ['i' => array_map('ob_kite_instrument', array_keys($keys))]);
    $out = [];
    foreach (($res['data'] ?? []) as $instrument => $q) {
        $symbol = $keys[ob_kite_key((string) $instrument)] ?? null;
        if ($symbol === null || !is_numeric($q['last_price'] ?? null)) {
            continue;
        }
        $last = (float) $q['last_price'];
        $close = (float) ($q['ohlc']['close'] ?? 0);
        $out[$symbol] = [
            'symbol' => $symbol,
            'ticker' => (string) $instrument,
            'price' => $last,
            'previousClose' => $close > 0 ? $close : $last,
            'currency' => 'INR',
            'marketTime' => time(),
        ];
    }
    return $out;
}

// --------------------------------------------------------------------- candles

/**
 * Chart timeframe → Kite interval, most days per request, and how many bars
 * of that interval make one of ours (4h, weeks and months are built here).
 */
const OB_KITE_TIMEFRAMES = [
    '1m' => ['minute', 60, null],
    '3m' => ['3minute', 100, null],
    '5m' => ['5minute', 100, null],
    '15m' => ['15minute', 200, null],
    '30m' => ['30minute', 200, null],
    '1h' => ['60minute', 400, null],
    '4h' => ['60minute', 400, '4h'],
    '1D' => ['day', 2000, null],
    '1W' => ['day', 2000, 'week'],
    '1M' => ['day', 2000, 'month'],
];

/** Same output as ob_candles(): [unix, o, h, l, c, volume] oldest first. */
function ob_kite_candles(string $symbol, string $tf): array
{
    $days = OB_CANDLE_TIMEFRAMES[$tf][2];
    [$interval, $maxDays, $group] = OB_KITE_TIMEFRAMES[$tf];
    $key = ob_kite_resolve_instrument_key($symbol);
    $token = ob_kite_tokens(['x' => $key])['x'] ?? null;
    if ($token === null) {
        throw new RuntimeException("Zerodha has no instrument token for $symbol");
    }

    $tz = new DateTimeZone('Asia/Kolkata');
    $to = new DateTimeImmutable('now', $tz);
    $start = $to->modify("-$days days");
    $rows = [];
    // Newest window first; stop once a window comes back empty (before listing).
    for ($n = 0; $to > $start; $n++) {
        $from = max($start, $to->modify("-$maxDays days"));
        if ($n > 0) {
            usleep((int) (1_000_000 / OB_KITE_HISTORY_PER_SECOND));
        }
        $chunk = ob_candle_rows(ob_kite_get("/instruments/historical/$token/$interval", [
            'from' => $from->format('Y-m-d H:i:s'),
            'to' => $to->format('Y-m-d H:i:s'),
        ]));
        if (!$chunk) {
            break;
        }
        $rows += $chunk;
        $to = $from->modify('-1 second');
    }
    ksort($rows);
    $rows = array_values($rows);
    return $group === null ? $rows : ob_kite_group_candles($rows, $group);
}

/** Rolls candles up into 4-hour (from 09:15 IST), weekly (Monday) or monthly bars. */
function ob_kite_group_candles(array $rows, string $group): array
{
    $tz = new DateTimeZone('Asia/Kolkata');
    $out = [];
    foreach ($rows as [$t, $o, $h, $l, $c, $v]) {
        $d = (new DateTimeImmutable("@$t"))->setTimezone($tz);
        $bucket = match ($group) {
            '4h' => $d->format('Y-m-d') . ':' . intdiv(max(0, $t - $d->setTime(9, 15)->getTimestamp()), 4 * 3600),
            'week' => $d->modify('monday this week')->format('Y-m-d'),
            default => $d->format('Y-m'),
        };
        if (!isset($out[$bucket])) {
            $out[$bucket] = [$t, $o, $h, $l, $c, $v];
            continue;
        }
        $b = &$out[$bucket];
        $b[2] = max($b[2], $h);
        $b[3] = min($b[3], $l);
        $b[4] = $c;
        $b[5] += $v;
        unset($b);
    }
    return array_values($out);
}

/**
 * The OI page's 1-minute candles (with OI), Kite edition of ob_oi_fetch().
 * Kite serves about 3 history requests a second, so they go in paced batches.
 * With $intraday, the underlying is fetched first and nothing else is when
 * today has no bars yet, so the caller's fall-back to the last session
 * doesn't pay for the whole basket twice.
 *
 * @param array<string,string> $keys id => instrument key
 * @return array<string, array<int, array{0: float, 1: float}>>
 */
function ob_kite_oi_fetch(array $keys, bool $intraday): array
{
    $tz = new DateTimeZone('Asia/Kolkata');
    $now = new DateTimeImmutable('now', $tz);
    $from = $intraday ? $now->setTime(9, 0) : $now->modify('-7 days')->setTime(9, 0);
    $tokens = ob_kite_tokens($keys);
    $url = static fn(int $token): string => OB_KITE_API . "/instruments/historical/$token/minute?" . ob_kite_query([
        'from' => $from->format('Y-m-d H:i:s'),
        'to' => $now->format('Y-m-d H:i:s'),
        'oi' => 1,
    ]);

    $urls = [];
    foreach ($tokens as $id => $token) {
        $urls[$id] = $url($token);
    }
    // Every id gets a series, even one Kite didn't recognise.
    $out = array_fill_keys(array_keys($keys), []);
    if ($intraday && isset($urls['spot'])) {
        // The underlying alone first: no bars today means the market hasn't opened.
        $spot = ob_kite_paced_get(['spot' => $urls['spot']]);
        if (!$spot['spot']) {
            return $out;
        }
        unset($urls['spot']);
        return array_replace($out, $spot, ob_kite_paced_get($urls));
    }
    return array_replace($out, ob_kite_paced_get($urls));
}

/** @param array<string,string> $urls */
function ob_kite_paced_get(array $urls): array
{
    $headers = ob_kite_headers();
    $out = [];
    foreach (array_chunk($urls, OB_KITE_HISTORY_PER_SECOND, true) as $n => $batch) {
        $started = microtime(true);
        foreach (ob_http_multi_get($batch, $headers, OB_KITE_HISTORY_PER_SECOND, 25) as $id => $res) {
            if ($res['status'] === 403 && str_contains($res['body'], 'TokenException')) {
                ob_clear_token();
                throw new ObNotAuthenticated('NOT_AUTHENTICATED');
            }
            $out[$id] = $res['status'] >= 200 && $res['status'] < 300 ? ob_oi_points($res['body']) : [];
        }
        $wait = 1.05 - (microtime(true) - $started);
        if ($wait > 0 && $n < (int) ceil(count($urls) / OB_KITE_HISTORY_PER_SECOND) - 1) {
            usleep((int) ($wait * 1_000_000));
        }
    }
    return $out;
}

/**
 * NSE futures by underlying, the Kite edition of ob_futures_index().
 * @return array<string, list<array{expiry:string, instrumentKey:string, lotSize:int}>>
 */
function ob_kite_futures_index(): array
{
    return ob_cached('kite:nfo-fut', static function (): array {
        $map = [];
        foreach (ob_kite_instruments('NFO') as $row) {
            if (($row['instrument_type'] ?? '') !== 'FUT' || ($row['expiry'] ?? '') === '') {
                continue;
            }
            $map[strtoupper($row['name'])][] = [
                'expiry' => $row['expiry'],
                'instrumentKey' => 'NFO|' . $row['tradingsymbol'],
                'lotSize' => (int) ($row['lot_size'] ?? 1),
            ];
        }
        foreach ($map as &$list) {
            usort($list, static fn(array $a, array $b): int => strcmp($a['expiry'], $b['expiry']));
        }
        return $map;
    }, 12 * 3600);
}
