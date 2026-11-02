use std::fs::File;
use std::io::{Read, Write};

// Eine .weitblick-Datei ist ein ZIP-Container:
//   presentation.json  – Leinwand, Objekte, Rahmen, Pfad, Thema
//   media/…            – Bilder und Videos (folgt später)
const PRESENTATION_ENTRY: &str = "presentation.json";

#[tauri::command]
fn save_presentation(path: String, json: String) -> Result<(), String> {
    // Erst in eine Nachbardatei schreiben und dann umbenennen,
    // damit ein Absturz nie eine halb geschriebene Präsentation hinterlässt.
    let tmp = format!("{path}.tmp");
    let file = File::create(&tmp).map_err(|e| format!("Datei kann nicht angelegt werden: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file(PRESENTATION_ENTRY, options).map_err(|e| e.to_string())?;
    zip.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    zip.finish().map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Speichern fehlgeschlagen: {e}"))
}

#[tauri::command]
fn open_presentation(path: String) -> Result<String, String> {
    let file = File::open(&path).map_err(|e| format!("Datei kann nicht geöffnet werden: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "Das ist keine Weitblick-Datei.".to_string())?;
    let mut entry = zip
        .by_name(PRESENTATION_ENTRY)
        .map_err(|_| "In der Datei fehlt presentation.json.".to_string())?;
    let mut json = String::new();
    entry.read_to_string(&mut json).map_err(|e| e.to_string())?;
    Ok(json)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_presentation, open_presentation])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
