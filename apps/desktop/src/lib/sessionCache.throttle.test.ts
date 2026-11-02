import { afterEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async (..._args: unknown[]) => undefined) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import type { Session } from "../bridge/types";
import { LIVE_CHECKPOINT_MS, scheduleSaveSessionJournal } from "./sessionCache";

const session = (text: string, status: Session["status"] = "running"): Session => ({
  id: "s-throttle",
  title: "t",
  cwd: "/w",
  status,
  createdAt: 1,
  updatedAt: 1,
  blocks: [{ id: "u1", type: "user", text: "hi" }, { id: "a1", type: "assistant", text }],
  usage: { inputTokens: 0, outputTokens: 0, contextUsed: 0, contextMax: 0, costUsd: 0 },
} as unknown as Session);

afterEach(() => { vi.useRealTimers(); invoke.mockClear(); });

describe("session journal checkpoints", () => {
  it("writes one checkpoint per interval while streaming, and flushes at turn end", async () => {
    vi.useFakeTimers();
    const stringify = vi.spyOn(JSON, "stringify");
    for (let i = 0; i < 200; i += 1) scheduleSaveSessionJournal(session("x".repeat(i)));
    expect(stringify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(LIVE_CHECKPOINT_MS);
    expect(invoke).toHaveBeenCalledTimes(1);
    const written = JSON.parse((invoke.mock.calls[0] as unknown as [string, { content: string }])[1].content);
    expect(written.session.blocks[1].text).toBe("x".repeat(199));
    scheduleSaveSessionJournal(session("done", "idle"));
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledTimes(2);
    stringify.mockRestore();
  });
});
