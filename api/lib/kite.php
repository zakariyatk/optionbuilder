<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/http.php';
require_once __DIR__ . '/cache.php';

/**
 * Zerodha Kite Connect client — the account side only.
 *
 * Market data (quotes, the option chain, candles, OI) stays on Upstox, so the
 * free Kite Connect "Personal" plan is enough: Zerodha serves the trading and
 * account APIs, which today means broker margin for a strategy's basket.
 *
 * Legs carry Upstox instrument keys (they come from the Upstox chain), so each
 * key is matched to its Zerodha tradingsymbol through the two instrument lists:
 * Upstox's public NSE master (underlying, expiry, strike, CE/PE/FUT) against
 * Kite's NFO dump.
 *
 * Login: Kite redirects back with a single-use request_token, exchanged (with
 * a SHA-256 checksum of key + token + secret) for an access token that lives
 * until 06:00 IST the next morning. It is stored apart from the Upstox token,
 * so both brokers can be connected at once.
 */

const OB_KITE_API = 'https://api.kite.trade';
const OB_KITE_LOGIN = 'https://kite.zerodha.com/connect/login';

function ob_kite_configured(): bool
{
    return ob_kite_api_key() !== '' && trim((string) ob_config_get('kite_api_secret', '')) !== '';
}

function ob_kite_api_key(): string
{
    return trim((string) ob_config_get('kite_api_key', ''));
}

// -------------------------------------------------------------- token storage

function ob_kite_token_file(): string
{
    return ob_data_dir() . '/kite-token.json';
}

function ob_kite_read_token(): ?array
{
    $raw = is_file(ob_kite_token_file()) ? @file_get_contents(ob_kite_token_file()) : false;
    $t = $raw === false ? null : json_decode($raw, true);
    return is_array($t) ? $t : null;
}

function ob_kite_clear_token(): void
{
    @unlink(ob_kite_token_file());
}

function ob_kite_has_valid_token(): bool
{
    $t = ob_kite_read_token();
    return $t !== null && ($t['access_token'] ?? '') !== '' && time() < (int) ($t['expires_at'] ?? 0);
}

function ob_kite_token_info(): ?array
{
    $t = ob_kite_read_token();
    if ($t === null) {
        return null;
    }
    return [
        'user_name' => $t['user_name'] ?? null,
        'issued_at' => (int) ($t['issued_at'] ?? 0) * 1000,
        'expires_at' => (int) ($t['expires_at'] ?? 0) * 1000,
    ];
}

// ----------------------------------------------------------------- login flow

function ob_kite_auth_url(string $state): string
{
    // redirect_params come back on the redirect URL registered on the Kite app.
    return OB_KITE_LOGIN . '?' . http_build_query([
        'v' => 3,
        'api_key' => ob_kite_api_key(),
        'redirect_params' => http_build_query(['state' => $state]),
    ]);
}

function ob_kite_exchange_token(string $requestToken): array
{
    $key = ob_kite_api_key();
    $secret = trim((string) ob_config_get('kite_api_secret', ''));
    $res = ob_http_request('POST', OB_KITE_API . '/session/token', [
        'X-Kite-Version' => '3',
        'Content-Type' => 'application/x-www-form-urlencoded',
        'Accept' => 'application/json',
    ], http_build_query([
        'api_key' => $key,
        'request_token' => $requestToken,
        'checksum' => hash('sha256', $key . $requestToken . $secret),
    ]), 25);

    $json = json_decode($res['body'], true);
    $data = is_array($json) ? ($json['data'] ?? null) : null;
    if (!is_array($data) || ($data['access_token'] ?? '') === '') {
        $msg = is_array($json) ? (string) ($json['message'] ?? '') : '';
        throw new RuntimeException('Zerodha token exchange failed: ' . ($msg !== '' ? $msg : substr($res['body'], 0, 300)));
    }

    // 0600: the token is equivalent to a broker session.
    @file_put_contents(ob_kite_token_file(), json_encode([
        'access_token' => $data['access_token'],
        'user_name' => $data['user_name'] ?? $data['user_shortname'] ?? null,
        'issued_at' => time(),
        // Kite access tokens are flushed at 06:00 IST every day.
        'expires_at' => ob_next_expiry_boundary(null, 6 * 3600),
    ]), LOCK_EX);
    @chmod(ob_kite_token_file(), 0600);

    return $data;
}

// ------------------------------------------------------------ authed requests

final class ObKiteNotAuthenticated extends RuntimeException
{
}

