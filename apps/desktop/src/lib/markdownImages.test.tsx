import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
const convertFileSrc = vi.hoisted(() => vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`));
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc }));

import { Markdown, renderMarkdownHtml } from "./markdown";
import { classifyImageSource, clearMarkdownImageCache, MarkdownImageScopeContext, resolveLocalImages } from "./markdownImages";

const SCOPE = { sessionId: "01a1981a-4e33-77d0-988c-c938902fff67", cwd: "/Users/xili/teacher" };
const SESSION_IMAGE = "/Users/xili/.grok/sessions/%2FUsers%2Fxili%2Fteacher/01a1981a-4e33-77d0-988c-c938902fff67/images/1.jpg";

beforeEach(() => {
  invoke.mockReset();
  convertFileSrc.mockClear();
  clearMarkdownImageCache();
});
afterEach(() => document.body.replaceChildren());

describe("classifyImageSource", () => {
  it("分清网页自己能加载的图片、需要本机解析的图片和危险地址", () => {
    expect(classifyImageSource("https://x.ai/a.png")).toBe("remote");
    expect(classifyImageSource("data:image/png;base64,AA")).toBe("remote");
    expect(classifyImageSource("images/1.jpg")).toBe("local");
    expect(classifyImageSource("/Users/xili/teacher/.tmp/sample/tone-ai.png")).toBe("local");
    expect(classifyImageSource("file:///Users/xili/a.png")).toBe("local");
    expect(classifyImageSource("~/Desktop/a.png")).toBe("local");
    expect(classifyImageSource("javascript:alert(1)")).toBe("blocked");
    expect(classifyImageSource("data:text/html,hi")).toBe("blocked");
  });
});

describe("Markdown 里的图片", () => {
  it("本地图片先不给 src（避免破图），远程图片直接加载", () => {
    const html = renderMarkdownHtml("![拼读 ui](images/1.jpg)\n\n![远程](https://x.ai/a.png)\n\n![坏](javascript:alert(1))");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const images = [...doc.querySelectorAll("img")];
    expect(images).toHaveLength(2);
    expect(images[0].getAttribute("data-md-src")).toBe("images/1.jpg");
    expect(images[0].hasAttribute("src")).toBe(false);
    expect(images[0].alt).toBe("拼读 ui");
    expect(images[1].getAttribute("src")).toBe("https://x.ai/a.png");
  });

  it("按会话解析本地图片并缓存结果", async () => {
    invoke.mockResolvedValue([SESSION_IMAGE, null]);
    const urls = await resolveLocalImages(SCOPE, ["images/1.jpg", "nope.png", "images/1.jpg"]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("resolve_markdown_images", { sessionId: SCOPE.sessionId, cwd: SCOPE.cwd, sources: ["images/1.jpg", "nope.png"] });
    expect(urls.get("images/1.jpg")).toBe(`asset://localhost/${encodeURIComponent(SESSION_IMAGE)}`);
    expect(urls.get("nope.png")).toBeNull();
    await resolveLocalImages(SCOPE, ["images/1.jpg"]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("显示解析后的图片，点击放大，Esc 关闭；找不到的图片显示提示而不是破图", async () => {
    invoke.mockResolvedValue([SESSION_IMAGE, null]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <MarkdownImageScopeContext.Provider value={SCOPE}>
        <Markdown text={"![拼读 ui](images/1.jpg)\n\n![丢失](gone.png)"} />
      </MarkdownImageScopeContext.Provider>,
    ));
    await act(async () => { await Promise.resolve(); });
    const image = container.querySelector<HTMLImageElement>("img[data-md-src]")!;
    expect(image.getAttribute("src")).toBe(`asset://localhost/${encodeURIComponent(SESSION_IMAGE)}`);
    expect(container.querySelector(".md-img-missing")?.textContent).toContain("丢失");

    await act(async () => image.click());
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.querySelector("img")?.getAttribute("src")).toBe(image.getAttribute("src"));

    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => root.unmount());
  });
});
