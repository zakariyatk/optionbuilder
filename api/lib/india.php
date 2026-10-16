<?php
declare(strict_types=1);

require_once __DIR__ . '/http.php';
require_once __DIR__ . '/cache.php';

/**
 * Every NSE-listed stock and ETF, searchable by symbol or company name.
 *
 * Built from the same public Upstox instruments master the backend already
 * uses to resolve instrument keys (no broker login needed), cached for 12 h.
 * Bonds, T-bills and gold bonds are left out; ETFs are recognised by their
 * mutual-fund ISIN (INF…).
 */

/** NSE cash-market series that are tradable equities: main board, trade-to-trade, SME. */
const OB_NSE_EQUITY_SERIES = ['EQ', 'BE', 'BZ', 'SM', 'ST'];

/** "BSE LIMITED" → "BSE Limited": short words stay as acronyms, the rest is title-cased. */
function ob_tidy_company_name(string $name): string
{
    $small = ['LTD' => 'Ltd', 'LTD.' => 'Ltd.', 'THE' => 'The', 'AND' => 'and', 'OF' => 'of', 'CO' => 'Co', 'INC' => 'Inc'];
    $words = preg_split('/\s+/', trim($name)) ?: [];
    return implode(' ', array_map(static function (string $w) use ($small): string {
        $u = strtoupper($w);
        if (isset($small[$u])) {
            return $small[$u];
        }
        return strlen($w) <= 3 ? $u : ucfirst(strtolower($w));
    }, $words));
}

/**
 * @return list<array{0:string,1:string,2:string,3:string}> [symbol, display name, upper-case search text, type]
 */
function ob_nse_listings(): array
{
    return ob_cached('listings:nse', function (): array {
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

        $out = [];
        $seen = [];
        foreach ($rows as $r) {
            if (($r['segment'] ?? '') !== 'NSE_EQ' || !in_array($r['instrument_type'] ?? '', OB_NSE_EQUITY_SERIES, true)) {
                continue;
            }
            $symbol = strtoupper((string) ($r['trading_symbol'] ?? ''));
            if ($symbol === '' || isset($seen[$symbol]) || !preg_match('/^[A-Z0-9&_\-]{1,20}$/', $symbol)) {
                continue;
            }
            $seen[$symbol] = true;
            $full = (string) ($r['name'] ?? $symbol);
            $short = trim((string) ($r['short_name'] ?? ''));
            // Upstox's short name is nicely cased ("Reliance Industries") unless it's just the symbol again.
            $display = ($short !== '' && strtoupper($short) !== $symbol) ? $short : ob_tidy_company_name($full);
            $etf = str_starts_with((string) ($r['isin'] ?? ''), 'INF');
            $out[] = [$symbol, $display, strtoupper($full . ' ' . $short), $etf ? 'ETF' : 'EQUITY'];
        }
        return $out;
    }, 12 * 3600);
}

/**
 * NSE stocks and ETFs matching a symbol or company name, best matches first:
 * exact symbol, symbol prefix, a name word starting with the query, then any
 * other match. Every word of a multi-word query must appear ("tata motors").
 *
 * @return list<array{symbol:string, ticker:string, name:string, exchange:string, type:string}>
 */
function ob_india_search(string $query, int $limit = 30): array
{
    $q = strtoupper(trim(preg_replace('/\s+/', ' ', $query) ?? ''));
    if ($q === '') {
        return [];
    }
    $words = explode(' ', $q);

    $scored = [];
    foreach (ob_nse_listings() as [$symbol, $name, $text, $type]) {
        $hay = $symbol . ' ' . $text;
        $all = true;
        foreach ($words as $w) {
            if (!str_contains($hay, $w)) {
                $all = false;
                break;
            }
        }
        if (!$all) {
            continue;
        }
        $score = match (true) {
            $symbol === $q => 0,
            str_starts_with($symbol, $q) => 1,
            (bool) preg_match('/(^|[\s&(-])' . preg_quote($q, '/') . '/', $text) => 2,
            str_contains($symbol, $q) => 3,
            default => 4,
        };
        // Main-board shares before ETFs on a tie, then shorter symbols (the parent company) first.
        $scored[] = [$score, $type === 'ETF' ? 1 : 0, strlen($symbol), $symbol, $name, $type];
    }
    usort($scored, static fn(array $a, array $b): int => [$a[0], $a[1], $a[2], $a[3]] <=> [$b[0], $b[1], $b[2], $b[3]]);

    return array_map(static fn(array $s): array => [
        'symbol' => $s[3],
        'ticker' => $s[3],
        'name' => $s[4],
        'exchange' => 'NSE',
        'type' => $s[5],
    ], array_slice($scored, 0, $limit));
}
