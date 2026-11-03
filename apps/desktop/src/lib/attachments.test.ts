import { describe, expect, it } from "vitest";
import { prepareAttachment, validateAttachmentSet } from "./attachments";
import { attachExplicitPromptImages, imagePathsInText } from "./pathAttachments";

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>test</text></svg>';
function svgFile(name: string, type: string) {
  const file = new File([svg], name, { type });
  // jsdom's File lacks text(); this is the browser's standard File method.
  Object.defineProperty(file, "text", { value: async () => svg });
  return file;
}

describe("SVG attachments", () => {
  it.each([["vector.svg", "image/svg+xml"], ["vector.SVG", ""], ["vector", "image/svg+xml"]])("sends %s (%s) as readable source text", async (name, type) => {
    const attachment = await prepareAttachment(svgFile(name, type));
    expect(attachment.kind).toBe("text");
    expect(attachment.text).toBe(svg);
    expect(attachment.data).toBeUndefined();
    expect(() => validateAttachmentSet([attachment])).not.toThrow();
  });

  it("leaves explicit SVG paths in the prompt without trying bitmap transport", async () => {
    const text = '请读取 assets/vector.svg 和 "/tmp/vector.SVG"';
    expect(imagePathsInText(text)).toEqual([]);
    await expect(attachExplicitPromptImages("/repo", text, [])).resolves.toEqual([]);
    expect(imagePathsInText("请读取 assets/photo.png")).toContain("assets/photo.png");
  });
});

describe("attachment body validation", () => {
  it("refuses a restored metadata-only image instead of silently omitting it", async () => {
    const image = { id: "a", kind: "image" as const, name: "a.png", mime: "image/png", size: 2 };
    expect(() => validateAttachmentSet([image])).toThrow("附件内容缺失");
    await expect(attachExplicitPromptImages("/repo", "请读取 assets/a.png", [image])).rejects.toThrow("附件内容缺失");
  });
  it("accepts an empty text file but requires its body field", () => {
    const text = { id: "a", kind: "text" as const, name: "empty.txt", mime: "text/plain", size: 0 };
    expect(() => validateAttachmentSet([text])).toThrow("附件内容缺失");
    expect(() => validateAttachmentSet([{ ...text, text: "" }])).not.toThrow();
  });
});
