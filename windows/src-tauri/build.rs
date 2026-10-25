fn main() {
    // Declares the app's own `notify` command, so capabilities/remote.json can grant it to the site.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&["notify"])))
        .expect("failed to run tauri-build");
}
