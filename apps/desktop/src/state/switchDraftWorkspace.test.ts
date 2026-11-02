import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(async (..._args: unknown[]) => null) }));
vi.mock("../bridge", () => ({ bridge: { kind: "mock" } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, convertFileSrc: (path: string) => path }));

import { useDesktop } from "./store";
import type { Session } from "../bridge/types";

describe("switchDraftWorkspace", () => {
  it("moves the unsent draft text and attachments to the chosen folder", async () => {
    const setWorkspace = vi.fn(async (cwd: string) => { useDesktop.setState({ workspace: cwd, view: "home", activeId: null }); });
    const newSession = vi.fn(async () => {
      useDesktop.setState({
        view: "session",
        activeId: "draft-new",
        sessions: { "draft-new": { id: "draft-new", cwd: useDesktop.getState().workspace, blocks: [], status: "idle" } as unknown as Session },
      });
    });
    const attachment = { id: "a1", kind: "image", name: "x.png", mime: "image/png", size: 1, data: "AA==" };
    useDesktop.setState({
      workspace: "/old",
      view: "session",
      activeId: "draft-old",
      sessions: { "draft-old": { id: "draft-old", cwd: "/old", blocks: [], status: "idle" } as unknown as Session },
      sessionComposers: { "draft-old": { text: "保留我", attachments: [attachment], model: "m", effort: "medium", mode: "agent", permissionMode: "default" } } as never,
      setWorkspace, newSession,
    } as never);
    await useDesktop.getState().switchDraftWorkspace("/new");
    expect(setWorkspace).toHaveBeenCalledWith("/new", { restoreProject: true });
    const state = useDesktop.getState();
    expect(state.activeId).toBe("draft-new");
    expect(state.sessionComposers["draft-new"]?.text).toBe("保留我");
    expect(state.sessionComposers["draft-new"]?.attachments).toHaveLength(1);
  });

  it("does nothing when the same folder is picked", async () => {
    const setWorkspace = vi.fn();
    useDesktop.setState({ workspace: "/same", setWorkspace } as never);
    await useDesktop.getState().switchDraftWorkspace("/same");
    expect(setWorkspace).not.toHaveBeenCalled();
  });
});
