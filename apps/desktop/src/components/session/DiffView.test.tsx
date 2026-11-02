import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { DiffView, DIFF_LINE_PAGE } from "./DiffView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DiffView", () => {
  it("renders no lines while collapsed and caps long files with show more", () => {
    const lines = Array.from({ length: DIFF_LINE_PAGE + 50 }, (_, i) => ({ kind: "add" as const, text: `line ${i}` }));
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<DiffView diff={[{ path: "a.ts", lines, added: lines.length, removed: 0 }]} collapsed />));
    expect(host.textContent).toContain("a.ts");
    expect(host.textContent).not.toContain("line 0");
    act(() => (host.querySelector("button") as HTMLButtonElement).click());
    expect(host.textContent).toContain("line 0");
    expect(host.textContent).not.toContain(`line ${DIFF_LINE_PAGE}`);
    const more = [...host.querySelectorAll("button")].at(-1) as HTMLButtonElement;
    act(() => more.click());
    expect(host.textContent).toContain(`line ${DIFF_LINE_PAGE + 49}`);
    act(() => root.unmount());
  });
});
