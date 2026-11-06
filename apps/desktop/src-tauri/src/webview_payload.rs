//! Prepare Host session events for the WebView and recover from content-process death.

use std::{fs, io::Write, path::PathBuf};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::path_sandbox::path_for_webview;
use crate::session_event_journal::HostSessionEvent;

const MIN_INLINE_IMAGE_BYTES: usize = 2_048;
const TOOL_IMAGE_MAX_BYTES: usize = 8 * 1024 * 1024;

fn safe_session_id(id: &str) -> Option<&str> {
    if id.is_empty()
        || id.len() > 80
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return None;
    }
    Some(id)
}

fn session_media_dir(app: &AppHandle, session_id: &str) -> Option<PathBuf> {
    let safe = safe_session_id(session_id)?;
    let dir = app
        .path()
        .app_config_dir()
        .ok()?
        .join("sessions")
        .join(safe)
        .join("media");
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn detect_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n']) {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(b"BM") {
        Some("image/bmp")
    } else {
        None
    }
}

fn persist_inline_image(app: &AppHandle, session_id: &str, mime: &str, data: &str) -> Option<String> {
    if data.len() < MIN_INLINE_IMAGE_BYTES {
        return None;
    }
    let bytes = BASE64.decode(data.as_bytes()).ok()?;
    if bytes.is_empty() || bytes.len() > TOOL_IMAGE_MAX_BYTES {
        return None;
    }
    let detected = detect_image_mime(&bytes)?;
    let declared_owned = mime.trim().to_ascii_lowercase();
    let declared = match declared_owned.as_str() {
        "" => detected,
        "image/jpg" => "image/jpeg",
        other => other,
    };
    if declared != detected {
        return None;
    }
    let extension = match detected {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        _ => return None,
    };
    let media_dir = session_media_dir(app, session_id)?;
    let name = format!("{:x}.{extension}", Sha256::digest(&bytes));
    let path = media_dir.join(name);
    if !path.is_file() {
        let mut file = fs::File::create(&path).ok()?;
        file.write_all(&bytes).ok()?;
    }
    let _ = app.asset_protocol_scope().allow_file(&path);
    Some(path_for_webview(&path))
}

pub(crate) fn prepare_host_session_event_for_webview(
    app: &AppHandle,
    mut event: HostSessionEvent,
) -> HostSessionEvent {
    event.sanitize_for_webview(|session_id, mime, data| {
        persist_inline_image(app, session_id, mime, data)
    });
    event
}

pub(crate) fn prepare_host_session_events_for_webview(
    app: &AppHandle,
    events: Vec<HostSessionEvent>,
) -> Vec<HostSessionEvent> {
    events
        .into_iter()
        .map(|event| prepare_host_session_event_for_webview(app, event))
        .collect()
}

pub(crate) fn install_webview_watchdog(app: AppHandle) {
    std::thread::Builder::new()
        .name("grox-webview-watch".into())
        .spawn(move || {
            let mut saw_alive = false;
            let mut recovering = false;
            loop {
                std::thread::sleep(std::time::Duration::from_secs(2));
                let Some(window) = app.get_webview_window("main") else {
                    continue;
                };
                match window.eval("window.__groxAlive = Date.now()") {
                    Ok(()) => {
                        saw_alive = true;
                        recovering = false;
                    }
                    Err(error) => {
                        if !saw_alive || recovering {
                            continue;
                        }
                        recovering = true;
                        tracing::warn!(
                            target: "grox::webview",
                            error = %error,
                            "main WebView became unresponsive; reloading"
                        );
                        let _ = app.emit(
                            "webview-memory-recovery",
                            json!({
                                "reason": "memory",
                                "message": "界面因内存过大已自动恢复",
                            }),
                        );
                        // Persist a one-shot flag the reloaded page can read.
                        let _ = app.emit(
                            "webview-memory-recovery-pending",
                            json!({ "reason": "memory" }),
                        );
                        if let Ok(config_dir) = app.path().app_config_dir() {
                            let marker = config_dir.join("webview-recovery.json");
                            let _ = fs::write(
                                &marker,
                                serde_json::to_vec(&json!({
                                    "reason": "memory",
                                    "at": chrono::Utc::now().timestamp_millis(),
                                }))
                                .unwrap_or_default(),
                            );
                        }
                        if let Err(reload_error) = window.reload() {
                            tracing::error!(
                                target: "grox::webview",
                                error = %reload_error,
                                "WebView reload failed after content-process loss"
                            );
                            recovering = false;
                        }
                    }
                }
            }
        })
        .ok();
}
