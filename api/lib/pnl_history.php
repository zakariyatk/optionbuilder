<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/kite.php';

/**
 * P&L history for the P&L Report's date picker. Kite Connect only returns
 * today's positions, so history comes from two places, kept in one file
 * (pnl-history.json in the data directory):
 *
 *   auto    Each time the P&L page loads, today's realised P&L and M2M per
 *           segment and symbol is saved under today's date, so every day the
 *           page is opened (after the close is best) is recorded from now on.
 *   upload  Zerodha Console tradebooks (Reports → Tradebook → CSV), any range,
 *           past years too. Trades are stored once (by trade id) and realised
 *           P&L is rebuilt by matching every closing trade first-in-first-out
 *           against earlier opening trades — same-day trades first, as Zerodha
 *           nets intraday trades before delivery.
 *
 *   statement  Console P&L statements (Reports → P&L, .xlsx): per-symbol totals
 *           for a period, with charges; each contract is placed on its expiry.
 *
 * For a segment and date: a tradebook covering the date wins (exact days), then
 * a statement covering it, then the auto save.
 * Charges and taxes are not included in either.
 */

/** P&L per price point per lot, for tradebooks that count commodity / currency trades in lots. */
const OB_LOT_MULTIPLIERS = [
    // MCX
    'GOLD' => 100, 'GOLDM' => 10, 'GOLDGUINEA' => 1, 'GOLDPETAL' => 1, 'GOLDTEN' => 10,
    'SILVER' => 30, 'SILVERM' => 5, 'SILVERMIC' => 1,
    'CRUDEOIL' => 100, 'CRUDEOILM' => 10, 'NATURALGAS' => 1250, 'NATGASMINI' => 250,
    'COPPER' => 2500, 'ZINC' => 5000, 'ZINCMINI' => 1000, 'ALUMINIUM' => 5000, 'ALUMINI' => 1000,
    'LEAD' => 5000, 'LEADMINI' => 1000, 'MENTHAOIL' => 360,
    // NSE currency
    'USDINR' => 1000, 'EURINR' => 1000, 'GBPINR' => 1000, 'JPYINR' => 1000,
];

function ob_pnl_history_file(): string
{
    return ob_data_dir() . '/pnl-history.json';
}

/**
 * Reads, optionally changes and writes the history under one lock.
 * @param callable(array): array|null $change returns the new history, or null to leave it
 */
function ob_pnl_history(?callable $change = null): array
{
    $fh = @fopen(ob_pnl_history_file(), 'c+');
    if ($fh === false) {
        throw new RuntimeException('Could not open P&L history — is the data directory writable?');
    }
    flock($fh, $change ? LOCK_EX : LOCK_SH);
    $h = json_decode((string) stream_get_contents($fh), true);
    $h = (is_array($h) ? $h : []) + ['auto' => [], 'trades' => [], 'coverage' => [], 'uploads' => [], 'multipliers' => [], 'statements' => []];
    if ($change !== null) {
        $next = $change($h);
        if (is_array($next)) {
            $h = $next;
            ftruncate($fh, 0);
            rewind($fh);
            fwrite($fh, (string) json_encode($h, JSON_UNESCAPED_SLASHES));
            fflush($fh);
        }
    }
    flock($fh, LOCK_UN);
    fclose($fh);
    @chmod(ob_pnl_history_file(), 0600);
    return $h;
}

/** "CRUDEOIL25DEC5600CE" → "CRUDEOIL"; "M&M" → "M&M". */
function ob_pnl_underlying(string $symbol): string
{
    return preg_match('/^([A-Z&\-]+?)\d/', strtoupper($symbol), $m) ? $m[1] : strtoupper($symbol);
}

// ------------------------------------------------------------------ auto save

/**
 * Saves today's realised P&L and M2M per segment and symbol (overwriting any
 * earlier save today), and remembers each commodity / currency contract's lot
 * multiplier for tradebook uploads.
 *
 * @param list<array> $positions rows from ob_kite_pnl()
 */
