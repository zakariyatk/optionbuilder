<?php
declare(strict_types=1);

/**
 * Intraday open-interest history per strike, for the Open Interest page's
 * time window: every option's 1-minute candles (which carry OI) fetched in
 * parallel, forward-filled onto one minute grid, with the underlying's price.
 * Outside market hours it falls back to the last session with data.
 */

const OB_OI_MAX_STRIKES = 61;

/** Candle rows → [unix => [close, oi]]. */
function ob_oi_points(string $body): array
{
    $json = json_decode($body, true);
    $out = [];
    foreach (($json['data']['candles'] ?? []) as $c) {
        if (!is_array($c) || count($c) < 5) {
            continue;
        }
        $t = strtotime((string) $c[0]);
        if ($t !== false) {
            $out[$t] = [(float) $c[4], isset($c[6]) ? (float) $c[6] : 0.0];
        }
    }
    ksort($out);
    return $out;
}

/**
 * @param array<string,string> $keys id => instrument key
 * @return array<string, array<int, array{0: float, 1: float}>>
 */
function ob_oi_fetch(array $keys, bool $intraday): array
{
    $tz = new DateTimeZone('Asia/Kolkata');
    $to = (new DateTimeImmutable('now', $tz))->format('Y-m-d');
    $from = (new DateTimeImmutable('-7 days', $tz))->format('Y-m-d');
    $urls = [];
    foreach ($keys as $id => $key) {
        $k = rawurlencode($key);
        $urls[$id] = $intraday
            ? OB_UPSTOX_API_V3 . "/historical-candle/intraday/$k/minutes/1"
            : OB_UPSTOX_API_V3 . "/historical-candle/$k/minutes/1/$to/$from";
    }
    $out = [];
    foreach (ob_http_multi_get($urls, ob_upstox_headers(), 10, 25) as $id => $res) {
        if ($res['status'] === 401) {
            ob_clear_token();
            throw new ObNotAuthenticated('NOT_AUTHENTICATED');
        }
        $out[$id] = $res['status'] >= 200 && $res['status'] < 300 ? ob_oi_points($res['body']) : [];
    }
    return $out;
}

/**
 * @return array{expiry: string, times: int[], spot: (float|null)[], rows: list<array>}
 */
function ob_oi_intraday(string $symbol, string $expiry, float $min, float $max): array
{
    $underlying = ob_resolve_instrument_key($symbol);
    ['expiries' => $expiries, 'lotSize' => $lotSize] = ob_option_contracts($underlying);
    if (!in_array($expiry, $expiries, true)) {
        throw new InvalidArgumentException('Unknown expiry');
    }
    $chain = ob_reshape_chain(ob_option_chain_raw($underlying, $expiry), $symbol, $expiries, $expiry, $lotSize);
    $rows = array_values(array_filter($chain['rows'], static fn(array $r): bool => $r['strike'] >= $min && $r['strike'] <= $max));
    if (count($rows) > OB_OI_MAX_STRIKES) {
        // Keep the strikes nearest the money.
        $spot = (float) ($chain['underlyingValue'] ?? 0);
        usort($rows, static fn($a, $b) => abs($a['strike'] - $spot) <=> abs($b['strike'] - $spot));
        $rows = array_slice($rows, 0, OB_OI_MAX_STRIKES);
        usort($rows, static fn($a, $b) => $a['strike'] <=> $b['strike']);
    }

    $keys = ['spot' => $underlying];
    foreach ($rows as $i => $r) {
        foreach (['call', 'put'] as $side) {
            if (!empty($r[$side]['instrumentKey'])) {
                $keys["$i:$side"] = $r[$side]['instrumentKey'];
            }
        }
    }

    $series = ob_oi_fetch($keys, true);
    if (!$series['spot']) {
        // Before the open, on holidays and weekends: show the last session instead.
        $series = ob_oi_fetch($keys, false);
        $lastDay = null;
        foreach (array_keys($series['spot']) as $t) {
            $lastDay = gmdate('Y-m-d', $t + 19800);
        }
        foreach ($series as $id => $points) {
            $series[$id] = array_filter($points, static fn(int $t): bool => gmdate('Y-m-d', $t + 19800) === $lastDay, ARRAY_FILTER_USE_KEY);
        }
    }

    // One minute grid across every series, each forward-filled.
    $times = [];
    foreach ($series as $points) {
        foreach (array_keys($points) as $t) {
            $times[$t] = true;
        }
    }
    $times = array_keys($times);
    sort($times);

    $fill = static function (array $points, int $field) use ($times): array {
        $out = [];
        $last = null;
        foreach ($times as $t) {
            if (isset($points[$t])) {
                $last = $points[$t][$field];
            }
            $out[] = $last;
        }
        return $out;
    };

    $outRows = [];
    foreach ($rows as $i => $r) {
        $sideOf = static function (string $name) use ($r, $i, $series, $fill): ?array {
            if (empty($r[$name])) {
                return null;
            }
            return [
                // Yesterday's closing OI — the baseline for a window that starts at the open.
                'prevOi' => $r[$name]['oi'] - $r[$name]['oiChange'],
                'oi' => array_map(static fn($v) => $v === null ? null : (int) round($v), $fill($series["$i:$name"] ?? [], 1)),
            ];
        };
        $outRows[] = ['strike' => $r['strike'], 'call' => $sideOf('call'), 'put' => $sideOf('put')];
    }

    return [
        'expiry' => $expiry,
        'times' => $times,
        'spot' => $fill($series['spot'], 0),
        'rows' => $outRows,
    ];
}
