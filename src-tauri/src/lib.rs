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

// Namen aller auf diesem Rechner installierten Schriftfamilien, sortiert.
#[tauri::command]
async fn system_fonts() -> Vec<String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let mut names: Vec<String> = db
        .faces()
        .filter_map(|f| f.families.first().map(|(name, _)| name.clone()))
        .filter(|n| !n.starts_with('.') && !n.is_empty())
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup();
    names
}

// Ein Schnitt einer Google-Schrift: Datei (woff2, Base64) plus die Angaben für @font-face.
#[derive(Serialize, Deserialize, Clone)]
struct FontFace {
    weight: String,
    style: String,
    range: String,
    data: String,
}

// Google liefert woff2 nur an moderne Browser aus, daher eine passende Kennung.
const FONT_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

fn css_value<'a>(block: &'a str, key: &str) -> Option<&'a str> {
    let start = block.find(key)? + key.len();
    let rest = &block[start..];
    Some(rest[..rest.find(';')?].trim())
}

// Lädt eine Schrift von Google Fonts (normal, fett, kursiv, fett-kursiv; nur lateinische Zeichen)
// und legt sie im App-Datenordner ab, damit sie später auch offline wieder verfügbar ist.
#[tauri::command]
async fn google_font(app: tauri::AppHandle, family: String) -> Result<Vec<FontFace>, String> {
    use tauri::Manager;
    let family = family.trim().to_string();
    if family.is_empty() || !family.chars().all(|c| c.is_alphanumeric() || c == ' ') {
        return Err("Ungültiger Schriftname.".into());
    }
    let cache_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("fonts");
    let cache_file = cache_dir.join(format!("{}.json", family.replace(' ', "_")));
    if let Ok(text) = std::fs::read_to_string(&cache_file) {
        if let Ok(faces) = serde_json::from_str::<Vec<FontFace>>(&text) {
            return Ok(faces);
        }
    }

    let name = family.replace(' ', "+");
    // Nicht jede Schrift hat alle Schnitte; dann mit weniger noch einmal versuchen.
    let variants = ["ital,wght@0,400;0,700;1,400;1,700", "wght@400;700", ""];
    let mut css = None;
    for v in variants {
        let spec = if v.is_empty() { name.clone() } else { format!("{name}:{v}") };
        let url = format!("https://fonts.googleapis.com/css2?family={spec}&display=swap");
        if let Ok(resp) = ureq::get(&url).set("User-Agent", FONT_UA).call() {
            css = resp.into_string().ok();
            break;
        }
    }
    let css = css.ok_or_else(|| format!("„{family}“ gibt es bei Google Fonts nicht, oder es besteht keine Internetverbindung."))?;

    let mut faces = Vec::new();
    // Jeder Block beginnt mit einem Kommentar wie /* latin */; nur lateinische Schnitte laden.
    for block in css.split("/* ").skip(1) {
        let subset = block.split(" */").next().unwrap_or("");
        if subset != "latin" && subset != "latin-ext" {
            continue;
        }
        let Some(src) = css_value(block, "src: url(").and_then(|s| s.split(')').next()) else {
            continue;
        };
        let bytes = ureq::get(src)
            .call()
            .map_err(|e| e.to_string())?
            .into_reader()
            .bytes()
            .collect::<Result<Vec<u8>, _>>()
            .map_err(|e| e.to_string())?;
        faces.push(FontFace {
            weight: css_value(block, "font-weight:").unwrap_or("400").to_string(),
            style: css_value(block, "font-style:").unwrap_or("normal").to_string(),
            range: css_value(block, "unicode-range:").unwrap_or("").to_string(),
            data: STANDARD.encode(bytes),
        });
    }
    if faces.is_empty() {
        return Err(format!("Für „{family}“ wurden keine passenden Schriftdateien gefunden."));
    }
    let _ = std::fs::create_dir_all(&cache_dir);
    let _ = std::fs::write(&cache_file, serde_json::to_string(&faces).unwrap_or_default());
    Ok(faces)
}

// Ein Eintrag in einem ZIP-Paket (z. B. PowerPoint): Text für XML-Teile, sonst Base64.
#[derive(Serialize, Deserialize)]
struct ZipEntry {
    name: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    data: Option<String>,
}

fn is_text_part(name: &str) -> bool {
    let n = name.to_lowercase();
    n.ends_with(".xml") || n.ends_with(".rels")
}

// Schreibt ein ZIP-Paket (für den PowerPoint-Export); erst in eine Nachbardatei, dann umbenennen.
#[tauri::command]
fn write_zip(path: String, entries: Vec<ZipEntry>) -> Result<(), String> {
    let tmp = format!("{path}.tmp");
    let file = File::create(&tmp).map_err(|e| format!("Datei kann nicht angelegt werden: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for e in entries {
        if e.name.contains("..") || e.name.starts_with('/') {
            return Err(format!("Ungültiger Name im Paket: {}", e.name));
        }
        let bytes = match (e.text, e.data) {
            (Some(t), _) => t.into_bytes(),
            (None, Some(d)) => STANDARD.decode(d).map_err(|e| e.to_string())?,
            _ => Vec::new(),
        };
        zip.start_file(e.name, options).map_err(|e| e.to_string())?;
        zip.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Speichern fehlgeschlagen: {e}"))
}

// Liest ein ZIP-Paket (für den PowerPoint-Import): XML als Text, alles andere als Base64.
#[tauri::command]
fn read_zip(path: String) -> Result<Vec<ZipEntry>, String> {
    let file = File::open(&path).map_err(|e| format!("Datei kann nicht geöffnet werden: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "Das ist keine gültige PowerPoint-Datei (.pptx).".to_string())?;
    let mut out = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        if !entry.is_file() {
            continue;
        }
        let name = entry.name().to_string();
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if is_text_part(&name) {
            out.push(ZipEntry { name, text: Some(String::from_utf8_lossy(&bytes).into_owned()), data: None });
        } else {
            out.push(ZipEntry { name, text: None, data: Some(STANDARD.encode(bytes)) });
        }
    }
    Ok(out)
}

// Eigene Stilkits gelten für alle Präsentationen und liegen deshalb im App-Datenordner.
fn style_kits_file(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("style-kits.json"))
}

#[tauri::command]
fn load_style_kits(app: tauri::AppHandle) -> Result<String, String> {
    Ok(std::fs::read_to_string(style_kits_file(&app)?).unwrap_or_else(|_| "[]".into()))
}

#[tauri::command]
fn save_style_kits(app: tauri::AppHandle, json: String) -> Result<(), String> {
    // Nur gültiges JSON schreiben, damit eine kaputte Datei nie alle Kits verliert.
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| e.to_string())?;
    let file = style_kits_file(&app)?;
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &file).map_err(|e| e.to_string())
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
            startup_file,
            system_fonts,
            google_font,
            load_style_kits,
            save_style_kits,
            write_zip,
            read_zip
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
