# AddStock for Windows

A Tauri 2 shell that opens <https://optionbuilder.adddots.com/> in its own window. The site isn't bundled, so
the backend's session cookie works unchanged and every deploy reaches the app.

Sign-in is Google only. Google refuses embedded webviews, so the shell sends Supabase's authorize page to the
system browser; Google comes back through an `addstock://auth/callback?code=…` link, and the shell reopens
the site with that code for supabase-js to finish. Upstox pages stay in the window; any other link opens in
the browser.

## Build

Needs Node 20+, Rust (`winget install Rustlang.Rustup`) and the Visual Studio C++ Build Tools
(`winget install Microsoft.VisualStudio.2022.BuildTools`, C++ workload).

```bash
npm install
npm test         # Rust unit tests: link handling and navigation rules
npm run dev      # run the app
npm run build    # installers in src-tauri/target/release/bundle/{nsis,msi}
npm run icons    # regenerate icons from the web app's logo
```

## Google sign-in setup (once)

1. Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application). Authorized
   redirect URI: `https://zqwuztvbpfifmkwtjyyk.supabase.co/auth/v1/callback`.
2. Supabase (add-call project) → Authentication → Sign In / Providers → Google: enable, paste the client ID
   and secret.
3. Supabase → Authentication → URL Configuration → Redirect URLs: add `addstock://auth/callback`.
4. Only addresses in `allowed_emails` in the server config get in. Google sign-in does create a Supabase
   user in the shared project the first time someone signs in, even when the allowlist then refuses them.

The installers aren't code-signed, so Windows SmartScreen shows "Windows protected your PC" on first run
(More info → Run anyway). A Microsoft Store listing avoids that for free: the Store signs the package.
