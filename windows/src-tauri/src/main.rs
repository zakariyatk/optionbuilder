// AddStock: the Windows shell around the live AddStock site.
//
// The window loads the site itself rather than a bundled copy, so the PHP backend's same-origin session
// cookie and CSRF checks work unchanged, and every deploy reaches the app too. It starts on a small local
// page (web/index.html) that opens the site once it answers, and shows an offline screen until then.
//
// Closing the window hides it to the tray, so price alerts keep running; they reach Windows as native
// notifications through the `notify` command, which the page's Notification API is pointed at.
//
// Updates come from the repo's GitHub Releases (latest.json, signed with the updater key): checked shortly
// after start, twice a day, and from the tray menu, and installed only when the user says so.
//
// Google refuses to sign in inside embedded webviews, so Supabase's authorize page is sent to the system
// browser; Google then comes back through an addstock://auth/callback link, which reopens the site's root
// with the ?code= for supabase-js to exchange in the window that started the sign-in.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_window_state::StateFlags;

const SITE: &str = "https://optionbuilder.adddots.com/";
const MAIN: &str = "main";
/// Passed by the "Start with Windows" entry, so the app starts in the tray instead of opening a window.
const HIDDEN_ARG: &str = "--hidden";

/// Runs in every page before its own scripts. Tells the site it is inside the app, and points the
/// Notification API at Windows notifications, which WebView2 doesn't show on its own.
const PAGE_SCRIPT: &str = r#"
(() => {
  const notify = (title, body) =>
    window.__TAURI_INTERNALS__ &&
    window.__TAURI_INTERNALS__.invoke('notify', { title: String(title), body: String(body || '') }).catch(() => {});
  class AddStockNotification {
    constructor(title, options) {
      notify(title, options && options.body);
    }
    close() {}
  }
  AddStockNotification.permission = 'granted';
  AddStockNotification.requestPermission = () => Promise.resolve('granted');
  window.Notification = AddStockNotification;
})();
"#;

/// Shown once per run, the first time closing the window only hides it.
static TRAY_HINT_SHOWN: AtomicBool = AtomicBool::new(false);

/// The first automatic update check waits for the window to settle; later ones run twice a day.
const FIRST_UPDATE_CHECK: Duration = Duration::from_secs(15);
const UPDATE_CHECK_EVERY: Duration = Duration::from_secs(12 * 60 * 60);

/// A Windows notification, for price alerts fired on the site.
#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) {
    let _ = app.notification().builder().title(title).body(body).show();
}

/// Hosts whose pages stay inside the window: the app's own start page, the site itself and Upstox, whose
/// OAuth must land back on the site's callback with the session cookie.
fn stays_inside(host: &str) -> bool {
    let site = Url::parse(SITE).expect("SITE is a valid URL");
    host == "tauri.localhost"
        || host == site.host_str().unwrap_or_default()
        || host == "upstox.com"
        || host.ends_with(".upstox.com")
}

/// Decide each top-level navigation: keep it in the window, or hand it to the system browser.
fn allow_navigation(app: &AppHandle, url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return true; // tauri:, about:blank, data: and blob: (image exports)
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

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Looks for a newer release and asks before installing it; the installer then closes and restarts the
/// app. A `quiet` check (the automatic ones) says nothing when there's no update or the check fails.
async fn check_for_update(app: AppHandle, quiet: bool) {
    let found = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(err) => Err(err),
    };
    match found {
        Ok(Some(update)) => {
            let message = format!(
                "AddStock {} is available (you have {}). Install it now? AddStock closes and reopens when it's done.",
                update.version, update.current_version
            );
            let handle = app.clone();
            app.dialog()
                .message(message)
                .title("Update available")
                .buttons(MessageDialogButtons::OkCancelCustom("Install".into(), "Later".into()))
                .show(move |install| {
                    if !install {
                        return;
                    }
                    tauri::async_runtime::spawn(async move {
                        if let Err(err) = update.download_and_install(|_, _| {}, || {}).await {
                            handle.dialog().message(format!("The update couldn't be installed: {err}")).title("Update failed").show(|_| {});
                        }
                    });
                });
        }
        Ok(None) if !quiet => {
            let message = format!("AddStock {} is the latest version.", app.package_info().version);
            app.dialog().message(message).title("No updates").show(|_| {});
        }
        Err(err) if !quiet => {
            app.dialog().message(format!("Couldn't check for updates: {err}")).title("Update check failed").show(|_| {});
        }
        _ => {}
    }
}

