# AddStock for Windows

A Tauri 2 shell that opens <https://optionbuilder.adddots.com/> in its own window. The site isn't bundled, so
the backend's session cookie works unchanged and every deploy reaches the app.

The app opens on its own start screen instead of the website's landing page: the app's sections down the
side, a sign-in banner and shortcuts (`frontend/src/features/landing/DesktopHome.tsx`). Each shortcut signs in
and then opens its page. Sign-in is the same email code as the website, typed into the app. Upstox pages
stay in the window; any other link opens in the browser.

Desktop extras:
- **Offline screen.** The window starts on `web/index.html`, which opens the site as soon as it answers and
  otherwise says you're offline and retries every 5 seconds.
- **Tray.** Closing the window hides it to the tray, so price alerts keep running. Click the tray icon to
  open it again; its menu has "Start with Windows" (starts hidden in the tray) and Quit.
- **Notifications.** Price alerts show as Windows notifications: the page's `Notification` API is pointed at
  the shell's `notify` command, the only command the site may call (`src-tauri/capabilities/remote.json`).
  While hidden, WebView2 slows the page's timers, so alerts can arrive up to a minute late.

The shell already handles Google for later (branch `google-sign-in`): Google refuses embedded webviews, so
Supabase's authorize page goes to the system browser and Google comes back through an
`addstock://auth/callback?code=…` link, which the shell reopens on the site for supabase-js to finish.

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

## Google sign-in setup (for the `google-sign-in` branch)

1. Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application). Authorized
   redirect URI: `https://zqwuztvbpfifmkwtjyyk.supabase.co/auth/v1/callback`.
2. Supabase (add-call project) → Authentication → Sign In / Providers → Google: enable, paste the client ID
   and secret.
3. Supabase → Authentication → URL Configuration → Redirect URLs: add `addstock://auth/callback`.
4. Only addresses in `allowed_emails` in the server config get in. Google sign-in does create a Supabase
   user in the shared project the first time someone signs in, even when the allowlist then refuses them.

The installers aren't code-signed, so Windows SmartScreen shows "Windows protected your PC" on first run
(More info → Run anyway). A Microsoft Store listing avoids that for free: the Store signs the package.
