//! Host 到 WebView 的统一错误契约。
//!
//! 协议、操作和环境错误必须在原生边界完成分类；前端只负责展示，不能再根据
//! 中文或英文错误文本推断是否重试、暂停队列或要求用户修复环境。

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostError {
    pub(crate) domain: String,
    pub(crate) code: String,
    pub(crate) message: String,
    pub(crate) recoverable: bool,
    pub(crate) fatal: bool,
    pub(crate) hold_queue: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) action: Option<String>,
}

impl HostError {
    pub(crate) fn protocol(code: &'static str, message: impl Into<String>) -> Self {
        Self::protocol_with_action(
            code,
            message,
            "导出会话诊断并核对具体错误；确认最后一轮结果后再重试",
        )
    }

    /// 仅用于 CLI 明确标记为 API 失败的事件，HTTP 状态与 JSON-RPC 错误码分开。
    pub(crate) fn api(message: &str) -> Self {
        let (code, summary, action) = if message.contains("status 402") || message.contains("usage balance exhausted") {
            ("API_QUOTA_EXHAUSTED", "Grok Build 可用额度已耗尽", "在账户中检查可用额度或等待额度恢复后继续")
        } else if message.contains("status 401") || message.contains("status 403") {
            ("API_AUTH_FAILED", "模型服务认证失败或无访问权限", "检查当前账户和模型服务授权后继续")
        } else if message.contains("status 429") {
            ("API_RATE_LIMITED", "模型服务请求频率或用量受到限制", "等待限制解除，并检查账户额度后继续")
        } else if message.contains("status 413") {
            ("API_REQUEST_TOO_LARGE", "模型服务拒绝了过大的请求", "减少本轮附件或上下文后重试")
        } else {
            ("API_REQUEST_FAILED", "模型服务请求失败", "检查模型服务返回的详细信息后继续")
        };
        Self::environment(code, format!("{summary}：{}", message.chars().take(3_500).collect::<String>()), false, true, action)
    }

    pub(crate) fn request_too_large(bytes: usize, limit: usize) -> Self {
        Self::environment(
            "ATTACHMENT_MESSAGE_TOO_LARGE",
            format!("本条消息编码后为 {bytes} 字节，超过 Grox 的 {limit} 字节发送上限"),
            false, true, "减少本轮附件或文字后重试；图片原文件保留",
        )
    }

    pub(crate) fn protocol_with_action(
        code: &'static str,
        message: impl Into<String>,
        action: &'static str,
    ) -> Self {
        Self {
            domain: "protocol".into(),
            code: code.into(),
            message: message.into(),
            recoverable: true,
            fatal: false,
            hold_queue: false,
            action: Some(action.into()),
        }
    }

    pub(crate) fn operation(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            domain: "operation".into(),
            code: code.into(),
            message: message.into(),
            recoverable: true,
            fatal: false,
            hold_queue: false,
            action: None,
        }
    }

    pub(crate) fn environment(
        code: &'static str,
        message: impl Into<String>,
        fatal: bool,
        hold_queue: bool,
        action: &'static str,
    ) -> Self {
        Self {
            domain: "environment".into(),
            code: code.into(),
            message: message.into(),
            recoverable: true,
            fatal,
            hold_queue,
            action: Some(action.into()),
        }
    }

    pub(crate) fn recoverable_environment(
        code: &'static str,
        message: impl Into<String>,
        action: &'static str,
    ) -> Self {
        Self::environment(code, message, false, false, action)
    }

    pub(crate) fn for_method(mut self, method: &str) -> Self {
        self.message = format!("{} · {method}", self.message);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_http_errors_are_distinct_from_rpc_and_attachment_errors() {
        for (status, code) in [(402, "API_QUOTA_EXHAUSTED"), (401, "API_AUTH_FAILED"), (403, "API_AUTH_FAILED"), (429, "API_RATE_LIMITED"), (413, "API_REQUEST_TOO_LARGE")] {
            let error = HostError::api(&format!("API error (status {status})"));
            assert_eq!(error.code, code);
            assert!(error.hold_queue);
        }
        assert_eq!(HostError::request_too_large(9_000_000, 8_388_608).code, "ATTACHMENT_MESSAGE_TOO_LARGE");
        assert!(!HostError::protocol("ACP_RPC_INTERNAL_ERROR", "Internal error").action.unwrap().contains("升级"));
    }

    #[test]
    fn serializes_the_shared_frontend_contract() {
        let error = HostError::environment(
            "SECRET_STORE_UNAVAILABLE",
            "无法读取系统凭据库",
            false,
            true,
            "解锁系统凭据库后重试",
        );
        let value = serde_json::to_value(error).unwrap();
        assert_eq!(value["domain"], "environment");
        assert_eq!(value["code"], "SECRET_STORE_UNAVAILABLE");
        assert_eq!(value["recoverable"], true);
        assert_eq!(value["fatal"], false);
        assert_eq!(value["holdQueue"], true);
    }
}
