//! Resolve local image references that appear in assistant Markdown.
//!
//! The grok CLI shows pictures to the operator by writing them into the
//! session folder (`~/.grok/sessions/<cwd>/<session>/images/1.jpg`) and
//! emitting a session-relative Markdown image such as `![拼读](images/1.jpg)`.
//! Agents also link absolute paths or `file://` URLs. The webview can load none
//! of these directly, so the frontend asks the host to map each reference to a
//! real file, which is then granted to the asset protocol one file at a time.

use std::path::{Component, Path, PathBuf};

const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "heic", "heif", "tif", "tiff", "ico",
];
const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_SOURCES_PER_CALL: usize = 64;

fn is_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| IMAGE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn percent_decoded(raw: &str) -> Option<String> {
    if !raw.contains('%') {
        return None;
    }
    percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .ok()
        .map(|value| value.into_owned())
        .filter(|value| value != raw)
}

/// Candidate files for one Markdown image source, most specific first.
/// Remote and inline sources (http, https, data, blob, asset) return nothing:
/// the webview loads those itself.
pub fn candidate_paths(
    source: &str,
    cwd: Option<&Path>,
    cli_session_dir: Option<&Path>,
    home: Option<&Path>,
) -> Vec<PathBuf> {
    let source = source.trim();
    if source.is_empty() || source.len() > 4096 {
        return Vec::new();
    }
    // Strip any query or fragment; local files never carry them meaningfully.
    let lowered = source.to_ascii_lowercase();
    let mut raw = if lowered.starts_with("file://") {
        let rest = &source["file://".len()..];
        // file://localhost/Users/... and file:///Users/...
        let rest = rest.strip_prefix("localhost").unwrap_or(rest);
        rest.to_string()
    } else if lowered.contains("://") || lowered.starts_with("data:") || lowered.starts_with("blob:") {
        return Vec::new();
    } else {
        source.to_string()
    };
    if let Some(index) = raw.find(['?', '#']) {
        raw.truncate(index);
    }
    let mut spellings = vec![raw.clone()];
    if let Some(decoded) = percent_decoded(&raw) {
        spellings.push(decoded);
    }

    let mut candidates = Vec::new();
    for spelling in spellings {
        let spelling = spelling.as_str();
        if let Some(rest) = spelling.strip_prefix("~/") {
            if let Some(home) = home {
                candidates.push(home.join(rest));
            }
            continue;
        }
        let path = Path::new(spelling);
        if path.is_absolute() {
            candidates.push(path.to_path_buf());
            continue;
        }
        let relative = spelling.trim_start_matches("./");
        if relative.is_empty() {
            continue;
        }
        let relative = Path::new(relative);
        // Session folder lookups never climb out of the session folder.
        let climbs = relative.components().any(|part| matches!(part, Component::ParentDir));
        if let Some(dir) = cli_session_dir {
            if !climbs {
                candidates.push(dir.join(relative));
            }
        }
        if let Some(cwd) = cwd {
            candidates.push(cwd.join(relative));
        }
    }
    candidates
}

/// First candidate that is an existing, reasonably sized image file.
pub fn resolve_image(
    source: &str,
    cwd: Option<&Path>,
    cli_session_dir: Option<&Path>,
    home: Option<&Path>,
) -> Option<PathBuf> {
    candidate_paths(source, cwd, cli_session_dir, home)
        .into_iter()
        .filter(|path| is_image_path(path))
        .filter_map(|path| std::fs::canonicalize(path).ok())
        .find(|path| {
            is_image_path(path)
                && std::fs::metadata(path)
                    .map(|meta| meta.is_file() && meta.len() <= MAX_IMAGE_BYTES)
                    .unwrap_or(false)
        })
}

/// The CLI keeps each session under `<grok_home>/sessions/<encoded cwd>/<id>`.
/// The encoding is an implementation detail of the CLI, so look the id up
/// across the project folders instead of re-deriving it.
pub fn find_cli_session_dir(grok_home: &Path, session_id: &str) -> Option<PathBuf> {
    let sessions = grok_home.join("sessions");
    let entries = std::fs::read_dir(&sessions).ok()?;
    entries
        .filter_map(Result::ok)
        .map(|entry| entry.path().join(session_id))
        .find(|path| path.is_dir())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "grox-md-images-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn remote_and_inline_sources_are_left_to_the_webview() {
        for source in ["https://x.ai/a.png", "http://127.0.0.1:3000/a.png", "data:image/png;base64,AA", "blob:abc", "asset://localhost/a.png"] {
            assert!(candidate_paths(source, Some(Path::new("/tmp")), None, None).is_empty(), "{source}");
        }
    }

    #[test]
    fn session_relative_images_resolve_inside_the_cli_session_folder_first() {
        let root = temp_dir();
        let grok_home = root.join("grok");
        let session = grok_home.join("sessions").join("%2FUsers%2Fxili%2Fteacher").join("sess-1");
        fs::create_dir_all(session.join("images")).unwrap();
        fs::write(session.join("images").join("1.jpg"), b"jpg").unwrap();
        let cwd = root.join("project");
        fs::create_dir_all(cwd.join("images")).unwrap();
        fs::write(cwd.join("images").join("1.jpg"), b"other").unwrap();

        let dir = find_cli_session_dir(&grok_home, "sess-1").expect("session dir");
        let resolved = resolve_image("images/1.jpg", Some(&cwd), Some(&dir), None).unwrap();
        assert_eq!(resolved, fs::canonicalize(session.join("images/1.jpg")).unwrap());
        // Falls back to the working directory when the session has no such file.
        fs::write(cwd.join("images").join("2.png"), b"png").unwrap();
        let resolved = resolve_image("./images/2.png", Some(&cwd), Some(&dir), None).unwrap();
        assert_eq!(resolved, fs::canonicalize(cwd.join("images/2.png")).unwrap());
        assert!(find_cli_session_dir(&grok_home, "missing").is_none());
    }

    #[test]
    fn absolute_file_url_and_home_paths_resolve() {
        let root = temp_dir();
        let dir = root.join("build sample");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("tone-ai.png");
        fs::write(&file, b"png").unwrap();
        let expected = fs::canonicalize(&file).unwrap();
        let absolute = file.to_string_lossy().to_string();
        assert_eq!(resolve_image(&absolute, None, None, None), Some(expected.clone()));
        let url = format!("file://{}", absolute.replace(' ', "%20"));
        assert_eq!(resolve_image(&url, None, None, None), Some(expected.clone()));
        assert_eq!(resolve_image("~/build sample/tone-ai.png", None, None, Some(&root)), Some(expected));
    }

    #[test]
    fn non_images_missing_files_and_session_escapes_are_rejected() {
        let root = temp_dir();
        let session = root.join("session");
        fs::create_dir_all(&session).unwrap();
        fs::write(root.join("secret.txt"), b"x").unwrap();
        fs::write(root.join("outside.png"), b"x").unwrap();
        assert!(resolve_image(&root.join("secret.txt").to_string_lossy(), None, None, None).is_none());
        assert!(resolve_image("nope.png", Some(&root), Some(&session), None).is_none());
        assert!(resolve_image("../outside.png", None, Some(&session), None).is_none());
    }
}
