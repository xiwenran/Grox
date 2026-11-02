import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useDesktop } from "../../state/store";
import { CommandPalette } from "./CommandPalette";

afterEach(() => {
  useDesktop.setState({ paletteOpen: false });
  document.body.replaceChildren();
});

describe("CommandPalette", () => {
  it("关闭时不渲染任何内容，打开后才构建列表", async () => {
    useDesktop.setState({ paletteOpen: false });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<CommandPalette />));
    expect(container.innerHTML).toBe("");

    await act(async () => useDesktop.setState({ paletteOpen: true }));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector("input")).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')?.className).not.toMatch(/backdrop-blur/);

    await act(async () => root.unmount());
  });
});
