//! 确认与执行共用已解析的推送目标，不修改现有上游跟踪配置。
use crate::host_core::{git_command, git_text};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct PushTarget {
    pub(crate) branch: String,
    pub(crate) remote: String,
    pub(crate) remote_ref: String,
    pub(crate) url: String,
    pub(crate) commit: String,
    pub(crate) tracking_ref: Option<String>,
}

impl PushTarget {
    pub(crate) fn binding(&self) -> Result<String, String> {
        serde_json::to_string(self).map_err(|error| error.to_string())
    }
    pub(crate) fn description(&self) -> String {
        let address = match url::Url::parse(&self.url) {
            Ok(mut value) => {
                let _ = value.set_username("");
                let _ = value.set_password(None);
                value.to_string()
            }
            Err(_) => self.url.clone(),
        };
        format!(
            "确认推送当前分支 {} 到 {} 的 {}？\n{}\n提交：{}",
            self.branch, self.remote, self.remote_ref, address, self.commit
        )
    }
}

pub(crate) fn resolve_push_target(root: &Path) -> Result<PushTarget, String> {
    let branch = git_text(root, &["branch", "--show-current"])?;
    if branch.is_empty() {
        return Err("当前处于 detached HEAD，无法直接推送".into());
    }
    let config = |key: &str| -> Result<String, String> {
        let output = git_command(root, &["config", "--get", key])?;
        if output.status.code() == Some(1) && output.stderr.is_empty() {
            return Err("当前分支没有配置上游，请先明确设置要推送的远端和分支".into());
        }
        if !output.status.success() {
            return Err(format!(
                "无法读取 Git 跟踪配置：{}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    };
    let remote = config(&format!("branch.{branch}.remote"))?;
    let remote_ref = config(&format!("branch.{branch}.merge"))?;
    if remote.is_empty()
        || remote == "."
        || remote.starts_with('-')
        || remote.chars().any(char::is_control)
        || !remote_ref.starts_with("refs/heads/")
    {
        return Err("上游不是可推送的远端分支，请先核对跟踪配置".into());
    }
    git_text(root, &["check-ref-format", &remote_ref])?;
    let urls = git_text(root, &["remote", "get-url", "--push", "--all", &remote])?;
    if urls.lines().count() != 1 || urls.is_empty() || urls.chars().any(char::is_control) {
        return Err("远端推送地址不唯一或无效，请先明确唯一目标".into());
    }
    let commit = git_text(root, &["rev-parse", "--verify", "HEAD"])?;
    let tracking = git_text(
        root,
        &[
            "for-each-ref",
            "--format=%(upstream)",
            &format!("refs/heads/{branch}"),
        ],
    )?;
    let tracking_ref = if tracking.starts_with("refs/remotes/") && !tracking.contains('\n') {
        Some(tracking)
    } else {
        None
    };
    Ok(PushTarget {
        branch,
        remote,
        remote_ref,
        url: urls,
        commit,
        tracking_ref,
    })
}

// A private, one-use remote makes Git apply exactly one alias to the pinned
// URL. Explicit pushurl skips pushInsteadOf, and insteadOf is not recursive.
// Process-only configuration preserves authentication without changing files.
fn push_pinned_url(root: &Path, target: &PushTarget) -> Result<(), String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| format!("无法固定推送目标：{error}"))?;
    let nonce: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    let remote = format!("grox-confirmed-{nonce}");
    let alias = format!("grox-confirmed://{nonce}/");
    let count = match std::env::var("GIT_CONFIG_COUNT") {
        Ok(value) => value
            .parse::<usize>()
            .map_err(|_| "GIT_CONFIG_COUNT 无效，未执行推送")?,
        Err(std::env::VarError::NotPresent) => 0,
        Err(_) => return Err("GIT_CONFIG_COUNT 编码无效，未执行推送".into()),
    };
    let total = count.checked_add(3).ok_or("Git 进程配置数量无效")?;
    let mut command = std::process::Command::new("git");
    command
        .current_dir(root)
        .args([
            "push",
            "--",
            &remote,
            &format!("{}:{}", target.commit, target.remote_ref),
        ])
        .env("GIT_CONFIG_COUNT", total.to_string());
    for (offset, key) in [
        format!("remote.{remote}.url"),
        format!("remote.{remote}.pushurl"),
        format!("url.{}.insteadOf", target.url),
    ]
    .iter()
    .enumerate()
    {
        command
            .env(format!("GIT_CONFIG_KEY_{}", count + offset), key)
            .env(format!("GIT_CONFIG_VALUE_{}", count + offset), &alias);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        command.creation_flags(0x0800_0000);
    }
    let output = command
        .output()
        .map_err(|error| format!("无法运行 Git：{error}"))?;
    if !output.status.success() {
        return Err(format!(
            "推送失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

pub(crate) fn push_confirmed_target(root: &Path, target: &PushTarget) -> Result<String, String> {
    let previous = if let Some(reference) = &target.tracking_ref {
        let output = git_command(root, &["rev-parse", "--verify", "--quiet", reference])?;
        if output.status.success() {
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        } else if output.status.code() == Some(1) {
            "0".repeat(target.commit.len())
        } else {
            return Err("无法读取本地远端跟踪记录，未执行推送".into());
        }
    } else {
        String::new()
    };
    // Confirmed URL and commit remain fixed even if HEAD or remote changes.
    push_pinned_url(root, target)?;
    // URL pushes do not refresh remote-tracking refs. Update only the confirmed
    // ref, using compare-and-swap to preserve concurrent fetch results.
    if let Some(reference) = &target.tracking_ref {
        if resolve_push_target(root).as_ref() != Ok(target) {
            return Ok("已推送；本地配置或提交已变化，未更新跟踪记录，请刷新 Git 状态".into());
        }
        if git_text(root, &["update-ref", reference, &target.commit, &previous]).is_err() {
            return Ok("已推送；本地跟踪记录发生变化，未覆盖，请刷新 Git 状态".into());
        }
    }
    Ok("已推送到已确认的上游分支".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git_confirm::GitConfirmStore;
    use std::{fs, path::PathBuf, process::Command};

    struct Repository {
        base: PathBuf,
        root: PathBuf,
        own: PathBuf,
        other: PathBuf,
    }
    impl Repository {
        fn new() -> Self {
            let base = std::env::temp_dir().join(format!(
                "grox-push-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir(&base).unwrap();
            let root = base.join("work");
            let own = base.join("own.git");
            let other = base.join("other.git");
            for path in [&own, &other] {
                git_text(&base, &["init", "--bare", path.to_str().unwrap()]).unwrap();
            }
            git_text(
                &base,
                &["init", "--initial-branch=main", root.to_str().unwrap()],
            )
            .unwrap();
            git_text(
                &root,
                &[
                    "config",
                    "core.hooksPath",
                    base.join("no-hooks").to_str().unwrap(),
                ],
            )
            .unwrap();
            git_text(&root, &["remote", "add", "origin", other.to_str().unwrap()]).unwrap();
            git_text(&root, &["remote", "add", "my", own.to_str().unwrap()]).unwrap();
            git_text(&root, &["config", "branch.main.remote", "my"]).unwrap();
            git_text(&root, &["config", "branch.main.merge", "refs/heads/review"]).unwrap();
            let repo = Self {
                base,
                root,
                own,
                other,
            };
            repo.advance("first");
            repo
        }
        fn advance(&self, message: &str) {
            let tree = git_text(&self.root, &["mktree"]).unwrap();
            let mut args = vec!["commit-tree", tree.as_str(), "-m", message];
            let parent = git_text(&self.root, &["rev-parse", "--verify", "HEAD"]).ok();
            if let Some(parent) = &parent {
                args.extend(["-p", parent]);
            }
            let output = Command::new("git")
                .current_dir(&self.root)
                .args(args)
                .env("GIT_AUTHOR_NAME", "Grox test")
                .env("GIT_AUTHOR_EMAIL", "test@example.invalid")
                .env("GIT_COMMITTER_NAME", "Grox test")
                .env("GIT_COMMITTER_EMAIL", "test@example.invalid")
                .output()
                .unwrap();
            assert!(output.status.success());
            let commit = String::from_utf8(output.stdout).unwrap();
            git_text(&self.root, &["update-ref", "HEAD", commit.trim()]).unwrap();
        }
    }
    impl Drop for Repository {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.base);
        }
    }

    #[test]
    fn push_uses_existing_upstream_without_rewriting_tracking() {
        let repo = Repository::new();
        let target = resolve_push_target(&repo.root).unwrap();
        assert_eq!(target.remote, "my");
        assert_eq!(target.remote_ref, "refs/heads/review");
        push_confirmed_target(&repo.root, &target).unwrap();
        assert_eq!(
            git_text(&repo.own, &["rev-parse", "refs/heads/review"]).unwrap(),
            target.commit
        );
        assert!(git_text(&repo.other, &["rev-parse", "--verify", "refs/heads/main"]).is_err());
        assert_eq!(
            git_text(&repo.root, &["config", "branch.main.remote"]).unwrap(),
            "my"
        );
        assert_eq!(
            git_text(&repo.root, &["config", "branch.main.merge"]).unwrap(),
            "refs/heads/review"
        );
        assert_eq!(
            git_text(&repo.root, &["rev-parse", "refs/remotes/my/review"]).unwrap(),
            target.commit
        );
    }

    #[test]
    fn confirmation_cannot_switch_address_branch_or_commit() {
        let repo = Repository::new();
        let confirms = GitConfirmStore::default();
        let original = resolve_push_target(&repo.root).unwrap();
        let token = confirms
            .issue_push("repo", &original.binding().unwrap())
            .unwrap();
        git_text(
            &repo.root,
            &["remote", "set-url", "my", repo.other.to_str().unwrap()],
        )
        .unwrap();
        let changed = resolve_push_target(&repo.root).unwrap();
        assert!(confirms
            .consume_push("repo", &changed.binding().unwrap(), &token)
            .is_err());
        git_text(
            &repo.root,
            &["remote", "set-url", "my", repo.own.to_str().unwrap()],
        )
        .unwrap();
        git_text(
            &repo.root,
            &["config", "branch.main.merge", "refs/heads/changed"],
        )
        .unwrap();
        assert!(confirms
            .consume_push(
                "repo",
                &resolve_push_target(&repo.root).unwrap().binding().unwrap(),
                &token
            )
            .is_err());
        git_text(
            &repo.root,
            &["config", "branch.main.merge", "refs/heads/review"],
        )
        .unwrap();
        repo.advance("second");
        assert!(confirms
            .consume_push(
                "repo",
                &resolve_push_target(&repo.root).unwrap().binding().unwrap(),
                &token
            )
            .is_err());
        // Already-confirmed execution can only send the exact original commit.
        push_confirmed_target(&repo.root, &original).unwrap();
        assert_eq!(
            git_text(&repo.own, &["rev-parse", "refs/heads/review"]).unwrap(),
            original.commit
        );
    }

    #[test]
    fn ambiguous_or_missing_upstream_is_explicit() {
        let repo = Repository::new();
        git_text(
            &repo.root,
            &[
                "remote",
                "set-url",
                "--add",
                "--push",
                "my",
                repo.own.to_str().unwrap(),
            ],
        )
        .unwrap();
        git_text(
            &repo.root,
            &[
                "remote",
                "set-url",
                "--add",
                "--push",
                "my",
                repo.other.to_str().unwrap(),
            ],
        )
        .unwrap();
        assert!(resolve_push_target(&repo.root)
            .unwrap_err()
            .contains("不唯一"));
        git_text(&repo.root, &["config", "--unset", "branch.main.remote"]).unwrap();
        assert!(resolve_push_target(&repo.root)
            .unwrap_err()
            .contains("没有配置上游"));
    }

    #[test]
    fn chained_and_late_rewrites_cannot_redirect_confirmed_push() {
        let repo = Repository::new();
        let target = resolve_push_target(&repo.root).unwrap();
        let original = repo.base.join("original.git");
        git_text(
            &repo.root,
            &["remote", "set-url", "my", original.to_str().unwrap()],
        )
        .unwrap();
        git_text(
            &repo.root,
            &[
                "config",
                &format!("url.{}.insteadOf", repo.own.display()),
                original.to_str().unwrap(),
            ],
        )
        .unwrap();
        assert_eq!(resolve_push_target(&repo.root).unwrap().url, target.url);
        // These rewrites are added after target confirmation. Neither may
        // redirect the already-confirmed URL in the actual push process.
        git_text(
            &repo.root,
            &[
                "config",
                &format!("url.{}.insteadOf", repo.other.display()),
                repo.own.to_str().unwrap(),
            ],
        )
        .unwrap();
        git_text(
            &repo.root,
            &[
                "config",
                &format!("url.{}.pushInsteadOf", repo.other.display()),
                repo.own.to_str().unwrap(),
            ],
        )
        .unwrap();
        git_text(
            &repo.root,
            &[
                "config",
                "--add",
                &format!("url.{}.insteadOf", repo.other.display()),
                "grox-confirmed://",
            ],
        )
        .unwrap();
        push_confirmed_target(&repo.root, &target).unwrap();
        assert_eq!(
            git_text(&repo.own, &["rev-parse", "refs/heads/review"]).unwrap(),
            target.commit
        );
        assert!(git_text(&repo.other, &["rev-parse", "--verify", "refs/heads/review"]).is_err());
    }

    #[test]
    fn dialog_hides_url_credentials() {
        let target = PushTarget {
            branch: "main".into(),
            remote: "my".into(),
            remote_ref: "refs/heads/main".into(),
            url: "https://user:private@example.invalid/repo.git".into(),
            commit: "abc".into(),
            tracking_ref: None,
        };
        assert!(!target.description().contains("private"));
        assert!(!target.description().contains("user:"));
        assert!(target.description().contains("example.invalid/repo.git"));
    }
}