fn handle_links(app: &AppHandle, links: Vec<Url>) {
    let Some(window) = app.get_webview_window(MAIN) else { return };
    if let Some(target) = links.iter().find_map(callback_target) {
        let _ = window.navigate(target);
    }
    show_main(app);
}

/// The tray icon: click to open the window; the menu also toggles "Start with Windows" and quits.
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open AddStock", true, None::<&str>)?;
    let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(app, "autostart", "Start with Windows", true, autostart_on, None::<&str>)?;
    let update = MenuItem::with_id(app, "update", "Check for updates…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit AddStock", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &autostart, &update, &PredefinedMenuItem::separator(app)?, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("AddStock")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "autostart" => {
                let launcher = app.autolaunch();
                let on = launcher.is_enabled().unwrap_or(false);
                let _ = if on { launcher.disable() } else { launcher.enable() };
                let _ = autostart.set_checked(launcher.is_enabled().unwrap_or(!on));
            }
            "update" => {
                tauri::async_runtime::spawn(check_for_update(app.clone(), false));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        // First, so a second launch (e.g. Windows opening an addstock:// link) is handed to this one.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| show_main(app)))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![HIDDEN_ARG])))
        // Size and position only: the window is shown or hidden by how the app was started.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![notify])
        .setup(|app| {
            // The installer registers addstock:// too; this also covers `tauri dev` and portable runs.
            #[cfg(windows)]
            app.deep_link().register_all()?;

            // Started cold by the sign-in link: open straight on the callback. Otherwise the start page,
            // which opens the site once it answers.
            let start = match app.deep_link().get_current()?.and_then(|links| links.iter().find_map(callback_target)) {
                Some(target) => WebviewUrl::External(target),
                None => WebviewUrl::App("index.html".into()),
            };
            let hidden = std::env::args().any(|arg| arg == HIDDEN_ARG);

            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, MAIN, start)
                .title("AddStock")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1024.0, 640.0)
                .center()
                .visible(!hidden)
                .initialization_script(&format!("window.__ADDSTOCK__ = '{}';{PAGE_SCRIPT}", env!("CARGO_PKG_VERSION")))
                .on_navigation(move |url| allow_navigation(&handle, url))
                .build()?;

            build_tray(app)?;

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(FIRST_UPDATE_CHECK);
                loop {
                    tauri::async_runtime::block_on(check_for_update(handle.clone(), true));
                    std::thread::sleep(UPDATE_CHECK_EVERY);
                }
            });

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| handle_links(&handle, event.urls()));
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing hides to the tray so alerts keep running; Quit in the tray menu exits.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN {
                    api.prevent_close();
                    let _ = window.hide();
                    if !TRAY_HINT_SHOWN.swap(true, Ordering::Relaxed) {
                        let _ = window
                            .notification()
                            .builder()
                            .title("AddStock is still running")
                            .body("Price alerts keep working. Open it from the tray icon, or quit from its menu.")
                            .show();
                    }
                }
            }
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
    fn start_page_site_and_upstox_stay_inside() {
        assert!(stays_inside("tauri.localhost"));
        assert!(stays_inside("optionbuilder.adddots.com"));
        assert!(stays_inside("api.upstox.com"));
        assert!(!stays_inside("zqwuztvbpfifmkwtjyyk.supabase.co"));
        assert!(!stays_inside("evilupstox.com"));
    }
}