function ob_pnl_history_save_today(array $positions): void
{
    $today = gmdate('Y-m-d', time() + 19800);
    $day = [];
    $mult = [];
    foreach ($positions as $p) {
        $seg = $p['segment'];
        $sym = $p['symbol'];
        $day[$seg][$sym] = [
            'r' => round(($day[$seg][$sym]['r'] ?? 0) + $p['realised'], 2),
            't' => round(($day[$seg][$sym]['t'] ?? 0) + $p['m2m'], 2),
        ];
        if (($p['multiplier'] ?? 1) != 1) {
            $mult[ob_pnl_underlying($sym)] = (float) $p['multiplier'];
        }
    }
    ob_pnl_history(static function (array $h) use ($today, $day, $mult): array {
        $h['auto'][$today] = $day;
        $h['multipliers'] = $mult + $h['multipliers'];
        return $h;
    });
}

// --------------------------------------------------------------------- upload

/**
 * Imports a Console tradebook CSV. Trades already imported (same trade id) are
 * skipped, so overlapping or repeated uploads are safe.
 *
 * @return array{imported:int, duplicates:int, from:?string, to:?string, segments:list<string>}
 */
function ob_pnl_import_tradebook(string $name, string $csv): array
{
    $lines = preg_split('/\r?\n/', trim(preg_replace('/^\xEF\xBB\xBF/', '', $csv) ?? '')) ?: [];
    // Console sometimes puts a few report lines above the header: find it.
    $header = null;
    while ($lines) {
        $cells = array_map(static fn($c) => strtolower(trim(str_replace(' ', '_', (string) $c))), str_getcsv((string) array_shift($lines)));
        if (in_array('symbol', $cells, true) && in_array('trade_type', $cells, true)) {
            $header = $cells;
            break;
        }
    }
    if ($header === null) {
        throw new InvalidArgumentException('This doesn’t look like a Console tradebook: no header with symbol and trade_type. Download it from Console → Reports → Tradebook as CSV.');
    }
    $col = array_flip($header);
    foreach (['symbol', 'trade_date', 'trade_type', 'quantity', 'price'] as $need) {
        if (!isset($col[$need])) {
            throw new InvalidArgumentException("The tradebook has no \"$need\" column.");
        }
    }
    $get = static fn(array $r, string $k): string => isset($col[$k]) ? trim((string) ($r[$col[$k]] ?? '')) : '';

    $trades = [];
    foreach ($lines as $line) {
        $r = str_getcsv($line);
        $symbol = strtoupper($get($r, 'symbol'));
        $side = strtolower($get($r, 'trade_type'));
        $qty = (float) str_replace(',', '', $get($r, 'quantity'));
        $price = (float) str_replace(',', '', $get($r, 'price'));
        $date = ob_pnl_date($get($r, 'trade_date'));
        if ($symbol === '' || !in_array($side, ['buy', 'sell'], true) || $qty <= 0 || $date === null) {
            continue;
        }
        $exchange = strtoupper($get($r, 'exchange'));
        $seg = $exchange !== '' ? ob_kite_segment($exchange) : match (strtoupper($get($r, 'segment'))) {
            'FO', 'CDS', 'CUR' => 'fo',
            'COM', 'MCX' => 'commodity',
            default => 'equity',
        };
        $time = $get($r, 'order_execution_time');
        $id = $get($r, 'trade_id');
        // Without a trade id, the row itself identifies the trade.
        $key = $seg . ':' . ($id !== '' ? $id . ':' . $symbol : md5($line));
        $trades[$key] = [$date, $time, $seg, $symbol, $side === 'buy' ? 1 : -1, $qty, $price, $exchange, ob_pnl_date($get($r, 'expiry_date'))];
    }
    if (!$trades) {
        throw new InvalidArgumentException('No trades found in this file.');
    }

    $dates = array_column($trades, 0);
    $from = min($dates);
    $to = max($dates);
    $segments = array_values(array_unique(array_column($trades, 2)));
    $imported = 0;
    ob_pnl_history(static function (array $h) use ($trades, $from, $to, $segments, $name, &$imported): array {
        foreach ($trades as $k => $t) {
            if (!isset($h['trades'][$k])) {
                $h['trades'][$k] = $t;
                $imported++;
            }
        }
        foreach ($segments as $seg) {
            $c = $h['coverage'][$seg] ?? null;
            $h['coverage'][$seg] = [$c ? min($c[0], $from) : $from, $c ? max($c[1], $to) : $to];
        }
        $h['uploads'][] = ['at' => time() * 1000, 'name' => mb_substr($name, 0, 120), 'from' => $from, 'to' => $to, 'segments' => $segments, 'trades' => count($trades)];
        $h['uploads'] = array_slice($h['uploads'], -50);
        return $h;
    });

    return ['imported' => $imported, 'duplicates' => count($trades) - $imported, 'from' => $from, 'to' => $to, 'segments' => $segments];
}

