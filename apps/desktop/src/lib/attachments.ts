import type { PromptAttachment } from "../bridge/types";

export const MAX_ATTACHMENTS = 8;
export const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "mdx", "json", "jsonl", "toml", "yaml", "yml", "xml", "csv",
  "tsv", "css", "html", "htm", "js", "jsx", "ts", "tsx", "rs", "py", "go",
  "java", "c", "h", "cpp", "hpp", "sh", "ps1", "sql", "log", "svg",
]);

const fileMime = (file: File) => file.type || "application/octet-stream";

const isTextFile = (file: File) => {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return file.type.startsWith("text/") || file.type === "image/svg+xml" || TEXT_EXTENSIONS.has(extension);
};

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read attachment"));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      resolve(value.slice(value.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export async function prepareAttachment(file: File, fallbackName?: string): Promise<PromptAttachment> {
  const name = file.name || fallbackName || `clipboard-${Date.now()}.png`;
  const mime = fileMime(file);
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${name} exceeds 16 MB`);
  if (mime.startsWith("image/") && mime !== "image/svg+xml" && !/\.svg$/i.test(name)) {
    return { id: crypto.randomUUID(), kind: "image", name, mime, size: file.size, data: await readBase64(file) };
  }
  if (isTextFile(file)) {
    return { id: crypto.randomUUID(), kind: "text", name, mime, size: file.size, text: await file.text() };
  }
  return { id: crypto.randomUUID(), kind: "binary", name, mime, size: file.size, data: await readBase64(file) };
}

export function validateAttachmentSet(items: PromptAttachment[]) {
  if (items.some((item) => item.kind === "text" ? item.text === undefined : item.kind === "image" ? !item.data : item.data === undefined)) {
    throw new Error("附件内容缺失，请重新选择对应文件后发送");
  }
  if (items.length > MAX_ATTACHMENTS) throw new Error("attachment_count");
  if (items.reduce((total, item) => total + item.size, 0) > MAX_TOTAL_BYTES) {
    throw new Error("attachment_size");
  }
}
