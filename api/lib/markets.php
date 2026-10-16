<?php
declare(strict_types=1);

require_once __DIR__ . '/http.php';

/**
 * Yahoo Finance quotes — spot prices and the global cue basket.
 *
 * range=1d is mandatory. A wider range makes chartPreviousClose the close at
 * the START of the window, silently turning a daily change into a 5-day one.
 */

const OB_YAHOO_TICKER = [
    'NIFTY' => '^NSEI',
    'BANKNIFTY' => '^NSEBANK',
    'FINNIFTY' => 'NIFTY_FIN_SERVICE.NS',
    'MIDCPNIFTY' => 'NIFTY_MID_SELECT.NS',
    'INDIAVIX' => '^INDIAVIX',
    // Live rupees per dollar, for valuing US holdings.
    'USDINR' => 'INR=X',
];

function ob_yahoo_chart_url(string $ticker): string
{
    return 'https://query1.finance.yahoo.com/v8/finance/chart/' . rawurlencode($ticker) . '?interval=1d&range=1d';
}

function ob_yahoo_meta_from(mixed $json, string $ticker): array
{
    $meta = $json['chart']['result'][0]['meta'] ?? null;
    if (!is_array($meta) || !isset($meta['regularMarketPrice'])) {
        throw new RuntimeException("No data for $ticker");
    }
    return $meta;
}

function ob_yahoo_meta(string $ticker): array
{
    return ob_yahoo_meta_from(ob_get_json(ob_yahoo_chart_url($ticker), [], 20), $ticker);
}

function ob_yahoo_ticker(string $symbol): string
{
    if (ob_is_us($symbol)) {
        return ob_us_ticker($symbol);
    }
    return OB_YAHOO_TICKER[$symbol] ?? ($symbol . '.NS');
}

function ob_spot_from_meta(string $symbol, string $ticker, array $meta): array
{
    return [
        'symbol' => $symbol,
        'ticker' => $ticker,
        'price' => (float) $meta['regularMarketPrice'],
        'previousClose' => (float) ($meta['previousClose'] ?? $meta['chartPreviousClose'] ?? 0),
        'currency' => $meta['currency'] ?? 'INR',
        'marketTime' => (int) ($meta['regularMarketTime'] ?? 0),
    ];
}

function ob_spot_price(string $symbol): array
{
    $ticker = ob_yahoo_ticker($symbol);
    return ob_spot_from_meta($symbol, $ticker, ob_yahoo_meta($ticker));
}

/**
 * Spot quotes for many symbols at once, fetched in parallel with a short
 * timeout so one slow symbol can't stall the whole watchlist. Symbols that
 * fail are left out.
 *
 * @param list<string> $symbols
 * @return array<string, array> keyed by symbol
 */
function ob_spot_prices(array $symbols, int $timeout = 8): array
{
    $urls = [];
    foreach ($symbols as $symbol) {
        $urls[$symbol] = ob_yahoo_chart_url(ob_yahoo_ticker($symbol));
    }
    $out = [];
    foreach (ob_http_multi_get($urls, ['Accept' => 'application/json'], 10, $timeout) as $symbol => $res) {
        if ($res['status'] < 200 || $res['status'] >= 300) {
            continue;
        }
        try {
            $ticker = ob_yahoo_ticker($symbol);
            $out[$symbol] = ob_spot_from_meta($symbol, $ticker, ob_yahoo_meta_from(json_decode($res['body'], true), $ticker));
        } catch (Throwable) {
            // Left out: the caller marks it.
        }
    }
    return $out;
}

// ------------------------------------------------------------ global markets

function ob_global_groups_spec(): array
{
    return [
        ['group' => 'US — overnight cue', 'equity' => true, 'items' => [
            ['name' => 'S&P 500', 'symbol' => '^GSPC'],
            ['name' => 'Nasdaq', 'symbol' => '^IXIC'],
            ['name' => 'Dow Jones', 'symbol' => '^DJI'],
        ]],
        ['group' => 'Asia — this morning', 'equity' => true, 'items' => [
            ['name' => 'Nikkei 225', 'symbol' => '^N225'],
            ['name' => 'Hang Seng', 'symbol' => '^HSI'],
            ['name' => 'Shanghai', 'symbol' => '000001.SS'],
        ]],
        ['group' => 'Commodities & FX', 'equity' => false, 'items' => [
            ['name' => 'Brent crude', 'symbol' => 'BZ=F', 'inverseForIndia' => true],
            ['name' => 'Gold', 'symbol' => 'GC=F'],
            ['name' => 'USD/INR', 'symbol' => 'INR=X', 'inverseForIndia' => true],
            ['name' => 'Dollar index', 'symbol' => 'DX-Y.NYB', 'inverseForIndia' => true],
        ]],
        ['group' => 'Volatility', 'equity' => false, 'items' => [
            ['name' => 'India VIX', 'symbol' => '^INDIAVIX', 'inverseForIndia' => true],
            ['name' => 'US VIX', 'symbol' => '^VIX', 'inverseForIndia' => true],
        ]],
    ];
}

