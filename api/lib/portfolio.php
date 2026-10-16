<?php
declare(strict_types=1);

require_once __DIR__ . '/drafts.php'; // ob_num(), ob_date_or_null()

/**
 * Investment portfolios: named lists of stock and futures transactions.
 *
 * Only the raw transactions are stored — holdings, average cost and P&L are
 * derived on the client, so a corrected transaction re-computes everything.
 * One JSON file in the data directory, like drafts.
 */

const OB_MAX_PORTFOLIOS = 20;
const OB_MAX_TRANSACTIONS = 2000;

function ob_portfolios_file(): string
{
    return ob_data_dir() . '/portfolios.json';
}

/** @return list<array<string, mixed>> */
function ob_portfolios_read(): array
{
    $f = ob_portfolios_file();
    if (!is_file($f)) {
        return [];
    }
    $json = json_decode((string) file_get_contents($f), true);
    return is_array($json) ? array_values($json) : [];
}

/** @param list<array<string, mixed>> $portfolios */
function ob_portfolios_write(array $portfolios): void
{
    $f = ob_portfolios_file();
    if (@file_put_contents($f, json_encode(array_values($portfolios), JSON_UNESCAPED_SLASHES), LOCK_EX) === false) {
        throw new RuntimeException('Could not save portfolios — is the data directory writable?');
    }
    @chmod($f, 0600);
}

function ob_portfolio_name(mixed $v): string
{
    $name = is_string($v) ? trim(preg_replace('/\s+/u', ' ', $v) ?? '') : '';
    if ($name === '' || mb_strlen($name) > 60) {
        throw new InvalidArgumentException('Portfolio name must be 1–60 characters');
    }
    return $name;
}

/** One transaction from the client, validated field by field. */
function ob_portfolio_txn(mixed $in): array
{
    if (!is_array($in)) {
        throw new InvalidArgumentException('Each transaction must be an object');
    }
    $kind = $in['kind'] ?? '';
    $side = $in['side'] ?? '';
    if (!in_array($kind, ['STOCK', 'FUT'], true) || !in_array($side, ['BUY', 'SELL'], true)) {
        throw new InvalidArgumentException('Transaction kind or side is invalid');
    }
    $symbol = strtoupper(trim((string) ($in['symbol'] ?? '')));
    // Futures are NSE only; stocks may be NSE or US (US:AAPL).
    if (!ob_symbol_ok($symbol) || ($kind === 'FUT' && ob_is_us($symbol))) {
        throw new InvalidArgumentException('Transaction symbol is invalid');
    }
    $date = ob_date_or_null($in['date'] ?? null);
    if ($date === null || $date > gmdate('Y-m-d', time() + 86400)) {
        throw new InvalidArgumentException('Transaction date must be a valid date, not in the future');
    }
    $qty = ob_num($in['qty'] ?? null, 1, 1e9);
    $price = ob_num($in['price'] ?? null, 0.01, 1e8);
    $fees = ob_num($in['fees'] ?? 0, 0, 1e8);
    if ($qty === null || $price === null || $fees === null) {
        throw new InvalidArgumentException('Transaction quantity, price or fees is invalid');
    }
    $id = (string) ($in['id'] ?? '');
    if (!preg_match('/^[A-Za-z0-9\-]{8,64}$/', $id)) {
        $id = bin2hex(random_bytes(8));
    }

    $txn = [
        'id' => $id,
        'kind' => $kind,
        'side' => $side,
        'symbol' => $symbol,
        'date' => $date,
        // Shares for a stock, lots for a future.
        'qty' => (int) $qty,
        'price' => $price,
        'fees' => $fees,
    ];

    if ($kind === 'FUT') {
        $lotSize = ob_num($in['lotSize'] ?? null, 1, 1e7);
        $expiry = ob_date_or_null($in['expiry'] ?? null);
        if ($lotSize === null || $expiry === null) {
            throw new InvalidArgumentException('A futures transaction needs a lot size and an expiry');
        }
        $key = $in['instrumentKey'] ?? null;
        $txn['lotSize'] = (int) $lotSize;
        $txn['expiry'] = $expiry;
        $txn['instrumentKey'] = is_string($key) && preg_match('/^[A-Za-z_]+\|[\w\- ]{1,48}$/', $key) ? $key : null;
    }

    $note = is_string($in['note'] ?? null) ? trim((string) $in['note']) : '';
    if ($note !== '') {
        $txn['note'] = mb_substr($note, 0, 200);
    }
    return $txn;
}

/** @return list<array<string, mixed>> */
function ob_portfolio_txns(mixed $in): array
{
    if (!is_array($in) || !array_is_list($in)) {
        throw new InvalidArgumentException('transactions must be a list');
    }
    if (count($in) > OB_MAX_TRANSACTIONS) {
        throw new InvalidArgumentException('Too many transactions (max ' . OB_MAX_TRANSACTIONS . ')');
    }
    return array_map('ob_portfolio_txn', $in);
}

