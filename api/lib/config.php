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
    $loaded = [];
    if ($file !== null) {
        // A file missing its `<?php return [` is echoed as plain text by PHP,
        // which would publish whatever secrets it holds. Swallow any output
        // and treat the file as invalid instead.
        ob_start();
        try {
            $loaded = require $file;
        } catch (Throwable) {
            $loaded = null;
        } finally {
            ob_end_clean();
        }
        if (!is_array($loaded)) {
            ob_config_invalid_file($file);
        }
    }
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

/** Remembers (and returns) a config file that exists but doesn't return an array. */
function ob_config_invalid_file(?string $set = null): ?string
{
    static $invalid = null;
    if ($set !== null) {
        $invalid = $set;
    }
    return $invalid;
}

/**
 * Hard stop when the config file is broken: say which file and what it must
 * look like, rather than run with no settings and fail somewhere confusing.
 */
function ob_require_valid_config(): void
{
    ob_config();
    $file = ob_config_invalid_file();
    if ($file === null) {
        return;
    }
    // Name the file relative to its domain folder, not the full server path.
    $shown = preg_replace('#^.*/(domains/[^/]+/)#', '$1', str_replace('\\', '/', $file));
    http_response_code(503);
    header('Content-Type: application/json');
    echo json_encode([
        'error' => 'CONFIG_INVALID',
        'detail' => "The config file $shown is not valid. It must start with <?php and return [ ... ]; "
            . 'with every setting inside the brackets (see api/config.example.php).',
    ]);
    exit;
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