function ob_kite_headers(): array
{
    $token = (string) (ob_kite_read_token()['access_token'] ?? '');
    if ($token === '') {
        throw new ObKiteNotAuthenticated('ZERODHA_NOT_AUTHENTICATED');
    }
    return [
        'X-Kite-Version' => '3',
        'Accept' => 'application/json',
        'Authorization' => 'token ' . ob_kite_api_key() . ':' . $token,
    ];
}

/** A Kite response's decoded body, or the right exception. Kite says 403 TokenException for an expired login. */
function ob_kite_check(array $res, string $path): array
{
    $json = json_decode($res['body'], true);
    $type = is_array($json) ? (string) ($json['error_type'] ?? '') : '';
    $message = is_array($json) ? (string) ($json['message'] ?? '') : '';

    if ($res['status'] === 401 || $type === 'TokenException') {
        ob_kite_clear_token();
        throw new ObKiteNotAuthenticated('ZERODHA_NOT_AUTHENTICATED');
    }
    if ($res['status'] === 429) {
        throw new RuntimeException("Zerodha rate limit hit on $path — try again in a moment");
    }
    if ($res['status'] < 200 || $res['status'] >= 300) {
        throw new RuntimeException("Zerodha $path failed ({$res['status']})" . ($message !== '' ? ": $message" : ''));
    }
    return is_array($json) ? $json : [];
}

function ob_kite_post_json(string $path, mixed $payload, array $params = []): array
{
    $url = OB_KITE_API . $path . ($params ? '?' . http_build_query($params) : '');
    $res = ob_http_request('POST', $url, ob_kite_headers() + ['Content-Type' => 'application/json'], json_encode($payload), 30);
    return ob_kite_check($res, $path);
}

// ------------------------------------------------ Upstox key → Zerodha symbol

/**
 * Kite's NFO contracts as "UNDERLYING|YYYY-MM-DD|STRIKE|CE" (strike 0 for
 * futures) => [tradingsymbol, lot size]. Cached for 12 h.
 */
function ob_kite_nfo_symbols(): array
{
    return ob_cached('kite:nfo-symbols', static function (): array {
        $res = ob_http_request('GET', OB_KITE_API . '/instruments/NFO', ob_kite_headers(), null, 90);
        if ($res['status'] < 200 || $res['status'] >= 300) {
            ob_kite_check($res, '/instruments/NFO');
        }
        $body = $res['body'];
        if (strncmp($body, "\x1f\x8b", 2) === 0) {
            $body = @gzdecode($body);
            if ($body === false) {
                throw new RuntimeException('Could not decompress the Zerodha NFO instruments file');
            }
        }
        $lines = preg_split('/\r?\n/', trim($body)) ?: [];
        $header = str_getcsv((string) array_shift($lines));
        $col = array_flip($header);
        foreach (['tradingsymbol', 'name', 'expiry', 'strike', 'instrument_type', 'lot_size'] as $c) {
            if (!isset($col[$c])) {
                throw new RuntimeException('Unexpected Zerodha NFO instruments payload');
            }
        }
        $map = [];
        foreach ($lines as $line) {
            $r = str_getcsv($line);
            $type = $r[$col['instrument_type']] ?? '';
            if ($type !== 'CE' && $type !== 'PE' && $type !== 'FUT') {
                continue;
            }
            $strike = $type === 'FUT' ? 0.0 : (float) $r[$col['strike']];
            $id = ob_kite_contract_id((string) $r[$col['name']], (string) $r[$col['expiry']], $strike, $type);
            $map[$id] = [(string) $r[$col['tradingsymbol']], (int) $r[$col['lot_size']]];
        }
        return $map;
    }, 12 * 3600);
}

function ob_kite_contract_id(string $underlying, string $expiry, float $strike, string $type): string
{
    return strtoupper($underlying) . '|' . $expiry . '|' . number_format($strike, 2, '.', '') . '|' . $type;
}

/**
 * The Zerodha NFO tradingsymbol for an Upstox F&O instrument key, matched on
 * underlying, expiry, strike and type. Each answer is cached for a day.
 */
function ob_kite_symbol_for_upstox(string $upstoxKey): ?string
{
    $hit = ob_cache_get("kite:sym:$upstoxKey", 86400);
    if (is_string($hit)) {
        return $hit;
    }
    $contract = ob_upstox_fo_contracts()[$upstoxKey] ?? null;
    if ($contract === null) {
        return null;
    }
    $symbol = ob_kite_nfo_symbols()[ob_kite_contract_id(...$contract)][0] ?? null;
    if ($symbol !== null) {
        ob_cache_put("kite:sym:$upstoxKey", $symbol);
    }
    return $symbol;
}