/** "2024-04-01", "01-04-2024" or "01/04/2024" → "2024-04-01". */
function ob_pnl_date(string $v): ?string
{
    if (preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $v, $m)) {
        return "$m[1]-$m[2]-$m[3]";
    }
    if (preg_match('#^(\d{2})[-/](\d{2})[-/](\d{4})#', $v, $m)) {
        return "$m[3]-$m[2]-$m[1]";
    }
    return null;
}

/**
 * Realised P&L per date, segment and symbol from the uploaded trades.
 * Each symbol's trades go in time order; a closing trade is matched first
 * against quantity opened the same day (intraday), then the oldest still open.
 * Closing quantity with nothing before it to match (bought before the
 * uploaded range) is reported as unmatched instead of guessed.
 *
 * Options still open after their expiry date are settled at ₹0 on that date
 * (they expired worthless — the usual case) and listed under `expired`, since
 * a tradebook has no closing trade for them.
 *
 * @return array{days: array<string, array<string, array<string, float>>>, unmatched: array<string, float>, expired: array<string, float>, multipliers: array<string, float>}
 */
function ob_pnl_realised_from_trades(array $trades, array $learned): array
{
    $by = [];
    foreach ($trades as $t) {
        $by[$t[2] . '|' . ($t[2] === 'equity' ? $t[3] : $t[7] . ':' . $t[3])][] = $t;
    }
    $days = [];
    $unmatched = [];
    $expired = [];
    $used = [];
    $today = gmdate('Y-m-d', time() + 19800);
    foreach ($by as $group) {
        usort($group, static fn(array $a, array $b): int => [$a[0], $a[1]] <=> [$b[0], $b[1]]);
        [, , $seg, $symbol] = $group[0];
        $m = 1.0;
        if ($seg === 'commodity' || in_array($group[0][7], ['CDS', 'BCD'], true)) {
            $u = ob_pnl_underlying($symbol);
            $m = (float) ($learned[$u] ?? OB_LOT_MULTIPLIERS[$u] ?? 1);
            $used[$u] = $m;
        }
        // Open lots: [date, signed qty, price]
        $lots = [];
        foreach ($group as [$date, , , , $side, $qty, $price]) {
            $left = $qty;
            // Same-day lots first, then the oldest.
            $order = array_keys($lots);
            usort($order, static fn(int $a, int $b): int => [$lots[$a][0] !== $date, $a] <=> [$lots[$b][0] !== $date, $b]);
            foreach ($order as $i) {
                if ($left <= 0) {
                    break;
                }
                if (($lots[$i][1] > 0) === ($side > 0)) {
                    continue; // same direction: nothing to close
                }
                $take = min($left, abs($lots[$i][1]));
                // Long closed by a sell: (sell − buy); short closed by a buy: (sell − buy) too.
                $pnl = $side < 0 ? ($price - $lots[$i][2]) * $take : ($lots[$i][2] - $price) * $take;
                $days[$date][$seg][$symbol] = ($days[$date][$seg][$symbol] ?? 0) + $pnl * $m;
                $lots[$i][1] += $side < 0 ? -$take : $take;
                $left -= $take;
                if (abs($lots[$i][1]) < 1e-9) {
                    unset($lots[$i]);
                }
            }
            if ($left > 0) {
                if ($side < 0 && $seg === 'equity') {
                    // Equity can't be sold short overnight: this sold shares bought before the upload.
                    $unmatched[$symbol] = ($unmatched[$symbol] ?? 0) + $left;
                } else {
                    $lots[] = [$date, $side * $left, $price];
                }
            }
        }
        $expiry = $group[0][8] ?? null;
        if ($lots && $seg !== 'equity' && $expiry !== null && $expiry < $today && preg_match('/(CE|PE)$/', $symbol)) {
            foreach ($lots as [, $q, $p]) {
                // Long: lose the premium paid; short: keep the premium received.
                $days[$expiry][$seg][$symbol] = ($days[$expiry][$seg][$symbol] ?? 0) + (-$q * $p) * $m;
                $expired[$symbol] = ($expired[$symbol] ?? 0) + $q;
            }
        }
    }
    foreach ($days as &$segs) {
        foreach ($segs as &$syms) {
            $syms = array_map(static fn($v) => round($v, 2), $syms);
        }
    }
    unset($segs, $syms);
    return ['days' => $days, 'unmatched' => $unmatched, 'expired' => $expired, 'multipliers' => $used];
}

