<?php
/**
 * Option Builder configuration template.
 *
 * RECOMMENDED: copy this file to the directory ABOVE your web root and name it
 * optionbuilder-config.php, e.g.
 *     /home/<user>/optionbuilder-config.php
 * when the app is deployed to /home/<user>/public_html/optionbuilder/.
 * Nothing there can ever be served over HTTP, even if .htaccess stops working.
 *
 * Alternatively copy it to api/config.php (blocked by api/.htaccess), or set
 * the OB_CONFIG_FILE environment variable to its path.
 *
 * Never commit the filled-in copy — it holds your broker secret.
 */

return [
    // From https://account.upstox.com/developer/apps
    'upstox_api_key' => '',
    'upstox_api_secret' => '',
    // Must match EXACTLY what is registered on the Upstox app, e.g.
    // 'https://www.adddots.com/optionbuilder/api/auth/upstox/callback'
    'upstox_redirect_uri' => '',

    // Password required to open the app. Store a HASH, not the password:
    //   php -r "echo password_hash('your-password', PASSWORD_DEFAULT), PHP_EOL;"
    // Leave both empty ONLY when the backend is not reachable from the internet.
    'app_password_hash' => '',
    // Legacy plain-text option, used only when app_password_hash is empty.
    'app_password' => '',

    // Where the broker token, cache and login-throttle state live. Must be
    // writable by PHP. Outside the web root is best:
    // 'data_dir' => '/home/<user>/optionbuilder-data',

    // Log in again after this many hours, even with the tab left open.
    'session_hours' => 12,
];