function ob_portfolio_create(array $body): array
{
    return [
        'id' => bin2hex(random_bytes(8)),
        'name' => ob_portfolio_name($body['name'] ?? ''),
        'createdAt' => (int) round(microtime(true) * 1000),
        'transactions' => isset($body['transactions']) ? ob_portfolio_txns($body['transactions']) : [],
    ];
}

function ob_portfolio_patch(array $portfolio, array $body): array
{
    if (array_key_exists('name', $body)) {
        $portfolio['name'] = ob_portfolio_name($body['name']);
    }
    if (array_key_exists('transactions', $body)) {
        $portfolio['transactions'] = ob_portfolio_txns($body['transactions']);
    }
    return $portfolio;
}

// ---------------------------------------------------------- price history

/** Benchmarks and FX, addressed by a short key so the client never sends raw Yahoo tickers. */
const OB_HISTORY_TICKERS = [
    'NIFTY' => '^NSEI',
    'BANKNIFTY' => '^NSEBANK',
    'SENSEX' => '^BSESN',
    'NIFTYMIDCAP' => 'NIFTY_MIDCAP_100.NS',
    'SP500' => '^GSPC',
    'NASDAQ100' => '^NDX',
    'QQQ' => 'QQQ',
    'DOW' => '^DJI',
    'GOLD' => 'GC=F',
    'USDINR' => 'INR=X',
];

function ob_history_ticker(string $key): string
{
    return OB_HISTORY_TICKERS[$key] ?? ob_yahoo_ticker($key);
}

/**
 * Daily closes for many symbols, in parallel. Each series is
 * [[unix seconds, close], …] oldest first; symbols Yahoo can't serve are left out.
 *
 * @param list<string> $keys
 * @return array<string, array{currency:string, points:list<array{0:int,1:float}>}>
 */
function ob_price_history(array $keys, string $range): array
{
    $urls = [];
    foreach ($keys as $key) {
        $urls[$key] = 'https://query1.finance.yahoo.com/v8/finance/chart/' . rawurlencode(ob_history_ticker($key))
            . '?interval=1d&range=' . rawurlencode($range);
    }

    $out = [];
    foreach (ob_http_multi_get($urls, ['Accept' => 'application/json'], 10, 20) as $key => $res) {
        if ($res['status'] < 200 || $res['status'] >= 300) {
            continue;
        }
        $json = json_decode($res['body'], true);
        $r = $json['chart']['result'][0] ?? null;
        $ts = $r['timestamp'] ?? null;
        $closes = $r['indicators']['adjclose'][0]['adjclose'] ?? $r['indicators']['quote'][0]['close'] ?? null;
        if (!is_array($ts) || !is_array($closes)) {
            continue;
        }
        $points = [];
        foreach ($ts as $i => $t) {
            $c = $closes[$i] ?? null;
            // Yahoo pads holidays and half-built bars with nulls.
            if (is_numeric($c) && $c > 0) {
                $points[] = [(int) $t, round((float) $c, 4)];
            }
        }
        if ($points) {
            $out[$key] = ['currency' => (string) ($r['meta']['currency'] ?? 'INR'), 'points' => $points];
        }
    }
    return $out;
}

// --------------------------------------------------------------- futures

/**
 * NSE futures contracts, from the same Upstox instruments master used for
 * equities (public, no broker login needed). Keyed by underlying symbol.
 *
 * @return array<string, list<array{expiry:string, instrumentKey:string, lotSize:int}>>
 */
function ob_futures_index(): array
{
    return ob_cached('instruments:nse-fut', function (): array {
        $body = ob_get_text('https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz', [], 60);
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
            if (($row['segment'] ?? '') !== 'NSE_FO' || ($row['instrument_type'] ?? '') !== 'FUT') {
                continue;
            }
            $underlying = strtoupper((string) ($row['underlying_symbol'] ?? $row['name'] ?? ''));
            $expiryMs = $row['expiry'] ?? null;
            if ($underlying === '' || !is_numeric($expiryMs)) {
                continue;
            }
            // Expiry is a millisecond timestamp; the IST calendar date is what traders see.
            $expiry = gmdate('Y-m-d', (int) ($expiryMs / 1000) + 19800);
            $map[$underlying][] = [
                'expiry' => $expiry,
                'instrumentKey' => (string) ($row['instrument_key'] ?? ''),
                'lotSize' => (int) ($row['lot_size'] ?? 1),
            ];
        }
        foreach ($map as &$list) {
            usort($list, static fn(array $a, array $b): int => strcmp($a['expiry'], $b['expiry']));
        }
        return $map;
    }, 12 * 3600);
}
