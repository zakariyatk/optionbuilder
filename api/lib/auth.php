<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/http.php';

/**
 * Login gate.
 *
 * The backend holds a live broker token, so every route except /api/health,
 * /api/session and the login endpoints requires a session. Two ways in, set in
 * the config file — this is a single-user app, so accounts would be ceremony
 * without benefit:
 *   - Supabase Auth (email code, or Google), limited to the addresses in
 *     allowed_emails. When it is configured it replaces the password: the
 *     password login is switched off.
 *   - One shared password, used only while Supabase sign-in is not configured.
 */

/** Failed logins allowed per IP inside the window before it is locked out. */
const OB_LOGIN_MAX_FAILURES = 5;
const OB_LOGIN_WINDOW = 900; // seconds

function ob_session_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    // Reject session ids the server didn't issue (session fixation).
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'httponly' => true,
        // Secure only over HTTPS, otherwise the cookie is dropped in local dev.
        'secure' => ob_is_https(),
        'samesite' => 'Lax',
    ]);
    session_name('obsession');
    session_start();
}

function ob_is_https(): bool
{
    return (($_SERVER['HTTPS'] ?? '') !== '' && $_SERVER['HTTPS'] !== 'off')
        || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

/** True when the request came from the machine running the server. */
function ob_is_local_request(): bool
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    return in_array($ip, ['127.0.0.1', '::1'], true);
}

function ob_password_configured(): bool
{
    return ob_config_get('app_password', '') !== '' || ob_config_get('app_password_hash', '') !== '';
}

/** Lower-cased addresses allowed to sign in through Supabase. */
function ob_allowed_emails(): array
{
    $emails = ob_config_get('allowed_emails', []);
    if (is_string($emails)) {
        $emails = explode(',', $emails);
    }
    return array_values(array_filter(array_map(
        static fn($e): string => strtolower(trim((string) $e)),
        (array) $emails
    )));
}

function ob_supabase_configured(): bool
{
    return ob_config_get('supabase_url', '') !== ''
        && ob_config_get('supabase_key', '') !== ''
        && ob_allowed_emails() !== [];
}

/** What the browser needs to start a Supabase sign-in. All of it is public. */
function ob_supabase_public_config(): ?array
{
    if (!ob_supabase_configured()) {
        return null;
    }
    return [
        'url' => rtrim((string) ob_config_get('supabase_url'), '/'),
        'key' => (string) ob_config_get('supabase_key'),
        // Only once the Google provider is enabled in the Supabase dashboard.
        'google' => (bool) ob_config_get('supabase_google', false),
    ];
}

/** True when some login method is set up, so the gate is on. */
function ob_login_configured(): bool
{
    return ob_supabase_configured() || ob_password_configured();
}

/** The password form is offered only while Supabase sign-in isn't set up. */
function ob_password_login_enabled(): bool
{
    return ob_password_configured() && !ob_supabase_configured();
}

/**
 * True when no password is configured — the gate is then disabled.
 *
 * Only honoured for local requests. A blank password on a public host would
 * silently expose a live broker token, so remote callers are refused outright
 * rather than let through (see ob_require_configured_password below).
 */
function ob_auth_disabled(): bool
{
    return !ob_login_configured() && ob_is_local_request();
}

/**
 * Hard stop: a deployed backend with no password set serves nothing at all.
 * Failing loudly here is far better than quietly publishing broker access.
 */
function ob_require_configured_password(): void
{
    if (!ob_login_configured() && !ob_is_local_request()) {
        http_response_code(503);
        header('Content-Type: application/json');
        echo json_encode([
            'error' => 'NOT_CONFIGURED',
            'detail' => 'Set supabase_url + supabase_key + allowed_emails (or app_password_hash) in the config file. The backend will not serve remote requests without one.',
        ]);
        exit;
    }
}

/**
 * CSRF guard for state-changing requests.
 *
 * The session cookie is SameSite=Lax, which already stops cross-site POSTs in
 * modern browsers; this is defence in depth. A cross-site HTML form cannot set
 * custom headers, and a cross-site fetch() that does is blocked by CORS
 * preflight (this backend sends no CORS allowance), so requiring
 * X-Requested-With plus a matching Origin when one is sent closes the gap.
 */
function ob_require_same_origin(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        return;
    }

    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') {
        $originHost = parse_url($origin, PHP_URL_HOST);
        $host = preg_replace('/:\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? ''));
        if ($originHost === null || $originHost === false || strcasecmp($originHost, $host) !== 0) {
            ob_error('Cross-origin request refused', 403);
        }
    }

    if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') === '') {
        ob_error('Missing X-Requested-With header', 403);
    }
}

