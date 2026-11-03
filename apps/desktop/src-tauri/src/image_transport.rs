//! 模型视觉预览与原文件分开，按编码后的大小约束 ACP 消息。

use std::{io::Cursor, path::Path};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::{codecs::jpeg::JpegEncoder, DynamicImage, ImageFormat, ImageReader};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::host_error::HostError;

pub(crate) const MAX_ACP_LINE_BYTES: usize = 8 * 1024 * 1024;
pub(crate) const IMAGE_PREVIEW_BYTES: usize = 512 * 1024;
const MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;
const MAX_PROMPT_IMAGES: usize = 8;
const MAX_PROMPT_IMAGE_BYTES: usize = 32 * 1024 * 1024;

pub(crate) struct ImagePreview {
    pub(crate) bytes: Vec<u8>,
    pub(crate) mime: &'static str,
}

fn attachment_error(message: impl Into<String>) -> HostError {
    HostError::environment(
        "ATTACHMENT_IMAGE_INVALID",
        message,
        false,
        true,
        "检查图片格式或换用可读取的图片文件后重新发送；原文件保留",
    )
}

/// 文件读取、附件和插话共用同一张视觉预览预算，原文件始终由调用方保留。
pub(crate) fn preview(bytes: &[u8]) -> Result<ImagePreview, String> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("单张图片不能超过 16 MiB".into());
    }
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| format!("无法识别图片：{error}"))?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(20_000);
    limits.max_image_height = Some(20_000);
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|error| format!("无法解码图片：{error}"))?;
    if bytes.len() <= IMAGE_PREVIEW_BYTES && decoded.width().max(decoded.height()) <= 2_000 {
        let mime = crate::host_core::prompt_image_mime(bytes).ok_or("不支持的图片格式")?;
        return Ok(ImagePreview {
            bytes: bytes.to_vec(),
            mime,
        });
    }
    let scaled = decoded.thumbnail(2_000, 2_000);
    let mut png = Cursor::new(Vec::new());
    scaled
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|error| format!("无法编码图片预览：{error}"))?;
    if png.get_ref().len() <= IMAGE_PREVIEW_BYTES {
        return Ok(ImagePreview {
            bytes: png.into_inner(),
            mime: "image/png",
        });
    }
    // JPEG 的透明区域合成白底，避免透明课件页面变成黑底。
    let mut rgb = scaled.to_rgb8();
    for (target, source) in rgb.pixels_mut().zip(scaled.to_rgba8().pixels()) {
        let alpha = u32::from(source[3]);
        for channel in 0..3 {
            target[channel] =
                ((u32::from(source[channel]) * alpha + 255 * (255 - alpha) + 127) / 255) as u8;
        }
    }
    let mut image = DynamicImage::ImageRgb8(rgb);
    for edge in [2_000, 1_600, 1_200, 900, 640] {
        image = image.thumbnail(edge, edge);
        let mut encoded = Vec::new();
        JpegEncoder::new_with_quality(&mut encoded, 85)
            .encode_image(&image)
            .map_err(|error| format!("无法编码图片预览：{error}"))?;
        if encoded.len() <= IMAGE_PREVIEW_BYTES {
            return Ok(ImagePreview {
                bytes: encoded,
                mime: "image/jpeg",
            });
        }
    }
    Err("图片预览仍超过传输预算，请分批发送或使用局部截图".into())
}

