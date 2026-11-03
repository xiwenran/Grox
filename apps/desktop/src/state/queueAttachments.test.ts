import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../bridge", () => ({ bridge: {} }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, convertFileSrc: (path: string) => path }));
import { useDesktop, type QueuedPrompt } from "./store";
import type { PromptAttachment, Session } from "../bridge/types";
const initialState = useDesktop.getState();
const image = (id: string): PromptAttachment => ({ id, name: `${id}.png`, kind: "image", mime: "image/png", size: 3, data: id });
const composer = { text: "看这张图", attachments: [image("second")], model: "grok-4.7", effort: "medium" as const, mode: "agent" as const, permissionMode: "default" as const };
beforeEach(() => {
  localStorage.clear();
  mocks.invoke.mockResolvedValue(undefined);
  useDesktop.setState({ activeId: "s1", workspace: "/workspace", providerSwitching: false, restoringSessionId: null,
    auth: { required: false, inProgress: false },
    sessions: { s1: { id: "s1", title: "t", cwd: "/workspace", createdAt: 1, updatedAt: 1, model: "grok-4.7", blocks: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUSD: 0, contextUsed: 0, contextMax: 0, turns: 0 }, status: "running" } as Session },
    sessionComposers: { s1: composer },
    promptQueues: { s1: [{ ...composer, id: "q1", createdAt: 1, attachments: [image("first")] } as QueuedPrompt] },
  });
});
afterEach(() => useDesktop.setState(initialState, true));
describe("busy queue attachment identity", () => {
  it("enqueues identical text with a different image", () => {
    expect(useDesktop.getState().sendPrompt("看这张图", [image("second")], "s1")).toBe(true);
    expect(useDesktop.getState().promptQueues.s1.map(item => item.attachments[0].id)).toEqual(["first", "second"]);
  });
  it("rejects the same text, attachments and options", () => {
    expect(useDesktop.getState().sendPrompt("看这张图", [image("first")], "s1")).toBe(false);
    expect(useDesktop.getState().promptQueues.s1).toHaveLength(1);
  });
  it("keeps identical text and images with a different mode", () => {
    expect(useDesktop.getState().sendPrompt("看这张图", [image("first")], "s1", "ask")).toBe(true);
    expect(useDesktop.getState().promptQueues.s1).toHaveLength(2);
  });
});
