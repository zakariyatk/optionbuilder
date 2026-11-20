<?php
declare(strict_types=1);

require_once __DIR__ . '/symbols.php';

/**
 * Reshapes the Upstox option chain into the single shape the frontend consumes,
 * so the client never branches on provider.
 */
function ob_reshape_chain(array $data, string $symbol, array $expiries, ?string $expiry, ?int $lotSize): array
{
    $leg = static function (?array $side): ?array {
        if ($side === null) {
            return null;
        }
        $md = $side['market_data'] ?? [];
        $greeks = $side['option_greeks'] ?? [];
        $ltp = (float) ($md['ltp'] ?? 0);
        $close = (float) ($md['close_price'] ?? 0);

        // An untraded strike reports ltp 0 while still carrying a stale close.
        // Differencing those yields a huge bogus "change", so only report a
        // change once the contract has actually traded.
        $traded = $ltp > 0;

        return [
            'instrumentKey' => $side['instrument_key'] ?? null,
            'ltp' => $ltp,
            'change' => ($traded && $close > 0) ? $ltp - $close : 0,
            'oi' => (float) ($md['oi'] ?? 0),
            'oiChange' => (float) ($md['oi'] ?? 0) - (float) ($md['prev_oi'] ?? 0),
            'volume' => (float) ($md['volume'] ?? 0),
            'iv' => (float) ($greeks['iv'] ?? 0),
            'delta' => isset($greeks['delta']) ? (float) $greeks['delta'] : null,
            'theta' => isset($greeks['theta']) ? (float) $greeks['theta'] : null,
            'bid' => (float) ($md['bid_price'] ?? 0),
            'ask' => (float) ($md['ask_price'] ?? 0),
        ];
    };

    $rows = [];
    foreach ($data as $row) {
        $rows[] = [
            'strike' => (float) ($row['strike_price'] ?? 0),
            'call' => $leg($row['call_options'] ?? null),
            'put' => $leg($row['put_options'] ?? null),
        ];
    }
    usort($rows, static fn($a, $b) => $a['strike'] <=> $b['strike']);

    return [
        'source' => 'upstox',
        'symbol' => $symbol,
        'lotSize' => $lotSize ?? ob_lot_size_for($symbol),
        'underlyingValue' => isset($data[0]['underlying_spot_price']) ? (float) $data[0]['underlying_spot_price'] : null,
        'timestamp' => gmdate('c'),
        'expiryDates' => $expiries,
        'expiry' => $expiry,
        'rows' => $rows,
    ];
}