pub(crate) fn prepare_prompt(mut prompt: Value, media_dir: &Path) -> Result<Value, HostError> {
    let blocks = prompt
        .as_array_mut()
        .ok_or_else(|| attachment_error("提示内容必须是数组"))?;
    let image_count = blocks
        .iter()
        .filter(|block| block["type"] == "image")
        .count();
    if image_count == 0 {
        return Ok(prompt);
    }
    if image_count > MAX_PROMPT_IMAGES {
        return Err(attachment_error("每条消息最多附加 8 张图片，请分批发送"));
    }
    let mut total = 0usize;
    let mut originals = Vec::with_capacity(image_count);
    for block in blocks.iter_mut().filter(|block| block["type"] == "image") {
        let encoded = block["data"]
            .as_str()
            .ok_or_else(|| attachment_error("图片缺少数据"))?;
        if encoded.len() > MAX_IMAGE_BYTES * 4 / 3 + 4 {
            return Err(attachment_error("单张图片不能超过 16 MiB"));
        }
        let bytes = BASE64
            .decode(encoded)
            .map_err(|error| attachment_error(format!("图片数据无效：{error}")))?;
        total = total.saturating_add(bytes.len());
        if total > MAX_PROMPT_IMAGE_BYTES {
            return Err(attachment_error(
                "图片原文件总大小不能超过 32 MiB，请分批发送",
            ));
        }
        let mime = crate::host_core::prompt_image_mime(&bytes)
            .ok_or_else(|| attachment_error("不支持的图片格式"))?;
        let declared = block["mimeType"].as_str().unwrap_or_default();
        if declared != mime && !(declared == "image/jpg" && mime == "image/jpeg") {
            return Err(attachment_error("图片声明格式与实际文件不一致"));
        }
        let visual = preview(&bytes).map_err(attachment_error)?;
        let extension = match mime {
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/gif" => "gif",
            "image/webp" => "webp",
            "image/bmp" => "bmp",
            _ => return Err(attachment_error("不支持的图片格式")),
        };
        let path = media_dir.join(format!("{:x}.{extension}", Sha256::digest(&bytes)));
        crate::write_tool_image(&path, &bytes).map_err(|error| {
            HostError::environment(
                "ATTACHMENT_ORIGINAL_SAVE_FAILED",
                error,
                false,
                true,
                "检查应用数据目录的空间和权限，原文件保存成功后再发送",
            )
        })?;
        originals.push(path.to_string_lossy().into_owned());
        block["data"] = Value::String(BASE64.encode(visual.bytes));
        block["mimeType"] = Value::String(visual.mime.into());
    }
    let source_note = format!(
        "\n\n图片原文件（制作用，按附件顺序）：\n{}\n附图为视觉预览，制作时使用原文件。",
        originals.join("\n")
    );
    if let Some(text) = blocks
        .first_mut()
        .and_then(|block| block.get_mut("text"))
        .filter(|text| text.is_string())
    {
        *text = Value::String(format!(
            "{}{source_note}",
            text.as_str().unwrap_or_default()
        ));
    } else {
        blocks.insert(0, serde_json::json!({"type":"text", "text":source_note}));
    }
    let encoded_bytes = prompt.to_string().len();
    // 预留请求编号、会话编号和执行参数，最终边界仍检查完整 JSON-RPC。
    if encoded_bytes > MAX_ACP_LINE_BYTES - 64 * 1024 {
        return Err(HostError::request_too_large(
            encoded_bytes,
            MAX_ACP_LINE_BYTES,
        ));
    }
    Ok(prompt)
}

