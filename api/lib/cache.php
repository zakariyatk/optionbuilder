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
const OB_TTL_REPORT = 120;
const OB_TTL_DAILY = 600;

function ob_cache_path(string $key): string
{
    // Hash so an arbitrary key (symbols, expiries) can't escape the directory.
    return ob_data_dir() . '/cache_' . sha1($key) . '.json';
}

/**
 * Returns the cached value for $key, or computes it with $producer and stores it.
 *
 * If the producer throws but a stale entry exists, the stale value is returned:
 * a momentarily flaky upstream shouldn't blank a panel that had good data a
 * minute ago.
 */
function ob_cached(string $key, callable $producer, int $ttl = OB_TTL_QUOTE): mixed
{
    $path = ob_cache_path($key);

    $stale = null;
    if (is_file($path)) {
        $raw = @file_get_contents($path);
        if ($raw !== false) {
            $entry = json_decode($raw, true);
            if (is_array($entry) && array_key_exists('value', $entry)) {
                if (isset($entry['at']) && (time() - (int) $entry['at']) < $ttl) {
                    return $entry['value'];
                }
                $stale = $entry['value'];
            }
        }
    }

    try {
        $value = $producer();
    } catch (Throwable $e) {
        if ($stale !== null) {
            return $stale;
        }
        throw $e;
    }

    // Write via a temp file + rename so a concurrent reader never sees a
    // half-written entry.
    $tmp = $path . '.' . getmypid() . '.tmp';
    if (@file_put_contents($tmp, json_encode(['at' => time(), 'value' => $value])) !== false) {
        @rename($tmp, $path);
    }

    return $value;
}

function ob_cache_clear(): void
{
    foreach (glob(ob_data_dir() . '/cache_*.json') ?: [] as $f) {
        @unlink($f);
    }
}
