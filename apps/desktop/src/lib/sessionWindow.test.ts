import { describe, expect, it } from "vitest";
import type { Session, SessionBlock } from "../bridge/types";
import {
  LIVE_WINDOW_MAX_BLOCKS,
  mergeSessionForJournal,
  parkToStubIndex,
  stubBlockForLive,
  windowSessionForLive,
} from "./sessionWindow";

const base = (blocks: SessionBlock[]): Session => ({
  id: "s1",
  title: "t",
  cwd: "/tmp",
  createdAt: 1,
  updatedAt: 2,
  model: "m",
  blocks,
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    costUSD: 0,
    contextUsed: 0,
    contextMax: 0,
    turns: 0,
  },
  status: "idle",
});

function manyBlocks(count: number): SessionBlock[] {
  const blocks: SessionBlock[] = [];
  for (let i = 0; i < count; i += 1) {
    if (i % 5 === 0) {
      blocks.push({ type: "user", id: `u${i}`, text: `ask ${i}`, ts: i });
    } else if (i % 5 === 1) {
      blocks.push({
        type: "tool",
        id: `t${i}`,
        ts: i,
        call: {
          id: `c${i}`,
          kind: "read",
          title: "read_file",
          status: "done",
          startedAt: i,
          input: "i".repeat(2_000),
          output: "o".repeat(8_000),
        },
      });
    } else {
      blocks.push({ type: "assistant", id: `a${i}`, text: "a".repeat(1_000), ts: i });
    }
  }
  return blocks;
}

describe("sessionWindow", () => {
  it("windowSessionForLive keeps a short stubbed tail", () => {
    const session = windowSessionForLive(base(manyBlocks(200)));
    expect(session.blocks.length).toBeLessThanOrEqual(LIVE_WINDOW_MAX_BLOCKS);
    expect(session.window?.earlierBlocks).toBeGreaterThan(0);
    expect(session.window?.totalBlocks).toBe(200);
    const tool = session.blocks.find((block) => block.type === "tool");
    expect(tool?.type).toBe("tool");
    if (tool?.type === "tool") {
      expect(tool.call.bodyDeferred).toBe(true);
      expect((tool.call.output?.length ?? 0)).toBeLessThan(500);
    }
  });

  it("parkToStubIndex marks preview and keeps stub window", () => {
    const parked = parkToStubIndex(base(manyBlocks(120)));
    expect(parked.preview).toBe(true);
    expect(parked.blocks.length).toBeLessThanOrEqual(LIVE_WINDOW_MAX_BLOCKS);
    expect(parked.window).toBeTruthy();
  });

  it("mergeSessionForJournal restores earlier disk blocks under a live window", () => {
    const disk = base(manyBlocks(30));
    const live = windowSessionForLive(disk);
    const merged = mergeSessionForJournal(disk, live);
    expect(merged.blocks.length).toBe(30);
    expect(merged.window).toBeUndefined();
    const tool = merged.blocks.find((block) => block.type === "tool");
    if (tool?.type === "tool") {
      expect(tool.call.bodyDeferred).not.toBe(true);
      expect((tool.call.output?.length ?? 0)).toBeGreaterThan(500);
    }
  });

  it("stubBlockForLive leaves short bodies alone", () => {
    const block = stubBlockForLive({
      type: "assistant",
      id: "a",
      text: "hi",
      ts: 1,
    });
    expect(block).toMatchObject({ type: "assistant", text: "hi" });
  });
});
