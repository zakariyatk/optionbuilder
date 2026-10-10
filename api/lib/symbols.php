<?php
declare(strict_types=1);

/**
 * Static reference data. NSE exposes no simple "which symbols have listed
 * options" endpoint, so these are hand-maintained.
 *
 * Lot sizes verified against the Upstox contracts API on 2026-08-09. When a
 * user is connected to Upstox the live broker value wins — these only backstop
 * the fallback paths, so expect them to drift.
 */

const OB_INDEX_SYMBOLS = [
    ['symbol' => 'NIFTY', 'label' => 'NIFTY 50', 'lotSize' => 65],
    ['symbol' => 'BANKNIFTY', 'label' => 'NIFTY BANK', 'lotSize' => 30],
    ['symbol' => 'FINNIFTY', 'label' => 'NIFTY FIN SERVICE', 'lotSize' => 60],
    ['symbol' => 'MIDCPNIFTY', 'label' => 'NIFTY MIDCAP SELECT', 'lotSize' => 120],
];

const OB_EQUITY_SYMBOLS = [
    ['symbol' => 'RELIANCE', 'label' => 'Reliance Industries', 'lotSize' => 500],
    ['symbol' => 'TCS', 'label' => 'Tata Consultancy Services', 'lotSize' => 175],
    ['symbol' => 'HDFCBANK', 'label' => 'HDFC Bank', 'lotSize' => 550],
    ['symbol' => 'INFY', 'label' => 'Infosys', 'lotSize' => 400],
    ['symbol' => 'ICICIBANK', 'label' => 'ICICI Bank', 'lotSize' => 700],
    ['symbol' => 'SBIN', 'label' => 'State Bank of India', 'lotSize' => 750],
    ['symbol' => 'TATAMOTORS', 'label' => 'Tata Motors', 'lotSize' => 1425],
    ['symbol' => 'AXISBANK', 'label' => 'Axis Bank', 'lotSize' => 625],
    ['symbol' => 'ITC', 'label' => 'ITC', 'lotSize' => 1600],
    ['symbol' => 'KOTAKBANK', 'label' => 'Kotak Mahindra Bank', 'lotSize' => 400],
    ['symbol' => 'LT', 'label' => 'Larsen & Toubro', 'lotSize' => 150],
    ['symbol' => 'BAJFINANCE', 'label' => 'Bajaj Finance', 'lotSize' => 125],
];

function ob_all_symbols(): array
{
    return array_merge(OB_INDEX_SYMBOLS, OB_EQUITY_SYMBOLS);
}

function ob_lot_size_for(string $symbol): int
{
    foreach (ob_all_symbols() as $s) {
        if ($s['symbol'] === $symbol) {
            return $s['lotSize'];
        }
    }
    return 1;
}
