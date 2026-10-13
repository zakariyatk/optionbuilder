<?php
declare(strict_types=1);

/**
 * OHLCV candles from Upstox for the Chart page: history from the v3
 * historical-candle API, plus today's bars from the intraday API for
 * minute / hour timeframes, merged oldest first.
 */

/**
 * Chart timeframe → Upstox unit, interval, days of history to load (kept
 * inside Upstox's per-request limits) and cache TTL in seconds.
 */
const OB_CANDLE_TIMEFRAMES = [
    '1m' => ['minutes', 1, 5, 15],
    '3m' => ['minutes', 3, 10, 15],
    '5m' => ['minutes', 5, 20, 15],
    '15m' => ['minutes', 15, 30, 15],
    '30m' => ['minutes', 30, 80, 30],
    '1h' => ['hours', 1, 85, 30],
    '4h' => ['hours', 4, 85, 60],
    '1D' => ['days', 1, 1100, 300],
    '1W' => ['weeks', 1, 3650, 600],
    '1M' => ['months', 1, 7300, 600],
];

/** Upstox candle rows ([iso, o, h, l, c, volume, oi]) → [unix, o, h, l, c, volume]. */
function ob_candle_rows(array $res): array
{
    $out = [];
    foreach (($res['data']['candles'] ?? []) as $c) {
        if (!is_array($c) || count($c) < 6) {
            continue;
        }
        $t = strtotime((string) $c[0]);
        if ($t === false) {
            continue;
        }
        $out[$t] = [$t, (float) $c[1], (float) $c[2], (float) $c[3], (float) $c[4], (float) $c[5]];
    }
    return $out;
}

function ob_candles(string $symbol, string $tf): array
{
    [$unit, $interval, $days] = OB_CANDLE_TIMEFRAMES[$tf];
    $key = rawurlencode(ob_resolve_instrument_key($symbol));
    $tz = new DateTimeZone('Asia/Kolkata');
    $to = (new DateTimeImmutable('now', $tz))->format('Y-m-d');
    $from = (new DateTimeImmutable("-$days days", $tz))->format('Y-m-d');

    $rows = ob_candle_rows(ob_upstox_get("/historical-candle/$key/$unit/$interval/$to/$from", [], OB_UPSTOX_API_V3));
    if ($unit === 'minutes' || $unit === 'hours') {
        try {
            // Today's session; the historical API stops at the previous day for intraday units.
            $rows = ob_candle_rows(ob_upstox_get("/historical-candle/intraday/$key/$unit/$interval", [], OB_UPSTOX_API_V3)) + $rows;
        } catch (ObNotAuthenticated $e) {
            throw $e;
        } catch (Throwable) {
            // Outside market days the intraday call can fail; history is still useful.
        }
    }
    ksort($rows);
    return array_values($rows);
}

/**
 * Live quotes from Upstox for watchlist symbols, shaped like the spot quote.
 *
 * @param list<string> $symbols
 * @return array<string, array> keyed by symbol
 */
function ob_upstox_watch_quotes(array $symbols): array
{
    $keys = [];
    foreach ($symbols as $s) {
        try {
            $keys[ob_resolve_instrument_key($s)] = $s;
        } catch (Throwable) {
            // Unknown symbol: left for the caller's fallback.
        }
    }
    if (!$keys) {
        return [];
    }
    $res = ob_upstox_get('/market-quote/quotes', ['instrument_key' => implode(',', array_keys($keys))]);
    $out = [];
    foreach (($res['data'] ?? []) as $q) {
        $symbol = $keys[(string) ($q['instrument_token'] ?? '')] ?? null;
        if ($symbol === null || !is_numeric($q['last_price'] ?? null)) {
            continue;
        }
        $last = (float) $q['last_price'];
        $change = is_numeric($q['net_change'] ?? null) ? (float) $q['net_change'] : 0.0;
        $ts = isset($q['timestamp']) ? strtotime((string) $q['timestamp']) : false;
        $out[$symbol] = [
            'symbol' => $symbol,
            'ticker' => (string) $q['instrument_token'],
            'price' => $last,
            'previousClose' => round($last - $change, 2),
            'currency' => 'INR',
            'marketTime' => $ts === false ? time() : $ts,
        ];
    }
    return $out;
}
