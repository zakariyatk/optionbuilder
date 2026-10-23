<?php
/**
 * Option Builder configuration template.
 *
 * RECOMMENDED: copy this file to the directory ABOVE your web root and name it
 * optionbuilder-config.php, e.g.
 *     /home/<user>/optionbuilder-config.php
 * when the site's web root is /home/<user>/public_html (on Hostinger:
 *     /home/<user>/domains/<domain>/optionbuilder-config.php
 * next to the domain's public_html). The app may sit anywhere below it,
 * e.g. public_html/opbuilder/, including as a subdomain's folder.
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
    // 'https://optionbuilder.adddots.com/api/auth/upstox/callback'
    'upstox_redirect_uri' => '',

    // Supabase sign-in (recommended): a 6-digit email code or magic link, and
    // Google once enabled. When url, key and allowed_emails are set, the
    // password login below is switched off. From the Supabase dashboard →
    // Project Settings → API: the project URL and the publishable (or anon) key.
    // Both are public; never put the service_role / secret key here.
    'supabase_url' => '',
    'supabase_key' => '',
    // Show "Continue with Google" — only after enabling the Google provider in
    // Supabase → Authentication → Sign In / Providers.
    'supabase_google' => false,
    // Only these accounts can open the app, even if the Supabase project has others.
    'allowed_emails' => [],

    // Password required to open the app, used only while Supabase sign-in is not
    // set up. Store a HASH, not the password:
    //   php -r "echo password_hash('your-password', PASSWORD_DEFAULT), PHP_EOL;"
    // Leave everything empty ONLY when the backend is not reachable from the internet.
    'app_password_hash' => '',
    // Legacy plain-text option, used only when app_password_hash is empty.
    'app_password' => '',

    // Where the broker token, cache and login-throttle state live. Must be
    // writable by PHP. Outside the web root is best:
    // 'data_dir' => '/home/<user>/optionbuilder-data',

    // Log in again after this many hours, even with the tab left open.
    'session_hours' => 12,
];
