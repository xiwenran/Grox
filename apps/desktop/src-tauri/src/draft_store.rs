//! 未发送草稿的 Host 权威仓储。
//!
//! 每个工作区保留一个草稿和单调 revision。删除只移除正文并推进 revision，
//! 因此页面刷新前排队的旧写入无法在发送成功后把草稿复活。

use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::{host_core::atomic_write_bounded_private, host_core::read_bounded_text};

const DRAFT_FILE_VERSION: u8 = 1;
const MAX_DRAFTS: usize = 32;
const MAX_TRACKED_WORKSPACES: usize = 512;
const MAX_ATTACHMENTS: usize = 32;
const MAX_TEXT_BYTES: usize = 1024 * 1024;
const MAX_ATTACHMENT_BODY_BYTES: usize = 48 * 1024 * 1024;
const MAX_FIELD_BYTES: usize = 4 * 1024;
pub(crate) const DRAFTS_MAX_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum DraftStoreError {
    Invalid(String),
    Conflict(String),
    Storage(String),
}

impl DraftStoreError {
    pub(crate) fn into_message(self) -> String {
        match self {
            Self::Invalid(message) | Self::Conflict(message) | Self::Storage(message) => message,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DraftAttachment {
    pub(crate) id: String,
    pub(crate) kind: String,
    pub(crate) name: String,
    pub(crate) mime: String,
    pub(crate) size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) data: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    body_ref: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AttachmentBody {
    text: Option<String>,
    data: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DraftRecord {
    pub(crate) cwd: String,
    pub(crate) text: String,
    pub(crate) attachments: Vec<DraftAttachment>,
    pub(crate) updated_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DraftSnapshot {
    pub(crate) revision: u64,
    pub(crate) draft: Option<DraftRecord>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DraftFile {
    version: u8,
    revisions: BTreeMap<String, u64>,
    entries: BTreeMap<String, DraftRecord>,
}

impl Default for DraftFile {
    fn default() -> Self {
        Self {
            version: DRAFT_FILE_VERSION,
            revisions: BTreeMap::new(),
            entries: BTreeMap::new(),
        }
    }
}

#[derive(Default)]
pub(crate) struct DraftStore {
    transaction: Mutex<()>,
}

impl DraftStore {
    pub(crate) fn read(
        &self,
        path: &Path,
        workspace: &str,
    ) -> Result<DraftSnapshot, DraftStoreError> {
        validate_workspace_key(workspace).map_err(DraftStoreError::Invalid)?;
        let _transaction = self.lock_transaction();
        let document = read_document(path).map_err(DraftStoreError::Storage)?;
        hydrated_snapshot(path, &document, workspace).map_err(DraftStoreError::Storage)
    }

    pub(crate) fn write(
        &self,
        path: &Path,
        workspace: &str,
        expected_revision: u64,
        text: String,
        attachments: Vec<DraftAttachment>,
    ) -> Result<DraftSnapshot, DraftStoreError> {
        validate_workspace_key(workspace).map_err(DraftStoreError::Invalid)?;
        let text = text.trim_end().to_string();
        if text.is_empty() && attachments.is_empty() {
            return self.delete(path, workspace, expected_revision);
        }
        validate_draft(&text, &attachments, true).map_err(DraftStoreError::Invalid)?;
        if attachments
            .iter()
            .any(|attachment| attachment.body_ref.is_some())
        {
            return Err(DraftStoreError::Invalid(
                "写入草稿需提供附件正文，不能指定存储引用".into(),
            ));
        }
        let _transaction = self.lock_transaction();
        let mut document = read_document(path).map_err(DraftStoreError::Storage)?;
        ensure_revision(&document, workspace, expected_revision)?;
        if !document.entries.contains_key(workspace) && document.entries.len() >= MAX_DRAFTS {
            return Err(DraftStoreError::Invalid(format!(
                "未发送草稿不能超过 {MAX_DRAFTS} 个工作区"
            )));
        }
        if !document.revisions.contains_key(workspace)
            && document.revisions.len() >= MAX_TRACKED_WORKSPACES
        {
            return Err(DraftStoreError::Storage(
                "草稿删除版本记录已满，请先导出诊断并清理应用数据".into(),
            ));
        }
        let revision = next_revision(expected_revision)?;
        let previous_bodies = body_references(&document);
        let attachments = externalize_bodies(path, attachments, &previous_bodies)
            .map_err(DraftStoreError::Storage)?;
        document.revisions.insert(workspace.to_string(), revision);
        document.entries.insert(
            workspace.to_string(),
            DraftRecord {
                cwd: workspace.to_string(),
                text,
                attachments,
                updated_at: now_ms(),
            },
        );
        if let Err(error) = write_document(path, &document) {
            cleanup_unreferenced_bodies(path, body_references(&document), &previous_bodies);
            return Err(DraftStoreError::Storage(error));
        }
        cleanup_unreferenced_bodies(path, previous_bodies, &body_references(&document));
        hydrated_snapshot(path, &document, workspace).map_err(DraftStoreError::Storage)
    }

    pub(crate) fn delete(
        &self,
        path: &Path,
        workspace: &str,
        expected_revision: u64,
    ) -> Result<DraftSnapshot, DraftStoreError> {
        validate_workspace_key(workspace).map_err(DraftStoreError::Invalid)?;
        let _transaction = self.lock_transaction();
        let mut document = read_document(path).map_err(DraftStoreError::Storage)?;
        ensure_revision(&document, workspace, expected_revision)?;
        if !document.revisions.contains_key(workspace)
            && document.revisions.len() >= MAX_TRACKED_WORKSPACES
        {
            return Err(DraftStoreError::Storage(
                "草稿删除版本记录已满，请先导出诊断并清理应用数据".into(),
            ));
        }
        let revision = next_revision(expected_revision)?;
        let previous_bodies = body_references(&document);
        document.revisions.insert(workspace.to_string(), revision);
        document.entries.remove(workspace);
        write_document(path, &document).map_err(DraftStoreError::Storage)?;
        cleanup_unreferenced_bodies(path, previous_bodies, &body_references(&document));
        Ok(DraftSnapshot {
            revision,
            draft: None,
        })
    }

    pub(crate) fn status(&self, path: &Path) -> Result<(usize, usize, u64), DraftStoreError> {
        let _transaction = self.lock_transaction();
        let document = read_document(path).map_err(DraftStoreError::Storage)?;
        let bytes = path.metadata().map(|value| value.len()).unwrap_or(0);
        Ok((document.entries.len(), document.revisions.len(), bytes))
    }

    fn lock_transaction(&self) -> std::sync::MutexGuard<'_, ()> {
        self.transaction
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

fn body_path(index: &Path, reference: &str) -> Result<std::path::PathBuf, String> {
    if reference.len() != 64
        || !reference
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("草稿附件引用无效".into());
    }
    // 测试文件和生产索引均使用各自专属的正文目录。
    let name = index
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("草稿索引路径无效")?;
    let directory = index.with_file_name(format!("{name}.attachments"));
    match std::fs::symlink_metadata(&directory) {
        Ok(metadata) if !metadata.is_dir() || metadata.file_type().is_symlink() => {
            return Err("草稿附件目录身份异常，已保留原文件".into());
        }
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error.to_string()),
        _ => {}
    }
    Ok(directory.join(format!("{reference}.json")))
}

fn externalize_bodies(
    index: &Path,
    mut attachments: Vec<DraftAttachment>,
    retained: &BTreeSet<String>,
) -> Result<Vec<DraftAttachment>, String> {
    use sha2::{Digest, Sha256};
    let mut written = BTreeSet::new();
    for attachment in &mut attachments {
        if attachment.text.is_none() && attachment.data.is_none() {
            continue;
        }
        let body = serde_json::to_string(&AttachmentBody {
            text: attachment.text.take(),
            data: attachment.data.take(),
        })
        .map_err(|error| error.to_string())?;
        let reference = format!("{:x}", Sha256::digest(body.as_bytes()));
        let result = body_path(index, &reference).and_then(|path| {
            atomic_write_bounded_private(&path, &body, MAX_ATTACHMENT_BODY_BYTES as u64 + 1024)
        });
        if let Err(error) = result {
            cleanup_unreferenced_bodies(index, written, retained);
            return Err(error);
        }
        written.insert(reference.clone());
        attachment.body_ref = Some(reference);
    }
    Ok(attachments)
}

fn hydrated_snapshot(
    index: &Path,
    document: &DraftFile,
    workspace: &str,
) -> Result<DraftSnapshot, String> {
    use sha2::{Digest, Sha256};
    let mut result = snapshot(document, workspace);
    if let Some(draft) = &mut result.draft {
        for attachment in &mut draft.attachments {
            if let Some(reference) = attachment.body_ref.take() {
                let body = read_bounded_text(
                    &body_path(index, &reference)?,
                    MAX_ATTACHMENT_BODY_BYTES as u64 + 1024,
                )
                .map_err(|error| format!("无法恢复附件 {}：{error}", attachment.name))?;
                if format!("{:x}", Sha256::digest(body.as_bytes())) != reference {
                    return Err(format!(
                        "附件 {} 的正文校验失败，保留草稿等待核对",
                        attachment.name
                    ));
                }
                let body: AttachmentBody = serde_json::from_str(&body)
                    .map_err(|error| format!("草稿附件正文无效：{error}"))?;
                attachment.text = body.text;
                attachment.data = body.data;
            }
        }
        validate_draft(&draft.text, &draft.attachments, true)?;
    }
    Ok(result)
}

fn body_references(document: &DraftFile) -> BTreeSet<String> {
    document
        .entries
        .values()
        .flat_map(|draft| {
            draft
                .attachments
                .iter()
                .filter_map(|attachment| attachment.body_ref.clone())
        })
        .collect()
}

fn cleanup_unreferenced_bodies(
    index: &Path,
    previous: BTreeSet<String>,
    retained: &BTreeSet<String>,
) {
    use sha2::{Digest, Sha256};
    for reference in previous.difference(retained) {
        let result = body_path(index, reference).and_then(|path| {
            let metadata = std::fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
            if !metadata.is_file() {
                return Err("附件正文文件身份异常，已保留".into());
            }
            let body = read_bounded_text(&path, MAX_ATTACHMENT_BODY_BYTES as u64 + 1024)?;
            if format!("{:x}", Sha256::digest(body.as_bytes())) != *reference {
                return Err("附件正文校验失败，已保留原文件".into());
            }
            std::fs::remove_file(path).map_err(|error| error.to_string())
        });
        if let Err(error) = result {
            tracing::warn!(target: "grox::draft", error = %error, "draft saved; obsolete attachment cleanup failed");
        }
    }
}

fn read_document(path: &Path) -> Result<DraftFile, String> {
    if !path.is_file() {
        return Ok(DraftFile::default());
    }
    let content = read_bounded_text(path, DRAFTS_MAX_BYTES)
        .map_err(|error| format!("无法读取草稿文件：{error}"))?;
    if content.trim().is_empty() {
        return Err("草稿文件为空，拒绝当作无草稿继续".into());
    }
    let document = serde_json::from_str::<DraftFile>(&content)
        .map_err(|error| format!("草稿文件不是有效 JSON：{error}"))?;
    validate_document(&document)?;
    Ok(document)
}

fn validate_document(document: &DraftFile) -> Result<(), String> {
    if document.version != DRAFT_FILE_VERSION {
        return Err(format!("不支持的草稿文件版本：{}", document.version));
    }
    if document.entries.len() > MAX_DRAFTS || document.revisions.len() > MAX_TRACKED_WORKSPACES {
        return Err("草稿文件超过条目限制".into());
    }
    for (workspace, record) in &document.entries {
        validate_workspace_key(workspace)?;
        if record.cwd != *workspace || !document.revisions.contains_key(workspace) {
            return Err(format!("草稿工作区身份不匹配：{workspace}"));
        }
        validate_draft(&record.text, &record.attachments, false)?;
    }
    if document.revisions.values().any(|revision| *revision == 0) {
        return Err("草稿 revision 必须大于 0".into());
    }
    Ok(())
}

fn write_document(path: &Path, document: &DraftFile) -> Result<(), String> {
    let content =
        serde_json::to_string(document).map_err(|error| format!("无法序列化草稿文件：{error}"))?;
    atomic_write_bounded_private(path, &content, DRAFTS_MAX_BYTES)
}

fn snapshot(document: &DraftFile, workspace: &str) -> DraftSnapshot {
    DraftSnapshot {
        revision: document.revisions.get(workspace).copied().unwrap_or(0),
        draft: document.entries.get(workspace).cloned(),
    }
}

fn ensure_revision(
    document: &DraftFile,
    workspace: &str,
    expected_revision: u64,
) -> Result<(), DraftStoreError> {
    let current = document.revisions.get(workspace).copied().unwrap_or(0);
    if current != expected_revision {
        return Err(DraftStoreError::Conflict(format!(
            "草稿写入冲突：磁盘版本 {current} 不等于提交基线 {expected_revision}"
        )));
    }
    Ok(())
}

fn next_revision(current: u64) -> Result<u64, DraftStoreError> {
    current
        .checked_add(1)
        .ok_or_else(|| DraftStoreError::Storage("草稿 revision 已耗尽".into()))
}

fn validate_workspace_key(workspace: &str) -> Result<(), String> {
    if workspace.trim().is_empty() || workspace.len() > MAX_FIELD_BYTES || workspace.contains('\0')
    {
        return Err("草稿工作区无效".into());
    }
    Ok(())
}

fn validate_draft(
    text: &str,
    attachments: &[DraftAttachment],
    require_body: bool,
) -> Result<(), String> {
    if text.len() > MAX_TEXT_BYTES {
        return Err("草稿正文不能超过 1 MB".into());
    }
    if attachments.len() > MAX_ATTACHMENTS {
        return Err(format!("草稿附件不能超过 {MAX_ATTACHMENTS} 个"));
    }
    let mut body_bytes = 0usize;
    for attachment in attachments {
        if let Some(reference) = &attachment.body_ref {
            body_path(Path::new("drafts.json"), reference)?;
            if attachment.text.is_some() || attachment.data.is_some() {
                return Err("草稿附件正文与存储引用不能同时存在".into());
            }
        }
        if attachment.id.is_empty()
            || attachment.id.len() > MAX_FIELD_BYTES
            || attachment.name.is_empty()
            || attachment.name.len() > MAX_FIELD_BYTES
            || attachment.mime.is_empty()
            || attachment.mime.len() > MAX_FIELD_BYTES
            || !matches!(attachment.kind.as_str(), "image" | "text" | "binary")
        {
            return Err("草稿包含无效附件元数据".into());
        }
        if require_body && attachment.body_ref.is_none() {
            let missing = match attachment.kind.as_str() {
                "image" => attachment.data.as_ref().map_or(true, String::is_empty),
                "binary" => attachment.data.is_none(),
                "text" => attachment.text.is_none(),
                _ => true,
            };
            if missing {
                return Err(format!(
                    "附件 {} 缺少正文，请重新选择文件；原草稿已保留",
                    attachment.name
                ));
            }
        }
        body_bytes = body_bytes
            .saturating_add(attachment.text.as_ref().map(String::len).unwrap_or(0))
            .saturating_add(attachment.data.as_ref().map(String::len).unwrap_or(0));
    }
    if body_bytes > MAX_ATTACHMENT_BODY_BYTES {
        return Err("草稿附件正文不能超过 48 MiB".into());
    }
    Ok(())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::*;

    fn temp_file(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "grox-drafts-{label}-{}-{}.json",
            std::process::id(),
            now_ms()
        ))
    }

    fn attachment() -> DraftAttachment {
        DraftAttachment {
            id: "a1".into(),
            kind: "text".into(),
            name: "notes.txt".into(),
            mime: "text/plain".into(),
            size: 4,
            text: Some("body".into()),
            data: None,
            body_ref: None,
        }
    }

    #[test]
    fn revision_tombstone_rejects_late_write() {
        let path = temp_file("tombstone");
        let store = DraftStore::default();
        let saved = store
            .write(&path, "/repo", 0, "hello".into(), vec![attachment()])
            .unwrap();
        assert_eq!(saved.revision, 1);
        let deleted = store.delete(&path, "/repo", 1).unwrap();
        assert_eq!(deleted.revision, 2);
        assert!(matches!(
            store
                .write(&path, "/repo", 1, "late".into(), vec![])
                .unwrap_err(),
            DraftStoreError::Conflict(_)
        ));
        assert_eq!(store.read(&path, "/repo").unwrap(), deleted);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn explicit_new_write_can_advance_a_tombstone() {
        let path = temp_file("rewrite");
        let store = DraftStore::default();
        let deleted = store.delete(&path, "/repo", 0).unwrap();
        let saved = store
            .write(&path, "/repo", deleted.revision, "next".into(), vec![])
            .unwrap();
        assert_eq!(saved.revision, 2);
        assert_eq!(saved.draft.unwrap().text, "next");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn corrupt_existing_file_fails_closed_without_rewrite() {
        let path = temp_file("corrupt");
        fs::write(&path, "not-json").unwrap();
        let store = DraftStore::default();
        match store
            .write(&path, "/repo", 0, "new".into(), vec![])
            .unwrap_err()
        {
            DraftStoreError::Storage(message) => assert!(message.contains("不是有效 JSON")),
            error => panic!("expected storage error, got {error:?}"),
        }
        assert_eq!(fs::read_to_string(&path).unwrap(), "not-json");
        let _ = fs::remove_file(path);
    }

    #[cfg(unix)]
    #[test]
    fn draft_file_is_private_at_creation() {
        use std::os::unix::fs::PermissionsExt as _;

        let path = temp_file("mode");
        DraftStore::default()
            .write(&path, "/repo", 0, "private".into(), vec![])
            .unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let _ = fs::remove_file(path);
    }
    #[test]
    fn large_bodies_survive_restart_without_bloating_index() {
        let path = temp_file("large");
        let mut image = attachment();
        image.kind = "image".into();
        image.mime = "image/png".into();
        image.text = None;
        image.data = Some("A".repeat(2_000_000));
        let saved = DraftStore::default()
            .write(&path, "/repo", 0, "look".into(), vec![image.clone(), image])
            .unwrap();
        assert!(fs::metadata(&path).unwrap().len() < 4096);
        assert_eq!(DraftStore::default().read(&path, "/repo").unwrap(), saved);
        assert!(saved
            .draft
            .unwrap()
            .attachments
            .iter()
            .all(|a| a.data.as_ref().unwrap().len() == 2_000_000 && a.body_ref.is_none()));
        DraftStore::default().delete(&path, "/repo", 1).unwrap();
        let directory = path.with_file_name(format!(
            "{}.attachments",
            path.file_name().unwrap().to_str().unwrap()
        ));
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);
        fs::remove_dir(directory).unwrap();
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn shared_body_is_retained_until_last_reference_is_deleted() {
        let path = temp_file("shared");
        let store = DraftStore::default();
        store
            .write(&path, "/a", 0, "a".into(), vec![attachment()])
            .unwrap();
        store
            .write(&path, "/b", 0, "b".into(), vec![attachment()])
            .unwrap();
        let document = read_document(&path).unwrap();
        let reference = body_references(&document).into_iter().next().unwrap();
        let body = body_path(&path, &reference).unwrap();
        store.delete(&path, "/a", 1).unwrap();
        assert!(body.is_file());
        assert_eq!(
            store.read(&path, "/b").unwrap().draft.unwrap().attachments[0]
                .text
                .as_deref(),
            Some("body")
        );
        store.delete(&path, "/b", 1).unwrap();
        assert!(!body.exists());
        fs::remove_dir(body.parent().unwrap()).unwrap();
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn missing_or_corrupt_body_is_explicit_and_keeps_index() {
        let path = temp_file("missing");
        let store = DraftStore::default();
        store
            .write(&path, "/repo", 0, "a".into(), vec![attachment()])
            .unwrap();
        let index = fs::read(&path).unwrap();
        let reference = body_references(&read_document(&path).unwrap())
            .into_iter()
            .next()
            .unwrap();
        let body = body_path(&path, &reference).unwrap();
        fs::write(&body, "tampered").unwrap();
        assert!(matches!(
            store.read(&path, "/repo"),
            Err(DraftStoreError::Storage(_))
        ));
        assert_eq!(fs::read(&path).unwrap(), index);
        // Cleanup preserves bytes that no longer match their content address.
        store.delete(&path, "/repo", 1).unwrap();
        assert_eq!(fs::read_to_string(&body).unwrap(), "tampered");
        fs::remove_file(&body).unwrap();
        store
            .write(&path, "/repo", 2, "b".into(), vec![attachment()])
            .unwrap();
        fs::remove_file(&body).unwrap();
        assert!(matches!(
            store.read(&path, "/repo"),
            Err(DraftStoreError::Storage(_))
        ));
        fs::remove_dir(body.parent().unwrap()).unwrap();
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn inline_legacy_body_is_read_and_input_references_are_rejected() {
        let path = temp_file("legacy");
        let mut document = DraftFile::default();
        document.revisions.insert("/repo".into(), 1);
        document.entries.insert(
            "/repo".into(),
            DraftRecord {
                cwd: "/repo".into(),
                text: "old".into(),
                attachments: vec![attachment()],
                updated_at: 1,
            },
        );
        write_document(&path, &document).unwrap();
        let store = DraftStore::default();
        assert_eq!(
            store
                .read(&path, "/repo")
                .unwrap()
                .draft
                .unwrap()
                .attachments[0],
            attachment()
        );
        let mut forged = attachment();
        forged.text = None;
        forged.body_ref = Some("a".repeat(64));
        assert!(matches!(
            store.write(&path, "/repo", 1, "forged".into(), vec![forged]),
            Err(DraftStoreError::Invalid(_))
        ));
        assert!(matches!(
            store.write(&path, "/repo", 0, "late".into(), vec![attachment()]),
            Err(DraftStoreError::Conflict(_))
        ));
        assert!(!path
            .with_file_name(format!(
                "{}.attachments",
                path.file_name().unwrap().to_str().unwrap()
            ))
            .exists());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn legacy_metadata_only_attachment_fails_without_rewriting() {
        let path = temp_file("metadata-only");
        let mut missing = attachment();
        missing.text = None;
        let mut document = DraftFile::default();
        document.revisions.insert("/repo".into(), 1);
        document.entries.insert(
            "/repo".into(),
            DraftRecord {
                cwd: "/repo".into(),
                text: "old".into(),
                attachments: vec![missing.clone()],
                updated_at: 1,
            },
        );
        write_document(&path, &document).unwrap();
        let index = fs::read(&path).unwrap();
        assert!(DraftStore::default()
            .read(&path, "/repo")
            .unwrap_err()
            .into_message()
            .contains("缺少正文"));
        assert!(matches!(
            DraftStore::default().write(&path, "/repo", 1, "new".into(), vec![missing]),
            Err(DraftStoreError::Invalid(_))
        ));
        assert_eq!(fs::read(&path).unwrap(), index);
        // One old damaged draft must not block other workspaces or explicit deletion.
        assert!(DraftStore::default()
            .read(&path, "/other")
            .unwrap()
            .draft
            .is_none());
        DraftStore::default().delete(&path, "/repo", 1).unwrap();
        fs::remove_file(path).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn body_directory_symlink_is_never_read_written_or_cleaned() {
        let path = temp_file("symlink");
        let outside = path.with_extension("outside");
        fs::create_dir(&outside).unwrap();
        let directory = path.with_file_name(format!(
            "{}.attachments",
            path.file_name().unwrap().to_str().unwrap()
        ));
        std::os::unix::fs::symlink(&outside, &directory).unwrap();
        assert!(DraftStore::default()
            .write(&path, "/repo", 0, "a".into(), vec![attachment()])
            .is_err());
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
        fs::remove_file(directory).unwrap();
        fs::remove_dir(outside).unwrap();
    }
}
