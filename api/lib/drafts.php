<?php
declare(strict_types=1);

/**
 * Draft portfolios: strategies saved with their entry prices so they can be
 * tracked against live quotes later, and closed with a recorded exit.
 *
 * Stored as one JSON file in the data directory (outside the web root or
 * blocked by .htaccess), shared by everyone who knows the app password.
 */

const OB_MAX_DRAFTS = 200;
const OB_MAX_DRAFT_LEGS = 20;

function ob_drafts_file(): string
{
    return ob_data_dir() . '/drafts.json';
}

/** @return list<array<string, mixed>> newest first */
function ob_drafts_read(): array
{
    $f = ob_drafts_file();
    if (!is_file($f)) {
        return [];
    }
    $json = json_decode((string) file_get_contents($f), true);
    return is_array($json) ? array_values($json) : [];
}

/** @param list<array<string, mixed>> $drafts */
function ob_drafts_write(array $drafts): void
{
    $f = ob_drafts_file();
    if (@file_put_contents($f, json_encode(array_values($drafts), JSON_UNESCAPED_SLASHES), LOCK_EX) === false) {
        throw new RuntimeException('Could not save drafts — is the data directory writable?');
    }
    @chmod($f, 0600);
}

function ob_num(mixed $v, float $min, float $max): ?float
{
    if (!is_int($v) && !is_float($v) && !(is_string($v) && is_numeric($v))) {
        return null;
    }
    $n = (float) $v;
    return is_finite($n) && $n >= $min && $n <= $max ? $n : null;
}

function ob_date_or_null(mixed $v): ?string
{
    return is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : null;
}

/** One leg from the client, validated field by field. Throws on anything malformed. */
function ob_draft_leg(mixed $in): array
{
    if (!is_array($in)) {
        throw new InvalidArgumentException('Each leg must be an object');
    }
    $action = $in['action'] ?? '';
    $type = $in['type'] ?? '';
    if (!in_array($action, ['BUY', 'SELL'], true) || !in_array($type, ['CE', 'PE', 'FUT', 'EQ'], true)) {
        throw new InvalidArgumentException('Leg action or type is invalid');
    }
    $strike = ob_num($in['strike'] ?? 0, 0, 1e7);
    $premium = ob_num($in['premium'] ?? null, 0, 1e7);
    $lots = ob_num($in['lots'] ?? null, 1, 100000);
    $lotSize = ob_num($in['lotSize'] ?? null, 1, 1e7);
    if ($strike === null || $premium === null || $lots === null || $lotSize === null) {
        throw new InvalidArgumentException('Leg strike, premium, lots or lot size is invalid');
    }
    $key = $in['instrumentKey'] ?? null;
    return [
        'action' => $action,
        'type' => $type,
        'strike' => $strike,
        'premium' => $premium,
        'lots' => (int) $lots,
        'lotSize' => (int) $lotSize,
        'instrumentKey' => is_string($key) && preg_match('/^[A-Za-z_]+\|[\w\- ]{1,48}$/', $key) ? $key : null,
        'iv' => ob_num($in['iv'] ?? null, 0, 1000),
        'expiry' => ob_date_or_null($in['expiry'] ?? null),
    ];
}

function ob_draft_name(mixed $v): string
{
    $name = trim(preg_replace('/\s+/', ' ', is_string($v) ? $v : '') ?? '');
    return mb_substr($name !== '' ? $name : 'Untitled', 0, 80);
}

/** Builds a new draft from the client payload; the server owns id and timestamps. */
function ob_draft_create(array $in): array
{
    $legs = $in['legs'] ?? null;
    if (!is_array($legs) || !$legs || count($legs) > OB_MAX_DRAFT_LEGS) {
        throw new InvalidArgumentException('A draft needs 1–' . OB_MAX_DRAFT_LEGS . ' legs');
    }
    $symbol = strtoupper(is_string($in['symbol'] ?? null) ? $in['symbol'] : '');
    if (!preg_match('/^[A-Z0-9&_\-]{1,30}$/', $symbol)) {
        throw new InvalidArgumentException('Symbol is invalid');
    }
    return [
        'id' => bin2hex(random_bytes(8)),
        'name' => ob_draft_name($in['name'] ?? ''),
        'symbol' => $symbol,
        'legs' => array_map('ob_draft_leg', array_values($legs)),
        'entrySpot' => ob_num($in['entrySpot'] ?? null, 0, 1e8),
        'createdAt' => (int) round(microtime(true) * 1000),
        'closedAt' => null,
        'exitPremiums' => null,
        'exitSpot' => null,
    ];
}

/** Applies a rename and/or a close to an existing draft. */
function ob_draft_patch(array $draft, array $in): array
{
    if (array_key_exists('name', $in)) {
        $draft['name'] = ob_draft_name($in['name']);
    }
    if (isset($in['close']) && is_array($in['close']) && $draft['closedAt'] === null) {
        $exits = $in['close']['exitPremiums'] ?? null;
        if (!is_array($exits) || count($exits) !== count($draft['legs'])) {
            throw new InvalidArgumentException('Closing needs one exit price per leg');
        }
        $prices = [];
        foreach (array_values($exits) as $p) {
            $n = ob_num($p, 0, 1e7);
            if ($n === null) {
                throw new InvalidArgumentException('Exit price is invalid');
            }
            $prices[] = $n;
        }
        $draft['exitPremiums'] = $prices;
        $draft['exitSpot'] = ob_num($in['close']['exitSpot'] ?? null, 0, 1e8);
        $draft['closedAt'] = (int) round(microtime(true) * 1000);
    }
    if (!empty($in['reopen'])) {
        $draft['closedAt'] = null;
        $draft['exitPremiums'] = null;
        $draft['exitSpot'] = null;
    }
    return $draft;
}

/**
 * Last traded price for each instrument key, keyed by the key that was asked for.
 *
 * @param list<string> $keys
 * @return array<string, float>
 */
function ob_upstox_ltp(array $keys): array
{
    $res = ob_upstox_get('/market-quote/ltp', ['instrument_key' => implode(',', $keys)]);
    $out = [];
    foreach (($res['data'] ?? []) as $q) {
        $token = (string) ($q['instrument_token'] ?? '');
        if ($token !== '' && isset($q['last_price']) && is_numeric($q['last_price'])) {
            $out[$token] = (float) $q['last_price'];
        }
    }
    return $out;
}

/** The day's broker positions, trimmed to what the Positions page shows. */
function ob_upstox_positions(): array
{
    $res = ob_upstox_get('/portfolio/short-term-positions');
    $f = static fn(array $p, string $k): float => is_numeric($p[$k] ?? null) ? (float) $p[$k] : 0.0;
    $out = [];
    foreach (($res['data'] ?? []) as $p) {
        if (!is_array($p)) {
            continue;
        }
        $out[] = [
            'instrumentKey' => (string) ($p['instrument_token'] ?? ''),
            'symbol' => (string) ($p['trading_symbol'] ?? $p['tradingsymbol'] ?? ''),
            'exchange' => (string) ($p['exchange'] ?? ''),
            'product' => (string) ($p['product'] ?? ''),
            'quantity' => (int) ($p['quantity'] ?? 0),
            'averagePrice' => $f($p, 'average_price'),
            'buyPrice' => $f($p, 'buy_price'),
            'sellPrice' => $f($p, 'sell_price'),
            'ltp' => $f($p, 'last_price'),
            'closePrice' => $f($p, 'close_price'),
            'pnl' => $f($p, 'pnl'),
            'realised' => $f($p, 'realised'),
            'unrealised' => $f($p, 'unrealised'),
        ];
    }
    return $out;
}