/**
 * Upstox's NSE F&O contracts from its public instruments master:
 * instrument key => [underlying, expiry (IST date), strike, CE|PE|FUT].
 */
function ob_upstox_fo_contracts(): array
{
    return ob_cached('instruments:nse-fo-contracts', static function (): array {
        $body = ob_get_text('https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz', [], 60);
        if (strncmp($body, "\x1f\x8b", 2) === 0) {
            $body = @gzdecode($body);
            if ($body === false) {
                throw new RuntimeException('Could not decompress Upstox instruments file');
            }
        }
        $rows = json_decode($body, true);
        if (!is_array($rows)) {
            throw new RuntimeException('Unexpected instruments payload');
        }
        $map = [];
        foreach ($rows as $row) {
            $type = $row['instrument_type'] ?? '';
            if (($row['segment'] ?? '') !== 'NSE_FO' || !in_array($type, ['CE', 'PE', 'FUT'], true) || !is_numeric($row['expiry'] ?? null)) {
                continue;
            }
            $map[(string) $row['instrument_key']] = [
                strtoupper((string) ($row['underlying_symbol'] ?? $row['name'] ?? '')),
                // Expiry is epoch ms; the IST calendar date is what Kite lists.
                gmdate('Y-m-d', (int) ($row['expiry'] / 1000) + 19800),
                $type === 'FUT' ? 0.0 : (float) ($row['strike_price'] ?? 0),
                $type,
            ];
        }
        return $map;
    }, 12 * 3600);
}

// --------------------------------------------------------------------- margin

/**
 * SPAN + exposure margin for a basket from Zerodha, in the fields the frontend
 * reads (final_margin includes the hedge benefit).
 *
 * @param array<int,array{instrument_key:string,quantity:int,transaction_type:string}> $instruments Upstox keys
 */
function ob_kite_margin(array $instruments): array
{
    $orders = [];
    foreach ($instruments as $i) {
        $symbol = ob_kite_symbol_for_upstox($i['instrument_key']);
        if ($symbol === null) {
            throw new RuntimeException('No Zerodha contract matches ' . $i['instrument_key']);
        }
        $orders[] = [
            'exchange' => 'NFO',
            'tradingsymbol' => $symbol,
            'transaction_type' => $i['transaction_type'],
            'variety' => 'regular',
            'product' => 'NRML',
            'order_type' => 'MARKET',
            'quantity' => $i['quantity'],
            'price' => 0,
            'trigger_price' => 0,
        ];
    }
    $data = ob_kite_post_json('/margins/basket', $orders, ['consider_positions' => 'false', 'mode' => 'compact'])['data'] ?? [];
    return [
        'required_margin' => isset($data['initial']['total']) ? (float) $data['initial']['total'] : null,
        'final_margin' => isset($data['final']['total']) ? (float) $data['final']['total'] : null,
    ];
}

// ------------------------------------------------------------------ P&L report

function ob_kite_get(string $path): array
{
    return ob_kite_check(ob_http_request('GET', OB_KITE_API . $path, ob_kite_headers(), null, 30), $path);
}

/**
 * Live P&L from the Zerodha account: open and closed-today positions (F&O,
 * intraday and delivery trades) and long-term holdings, with totals.
 * Prices are Zerodha's own last prices, so this needs no Upstox data.
 *
 * Kite Connect has no API for Console's historical P&L statements, so this is
 * the account as it stands now: today's realised P&L plus open positions.
 */