// -------------------------------------------------------------------- history

/**
 * Every recorded day, each segment from the upload when its tradebooks cover
 * the date and from the auto save otherwise.
 */
function ob_pnl_history_report(): array
{
    $h = ob_pnl_history();
    $up = ob_pnl_realised_from_trades(array_values($h['trades']), $h['multipliers']);
    $segs = ['equity', 'fo', 'commodity'];
    // Statements: each symbol on its contract's expiry (or the period's last day).
    $st = [];
    $stCov = [];
    foreach ($h['statements'] as $s) {
        $stCov[$s['segment']][] = [$s['from'], $s['to']];
        if ($s['segment'] === 'equity') {
            // Stocks carry no expiry, so an equity statement can't be placed on
            // days: it is returned whole (`undated`) for ranges that cover it.
            continue;
        }
        foreach ($s['symbols'] as $sym => $v) {
            $d = ob_pnl_statement_date((string) $sym, $s['from'], $s['to']);
            $st[$d][$s['segment']][$sym] = round(($st[$d][$s['segment']][$sym] ?? 0) + $v, 2);
        }
    }
    $inStatement = static function (string $seg, string $date) use ($stCov): bool {
        foreach ($stCov[$seg] ?? [] as [$f, $t]) {
            if ($date >= $f && $date <= $t) {
                return true;
            }
        }
        return false;
    };
    $dates = array_unique(array_merge(array_keys($h['auto']), array_keys($up['days']), array_keys($st)));
    sort($dates);

    $out = [];
    foreach ($dates as $date) {
        $row = ['date' => $date];
        foreach ($segs as $seg) {
            $cov = $h['coverage'][$seg] ?? null;
            // Upload inside its tradebooks' range, or for a day only it knows
            // about (an option settling at expiry after the last trade).
            $hasUp = isset($up['days'][$date][$seg]);
            if (($cov && $date >= $cov[0] && $date <= $cov[1]) || ($hasUp && !isset($h['auto'][$date][$seg]))) {
                $syms = $up['days'][$date][$seg] ?? [];
                $row[$seg] = ['source' => 'upload', 'realised' => round(array_sum($syms), 2), 'today' => null, 'symbols' => (object) $syms];
            } elseif ($inStatement($seg, $date)) {
                $syms = $st[$date][$seg] ?? [];
                $row[$seg] = ['source' => 'statement', 'realised' => round(array_sum($syms), 2), 'today' => null, 'symbols' => (object) $syms];
            } elseif (isset($h['auto'][$date][$seg])) {
                $a = $h['auto'][$date][$seg];
                $row[$seg] = [
                    'source' => 'auto',
                    'realised' => round(array_sum(array_column($a, 'r')), 2),
                    'today' => round(array_sum(array_column($a, 't')), 2),
                    'symbols' => (object) array_map(static fn($v) => $v['r'], $a),
                ];
            } else {
                $row[$seg] = null;
            }
        }
        $out[] = $row;
    }
    $autoDates = array_keys($h['auto']);
    sort($autoDates);

    return [
        'days' => $out,
        'autoSince' => $autoDates[0] ?? null,
        'autoDays' => count($autoDates),
        'coverage' => (object) $h['coverage'],
        'uploads' => array_reverse($h['uploads']),
        'unmatched' => (object) $up['unmatched'],
        'expired' => (object) $up['expired'],
        'statements' => array_map(static fn($s) => [
            'segment' => $s['segment'], 'from' => $s['from'], 'to' => $s['to'], 'name' => $s['name'], 'at' => $s['at'],
            'realised' => round(array_sum($s['symbols']), 2), 'charges' => $s['charges'], 'other' => $s['other'], 'symbols' => count($s['symbols']),
            'undated' => $s['segment'] === 'equity' ? (object) $s['symbols'] : null,
        ], $h['statements']),
        'multipliers' => (object) $up['multipliers'],
    ];
}

