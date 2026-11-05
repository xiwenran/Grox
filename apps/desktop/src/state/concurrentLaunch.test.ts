import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BridgeEvent, Session } from "../bridge/types";

const mocks = vi.hoisted(() => ({
  listener: undefined as ((event: BridgeEvent) => void) | undefined,
  newSession: vi.fn(),
  prompt: vi.fn(async () => {}),
  invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
}));
vi.mock("../bridge", () => ({ bridge: {
  kind: "mock",
  subscribe: (listener: (event: BridgeEvent) => void) => { mocks.listener = listener; return () => {}; },
  invalidateWorkspaceSelection: vi.fn(),
  closeSession: vi.fn(async () => {}),
  setPermissionMode: vi.fn(),
  newSession: mocks.newSession,
  prompt: mocks.prompt,
} }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { useDesktop } from "./store";
import { loadDraftBuffer, resetDraftPersistenceForTests } from "../lib/draftPersistence";
const initialState = useDesktop.getState();
const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUSD: 0, contextUsed: 0, contextMax: 0, turns: 0 };
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
function ready(sessionId: string, cwd: string, launchId?: string) {
  const session: Session = { id: sessionId, cwd, title: "Untitled mission", model: "grok-build", createdAt: 1, updatedAt: 1, status: "idle", blocks: [], usage };
  mocks.listener!({ type: "session_ready", session, launchId });
}
beforeAll(async () => {
  vi.useFakeTimers();
  await useDesktop.getState().init();
  vi.clearAllTimers();
});
afterEach(() => {
  mocks.newSession.mockReset();
  mocks.prompt.mockClear();
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  resetDraftPersistenceForTests();
  vi.clearAllTimers();
  localStorage.clear();
  useDesktop.setState(initialState, true);
});
afterAll(() => vi.useRealTimers());

describe("concurrent session creation", () => {
  it("乱序创建完成时各自发送原消息、附件和选项，保持当前视图", async () => {
    const a = deferred();
    const b = deferred();
    mocks.newSession.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const attachment = { id: "att-a", kind: "text" as const, name: "a.txt", mime: "text/plain", size: 1, text: "a" };
    useDesktop.setState({ workspace: "/repo-a", effort: "low", mode: "plan", permissionMode: "default" });
    const first = useDesktop.getState().newSession({ text: "任务 A", attachments: [attachment] });
    await Promise.resolve();
    const firstId = mocks.newSession.mock.calls[0][1];
    useDesktop.setState({ workspace: "/repo-b", effort: "high", mode: "agent", permissionMode: "auto" });
    const second = useDesktop.getState().newSession({ text: "任务 B" });
    await Promise.resolve();
    const secondId = mocks.newSession.mock.calls[1][1];
    expect(useDesktop.getState().sessions[firstId]).toBeDefined();
    ready("b", "/repo-b", secondId);
    b.resolve();
    await second;
    ready("a", "/repo-a", firstId);
    a.resolve();
    await first;
    expect(mocks.prompt.mock.calls).toEqual([
      ["b", "任务 B", expect.objectContaining({ effort: "high", mode: "agent", permissionMode: "auto", attachments: [] })],
      ["a", "任务 A", expect.objectContaining({ effort: "low", mode: "plan", permissionMode: "default", attachments: [attachment] })],
    ]);
    expect(useDesktop.getState().activeId).toBe("b");
    expect(useDesktop.getState().workspace).toBe("/repo-b");
    expect(useDesktop.getState().sessions.a.blocks[0]).toMatchObject({ text: "任务 A" });
    expect(Object.keys(useDesktop.getState().sessions)).not.toContain(firstId);
    expect(Object.keys(useDesktop.getState().sessions)).not.toContain(secondId);
  });

  it("旧创建失败仅恢复自己的草稿，保留新创建和当前工作区", async () => {
    const a = deferred();
    const b = deferred();
    mocks.newSession.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    useDesktop.setState({ workspace: "/repo-a", effort: "low" });
    const first = useDesktop.getState().newSession({ text: "保留 A" });
    const rejected = expect(first).rejects.toThrow("A 创建失败");
    await Promise.resolve();
    useDesktop.setState({ workspace: "/repo-b", effort: "high" });
    const second = useDesktop.getState().newSession({ text: "发送 B" });
    await Promise.resolve();
    const secondId = mocks.newSession.mock.calls[1][1];
    a.reject(new Error("A 创建失败"));
    await rejected;
    expect(useDesktop.getState().activeId).toBe(secondId);
    expect(useDesktop.getState().sessions[secondId]).toBeDefined();
    const restored = Object.values(useDesktop.getState().sessions).find(s => s.id.startsWith("draft-"))!;
    expect(restored.cwd).toBe("/repo-a");
    expect(useDesktop.getState().sessionComposers[restored.id]).toMatchObject({ text: "保留 A", effort: "low" });
    ready("b", "/repo-b", secondId);
    b.resolve();
    await second;
    expect(mocks.prompt).toHaveBeenCalledWith("b", "发送 B", expect.anything());
  });

  it("等待创建时打开空白草稿，旧结果不能抢走视图或丢掉原消息", async () => {
    const a = deferred();
    mocks.newSession.mockReturnValueOnce(a.promise);
    useDesktop.setState({ workspace: "/repo-a" });
    const first = useDesktop.getState().newSession({ text: "任务 A" });
    await Promise.resolve();
    const firstId = mocks.newSession.mock.calls[0][1];
    await useDesktop.getState().newSession();
    const draftId = useDesktop.getState().activeId;
    ready("a", "/repo-a", firstId);
    a.resolve();
    await first;
    expect(useDesktop.getState().activeId).toBe(draftId);
    expect(useDesktop.getState().sessions[draftId!]).toBeDefined();
    expect(mocks.prompt).toHaveBeenCalledWith("a", "任务 A", expect.anything());
  });

  it("同一项目 A 创建失败、B 成功后，A 的正文和原图仍可从独立缓冲恢复", async () => {
    const a = deferred();
    const b = deferred();
    mocks.newSession.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const image = { id: "image-a", kind: "image" as const, name: "a.png", mime: "image/png", size: 3, data: "YWJj" };
    useDesktop.setState({ workspace: "/shared", activeId: null, sessions: {}, sessionComposers: {} });
    const first = useDesktop.getState().newSession({ text: "保留 A 原图", attachments: [image] });
    const rejected = expect(first).rejects.toThrow("A 失败");
    await Promise.resolve();
    const second = useDesktop.getState().newSession({ text: "发送 B" });
    await Promise.resolve();
    const secondId = mocks.newSession.mock.calls[1][1];
    a.reject(new Error("A 失败"));
    await rejected;
    ready("b", "/shared", secondId);
    b.resolve();
    await second;
    const records = JSON.parse(localStorage.getItem("grox.launchRecovery.v1") ?? "[]");
    expect(records).toHaveLength(1);
    expect(await loadDraftBuffer("/shared", records[0].scope)).toMatchObject({ text: "保留 A 原图", attachments: [image] });
    // 模拟会话壳和附件内存已丢失，恢复仍来自持久缓冲。
    useDesktop.setState({ activeId: null, sessions: {}, sessionComposers: {} });
    await useDesktop.getState().newSession();
    const recoveredId = useDesktop.getState().activeId!;
    expect(useDesktop.getState().sessionComposers[recoveredId]).toMatchObject({ text: "保留 A 原图", attachments: [image] });
  });

  it("较慢的草稿读取完成后不能抢占后来已创建的会话", async () => {
    let resolveRead!: (value: unknown) => void;
    const reading = new Promise(resolve => { resolveRead = resolve; });
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    mocks.invoke.mockImplementation(async (command: unknown) => command === "read_draft" ? reading : undefined);
    useDesktop.setState({ workspace: "/repo-a" });
    const oldDraft = useDesktop.getState().newSession();
    // 新导航不需要等待旧目录的磁盘读取。
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    const b = deferred();
    mocks.newSession.mockReturnValueOnce(b.promise);
    const next = useDesktop.getState().newSession({ text: "新任务" });
    await Promise.resolve();
    ready("b", "/repo-a", mocks.newSession.mock.calls[0][1]);
    b.resolve();
    await next;
    resolveRead({ revision: 1, draft: null });
    await oldDraft;
    expect(useDesktop.getState().activeId).toBe("b");
  });

  it("独立缓冲写入失败时保留原默认草稿，不调用清除", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    const original = { cwd: "/repo-a", text: "保留原草稿", attachments: [], updatedAt: Date.now() };
    mocks.invoke.mockImplementation(async (command: unknown) => {
      if (command === "read_draft") return { revision: 1, draft: original };
      if (command === "write_draft") throw new Error("磁盘写入失败");
      return undefined;
    });
    mocks.newSession.mockImplementationOnce(async (_cwd: string, _id: string, preparation: Promise<void>) => { await preparation; });
    useDesktop.setState({ workspace: "/repo-a", activeId: "draft-source", sessions: {
      "draft-source": { id: "draft-source", cwd: "/repo-a", title: "", model: "grok-build", createdAt: 1, updatedAt: 1, status: "idle", blocks: [], usage },
    } });
    await expect(useDesktop.getState().newSession({ text: original.text })).rejects.toThrow("磁盘写入失败");
    expect(mocks.invoke.mock.calls.some(([command]) => command === "delete_draft")).toBe(false);
    expect(await loadDraftBuffer("/repo-a")).toMatchObject({ text: original.text });
  });
});
