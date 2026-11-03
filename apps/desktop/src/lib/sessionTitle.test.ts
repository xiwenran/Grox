import { describe, expect, it } from "vitest";
import { displaySessionTitle } from "./sessionTitle";
import { decorateSessionMetas, mergeSessionMetas } from "../state/catalogDomain";

const note = "\n\n图片原文件（制作用，按附件顺序）：\n/home/example/.grok/sessions/grox-attachments/session/image.png\n附图为视觉预览，制作时使用原文件。";
const decorate = (rows: { id: string; cwd: string; title: string; updatedAt: number }[]) => decorateSessionMetas(rows, {}, []);

describe("managed image session titles", () => {
  it("keeps the user title and removes multiline or CLI-folded transport notes", () => {
    expect(displaySessionTitle(`制作课件${note}`)).toBe("制作课件");
    expect(displaySessionTitle(`制作课件${note}`.replace(/\s+/g, " "))).toBe("制作课件");
    expect(displaySessionTitle(`制作课件${note}`.replaceAll("/", "\\"))).toBe("制作课件");
  });
  it("keeps user-written paths and ordinary mentions intact", () => {
    for (const text of ["检查 /home/example/photos/original.png", "解释图片原文件（制作用，按附件顺序）：这句话", `分析这段引用：${note}\n还需要生成总结`]) {
      expect(displaySessionTitle(text)).toBe(text);
    }
  });
  it("uses an untitled fallback for an image-only generated title", () => {
    expect(displaySessionTitle(note)).toBe("Untitled mission");
  });
  it("cleans existing cached catalogue rows and newly returned CLI rows", () => {
    const row = { id: "s", cwd: "/repo", title: `制作课件${note}`, updatedAt: 1 };
    expect(decorate([row])[0].title).toBe("制作课件");
    expect(mergeSessionMetas([], [row], "/repo", new Set(), decorate)[0].title).toBe("制作课件");
    expect(row.title).toContain("grox-attachments");
  });
});
