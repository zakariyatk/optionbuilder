<?php
declare(strict_types=1);

require_once __DIR__ . '/http.php';

/**
 * US stocks and ETFs, from Yahoo Finance (Upstox covers Indian markets only).
 *
 * US symbols travel through the app as "US:<ticker>", e.g. US:AAPL, so they
 * can never collide with an NSE symbol of the same letters. Everything that
 * talks to Yahoo maps them with ob_yahoo_ticker() (markets.php).
 */

const OB_US_PREFIX = 'US:';

/** Yahoo exchange codes for US listings → the name traders know. */
const OB_US_EXCHANGES = [
    'NMS' => 'NASDAQ',
    'NGM' => 'NASDAQ',
    'NCM' => 'NASDAQ',
    'NAS' => 'NASDAQ',
    'NYQ' => 'NYSE',
    'NYS' => 'NYSE',
    'ASE' => 'NYSE American',
    'PCX' => 'NYSE Arca',
    'BTS' => 'Cboe',
];

function ob_is_us(string $symbol): bool
{
    return str_starts_with($symbol, OB_US_PREFIX);
}

/** A symbol the API accepts: an NSE symbol, or US:<ticker> (BRK.B style class shares included). */
function ob_symbol_ok(string $symbol): bool
{
    return (bool) preg_match('/^[A-Z0-9&_\-]{1,20}$/', $symbol)
        || (bool) preg_match('/^US:[A-Z][A-Z0-9.\-]{0,9}$/', $symbol);
}

/** US:BRK.B → BRK-B, Yahoo's spelling of share classes. */
function ob_us_ticker(string $symbol): string
{
    return str_replace('.', '-', substr($symbol, strlen(OB_US_PREFIX)));
}

/**
 * US stocks and ETFs matching a name or ticker.
 *
 * @return list<array{symbol:string, ticker:string, name:string, exchange:string, type:string}>
 */
function ob_us_search(string $query): array
{
    $url = 'https://query1.finance.yahoo.com/v1/finance/search?' . http_build_query([
        'q' => $query,
        'quotesCount' => 15,
        'newsCount' => 0,
        'listsCount' => 0,
    ]);
    $json = ob_get_json($url, [], 10);

    $out = [];
    foreach (($json['quotes'] ?? []) as $q) {
        $type = (string) ($q['quoteType'] ?? '');
        $exchange = OB_US_EXCHANGES[(string) ($q['exchange'] ?? '')] ?? null;
        $ticker = (string) ($q['symbol'] ?? '');
        // US-listed equities and ETFs only — no futures, foreign listings or funds.
        if ($exchange === null || !in_array($type, ['EQUITY', 'ETF'], true) || !preg_match('/^[A-Z][A-Z0-9\-]{0,9}$/', $ticker)) {
            continue;
        }
        $out[] = [
            'symbol' => OB_US_PREFIX . str_replace('-', '.', $ticker),
            'ticker' => $ticker,
            'name' => (string) ($q['longname'] ?? $q['shortname'] ?? $ticker),
            'exchange' => $exchange,
            'type' => $type,
        ];
    }
    return array_slice($out, 0, 10);
}

// ---------------------------------------------------------------- candles

/**
 * Chart timeframe → Yahoo interval, range, and how many Yahoo bars make one
 * of ours. Yahoo has no 3m or 4h bars, so those are built from 1m and 1h.
 * Yahoo keeps ~7 days of 1m bars and ~60 days of 2–30m bars.
 */
const OB_YAHOO_CANDLE_SPEC = [
    '1m' => ['1m', '5d', 1],
    '3m' => ['1m', '5d', 3],
    '5m' => ['5m', '1mo', 1],
    '15m' => ['15m', '1mo', 1],
    '30m' => ['30m', '1mo', 1],
    '1h' => ['60m', '6mo', 1],
    '4h' => ['60m', '1y', 4],
    '1D' => ['1d', '5y', 1],
    '1W' => ['1wk', '10y', 1],
    '1M' => ['1mo', 'max', 1],
];

/**
 * OHLCV candles for a US symbol, shaped like the Upstox ones:
 * [unix seconds, open, high, low, close, volume], oldest first.
 * Regular session only — pre-market and after-hours are left out.
 */
function ob_yahoo_candles(string $symbol, string $tf): array
{
    [$interval, $range, $group] = OB_YAHOO_CANDLE_SPEC[$tf];
    $url = 'https://query1.finance.yahoo.com/v8/finance/chart/' . rawurlencode(ob_us_ticker($symbol))
        . '?' . http_build_query(['interval' => $interval, 'range' => $range, 'includePrePost' => 'false']);
    $json = ob_get_json($url, [], 20);

    $r = $json['chart']['result'][0] ?? null;
    $ts = $r['timestamp'] ?? null;
    $q = $r['indicators']['quote'][0] ?? null;
    if (!is_array($ts) || !is_array($q)) {
        throw new RuntimeException('No chart data for ' . ob_us_ticker($symbol));
    }

    $bars = [];
    foreach ($ts as $i => $t) {
        $o = $q['open'][$i] ?? null;
        $h = $q['high'][$i] ?? null;
        $l = $q['low'][$i] ?? null;
        $c = $q['close'][$i] ?? null;
        // Yahoo pads gaps (halts, holidays) with nulls.
        if (!is_numeric($o) || !is_numeric($h) || !is_numeric($l) || !is_numeric($c)) {
            continue;
        }
        $bars[] = [(int) $t, round((float) $o, 4), round((float) $h, 4), round((float) $l, 4), round((float) $c, 4), (float) ($q['volume'][$i] ?? 0)];
    }

    return $group > 1 ? ob_group_session_bars($bars, $group, (string) ($r['meta']['exchangeTimezoneName'] ?? 'America/New_York')) : $bars;
}

/**
 * Merges every $n consecutive intraday bars of the same session into one,
 * counted from the session's first bar — so 4h bars start at the open
 * (09:30, 13:30 New York) like a broker's, not at arbitrary clock hours.
 *
 * @param list<array{0:int,1:float,2:float,3:float,4:float,5:float}> $bars
 */
function ob_group_session_bars(array $bars, int $n, string $timezone): array
{
    $tz = new DateTimeZone($timezone);
    $out = [];
    $day = null;
    $k = 0;
    foreach ($bars as $b) {
        $d = (new DateTimeImmutable('@' . $b[0]))->setTimezone($tz)->format('Y-m-d');
        if ($d !== $day) {
            $day = $d;
            $k = 0;
        }
        if ($k % $n === 0) {
            $out[] = $b;
        } else {
            $last = &$out[count($out) - 1];
            $last[2] = max($last[2], $b[2]);
            $last[3] = min($last[3], $b[3]);
            $last[4] = $b[4];
            $last[5] += $b[5];
            unset($last);
        }
        $k++;
    }
    return $out;
}
