<?php
declare(strict_types=1);

require_once __DIR__ . '/http.php';
require_once __DIR__ . '/cache.php';
require_once __DIR__ . '/us.php';

/**
 * US listed option chains from Yahoo Finance (delayed ~15 minutes).
 *
 * Yahoo's options endpoint wants a session: a cookie set by fc.yahoo.com and
 * a "crumb" fetched with it. Both are cached for a few hours and renewed
 * once when Yahoo rejects them. The response is reshaped to the same chain
 * shape the Upstox chain uses, with 100-share contracts.
 */

const OB_YAHOO_SESSION_TTL = 6 * 3600;
const OB_US_CONTRACT_SIZE = 100;

/** Cookie header value from a raw response's Set-Cookie lines. */
function ob_cookies_from_headers(string $rawHeaders): string
{
    preg_match_all('/^set-cookie:\s*([^;\r\n]+)/mi', $rawHeaders, $m);
    return implode('; ', $m[1] ?? []);
}

/** @return array{cookie:string, crumb:string} */
function ob_yahoo_session(bool $refresh = false): array
{
    if (!$refresh) {
        $cached = ob_cache_get('yahoo:session', OB_YAHOO_SESSION_TTL);
        if (is_array($cached) && !empty($cached['crumb'])) {
            return $cached;
        }
    }

    $ch = curl_init('https://fc.yahoo.com/');
    if ($ch === false) {
        throw new ObHttpError('Could not initialise cURL');
    }
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_USERAGENT => OB_UA,
    ]);
    $response = curl_exec($ch);
    $headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    // fc.yahoo.com answers 404 by design; only the cookie matters.
    $cookie = is_string($response) ? ob_cookies_from_headers(substr($response, 0, $headerSize)) : '';
    if ($cookie === '') {
        throw new ObHttpError('Yahoo did not set a session cookie');
    }

    $crumb = trim(ob_get_text('https://query2.finance.yahoo.com/v1/test/getcrumb', ['Cookie' => $cookie], 15));
    if ($crumb === '' || str_contains($crumb, '<')) {
        throw new ObHttpError('Yahoo did not return a crumb');
    }

    $session = ['cookie' => $cookie, 'crumb' => $crumb];
    ob_cache_put('yahoo:session', $session);
    return $session;
}

/** Raw Yahoo options JSON for one ticker and (optionally) one expiry, renewing the session once on 401/403. */
function ob_yahoo_options_raw(string $ticker, ?int $date): array
{
    for ($attempt = 0; $attempt < 2; $attempt++) {
        $session = ob_yahoo_session($attempt > 0);
        $query = ['crumb' => $session['crumb']];
        if ($date !== null) {
            $query['date'] = $date;
        }
        $url = 'https://query2.finance.yahoo.com/v7/finance/options/' . rawurlencode($ticker) . '?' . http_build_query($query);
        try {
            $json = ob_get_json($url, ['Cookie' => $session['cookie']], 20);
        } catch (ObHttpError $e) {
            if ($attempt === 0 && in_array($e->status, [401, 403], true)) {
                continue;
            }
            throw $e;
        }
        $result = $json['optionChain']['result'][0] ?? null;
        if (!is_array($result)) {
            throw new RuntimeException('Yahoo returned no option chain for ' . $ticker);
        }
        return $result;
    }
    throw new RuntimeException('Yahoo rejected the session');
}

/** One Yahoo contract → the app's chain side. */
function ob_yahoo_side(?array $c): ?array
{
    if ($c === null) {
        return null;
    }
    return [
        'instrumentKey' => null,
        'ltp' => (float) ($c['lastPrice'] ?? 0),
        'change' => (float) ($c['change'] ?? 0),
        'oi' => (int) ($c['openInterest'] ?? 0),
        'oiChange' => 0,
        'volume' => (int) ($c['volume'] ?? 0),
        // Yahoo quotes IV as a decimal; the app uses percent.
        'iv' => round((float) ($c['impliedVolatility'] ?? 0) * 100, 2),
        'delta' => null,
        'theta' => null,
        'bid' => (float) ($c['bid'] ?? 0),
        'ask' => (float) ($c['ask'] ?? 0),
    ];
}

/**
 * The option chain for a US:<ticker> symbol at `$expiry` (YYYY-MM-DD), or the
 * nearest expiry when null / not listed.
 */
function ob_us_option_chain(string $symbol, ?string $expiry): array
{
    $ticker = ob_us_ticker($symbol);
    $first = ob_yahoo_options_raw($ticker, null);
    $dates = array_map('intval', $first['expirationDates'] ?? []);
    if (!$dates) {
        throw new RuntimeException("No listed options for $ticker");
    }
    $toDay = static fn(int $t): string => gmdate('Y-m-d', $t);
    $expiries = array_map($toDay, $dates);

    $index = $expiry !== null ? array_search($expiry, $expiries, true) : false;
    $result = ($index === false || $index === 0) ? $first : ob_yahoo_options_raw($ticker, $dates[$index]);
    $target = $index === false ? $expiries[0] : $expiries[$index];

    $book = $result['options'][0] ?? ['calls' => [], 'puts' => []];
    $byStrike = [];
    foreach (['calls' => 'call', 'puts' => 'put'] as $list => $side) {
        foreach ($book[$list] ?? [] as $c) {
            $k = (string) (float) $c['strike'];
            $byStrike[$k] ??= ['strike' => (float) $c['strike'], 'call' => null, 'put' => null];
            $byStrike[$k][$side] = ob_yahoo_side($c);
        }
    }
    ksort($byStrike, SORT_NUMERIC);

    $quote = $result['quote'] ?? $first['quote'] ?? [];
    $q = isset($quote['trailingAnnualDividendYield'])
        ? (float) $quote['trailingAnnualDividendYield']
        : (isset($quote['dividendYield']) ? (float) $quote['dividendYield'] / 100 : 0.0);

    return [
        'source' => 'yahoo',
        'symbol' => $symbol,
        'lotSize' => OB_US_CONTRACT_SIZE,
        'underlyingValue' => isset($quote['regularMarketPrice']) ? (float) $quote['regularMarketPrice'] : null,
        'timestamp' => gmdate('c'),
        'expiryDates' => $expiries,
        'expiry' => $target,
        'rows' => array_values($byStrike),
        'dividendYield' => max(0.0, min($q, 0.2)),
    ];
}
