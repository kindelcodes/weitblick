use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Write};

// Eine .weitblick-Datei ist ein ZIP-Container:
//   presentation.json  – Leinwand, Objekte, Rahmen, Pfad, Thema
//   media/…            – Bilder in Originalform
const PRESENTATION_ENTRY: &str = "presentation.json";
const MEDIA_DIR: &str = "media/";

// Eine Mediendatei auf dem Weg zwischen Oberfläche und Datei, Inhalt als Base64.
#[derive(Serialize, Deserialize)]
struct MediaFile {
    name: String,
    data: String,
}

#[derive(Serialize)]
struct Loaded {
    json: String,
    media: Vec<MediaFile>,
}

// Nur einfache Namen unter media/ zulassen, damit niemand aus dem Container herausschreibt.
fn is_safe_media_name(name: &str) -> bool {
    name.starts_with(MEDIA_DIR) && !name.contains("..") && !name.contains('\\') && name.len() > MEDIA_DIR.len()
}

#[tauri::command]
fn save_presentation(path: String, json: String, media: Vec<MediaFile>) -> Result<(), String> {
    // Erst in eine Nachbardatei schreiben und dann umbenennen,
    // damit ein Absturz nie eine halb geschriebene Präsentation hinterlässt.
    let tmp = format!("{path}.tmp");
    let file = File::create(&tmp).map_err(|e| format!("Datei kann nicht angelegt werden: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let deflated = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    // Bilder sind schon komprimiert, nochmal packen kostet nur Zeit.
    let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

    zip.start_file(PRESENTATION_ENTRY, deflated).map_err(|e| e.to_string())?;
    zip.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    for m in media {
        if !is_safe_media_name(&m.name) {
            return Err(format!("Ungültiger Medienname: {}", m.name));
        }
        let bytes = STANDARD.decode(m.data).map_err(|e| e.to_string())?;
        zip.start_file(m.name, stored).map_err(|e| e.to_string())?;
        zip.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Speichern fehlgeschlagen: {e}"))
}

#[tauri::command]
fn open_presentation(path: String) -> Result<Loaded, String> {
    let file = File::open(&path).map_err(|e| format!("Datei kann nicht geöffnet werden: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "Das ist keine Weitblick-Datei.".to_string())?;
    let mut json = String::new();
    let mut media = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if name == PRESENTATION_ENTRY {
            entry.read_to_string(&mut json).map_err(|e| e.to_string())?;
        } else if entry.is_file() && is_safe_media_name(&name) {
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
            media.push(MediaFile { name, data: STANDARD.encode(bytes) });
        }
    }
    if json.is_empty() {
        return Err("In der Datei fehlt presentation.json.".to_string());
    }
    Ok(Loaded { json, media })
}

// Liest eine Bilddatei von der Festplatte, damit die Oberfläche sie einbetten kann.
#[tauri::command]
fn import_media(path: String) -> Result<MediaFile, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Bild kann nicht gelesen werden: {e}"))?;
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(MediaFile { name, data: STANDARD.encode(bytes) })
}

// Wurde die App per Doppelklick auf eine .weitblick-Datei gestartet, steht deren Pfad in den Argumenten.
#[tauri::command]
fn startup_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| a.to_lowercase().ends_with(".weitblick") && std::path::Path::new(a).is_file())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_presentation,
            open_presentation,
            import_media,
            startup_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
