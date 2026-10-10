<?php
declare(strict_types=1);

/** JSON response helpers, shared by every route. */

function ob_json(mixed $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    // Responses are per-session and time-sensitive; never let a proxy hold them.
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function ob_error(string $message, int $status = 500, ?string $detail = null): never
{
    $body = ['error' => $message];
    if ($detail !== null) {
        $body['detail'] = $detail;
    }
    ob_json($body, $status);
}

/** Query param as a trimmed string, or null when absent/empty. */
function ob_query(string $name): ?string
{
    $v = $_GET[$name] ?? null;
    if (!is_string($v)) {
        return null;
    }
    $v = trim($v);
    return $v === '' ? null : $v;
}

/** Decoded JSON request body. */
function ob_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $json = json_decode($raw, true);
    return is_array($json) ? $json : [];
}
