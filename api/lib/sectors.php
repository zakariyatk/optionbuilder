<?php
declare(strict_types=1);

require_once __DIR__ . '/http.php';
require_once __DIR__ . '/cache.php';
require_once __DIR__ . '/india.php';
require_once __DIR__ . '/us.php';

/**
 * Sector of each portfolio holding, for the Portfolio page's sector cards.
 *
 * Indian stocks: NSE's Nifty 500 list, which carries NSE's own industry names
 * ("Information Technology", "Financial Services"). Anything outside it, and
 * every US stock, is looked up on Yahoo search, which returns a sector for
 * equities. ETFs are grouped as "ETF". A sector rarely changes, so lookups
 * are cached for a month; a symbol nobody knows comes back as null.
 */

const OB_TTL_SECTOR = 30 * 86400;

/** @return array<string,string> NSE symbol → industry, for the Nifty 500. */
function ob_nifty500_sectors(): array
{
    return ob_cached('sectors:nifty500', function (): array {
        $csv = ob_get_text('https://archives.nseindia.com/content/indices/ind_nifty500list.csv', ['User-Agent' => OB_UA], 20);
        $map = [];
        foreach (preg_split('/\r?\n/', trim($csv)) as $k => $line) {
            $row = str_getcsv($line, ',', '"', '');
            // Company Name, Industry, Symbol, Series, ISIN Code
            if ($k === 0 || count($row) < 3) {
                continue;
            }
            $symbol = strtoupper(trim($row[2]));
            $industry = trim($row[1]);
            if ($symbol !== '' && $industry !== '') {
                $map[$symbol] = $industry;
            }
        }
        if (!$map) {
            throw new RuntimeException('Empty Nifty 500 list');
        }
        return $map;
    }, 7 * 86400);
}

/** NSE symbols the listings mark as ETFs. */
function ob_nse_etfs(): array
{
    return ob_cached('sectors:nse-etfs', function (): array {
        $out = [];
        foreach (ob_nse_listings() as [$symbol, , , $type]) {
            if ($type === 'ETF') {
                $out[$symbol] = true;
            }
        }
        return $out;
    }, 86400);
}

/** The Yahoo ticker for a holding: US:BRK.B → BRK-B, TCS → TCS.NS. */
function ob_sector_yahoo_ticker(string $symbol): string
{
    return ob_is_us($symbol) ? ob_us_ticker($symbol) : $symbol . '.NS';
}

/**
 * @param string[] $symbols NSE symbols and US:<ticker>s
 * @return array<string,?string> symbol → sector, or null when unknown
 */
function ob_sectors(array $symbols): array
{
    $out = [];
    $ask = [];

    try {
        $nifty = ob_nifty500_sectors();
    } catch (Throwable) {
        $nifty = [];
    }
    try {
        $etfs = ob_nse_etfs();
    } catch (Throwable) {
        $etfs = [];
    }

    foreach ($symbols as $symbol) {
        if (!ob_is_us($symbol)) {
            if (isset($etfs[$symbol])) {
                $out[$symbol] = 'ETF';
                continue;
            }
            if (isset($nifty[$symbol])) {
                $out[$symbol] = $nifty[$symbol];
                continue;
            }
        }
        $cached = ob_cache_get("sector:$symbol", OB_TTL_SECTOR);
        if (is_array($cached)) {
            $out[$symbol] = $cached['sector'];
            continue;
        }
        $ask[$symbol] = 'https://query1.finance.yahoo.com/v1/finance/search?' . http_build_query([
            'q' => ob_sector_yahoo_ticker($symbol),
            'quotesCount' => 3,
            'newsCount' => 0,
            'listsCount' => 0,
        ]);
    }

    if ($ask) {
        foreach (ob_http_multi_get($ask, ['Accept' => 'application/json', 'User-Agent' => OB_UA], 8, 12) as $symbol => $res) {
            if ($res['status'] < 200 || $res['status'] >= 300) {
                // Don't cache a failed lookup: try again next time.
                $out[$symbol] = null;
                continue;
            }
            $json = json_decode($res['body'], true);
            $want = strtoupper(ob_sector_yahoo_ticker($symbol));
            $sector = null;
            foreach (($json['quotes'] ?? []) as $q) {
                if (strtoupper((string) ($q['symbol'] ?? '')) !== $want) {
                    continue;
                }
                $type = (string) ($q['quoteType'] ?? '');
                $sector = $type === 'ETF' || $type === 'MUTUALFUND'
                    ? 'ETF'
                    : (((string) ($q['sectorDisp'] ?? $q['sector'] ?? '')) ?: null);
                break;
            }
            ob_cache_put("sector:$symbol", ['sector' => $sector]);
            $out[$symbol] = $sector;
        }
    }

    return $out;
}
