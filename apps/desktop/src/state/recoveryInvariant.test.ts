import { describe, expect, it } from "vitest";
import { mergeHydratedPromptQueues, type PersistedPromptQueues } from "../lib/promptQueuePersistence";
import {
  TURN_INTERRUPTED_NOTICE_ID,
  isQueueDrainParked,
  nextQueueDrainParked,
  pruneResolvedTurnInterruptedNotice,
} from "../lib/sessionRuntime";

const queued = (id: string) => ({
  id, text: `prompt-${id}`, attachments: [], model: "grok-build", effort: "high" as const,
  mode: "agent" as const, permissionMode: "default" as const, createdAt: 1,
});

describe("recovery invariants", () => {
  it("reinit keeps persisted prompts and remains parked until explicit resume", () => {
    const persisted: PersistedPromptQueues = { sessionA: [queued("disk")] };
    const current: PersistedPromptQueues = { sessionA: [queued("local")] };
    const restored = mergeHydratedPromptQueues(persisted, current);
    expect(restored.sessionA.map((row) => row.id)).toEqual(["disk", "local"]);

    let parked = nextQueueDrainParked({}, "sessionA", true);
    expect(isQueueDrainParked(parked, "sessionA")).toBe(true);
    parked = nextQueueDrainParked(parked, "sessionA", false);
    expect(isQueueDrainParked(parked, "sessionA")).toBe(false);
  });

  it("未完成回合横幅在队列恢复/清空/发完后自动消失", () => {
    const banner = { id: TURN_INTERRUPTED_NOTICE_ID, level: "error" as const, title: "运行环境错误", message: "检测到未完成的会话回合" };
    const other = { id: "error-environment-OTHER", level: "error" as const, title: "x", message: "y" };
    const notices = [banner, other];
    // 仍暂停且有待发送内容：保留。
    expect(pruneResolvedTurnInterruptedNotice(notices, { a: true }, { a: [queued("q")] })).toBe(notices);
    // 用户点了“恢复队列”：撤下横幅，其它提示不动。
    expect(pruneResolvedTurnInterruptedNotice(notices, { a: false }, { a: [queued("q")] })).toEqual([other]);
    // 暂停标记还在，但队列已空或只剩 Host 已领取的行。
    expect(pruneResolvedTurnInterruptedNotice(notices, { a: true }, { a: [] })).toEqual([other]);
    expect(pruneResolvedTurnInterruptedNotice(notices, { a: true }, { a: [{ ...queued("s"), state: "sending" }] })).toEqual([other]);
    // 没有横幅时原样返回，避免无谓的状态写入。
    expect(pruneResolvedTurnInterruptedNotice([other], {}, {})).toEqual([other]);
  });
});

