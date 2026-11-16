<?php
declare(strict_types=1);

require_once __DIR__ . '/http.php';

/**
 * AI Trade: Claude reviews one chart and gives a trade idea.
 *
 * The page sends a text brief (candles + the levels it computed); this wraps
 * it in the system prompt and JSON schema from ai_trade_spec.json and calls
 * the Claude Messages API with the key in config ('anthropic_api_key').
 *
 * Plain HTTP through ob_http_request, like the rest of this backend: it has
 * no Composer dependencies, so the Anthropic PHP SDK isn't used here. The
 * same spec drives ai-helper/server.mjs, which runs on your PC with the ant
 * CLI login and the official TypeScript SDK.
 */

const OB_AI_API = 'https://api.anthropic.com/v1/messages';
const OB_AI_VERSION = '2026-10-21';
/** Refusal fallbacks, routed by Anthropic ("default"), for Claude Opus 5.5. */
const OB_AI_BETA = 'server-side-fallback-2026-07-01';
/** A brief is ~10–20 KB; anything far bigger isn't from the page. */
const OB_AI_MAX_BRIEF = 60000;

function ob_ai_spec(): array
{
    static $spec = null;
    if ($spec === null) {
        $spec = json_decode((string) file_get_contents(__DIR__ . '/ai_trade_spec.json'), true);
        if (!is_array($spec)) {
            throw new RuntimeException('ai_trade_spec.json is missing or invalid');
        }
    }
    return $spec;
}

function ob_ai_key(): string
{
    return trim((string) ob_config_get('anthropic_api_key', ''));
}

function ob_ai_configured(): bool
{
    return ob_ai_key() !== '';
}

function ob_ai_model(): string
{
    $m = trim((string) ob_config_get('ai_model', ''));
    return $m !== '' ? $m : (string) ob_ai_spec()['model'];
}

/** Analyses a day across all users: a cap on what the key can spend (config 'ai_daily_limit'). */
function ob_ai_daily_limit(): int
{
    return max(0, (int) ob_config_get('ai_daily_limit', 40));
}

function ob_ai_usage_file(): string
{
    $day = (new DateTimeImmutable('now', new DateTimeZone('Asia/Kolkata')))->format('Ymd');
    return ob_data_dir() . "/ai-usage-$day.json";
}

function ob_ai_used_today(): int
{
    $raw = @file_get_contents(ob_ai_usage_file());
    $n = $raw === false ? 0 : (int) (json_decode($raw, true)['count'] ?? 0);
    return max(0, $n);
}

function ob_ai_count_one(): void
{
    $f = ob_ai_usage_file();
    $fh = @fopen($f, 'c+');
    if ($fh === false) {
        return;
    }
    flock($fh, LOCK_EX);
    $n = (int) (json_decode((string) stream_get_contents($fh), true)['count'] ?? 0) + 1;
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode(['count' => $n]));
    flock($fh, LOCK_UN);
    fclose($fh);
}

final class ObAiError extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 502)
    {
        parent::__construct($message);
    }
}

/**
 * One analysis. The same brief within 10 minutes is answered from cache, so
 * re-clicking doesn't spend again.
 *
 * @return array{signal: array, model: string, at: int, cached: bool}
 */
function ob_ai_analyse(string $symbol, string $tf, string $brief): array
{
    if (!ob_ai_configured()) {
        throw new ObAiError('AI_NOT_CONFIGURED', 503);
    }
    if ($brief === '' || strlen($brief) > OB_AI_MAX_BRIEF) {
        throw new ObAiError('brief is empty or too long', 400);
    }
    $cacheKey = 'ai:' . md5(ob_ai_model() . "|$symbol|$tf|$brief");
    $hit = ob_cache_get($cacheKey, 600);
    if ($hit !== null) {
        return ['cached' => true] + $hit;
    }
    $limit = ob_ai_daily_limit();
    if ($limit > 0 && ob_ai_used_today() >= $limit) {
        throw new ObAiError("Today's AI analysis limit ($limit) is used up. It resets at midnight IST.", 429);
    }

    $spec = ob_ai_spec();
    $payload = [
        'model' => ob_ai_model(),
        'max_tokens' => (int) $spec['max_tokens'],
        'system' => [
            // The prompt never changes, so repeat analyses read it from cache.
            ['type' => 'text', 'text' => (string) $spec['system'], 'cache_control' => ['type' => 'ephemeral']],
        ],
        'messages' => [
            ['role' => 'user', 'content' => $brief],
        ],
        'output_config' => [
            'effort' => (string) ($spec['effort'] ?? 'high'),
            'format' => ['type' => 'json_schema', 'schema' => $spec['schema']],
        ],
        // If a safety classifier declines, Anthropic re-runs it on a fallback model.
        'fallbacks' => 'default',
    ];

    // Opus thinks before answering; give it time on hosts that stop scripts at 30 s.
    @set_time_limit(180);
    ob_ai_count_one();
    $res = ob_http_request('POST', OB_AI_API, [
        'Content-Type' => 'application/json',
        'x-api-key' => ob_ai_key(),
        'anthropic-version' => OB_AI_VERSION,
        'anthropic-beta' => OB_AI_BETA,
    ], json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 170);

    $json = json_decode($res['body'], true);
    if ($res['status'] < 200 || $res['status'] >= 300) {
        $msg = is_array($json) ? (string) ($json['error']['message'] ?? '') : '';
        $type = is_array($json) ? (string) ($json['error']['type'] ?? '') : '';
        $status = match (true) {
            $res['status'] === 401, $res['status'] === 403 => 502,
            $res['status'] === 429, $res['status'] === 529 => 503,
            default => 502,
        };
        throw new ObAiError(trim("Claude API error {$res['status']} $type: $msg"), $status);
    }
    if (!is_array($json)) {
        throw new ObAiError('Claude API sent an unreadable response');
    }
    $stop = (string) ($json['stop_reason'] ?? '');
    if ($stop === 'refusal') {
        throw new ObAiError('Claude declined to analyse this chart.', 422);
    }
    if ($stop === 'max_tokens') {
        throw new ObAiError('Claude ran out of room before finishing. Try again.');
    }
    $text = '';
    foreach (($json['content'] ?? []) as $block) {
        if (($block['type'] ?? '') === 'text') {
            $text .= (string) ($block['text'] ?? '');
        }
    }
    $signal = json_decode($text, true);
    if (!is_array($signal) || !isset($signal['action'])) {
        throw new ObAiError('Claude did not return a signal');
    }
    $out = ['signal' => $signal, 'model' => (string) ($json['model'] ?? ob_ai_model()), 'at' => (int) round(microtime(true) * 1000)];
    ob_cache_put($cacheKey, $out);
    return ['cached' => false] + $out;
}
