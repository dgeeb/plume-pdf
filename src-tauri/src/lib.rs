use std::path::Path;
use tauri::ipc::{InvokeBody, Request, Response};

/// Read a file and return its raw bytes (no JSON encoding).
#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

/// Write raw bytes to the path given (URL-encoded) in the `path` header.
/// Writes to a temp file first, then replaces the target, so a failed save never corrupts the original.
#[tauri::command]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let header = request
        .headers()
        .get("path")
        .ok_or("missing path")?
        .to_str()
        .map_err(|e| e.to_string())?;
    let path = urlencoding::decode(header).map_err(|e| e.to_string())?.into_owned();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let tmp = format!("{path}.plume-tmp");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("{e} (is the file open in another program?)")
    })
}

/// PDF passed on the command line, e.g. when opened from Explorer.
#[tauri::command]
fn startup_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| a.to_lowercase().ends_with(".pdf") && Path::new(a).is_file())
}

/// True for the app's own pages. Everything else (a link in a PDF, a redirect...) must never
/// replace the app window; web links are opened in the user's browser by the frontend instead.
fn is_app_url(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => match url.host_str() {
            Some("tauri.localhost") => true,
            Some("localhost") => cfg!(debug_assertions) && url.port() == Some(1420),
            _ => false,
        },
        _ => false,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .expect("main window config");
            tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?
                .on_navigation(|url| {
                    let ok = is_app_url(url);
                    if !ok {
                        eprintln!("blocked navigation to {url}");
                    }
                    ok
                })
                // No pop-up windows (middle-click, window.open, target=_blank).
                .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![read_file, write_file, startup_file])
        .run(tauri::generate_context!())
        .expect("error while running Plume PDF");
}
