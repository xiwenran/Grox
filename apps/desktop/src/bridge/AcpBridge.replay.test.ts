import { describe, expect, it } from "vitest";
import { displayDiskUserPrompt, displayReplayUserPrompt } from "../lib/replayUserPrompt";
import { blockContentKey, insertLiveOnlyIntoOffline } from "../lib/offlineMerge";
import type { SessionBlock } from "./types";

const IMAGE_PROMPT = `<image_files>
The following images were provided by the user and saved to the workspace for future use:
1. /Users/x/.grok/sessions/s/assets/image-1.jpg

These images can be copied for use in other locations.
</image_files>

<user_query>
打不开
</user_query>



<system-reminder>
<image_compression_notice>
Image 1 was over the max input resolution and was re-encoded.
</image_compression_notice>
</system-reminder>`;

describe("ACP 会话回放用户消息", () => {
  it("隐藏 Grok Build 注入的上下文信封", () => {
    expect(displayReplayUserPrompt(`<user_info>\nOS Version: macos\n</user_info>\n\n<git_status>\n## main\n</git_status>`)).toBe("");
    expect(displayReplayUserPrompt(`<rules>\n内部规则\n</rules>`)).toBe("");
  });

  it("隐藏重复的 user_query 信封但保留真实请求", () => {
    expect(displayReplayUserPrompt(`<user_query>\n读取 README\n</user_query>`)).toBe("");
    expect(displayReplayUserPrompt(`The user interrupted the previous turn:\n<user_query>\n继续检查\n</user_query>\nMake sure to complete any unfinished tasks from previous turns.`)).toBe("");
    expect(displayReplayUserPrompt("读取 README")).toBe("读取 README");
  });

  it("磁盘恢复会还原用户正文且不泄漏中断信封", () => {
    expect(displayDiskUserPrompt(`<user_query>\n读取 README\n</user_query>`)).toBe("读取 README");
    expect(displayDiskUserPrompt(`The user interrupted the previous turn:\n<user_query>\n继续检查\n</user_query>\nMake sure to complete any unfinished tasks from previous turns.`)).toBe("继续检查");
  });

  it("继续把深度研究传输命令还原为用户可见指令", () => {
    expect(displayReplayUserPrompt(`/workflow grox-deep-research {"query":"数据库"}`)).toBe("/deep-research 数据库");
  });

  it("带图片的提示剥掉 image_files / system-reminder 信封后只显示正文", () => {
    expect(displayDiskUserPrompt(IMAGE_PROMPT)).toBe("打不开");
    expect(displayReplayUserPrompt(IMAGE_PROMPT)).toBe("");
    // 普通正文里提到这些标签不能被误剥。
    expect(displayDiskUserPrompt("<system-reminder>是什么？")).toBe("<system-reminder>是什么？");
  });

  it("磁盘预览与本地乐观气泡合并时同一条带图消息只保留一条", () => {
    const preview: SessionBlock = { type: "user", id: "preview-s-112", text: displayDiskUserPrompt(IMAGE_PROMPT), ts: 1 };
    const live: SessionBlock = {
      type: "user", id: "local-1", text: "打不开", ts: 2,
      attachments: [{ id: "a", kind: "image", name: "image.png", mime: "image/png", size: 1 }],
    };
    expect(blockContentKey(preview)).toBe(blockContentKey(live));
    const merged = insertLiveOnlyIntoOffline([preview], [live]);
    expect(merged.filter((block) => block.type === "user")).toHaveLength(1);
  });
});