/// 保存与解码放到阻塞线程，并与会话删除使用同一把存储锁。
pub(crate) async fn prepare_session_prompt(
    app: &tauri::AppHandle,
    session_id: &str,
    prompt: Value,
) -> Result<Value, HostError> {
    if !prompt
        .as_array()
        .is_some_and(|blocks| blocks.iter().any(|block| block["type"] == "image"))
    {
        return Ok(prompt);
    }
    crate::safe_session_storage_id(session_id).map_err(attachment_error)?;
    // 沿用已允许读取的官方会话目录，不扩大 Host 的文件读取权限。
    let directory = crate::host_core::grok_home()
        .map_err(attachment_error)?
        .join("sessions")
        .join("grox-attachments")
        .join(session_id);
    let app = app.clone();
    let session_id = session_id.to_string();
    tokio::task::spawn_blocking(move || {
        use tauri::Manager;
        let storage = app.state::<crate::session_storage::SessionStorageState>();
        let _write = storage.begin_write(&session_id).map_err(attachment_error)?;
        prepare_prompt(prompt, &directory)
    })
    .await
    .map_err(|error| attachment_error(format!("图片预处理未完成：{error}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn noisy_png() -> Vec<u8> {
        let mut seed = 0x12345678u32;
        let pixels = (0..1024 * 1024 * 3)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                seed as u8
            })
            .collect();
        let image = DynamicImage::ImageRgb8(image::RgbImage::from_raw(1024, 1024, pixels).unwrap());
        let mut output = Cursor::new(Vec::new());
        image.write_to(&mut output, ImageFormat::Png).unwrap();
        output.into_inner()
    }

    #[test]
    fn photo_batch_fits_wire_and_keeps_byte_identical_originals() {
        let original = noisy_png();
        let data = BASE64.encode(&original);
        let mut blocks = vec![json!({"type":"text", "text":"制作课件"})];
        for _ in 0..4 {
            blocks.push(json!({"type":"image", "mimeType":"image/png", "data":data}));
        }
        let prompt = Value::Array(blocks);
        assert!(prompt.to_string().len() > MAX_ACP_LINE_BYTES);
        let directory = std::env::temp_dir().join(format!(
            "grox-images-{}-{}",
            std::process::id(),
            crate::CONFIG_WRITE_NONCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let prepared = prepare_prompt(prompt, &directory).unwrap();
        let wire = json!({"jsonrpc":"2.0", "id":1, "method":"session/prompt", "params":{"sessionId":"s1", "prompt":prepared}}).to_string();
        assert!(crate::host_core::prepare_acp_line(
            wire,
            &crate::mcp_leases::McpLeaseStore::default()
        )
        .is_ok());
        for block in prepared.as_array().unwrap().iter().skip(1) {
            let preview = BASE64.decode(block["data"].as_str().unwrap()).unwrap();
            assert!(preview.len() <= IMAGE_PREVIEW_BYTES);
            assert_eq!(
                crate::host_core::prompt_image_mime(&preview),
                block["mimeType"].as_str()
            );
            image::load_from_memory(&preview).unwrap();
        }
        let saved = directory.join(format!("{:x}.png", Sha256::digest(&original)));
        assert_eq!(std::fs::read(&saved).unwrap(), original);
        assert!(prepared[0]["text"]
            .as_str()
            .unwrap()
            .contains(saved.to_str().unwrap()));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn tool_read_returns_preview_and_preserves_source_file() {
        let original = noisy_png();
        let directory = std::env::temp_dir().join(format!(
            "grox-image-read-{}-{}",
            std::process::id(),
            crate::CONFIG_WRITE_NONCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("photo.png");
        std::fs::write(&path, &original).unwrap();
        let result = crate::host_core::acp_read_file(
            directory.to_string_lossy().into(),
            path.to_string_lossy().into(),
            None,
            None,
        )
        .unwrap();
        let preview = BASE64.decode(result.content_base64.unwrap()).unwrap();
        assert!(preview.len() <= IMAGE_PREVIEW_BYTES);
        assert_eq!(
            result.content_type,
            crate::host_core::prompt_image_mime(&preview).unwrap()
        );
        assert_eq!(std::fs::read(path).unwrap(), original);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn invalid_images_and_overfull_batches_fail_explicitly() {
        assert!(preview(b"broken image").is_err());
        let prompt = json!([{"type":"text", "text":"x"}, {"type":"image", "mimeType":"image/png", "data":"invalid"}]);
        let error = prepare_prompt(prompt, Path::new("unused")).unwrap_err();
        assert_eq!(error.code, "ATTACHMENT_IMAGE_INVALID");
        assert!(error.hold_queue);
        let prompt = Value::Array((0..9).map(|_| json!({"type":"image"})).collect());
        assert!(prepare_prompt(prompt, Path::new("unused"))
            .unwrap_err()
            .message
            .contains("8 张"));
    }

    #[test]
    fn transparent_png_previews_preserve_alpha_and_dimension_limit() {
        let mut image = image::RgbaImage::new(2100, 2);
        image.put_pixel(0, 0, image::Rgba([255, 0, 0, 0]));
        let mut input = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut input, ImageFormat::Png)
            .unwrap();
        let output = preview(input.get_ref()).unwrap();
        let decoded = image::load_from_memory(&output.bytes).unwrap();
        assert!(decoded.width() <= 2000);
        assert_eq!(output.mime, "image/png");
        assert_eq!(decoded.to_rgba8().get_pixel(0, 0)[3], 0);
    }
}
