import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  interject: vi.fn(),
  cancel: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("../bridge", () => ({
  bridge: { interject: mocks.interject, cancel: mocks.cancel },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, convertFileSrc: (path: string) => path }));

import { useDesktop, type QueuedPrompt } from "./store";
import type { Session } from "../bridge/types";

const initialState = useDesktop.getState();
const SESSION = "session-steer";

const queued = (id: string, text: string): QueuedPrompt => ({
  id, text, attachments: [], model: "grok-4.7", effort: "medium", mode: "agent",
  permissionMode: "default", createdAt: 1,
});

function seed(status: Session["status"], queue: QueuedPrompt[]) {
  useDesktop.setState({
    activeId: SESSION,
    sessions: {
      [SESSION]: {
        id: SESSION, title: "t", cwd: "/workspace", createdAt: 1, updatedAt: 1, model: "grok-4.7",
        blocks: [], usage: initialState.sessions[SESSION]?.usage ?? ({} as Session["usage"]), status,
      } as Session,
    },
    promptQueues: { [SESSION]: queue },
  });
}

beforeEach(() => {
  localStorage.clear();
  mocks.interject.mockReset();
  mocks.cancel.mockReset();
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue(undefined);
});

afterEach(() => {
  useDesktop.setState(initialState, true);
  vi.useRealTimers();
});

describe("队列引导（Codex 式）", () => {
  it("回合进行中：通过 x.ai/interject 立即插入，并移出队列", async () => {
    mocks.interject.mockResolvedValue(true);
    seed("running", [queued("a", "改成红色"), queued("b", "再加标题")]);
    const result = await useDesktop.getState().steerQueuedPrompt(SESSION, "a");
    expect(result).toBe("interjected");
    expect(mocks.interject).toHaveBeenCalledWith(SESSION, "改成红色", expect.objectContaining({ mode: "agent", attachments: [] }));
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(useDesktop.getState().promptQueues[SESSION].map((item) => item.id)).toEqual(["b"]);
  });

  it("请求进行中该条已离开队列，回合结束也不会被重复发送", async () => {
    let resolve!: (value: boolean) => void;
    mocks.interject.mockImplementation(() => new Promise<boolean>((done) => { resolve = done; }));
    seed("running", [queued("a", "改成红色")]);
    const pending = useDesktop.getState().steerQueuedPrompt(SESSION, "a");
    expect(useDesktop.getState().promptQueues[SESSION]).toEqual([]);
    resolve(true);
    await expect(pending).resolves.toBe("interjected");
  });

  it("运行时不支持插话：停止当前回合，并把这条放到队首等回合结束后立刻发送", async () => {
    vi.useFakeTimers();
    mocks.interject.mockResolvedValue(false);
    seed("running", [queued("b", "其他"), queued("a", "改成红色")]);
    const result = await useDesktop.getState().steerQueuedPrompt(SESSION, "a");
    expect(result).toBe("restarted");
    expect(mocks.cancel).toHaveBeenCalledWith(SESSION);
    expect(useDesktop.getState().promptQueues[SESSION].map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("插话报错时放回队首并提示", async () => {
    mocks.interject.mockRejectedValue(new Error("boom"));
    seed("running", [queued("a", "改成红色")]);
    await expect(useDesktop.getState().steerQueuedPrompt(SESSION, "a")).resolves.toBe("skipped");
    expect(useDesktop.getState().promptQueues[SESSION].map((item) => item.id)).toEqual(["a"]);
    expect(useDesktop.getState().startupError).toContain("引导失败");
  });

  it("没有运行中的回合时不做任何事", async () => {
    seed("idle", [queued("a", "改成红色")]);
    await expect(useDesktop.getState().steerQueuedPrompt(SESSION, "a")).resolves.toBe("skipped");
    expect(mocks.interject).not.toHaveBeenCalled();
    expect(useDesktop.getState().promptQueues[SESSION]).toHaveLength(1);
  });
});
