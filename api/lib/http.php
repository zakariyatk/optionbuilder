<?php
declare(strict_types=1);

/**
 * cURL helpers.
 *
 * cURL rather than file_get_contents(): shared hosts routinely disable
 * allow_url_fopen, and cURL gives explicit control over timeouts, which matters
 * when an upstream (NSE especially) hangs rather than refusing.
 */

const OB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

final class ObHttpError extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 0)
    {
        parent::__construct($message);
    }
}

/**
 * @param array<string,string> $headers
 * @return array{status:int, body:string}
 */
function ob_http_request(string $method, string $url, array $headers = [], ?string $body = null, int $timeout = 20): array
{
    $ch = curl_init($url);
    if ($ch === false) {
        throw new ObHttpError('Could not initialise cURL');
    }

    $headerLines = [];
    foreach ($headers as $k => $v) {
        $headerLines[] = "$k: $v";
    }

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_USERAGENT => OB_UA,
        CURLOPT_HTTPHEADER => $headerLines,
        CURLOPT_CUSTOMREQUEST => $method,
        // Let cURL negotiate and transparently inflate gzip responses.
        CURLOPT_ENCODING => '',
    ]);

    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }

    $response = curl_exec($ch);
    if ($response === false) {
        $err = curl_error($ch);
        curl_close($ch);
        throw new ObHttpError("Request failed: $err");
    }

    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    return ['status' => $status, 'body' => (string) $response];
}

/**
 * Many GETs in parallel (curl_multi), at most `$concurrency` in flight.
 * Failed transfers come back with status 0.
 *
 * @param array<string,string> $urls keyed by the caller's ids
 * @param array<string,string> $headers
 * @return array<string, array{status:int, body:string}>
 */
function ob_http_multi_get(array $urls, array $headers = [], int $concurrency = 10, int $timeout = 20): array
{
    $headerLines = [];
    foreach ($headers as $k => $v) {
        $headerLines[] = "$k: $v";
    }
    $out = [];
    foreach (array_chunk($urls, max(1, $concurrency), true) as $batch) {
        $mh = curl_multi_init();
        $handles = [];
        foreach ($batch as $id => $url) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => $timeout,
                CURLOPT_CONNECTTIMEOUT => 10,
                CURLOPT_USERAGENT => OB_UA,
                CURLOPT_HTTPHEADER => $headerLines,
                CURLOPT_ENCODING => '',
            ]);
            curl_multi_add_handle($mh, $ch);
            $handles[$id] = $ch;
        }
        do {
            $status = curl_multi_exec($mh, $running);
            if ($running) {
                curl_multi_select($mh, 1.0);
            }
        } while ($running && $status === CURLM_OK);
        foreach ($handles as $id => $ch) {
            $out[$id] = [
                'status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE),
                'body' => (string) curl_multi_getcontent($ch),
            ];
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
        }
        curl_multi_close($mh);
    }
    return $out;
}

/** GET returning decoded JSON, throwing on transport or HTTP failure. */
function ob_get_json(string $url, array $headers = [], int $timeout = 20): mixed
{
    $headers += ['Accept' => 'application/json'];
    $res = ob_http_request('GET', $url, $headers, null, $timeout);

    if ($res['status'] < 200 || $res['status'] >= 300) {
        throw new ObHttpError("HTTP {$res['status']} for $url", $res['status']);
    }

    $json = json_decode($res['body'], true);
    if ($json === null && json_last_error() !== JSON_ERROR_NONE) {
        throw new ObHttpError('Invalid JSON from ' . $url);
    }
    return $json;
}

function ob_get_text(string $url, array $headers = [], int $timeout = 20): string
{
    $res = ob_http_request('GET', $url, $headers, null, $timeout);
    if ($res['status'] < 200 || $res['status'] >= 300) {
        throw new ObHttpError("HTTP {$res['status']} for $url", $res['status']);
    }
    return $res['body'];
}
