// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Linux (WebKitGTK): Im Compositing-Modus werden per transform vergrößerte Ebenen ohne ihren
    // Zoomfaktor gerastert und nur hochgezogen – nah herangezoomte Bereiche werden unscharf. Ohne
    // Compositing zeichnet WebKitGTK jedes Bild in echter Auflösung, wie WebView2 unter Windows.
    // Eine vom Nutzer gesetzte Variable bleibt unangetastet.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        // SAFETY: läuft vor dem Start von Tauri, es gibt noch keine weiteren Threads.
        unsafe { std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1") };
    }
    weitblick_lib::run()
}