function ob_kite_pnl(): array
{
    $positions = ob_kite_get('/portfolio/positions')['data']['net'] ?? [];
    $holdings = ob_kite_get('/portfolio/holdings')['data'] ?? [];
    try {
        $funds = ob_kite_funds(ob_kite_get('/user/margins')['data'] ?? []);
    } catch (ObKiteNotAuthenticated $e) {
        throw $e;
    } catch (Throwable) {
        // Funds are a nice-to-have on this page; P&L still shows without them.
        $funds = null;
    }

    // Holdings first: shares sold from them today are settled against their cost below.
    $holdingBy = [];
    foreach ($holdings as $x) {
        $holdingBy[strtoupper((string) ($x['exchange'] ?? '')) . ':' . strtoupper((string) ($x['tradingsymbol'] ?? ''))] = $x;
    }

    $pos = [];
    $t = ['pnl' => 0.0, 'realised' => 0.0, 'unrealised' => 0.0, 'm2m' => 0.0];
    foreach ($positions as $p) {
        $row = ob_kite_position_pnl($p, $holdingBy);
        foreach ($t as $k => $_) {
            $t[$k] += $row[$k];
        }
        $pos[] = $row;
    }

    $hold = [];
    $h = ['invested' => 0.0, 'current' => 0.0, 'pnl' => 0.0, 'dayChange' => 0.0];
    foreach ($holdings as $x) {
        // Settled + T1 (bought yesterday, not yet delivered), minus what was sold
        // today: that sale is booked as realised P&L in positions, not here.
        $qty = (int) ($x['quantity'] ?? 0) + (int) ($x['t1_quantity'] ?? 0) - (int) ($x['used_quantity'] ?? 0);
        if ($qty <= 0) {
            continue;
        }
        $avg = (float) ($x['average_price'] ?? 0);
        $last = (float) ($x['last_price'] ?? 0);
        $close = (float) ($x['close_price'] ?? 0);
        $row = [
            'symbol' => (string) ($x['tradingsymbol'] ?? ''),
            'exchange' => (string) ($x['exchange'] ?? ''),
            'quantity' => $qty,
            'average' => $avg,
            'last' => $last,
            'invested' => round($avg * $qty, 2),
            'current' => round($last * $qty, 2),
            'pnl' => round(($last - $avg) * $qty, 2),
            'dayChange' => $close > 0 ? round(($last - $close) * $qty, 2) : 0.0,
            'dayChangePct' => $close > 0 ? round(($last - $close) / $close * 100, 2) : 0.0,
        ];
        foreach ($h as $k => $_) {
            $h[$k] += $row[$k];
        }
        $hold[] = $row;
    }

    usort($pos, static fn(array $a, array $b): int => [$a['quantity'] === 0, $a['symbol']] <=> [$b['quantity'] === 0, $b['symbol']]);
    usort($hold, static fn(array $a, array $b): int => $b['current'] <=> $a['current']);

    return [
        'positions' => $pos,
        'holdings' => $hold,
        'funds' => $funds,
        'totals' => [
            'positions' => array_map(static fn(float $v): float => round($v, 2), $t),
            'holdings' => array_map(static fn(float $v): float => round($v, 2), $h),
        ],
        'at' => (int) round(microtime(true) * 1000),
    ];
}

/**
 * The P&L page's segment for an exchange: equity (NSE, BSE cash), F&O (NFO, BFO,
 * and currency derivatives CDS / BCD) or commodity (MCX, NCDEX).
 */
function ob_kite_segment(string $exchange): string
{
    return match (strtoupper($exchange)) {
        'NFO', 'BFO', 'CDS', 'BCD' => 'fo',
        'MCX', 'NCO', 'NCDEX' => 'commodity',
        default => 'equity',
    };
}

/**
 * Funds per Zerodha segment from /user/margins. Zerodha keeps two: equity
 * (which also funds F&O) and commodity.
 *
 * @return array{equity: ?array, commodity: ?array}
 */
function ob_kite_funds(array $data): array
{
    $one = static function (mixed $seg): ?array {
        if (!is_array($seg) || ($seg['enabled'] ?? true) === false) {
            return null;
        }
        return [
            // What can still be used for new trades.
            'available' => round((float) ($seg['net'] ?? 0), 2),
            // Margin blocked by positions and orders.
            'used' => round((float) ($seg['utilised']['debits'] ?? 0), 2),
            'openingBalance' => round((float) ($seg['available']['opening_balance'] ?? 0), 2),
            'collateral' => round((float) ($seg['available']['collateral'] ?? 0), 2),
        ];
    };
    return ['equity' => $one($data['equity'] ?? null), 'commodity' => $one($data['commodity'] ?? null)];
}

/**
 * One net position's P&L, computed the way Zerodha documents it rather than
 * read from Kite's `realised` / `unrealised` fields, which Kite doesn't fill
 * reliably (realised often 0, unrealised the whole P&L):
 *
 *   P&L        = (sell value − buy value) + net qty × LTP × multiplier
 *   unrealised = net qty × (LTP − average price) × multiplier   (the open part)
 *   realised   = P&L − unrealised                               (the closed part)
 *   today/M2M  = (day sell value − day buy value)
 *                + (net qty × LTP − overnight qty × yesterday's close) × multiplier
 *
 * The multiplier matters for MCX and currency contracts (P&L per point per lot).
 * A delivery (CNC) sale from holdings has no buy side today, so it is realised
 * against the holding's average cost instead of against the LTP.
 *
 * @param array<string,array> $holdingBy "EXCHANGE:SYMBOL" => Kite holding
 */
