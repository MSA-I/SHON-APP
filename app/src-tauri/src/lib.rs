// SOP: architecture/08-tauri-filesystem.md
//
// Tauri 2 backend entry point. The JS lib layer (src/lib/tauri-fs.ts) talks to
// the FS plugin directly — no custom commands are needed at this stage. If a
// future feature requires a Rust-side command (e.g., a high-perf thumbnail
// generator), add `#[tauri::command]` here and wire it into `invoke_handler`.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
