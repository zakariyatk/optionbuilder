<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

/**
 * File-based cache. Shared hosting has no APCu or Redis to rely on, and the
 * payloads here are small JSON blobs, so files are the right tool.
 *
 * TTLs mirror the Node backend: quotes 15s, reports 2min, daily data 10min.
 */

const OB_TTL_QUOTE = 15;
/** The watchlist polls every few seconds while the market is open. */
const OB_TTL_WATCH = 4;
/** How old a quote may be when its upstream is failing before it's shown as unavailable. */
const OB_MAX_STALE_QUOTE = 120;
const OB_TTL_REPORT = 120;
const OB_TTL_DAILY = 600;

function ob_cache_path(string $key): string
{
    // Hash so an arbitrary key (symbols, expiries) can't escape the directory.
    return ob_data_dir() . '/cache_' . sha1($key) . '.json';
}

/**
 * The cached value for $key if it was stored less than $maxAge seconds ago,
 * else null.
 */
function ob_cache_get(string $key, int $maxAge): mixed
{
    $path = ob_cache_path($key);
    if (!is_file($path)) {
        return null;
    }
    $raw = @file_get_contents($path);
    $entry = $raw === false ? null : json_decode($raw, true);
    if (!is_array($entry) || !array_key_exists('value', $entry) || !isset($entry['at'])) {
        return null;
    }
    return (time() - (int) $entry['at']) < $maxAge ? $entry['value'] : null;
}

function ob_cache_put(string $key, mixed $value): void
{
    $path = ob_cache_path($key);
    // Write via a temp file + rename so a concurrent reader never sees a
    // half-written entry.
    $tmp = $path . '.' . getmypid() . '.tmp';
    if (@file_put_contents($tmp, json_encode(['at' => time(), 'value' => $value])) !== false) {
        @rename($tmp, $path);
    }
}

/**
 * Returns the cached value for $key, or computes it with $producer and stores it.
 *
 * If the producer throws but an entry younger than $maxStale seconds exists,
 * that stale value is returned: a momentarily flaky upstream shouldn't blank a
 * panel that had good data a minute ago. Live quotes pass a small $maxStale so
 * an upstream that keeps failing can't freeze them on an old snapshot.
 */
function ob_cached(string $key, callable $producer, int $ttl = OB_TTL_QUOTE, int $maxStale = PHP_INT_MAX): mixed
{
    $fresh = ob_cache_get($key, $ttl);
    if ($fresh !== null) {
        return $fresh;
    }

    try {
        $value = $producer();
    } catch (Throwable $e) {
        $stale = ob_cache_get($key, $maxStale);
        if ($stale !== null) {
            return $stale;
        }
        throw $e;
    }

    ob_cache_put($key, $value);
    return $value;
}

function ob_cache_clear(): void
{
    foreach (glob(ob_data_dir() . '/cache_*.json') ?: [] as $f) {
        @unlink($f);
    }
}