function ob_kite_position_pnl(array $p, array $holdingBy): array
{
    $f = static fn(string $k): float => (float) ($p[$k] ?? 0);
    $m = $f('multiplier') ?: 1.0;
    $qty = (int) ($p['quantity'] ?? 0);
    $last = $f('last_price');
    $avg = $f('average_price');
    $symbol = (string) ($p['tradingsymbol'] ?? '');
    $exchange = (string) ($p['exchange'] ?? '');

    $hasValues = isset($p['buy_value']) || isset($p['sell_value']);
    $pnl = $hasValues ? ($f('sell_value') - $f('buy_value')) + $qty * $last * $m : $f('pnl');
    $unrealised = $qty !== 0 ? $qty * ($last - $avg) * $m : 0.0;
    $realised = $pnl - $unrealised;

    $hasDay = isset($p['day_buy_value']) || isset($p['day_sell_value']);
    $m2m = $hasDay
        ? ($f('day_sell_value') - $f('day_buy_value')) + ($qty * $last - (int) ($p['overnight_quantity'] ?? 0) * $f('close_price')) * $m
        : $f('m2m');

    // Sold from holdings today (CNC, nothing bought): profit is against the holding's cost.
    $holding = $holdingBy[strtoupper($exchange) . ':' . strtoupper($symbol)] ?? null;
    $soldFromHolding = false;
    if ($holding !== null && ($p['product'] ?? '') === 'CNC' && $qty < 0 && (int) ($p['buy_quantity'] ?? 0) === 0) {
        $sold = -$qty;
        $cost = (float) ($holding['average_price'] ?? 0);
        $close = (float) ($holding['close_price'] ?? 0);
        $realised = $sold * ($f('sell_price') - $cost);
        $unrealised = 0.0;
        $pnl = $realised;
        // Today's part: the sale against yesterday's close.
        $m2m = $close > 0 ? $sold * ($f('sell_price') - $close) : $m2m;
        $soldFromHolding = true;
    }

    return [
        'symbol' => $symbol,
        'exchange' => $exchange,
        'segment' => ob_kite_segment($exchange),
        'product' => (string) ($p['product'] ?? ''),
        // A sale from holdings closes that quantity, so show it as closed.
        'quantity' => $soldFromHolding ? 0 : $qty,
        'buyQty' => (int) ($p['buy_quantity'] ?? 0),
        'buyAvg' => $f('buy_price'),
        'sellQty' => (int) ($p['sell_quantity'] ?? 0),
        'sellAvg' => $f('sell_price'),
        'average' => $soldFromHolding ? (float) ($holding['average_price'] ?? 0) : $avg,
        'last' => $last,
        'multiplier' => $m,
        'pnl' => round($pnl, 2),
        'realised' => round($realised, 2),
        'unrealised' => round($unrealised, 2),
        'm2m' => round($m2m, 2),
    ];
}

/**
 * Today's charges and taxes per segment (brokerage, STT / CTT, exchange and
 * SEBI fees, GST, stamp duty), from Kite's virtual contract note: today's
 * completed orders sent to /charges/orders. Null when it can't be worked out.
 *
 * @return array<string, float>|null segment => charges
 */
function ob_kite_today_charges(): ?array
{
    $orders = ob_kite_get('/orders')['data'] ?? [];
    $done = [];
    foreach ($orders as $o) {
        if (($o['status'] ?? '') !== 'COMPLETE' || (int) ($o['filled_quantity'] ?? 0) <= 0) {
            continue;
        }
        $done[] = [
            'order_id' => (string) $o['order_id'],
            'exchange' => (string) $o['exchange'],
            'tradingsymbol' => (string) $o['tradingsymbol'],
            'transaction_type' => (string) $o['transaction_type'],
            'variety' => (string) ($o['variety'] ?? 'regular'),
            'product' => (string) ($o['product'] ?? 'NRML'),
            'order_type' => (string) ($o['order_type'] ?? 'MARKET'),
            'quantity' => (int) $o['filled_quantity'],
            'average_price' => (float) ($o['average_price'] ?? 0),
        ];
    }
    $out = ['equity' => 0.0, 'fo' => 0.0, 'commodity' => 0.0];
    if (!$done) {
        return $out;
    }
    foreach (array_chunk($done, 100) as $batch) {
        foreach (ob_kite_post_json('/charges/orders', $batch)['data'] ?? [] as $c) {
            $seg = ob_kite_segment((string) ($c['exchange'] ?? ''));
            $out[$seg] += (float) ($c['charges']['total'] ?? 0);
        }
    }
    return array_map(static fn($v) => round($v, 2), $out);
}
