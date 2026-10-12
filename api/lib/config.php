<?php
declare(strict_types=1);

/**
 * Configuration, loaded from a plain PHP file that returns an array.
 *
 * Deliberately PHP rather than a .env: on shared hosting a .env sitting under
 * the web root can be served as plain text if the .htaccess ever fails to
 * apply, whereas a .php file executes and yields nothing.
 *
 * Lookup order — the first file that exists wins:
 *   1. the path in the OB_CONFIG_FILE environment variable
 *   2. optionbuilder-config.php in the directory ABOVE public_html
 *      (e.g. /home/user/domains/example.com/optionbuilder-config.php) — the
 *      recommended place, since nothing there can ever be served. Found by
 *      walking up from this file to the nearest public_html, so it works
 *      however deep the app sits (public_html/app/Optionbuilder/, …) and
 *      whether it is served from the main domain or from a subdomain whose
 *      folder is inside public_html.
 *   3. optionbuilder-config.php in the directory above the web server's
 *      document root (for hosts without a public_html folder)
 *   4. config.php next to index.php (legacy location, protected by .htaccess)
 */

function ob_config_file(): ?string
{
    // The nearest public_html above this file.
    $publicHtml = null;
    for ($dir = __DIR__; dirname($dir) !== $dir; $dir = dirname($dir)) {
        if (basename($dir) === 'public_html') {
            $publicHtml = $dir;
            break;
        }
    }
    $docRoot = isset($_SERVER['DOCUMENT_ROOT']) ? realpath((string) $_SERVER['DOCUMENT_ROOT']) : false;
    $candidates = [
        getenv('OB_CONFIG_FILE') ?: null,
        $publicHtml ? dirname($publicHtml) . '/optionbuilder-config.php' : null,
        // The directory above the web root.
        $docRoot ? dirname($docRoot) . '/optionbuilder-config.php' : null,
        __DIR__ . '/../config.php',
    ];
    foreach ($candidates as $file) {
        if ($file !== null && is_file($file)) {
            return $file;
        }
    }
    return null;
}

function ob_config(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }

    $file = ob_config_file();
    $loaded = $file !== null ? require $file : [];
    $config = is_array($loaded) ? $loaded : [];

    return $config += [
        'upstox_api_key' => '',
        'upstox_api_secret' => '',
        'upstox_redirect_uri' => '',
        // Password required to use the app. Prefer app_password_hash (from
        // `php -r "echo password_hash('…', PASSWORD_DEFAULT);"`) so the
        // plain password never sits on the server. Both empty disables the
        // gate — only sensible when the backend is not reachable from the internet.
        'app_password' => '',
        'app_password_hash' => '',
        // Writable directory for the broker token, cache and rate-limit state.
        // Point it outside the web root when the host allows.
        'data_dir' => __DIR__ . '/../data',
        // Sessions expire after this many hours even if the tab stays open.
        'session_hours' => 12,
    ];
}

function ob_config_get(string $key, mixed $default = null): mixed
{
    $c = ob_config();
    return $c[$key] ?? $default;
}

/** Writable directory for the token and cache. Created on first use. */
function ob_data_dir(): string
{
    $dir = (string) ob_config_get('data_dir');
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    return $dir;
}