function ob_global_markets(): array
{
    $groups = [];
    foreach (ob_global_groups_spec() as $spec) {
        $items = [];
        foreach ($spec['items'] as $item) {
            try {
                $meta = ob_yahoo_meta($item['symbol']);
                $price = (float) $meta['regularMarketPrice'];
                $prev = (float) ($meta['previousClose'] ?? $meta['chartPreviousClose'] ?? 0);
                $items[] = $item + [
                    'ok' => true,
                    'price' => $price,
                    'previousClose' => $prev,
                    'change' => $prev > 0 ? $price - $prev : 0,
                    'changePct' => $prev > 0 ? (($price - $prev) / $prev) * 100 : 0,
                    'marketTime' => (int) ($meta['regularMarketTime'] ?? 0),
                ];
            } catch (Throwable) {
                // One dead ticker shouldn't blank the whole panel.
                $items[] = $item + ['ok' => false, 'price' => null, 'changePct' => 0];
            }
        }
        $groups[] = ['group' => $spec['group'], 'equity' => $spec['equity'], 'items' => $items];
    }

    return ['groups' => $groups, 'sentiment' => ob_global_sentiment($groups), 'asOf' => gmdate('c')];
}

/**
 * A transparent read, not a forecast: the average move across the six global
 * equity indices sets the label, with India-specific headwinds reported as
 * separate caveats rather than folded into one opaque score.
 */
function ob_global_sentiment(array $groups): array
{
    $equityMoves = [];
    $all = [];
    foreach ($groups as $g) {
        foreach ($g['items'] as $i) {
            if (!$i['ok']) {
                continue;
            }
            $all[] = $i;
            if ($g['equity']) {
                $equityMoves[] = $i['changePct'];
            }
        }
    }

    $equityAvg = $equityMoves ? array_sum($equityMoves) / count($equityMoves) : null;

    $label = 'Mixed';
    if ($equityAvg !== null) {
        if ($equityAvg >= 0.5) {
            $label = 'Risk-on';
        } elseif ($equityAvg <= -0.5) {
            $label = 'Risk-off';
        } elseif ($equityAvg > 0) {
            $label = 'Mildly positive';
        } elseif ($equityAvg < 0) {
            $label = 'Mildly negative';
        }
    }

    $find = static function (string $name) use ($all): ?array {
        foreach ($all as $i) {
            if ($i['name'] === $name) {
                return $i;
            }
        }
        return null;
    };

    $caveats = [];
    $crude = $find('Brent crude');
    if ($crude && $crude['changePct'] >= 1) {
        $caveats[] = sprintf('Brent +%.1f%% — import-bill headwind', $crude['changePct']);
    }
    $inr = $find('USD/INR');
    if ($inr && $inr['changePct'] >= 0.25) {
        $caveats[] = sprintf('Rupee weaker %.2f%%', $inr['changePct']);
    }
    $ivix = $find('India VIX');
    if ($ivix && $ivix['changePct'] >= 5) {
        $caveats[] = sprintf('India VIX +%.1f%% — rising fear', $ivix['changePct']);
    }

    usort($all, static fn($a, $b) => abs($b['changePct']) <=> abs($a['changePct']));
    $drivers = [];
    foreach (array_slice($all, 0, 3) as $i) {
        $drivers[] = sprintf('%s %s%.2f%%', $i['name'], $i['changePct'] >= 0 ? '+' : '', $i['changePct']);
    }

    return ['label' => $label, 'equityAvg' => $equityAvg, 'drivers' => $drivers, 'caveats' => $caveats];
}

// ------------------------------------------------------------------- FII/DII

/**
 * NSE publishes participant flows at a plain JSON endpoint that, unlike the
 * option-chain API, is not behind the Akamai bot wall. Values are ₹ crore.
 */
function ob_fii_dii(): array
{
    $raw = ob_get_json('https://www.nseindia.com/api/fiidiiTradeReact', [
        'Accept' => 'application/json',
        'Referer' => 'https://www.nseindia.com/',
    ], 25);

    if (!is_array($raw)) {
        throw new RuntimeException('Unexpected FII/DII response shape');
    }

    $out = [];
    foreach ($raw as $row) {
        $out[] = [
            'category' => ($row['category'] ?? '') === 'FII/FPI' ? 'FII' : ($row['category'] ?? ''),
            'date' => $row['date'] ?? '',
            'buy' => (float) ($row['buyValue'] ?? 0),
            'sell' => (float) ($row['sellValue'] ?? 0),
            'net' => (float) ($row['netValue'] ?? 0),
        ];
    }
    return $out;
}
