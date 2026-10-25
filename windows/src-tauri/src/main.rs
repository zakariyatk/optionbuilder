// AddStock: the Windows shell around the live Option Builder site.
//
// The window loads the site itself rather than a bundled copy, so the PHP backend's same-origin session
// cookie and CSRF checks work unchanged, and every deploy reaches the app too. Google refuses to sign in
// inside embedded webviews, so Supabase's authorize page is sent to the system browser; Google then comes
// back through an addstock://auth/callback link, which reopens the site's root with the ?code= for
// supabase-js to exchange in the window that started the sign-in.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

const SITE: &str = "https://optionbuilder.adddots.com/";
const MAIN: &str = "main";

/// Hosts whose pages stay inside the window: the site itself and Upstox, whose OAuth must land back
/// on the site's callback with the session cookie.
fn stays_inside(host: &str) -> bool {
    let site = Url::parse(SITE).expect("SITE is a valid URL");
    host == site.host_str().unwrap_or_default()
        || host == "upstox.com"
        || host.ends_with(".upstox.com")
}

/// Decide each top-level navigation: keep it in the window, or hand it to the system browser.
fn allow_navigation(app: &AppHandle, url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return true; // about:blank, data: and blob: (image exports)
    }
    let host = url.host_str().unwrap_or_default();
    if stays_inside(host) {
        return true;
    }
    let _ = app.opener().open_url(url.as_str(), None::<&str>);
    false
}

/// The site URL an addstock://auth/callback link should reopen, or None for any other link.
/// Only Supabase's own parameters are passed on, so a link from elsewhere can't steer the window.
fn callback_target(link: &Url) -> Option<Url> {
    if link.scheme() != "addstock" || link.host_str() != Some("auth") || link.path() != "/callback" {
        return None;
    }
    let mut target = Url::parse(SITE).ok()?;
    {
        let mut query = target.query_pairs_mut();
        for (key, value) in link.query_pairs() {
            if matches!(key.as_ref(), "code" | "error" | "error_code" | "error_description") {
                query.append_pair(&key, &value);
            }
        }
    }
    if target.query().map_or(true, str::is_empty) {
        return None;
    }
    Some(target)
}

fn handle_links(app: &AppHandle, links: Vec<Url>) {
    let Some(window) = app.get_webview_window(MAIN) else { return };
    if let Some(target) = links.iter().find_map(callback_target) {
        let _ = window.navigate(target);
    }
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn main() {
    tauri::Builder::default()
        // First, so a second launch (e.g. Windows opening an addstock:// link) is handed to this one.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window(MAIN) {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            // The installer registers addstock:// too; this also covers `tauri dev` and portable runs.
            #[cfg(windows)]
            app.deep_link().register_all()?;

            // Started cold by the sign-in link: open straight on the callback.
            let start = app
                .deep_link()
                .get_current()?
                .and_then(|links| links.iter().find_map(callback_target))
                .unwrap_or_else(|| Url::parse(SITE).expect("SITE is a valid URL"));

            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, MAIN, WebviewUrl::External(start))
                .title("AddStock")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1024.0, 640.0)
                .center()
                // Lets the page know it runs in the app: Google-only sign-in, no landing page.
                .initialization_script(&format!("window.__ADDSTOCK__ = '{}';", env!("CARGO_PKG_VERSION")))
                .on_navigation(move |url| allow_navigation(&handle, url))
                .build()?;

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| handle_links(&handle, event.urls()));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AddStock");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_keeps_only_supabase_parameters() {
        let link = Url::parse("addstock://auth/callback?code=abc&next=https://evil.example").unwrap();
        assert_eq!(callback_target(&link).unwrap().as_str(), "https://optionbuilder.adddots.com/?code=abc");
    }

    #[test]
    fn callback_ignores_other_links() {
        assert!(callback_target(&Url::parse("addstock://auth/callback").unwrap()).is_none());
        assert!(callback_target(&Url::parse("addstock://other/callback?code=abc").unwrap()).is_none());
    }

    #[test]
    fn upstox_and_site_stay_inside() {
        assert!(stays_inside("optionbuilder.adddots.com"));
        assert!(stays_inside("api.upstox.com"));
        assert!(!stays_inside("zqwuztvbpfifmkwtjyyk.supabase.co"));
        assert!(!stays_inside("evilupstox.com"));
    }
}