function ob_is_logged_in(): bool
{
    if (ob_auth_disabled()) {
        return true;
    }
    ob_session_start();
    if (($_SESSION['ob_authed'] ?? false) !== true) {
        return false;
    }

    $maxAge = max(1, (int) ob_config_get('session_hours', 12)) * 3600;
    if (time() - (int) ($_SESSION['ob_authed_at'] ?? 0) > $maxAge) {
        ob_logout_session();
        return false;
    }
    return true;
}

// ------------------------------------------------------------ login throttle

function ob_throttle_file(): string
{
    // Hashed so an IPv6 address or a spoofed value can't shape the path.
    return ob_data_dir() . '/throttle_' . sha1((string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown')) . '.json';
}

/** @return array{failures:int, since:int} */
function ob_throttle_read(): array
{
    $raw = @file_get_contents(ob_throttle_file());
    $t = $raw !== false ? json_decode($raw, true) : null;
    if (!is_array($t) || time() - (int) ($t['since'] ?? 0) > OB_LOGIN_WINDOW) {
        return ['failures' => 0, 'since' => time()];
    }
    return ['failures' => (int) $t['failures'], 'since' => (int) $t['since']];
}

/** Seconds until this IP may try again, or 0 when it isn't locked out. */
function ob_login_locked_for(): int
{
    $t = ob_throttle_read();
    if ($t['failures'] < OB_LOGIN_MAX_FAILURES) {
        return 0;
    }
    return max(1, OB_LOGIN_WINDOW - (time() - $t['since']));
}

function ob_login_record_failure(): void
{
    $t = ob_throttle_read();
    $t['failures']++;
    @file_put_contents(ob_throttle_file(), json_encode($t), LOCK_EX);
}

function ob_login_clear_failures(): void
{
    @unlink(ob_throttle_file());
}

// --------------------------------------------------------------- login/out

function ob_password_matches(string $password): bool
{
    $hash = (string) ob_config_get('app_password_hash', '');
    if ($hash !== '') {
        return password_verify($password, $hash);
    }
    // Constant-time compare so the password can't be guessed by timing.
    return hash_equals((string) ob_config_get('app_password', ''), $password);
}

function ob_login(string $password): bool
{
    if (!ob_login_configured()) {
        return true;
    }
    if (!ob_password_login_enabled() || !ob_password_matches($password)) {
        return false;
    }
    ob_start_authed_session();
    return true;
}

function ob_start_authed_session(?string $email = null): void
{
    ob_session_start();
    session_regenerate_id(true); // don't let a pre-set session id be reused
    $_SESSION['ob_authed'] = true;
    $_SESSION['ob_authed_at'] = time();
    $_SESSION['ob_email'] = $email;
}

/**
 * Check a Supabase access token and return its email, or null.
 *
 * Asking Supabase's /auth/v1/user for the token's owner verifies the signature,
 * expiry and revocation in one call, so no JWT secret or key set lives here.
 * The Supabase project may serve other apps with other users, so the address
 * must also be confirmed and on this app's allowlist.
 */
function ob_supabase_verify(string $accessToken): ?string
{
    if ($accessToken === '' || strlen($accessToken) > 8192) {
        return null;
    }
    try {
        $res = ob_http_request(
            'GET',
            rtrim((string) ob_config_get('supabase_url'), '/') . '/auth/v1/user',
            [
                'Accept' => 'application/json',
                'apikey' => (string) ob_config_get('supabase_key'),
                'Authorization' => 'Bearer ' . $accessToken,
            ],
            null,
            15
        );
    } catch (Throwable) {
        return null;
    }
    if ($res['status'] !== 200) {
        return null;
    }
    $u = json_decode($res['body'], true);
    if (!is_array($u)) {
        return null;
    }

    $email = strtolower((string) ($u['email'] ?? ''));
    $ok = $email !== ''
        && !empty($u['email_confirmed_at'])
        && in_array($email, ob_allowed_emails(), true);
    return $ok ? $email : null;
}

function ob_login_supabase(string $accessToken): bool
{
    if (!ob_supabase_configured()) {
        return false;
    }
    $email = ob_supabase_verify($accessToken);
    if ($email === null) {
        return false;
    }
    ob_start_authed_session($email);
    return true;
}

function ob_logout_session(): void
{
    ob_session_start();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires' => time() - 3600,
            'path' => $p['path'],
            'secure' => $p['secure'],
            'httponly' => $p['httponly'],
            'samesite' => $p['samesite'] ?? 'Lax',
        ]);
    }
    session_destroy();
}