function ob_pnl_clear_uploads(): void
{
    ob_pnl_history(static function (array $h): array {
        $h['trades'] = [];
        $h['coverage'] = [];
        $h['uploads'] = [];
        $h['statements'] = [];
        return $h;
    });
}

// -------------------------------------------------------- Console P&L statement

/**
 * Rows of every sheet in an .xlsx file, as plain cell values (no formulas or
 * styles). Enough for Console's reports; needs PHP's zip extension.
 *
 * @return array<string, list<list<string|float|null>>> sheet name => rows
 */
function ob_xlsx_rows(string $bytes): array
{
    if (!class_exists('ZipArchive')) {
        throw new RuntimeException('This server can’t open .xlsx files (PHP zip extension missing). Save the report as CSV and upload that.');
    }
    $tmp = tempnam(sys_get_temp_dir(), 'obx');
    file_put_contents($tmp, $bytes);
    $zip = new ZipArchive();
    if ($zip->open($tmp) !== true) {
        @unlink($tmp);
        throw new InvalidArgumentException('The file isn’t a valid .xlsx workbook.');
    }
    $read = static function (string $name) use ($zip): ?SimpleXMLElement {
        $xml = $zip->getFromName($name);
        return $xml === false ? null : (simplexml_load_string($xml, SimpleXMLElement::class, LIBXML_NONET) ?: null);
    };
    $strings = [];
    if ($ss = $read('xl/sharedStrings.xml')) {
        foreach ($ss->si as $si) {
            $text = (string) $si->t;
            foreach ($si->r as $run) {
                $text .= (string) $run->t;
            }
            $strings[] = $text;
        }
    }
    $sheets = [];
    $book = $read('xl/workbook.xml');
    $rels = $read('xl/_rels/workbook.xml.rels');
    $targets = [];
    foreach ($rels?->Relationship ?? [] as $rel) {
        $targets[(string) $rel['Id']] = 'xl/' . ltrim(preg_replace('#^/?xl/#', '', (string) $rel['Target']) ?? '', '/');
    }
    foreach ($book?->sheets->sheet ?? [] as $sheet) {
        $rid = (string) $sheet->attributes('http://schemas.openxmlformats.org/officeDocument/2006/relationships')['id'];
        $xml = isset($targets[$rid]) ? $read($targets[$rid]) : null;
        if ($xml === null) {
            continue;
        }
        $rows = [];
        foreach ($xml->sheetData->row as $row) {
            $cells = [];
            foreach ($row->c as $c) {
                // Column letters → index, so blank cells keep their place.
                preg_match('/^([A-Z]+)/', (string) $c['r'], $m);
                $col = 0;
                foreach (str_split($m[1] ?? 'A') as $ch) {
                    $col = $col * 26 + (ord($ch) - 64);
                }
                $t = (string) $c['t'];
                $v = (string) $c->v;
                $cells[$col - 1] = match ($t) {
                    's' => $strings[(int) $v] ?? '',
                    'inlineStr' => (string) $c->is->t,
                    'str', 'b' => $v,
                    default => $v === '' ? null : (float) $v,
                };
            }
            if ($cells) {
                $max = max(array_keys($cells));
                $rows[] = array_map(static fn($i) => $cells[$i] ?? null, range(0, $max));
            }
        }
        $sheets[(string) $sheet['name']] = $rows;
    }
    $zip->close();
    @unlink($tmp);
    return $sheets;
}

/**
 * Imports a Console P&L statement (Reports → P&L, .xlsx or CSV): per-symbol
 * realised P&L for a period, plus charges. It has no trade dates, so each
 * futures / options contract is placed on its expiry month (from the symbol)
 * and anything else on the statement's last day. A statement for the same
 * segment and period replaces the earlier one.
 *
 * @param list<list<mixed>> $rows one sheet
 * @return array{segment:string, from:string, to:string, symbols:int, realised:float, charges:float}
 */
