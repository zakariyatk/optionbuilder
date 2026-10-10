<?php
declare(strict_types=1);

/**
 * Monthly expiry derivation and the max-OI report.
 *
 * The monthly contract is the LAST expiry inside a calendar month. Deriving it
 * that way avoids hardcoding "last Thursday", which NSE has changed more than
 * once — NIFTY is currently Tuesday.
 */

/** @return array<string,string> "YYYY-MM" => last expiry in that month */
function ob_monthly_expiries(array $expiries): array
{
    $sorted = $expiries;
    sort($sorted);
    $byMonth = [];
    foreach ($sorted as $e) {
        $byMonth[substr($e, 0, 7)] = $e; // later dates overwrite earlier
    }
    return $byMonth;
}

function ob_current_monthly_expiry(array $expiries, ?string $today = null): ?string
{
    $monthlies = array_values(ob_monthly_expiries($expiries));
    sort($monthlies);
    $today ??= gmdate('Y-m-d');
    foreach ($monthlies as $e) {
        if ($e >= $today) {
            return $e;
        }
    }
    return $monthlies[0] ?? null;
}

function ob_december_monthly_expiry(array $expiries, int $year): ?string
{
    return ob_monthly_expiries($expiries)["$year-12"] ?? null;
}

/** Highest-OI call and put in a chain, the PCR, and the distribution for charting. */
function ob_max_oi_summary(array $rows, string $expiry, ?float $spot): array
{
    $best = static function (string $side) use ($rows): ?array {
        $top = null;
        foreach ($rows as $row) {
            $oi = $row[$side]['oi'] ?? 0;
            if ($top === null || $oi > $top['oi']) {
                $top = [
                    'strike' => $row['strike'],
                    'oi' => (float) $oi,
                    'ltp' => (float) ($row[$side]['ltp'] ?? 0),
                    'oiChange' => (float) ($row[$side]['oiChange'] ?? 0),
                ];
            }
        }
        return ($top !== null && $top['oi'] > 0) ? $top : null;
    };

    $maxCall = $best('call');
    $maxPut = $best('put');

    $totalCallOi = 0.0;
    $totalPutOi = 0.0;
    foreach ($rows as $row) {
        $totalCallOi += (float) ($row['call']['oi'] ?? 0);
        $totalPutOi += (float) ($row['put']['oi'] ?? 0);
    }

    // Strike-wise OI around the money for the chart. The far wings are empty
    // and would squash the meaningful bars flat.
    $band = 10;
    $distribution = [];
    if ($spot !== null && $rows) {
        $atmIndex = 0;
        foreach ($rows as $i => $row) {
            if (abs($row['strike'] - $spot) < abs($rows[$atmIndex]['strike'] - $spot)) {
                $atmIndex = $i;
            }
        }

        $from = max(0, $atmIndex - $band);
        $to = min(count($rows), $atmIndex + $band + 1);

        // The peaks are what the report headlines, so the chart must always
        // contain them — they can sit outside a symmetric band.
        foreach ([$maxCall['strike'] ?? null, $maxPut['strike'] ?? null] as $peak) {
            if ($peak === null) {
                continue;
            }
            foreach ($rows as $i => $row) {
                if ($row['strike'] === $peak) {
                    $from = min($from, $i);
                    $to = max($to, $i + 1);
                    break;
                }
            }
        }

        foreach (array_slice($rows, $from, $to - $from) as $row) {
            $distribution[] = [
                'strike' => $row['strike'],
                'callOi' => (float) ($row['call']['oi'] ?? 0),
                'putOi' => (float) ($row['put']['oi'] ?? 0),
                'callOiChange' => (float) ($row['call']['oiChange'] ?? 0),
                'putOiChange' => (float) ($row['put']['oiChange'] ?? 0),
            ];
        }
    }

    return [
        'expiry' => $expiry,
        'spot' => $spot,
        'maxCallOi' => $maxCall,
        'maxPutOi' => $maxPut,
        'totalCallOi' => $totalCallOi,
        'totalPutOi' => $totalPutOi,
        'pcr' => $totalCallOi > 0 ? $totalPutOi / $totalCallOi : null,
        'distribution' => $distribution,
    ];
}