function ob_pnl_import_statement(string $name, array $rows): array
{
    $seg = null;
    $from = $to = null;
    $charges = 0.0;
    $other = 0.0;
    $symbols = [];
    $col = null;
    foreach ($rows as $r) {
        $cells = array_values(array_filter($r, static fn($v) => $v !== null && $v !== ''));
        $first = is_string($cells[0] ?? null) ? trim($cells[0]) : '';
        if (preg_match('/P&L Statement for (.+?) from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/i', $first, $m)) {
            $seg = match (true) {
                (bool) preg_match('/commodit/i', $m[1]) => 'commodity',
                (bool) preg_match('/F&?O|deriv|currenc/i', $m[1]) => 'fo',
                default => 'equity',
            };
            [$from, $to] = [$m[2], $m[3]];
            continue;
        }
        if ($col === null && $first === 'Charges' && is_numeric($cells[1] ?? null)) {
            $charges = (float) $cells[1];
            continue;
        }
        if ($col === null && $first === 'Other Credit & Debit' && is_numeric($cells[1] ?? null)) {
            $other = (float) $cells[1];
            continue;
        }
        if ($col === null && in_array('Symbol', $r, true) && in_array('Realized P&L', $r, true)) {
            $col = array_flip(array_map(static fn($v) => is_string($v) ? trim($v) : '', $r));
            continue;
        }
        if ($col !== null) {
            $sym = strtoupper(trim((string) ($r[$col['Symbol']] ?? '')));
            $pnl = $r[$col['Realized P&L']] ?? null;
            if ($sym === '' || !is_numeric($pnl)) {
                continue;
            }
            $symbols[$sym] = round(($symbols[$sym] ?? 0) + (float) $pnl, 2);
        }
    }
    if ($seg === null || $from === null || $col === null) {
        throw new InvalidArgumentException('This doesn’t look like a Console P&L statement (no “P&L Statement for … from … to …” title or Symbol / Realized P&L table).');
    }

    ob_pnl_history(static function (array $h) use ($seg, $from, $to, $symbols, $charges, $other, $name): array {
        $h['statements'] = array_values(array_filter($h['statements'] ?? [], static fn($s) => !($s['segment'] === $seg && $s['from'] === $from && $s['to'] === $to)));
        $h['statements'][] = ['segment' => $seg, 'from' => $from, 'to' => $to, 'name' => mb_substr($name, 0, 120), 'at' => time() * 1000, 'symbols' => $symbols, 'charges' => round($charges, 2), 'other' => round($other, 2)];
        return $h;
    });
    return ['segment' => $seg, 'from' => $from, 'to' => $to, 'symbols' => count($symbols), 'realised' => round(array_sum($symbols), 2), 'charges' => round($charges, 2)];
}

/**
 * The day a statement's symbol is counted on: a contract's expiry month (last
 * day, or the exact day for weekly options), kept inside the statement period;
 * otherwise the period's last day.
 */
function ob_pnl_statement_date(string $symbol, string $from, string $to): string
{
    $months = ['JAN' => 1, 'FEB' => 2, 'MAR' => 3, 'APR' => 4, 'MAY' => 5, 'JUN' => 6, 'JUL' => 7, 'AUG' => 8, 'SEP' => 9, 'OCT' => 10, 'NOV' => 11, 'DEC' => 12];
    $date = null;
    if (preg_match('/^[A-Z&\-]+?(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/', $symbol, $m)) {
        $y = 2000 + (int) $m[1];
        $mo = $months[$m[2]];
        $date = sprintf('%04d-%02d-%02d', $y, $mo, (int) gmdate('t', gmmktime(0, 0, 0, $mo, 1, $y)));
    } elseif (preg_match('/^[A-Z&\-]+?(\d{2})([1-9OND])(\d{2})\d+(CE|PE)$/', $symbol, $m)) {
        $mo = ctype_digit($m[2]) ? (int) $m[2] : ['O' => 10, 'N' => 11, 'D' => 12][$m[2]];
        $date = sprintf('%04d-%02d-%02d', 2000 + (int) $m[1], $mo, (int) $m[3]);
    }
    if ($date === null || $date > $to) {
        return $to;
    }
    return $date < $from ? $from : $date;
}
