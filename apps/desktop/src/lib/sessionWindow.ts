import type { Session, SessionBlock, ToolCall, ToolImage } from "../bridge/types";

/** Soft cap for blocks kept fully/stubbed in the live WebView store. */
export const LIVE_WINDOW_MAX_BLOCKS = 80;
/** Prefer ending the window at a user-turn boundary within this many turns. */
export const LIVE_WINDOW_USER_TURNS = 3;
export const STUB_TEXT_CHARS = 280;
export const STUB_TOOL_CHARS = 240;

function durableToolImages(images: ToolImage[] | undefined): ToolImage[] | undefined {
  const durable = images?.flatMap((image) => (image.path ? [{ mime: image.mime, path: image.path }] : []));
  return durable && durable.length > 0 ? durable : undefined;
}

function isPrimaryUser(block: SessionBlock): boolean {
  return block.type === "user" && !block.interjected;
}

/** Find start index for the live window: last N user turns, then clamp to max blocks. */
export function liveWindowStart(
  blocks: readonly SessionBlock[],
  maxBlocks = LIVE_WINDOW_MAX_BLOCKS,
  userTurns = LIVE_WINDOW_USER_TURNS,
): number {
  if (blocks.length <= maxBlocks) return 0;
  let turns = 0;
  let start = Math.max(0, blocks.length - maxBlocks);
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (isPrimaryUser(blocks[i])) {
      turns += 1;
      if (turns >= userTurns) {
        start = i;
        break;
      }
    }
  }
  if (blocks.length - start > maxBlocks) {
    start = blocks.length - maxBlocks;
    for (let i = start; i < blocks.length; i += 1) {
      if (isPrimaryUser(blocks[i])) {
        start = i;
        break;
      }
    }
  }
  return start;
}

function stubText(text: string, limit: number): { text: string; deferred: boolean } {
  if (text.length <= limit) return { text, deferred: false };
  return { text: `${text.slice(0, limit)}\n…[已折叠，展开可加载全文]`, deferred: true };
}

/** Collapse heavy bodies so the store keeps titles/previews only. */
export function stubBlockForLive(block: SessionBlock): SessionBlock {
  if (block.type === "thinking") {
    const { text, deferred } = stubText(block.text, STUB_TEXT_CHARS);
    if (!deferred && !block.live) return block;
    return { ...block, text, live: false, bodyDeferred: deferred || block.bodyDeferred };
  }
  if (block.type === "assistant") {
    if (block.streaming) return block;
    const { text, deferred } = stubText(block.text, STUB_TEXT_CHARS * 2);
    if (!deferred) return block;
    return { ...block, text, bodyDeferred: true };
  }
  if (block.type === "tool") {
    const call = block.call;
    if (call.bodyDeferred) {
      return {
        ...block,
        call: {
          ...call,
          images: durableToolImages(call.images),
          diff: undefined,
          terminal: call.terminal
            ? { ...call.terminal, lines: call.terminal.lines.slice(-12) }
            : undefined,
        },
      };
    }
    const input = call.input ? stubText(call.input, STUB_TOOL_CHARS) : undefined;
    const output = call.output ? stubText(call.output, STUB_TOOL_CHARS) : undefined;
    const deferred = Boolean(
      input?.deferred
      || output?.deferred
      || (call.diff && call.diff.length > 0)
      || (call.terminal && call.terminal.lines.length > 12),
    );
    if (!deferred) {
      return {
        ...block,
        call: { ...call, images: durableToolImages(call.images) },
      };
    }
    const next: ToolCall = {
      ...call,
      input: input?.text,
      output: output?.text,
      diff: undefined,
      terminal: call.terminal
        ? { ...call.terminal, lines: call.terminal.lines.slice(-12) }
        : undefined,
      images: durableToolImages(call.images),
      bodyDeferred: true,
    };
    return { ...block, call: next };
  }
  if (block.type === "system") {
    const { text, deferred } = stubText(block.text, STUB_TEXT_CHARS);
    return deferred ? { ...block, text } : block;
  }
  return block;
}

export function countPrimaryUserTurns(blocks: readonly SessionBlock[]): number {
  return blocks.reduce((n, block) => n + (isPrimaryUser(block) ? 1 : 0), 0);
}

function earlierTurnCount(blocks: readonly SessionBlock[], start: number): number {
  let n = 0;
  for (let i = 0; i < start; i += 1) {
    if (isPrimaryUser(blocks[i])) n += 1;
  }
  return n;
}

/**
 * Keep only the live tail window in memory, with heavy bodies stubbed.
 * Full bodies remain in the on-disk journal for Host page/body fetches.
 */
export function windowSessionForLive(session: Session): Session {
  const start = liveWindowStart(session.blocks);
  const slice = session.blocks.slice(start).map(stubBlockForLive);
  if (start > 0) {
    return {
      ...session,
      preview: true,
      blocks: slice,
      window: {
        earlierBlocks: start,
        earlierTurns: earlierTurnCount(session.blocks, start),
        totalBlocks: session.blocks.length,
        oldestVisibleId: slice[0]?.id,
      },
    };
  }
  const unchanged = slice.length === session.blocks.length
    && slice.every((block, index) => block === session.blocks[index]);
  if (unchanged) return session;
  const hasDeferred = slice.some((block) => (
    (block.type === "tool" && block.call.bodyDeferred)
    || ((block.type === "thinking" || block.type === "assistant") && block.bodyDeferred)
  ));
  return {
    ...session,
    blocks: slice,
    window: hasDeferred
      ? {
          earlierBlocks: 0,
          earlierTurns: 0,
          totalBlocks: session.blocks.length,
          oldestVisibleId: slice[0]?.id,
        }
      : session.window,
  };
}

/**
 * Park an inactive session as a stub index: tiny window of stubs only.
 */
export function parkToStubIndex(session: Session): Session {
  const windowed = windowSessionForLive(session);
  const stubs = windowed.blocks.map(stubBlockForLive);
  return {
    ...windowed,
    preview: true,
    blocks: stubs,
    window: {
      earlierBlocks: windowed.window?.earlierBlocks ?? 0,
      earlierTurns: windowed.window?.earlierTurns ?? 0,
      totalBlocks: windowed.window?.totalBlocks ?? session.blocks.length,
      oldestVisibleId: stubs[0]?.id,
    },
  };
}

/** Score for preferRicherSession: higher = cleaner in-window view (not more blocks). */
export function sessionWindowCleanScore(session: Session): number {
  let score = 0;
  if (session.window) score += 1000;
  if (session.preview) score += 50;
  score += Math.max(0, 200 - session.blocks.length);
  for (const block of session.blocks) {
    if (block.type === "tool" && block.call.bodyDeferred) score += 2;
    if (block.type === "tool" && !block.call.bodyDeferred && (block.call.output?.length ?? 0) > 2000) {
      score -= 5;
    }
    if ((block.type === "thinking" || block.type === "assistant") && block.bodyDeferred) score += 1;
  }
  return score;
}

/** Prefer the block that still carries a full body when merging journal writes. */
export function preferFullerBlock(disk: SessionBlock, live: SessionBlock): SessionBlock {
  if (disk.type !== live.type) return live;
  if (live.type === "tool" && disk.type === "tool") {
    if (live.call.bodyDeferred && !disk.call.bodyDeferred) {
      return {
        ...live,
        call: {
          ...disk.call,
          ...live.call,
          input: disk.call.input ?? live.call.input,
          output: disk.call.output ?? live.call.output,
          diff: disk.call.diff ?? live.call.diff,
          terminal: disk.call.terminal ?? live.call.terminal,
          images: durableToolImages(disk.call.images) ?? durableToolImages(live.call.images),
          bodyDeferred: false,
        },
      };
    }
  }
  if (
    (live.type === "thinking" || live.type === "assistant")
    && (disk.type === "thinking" || disk.type === "assistant")
    && live.bodyDeferred
    && !disk.bodyDeferred
    && disk.text.length >= live.text.length
  ) {
    return { ...live, text: disk.text, bodyDeferred: false } as SessionBlock;
  }
  return live;
}

/**
 * Rebuild a journal-worthy session from a windowed live view + existing disk
 * snapshot so stub parks cannot erase earlier transcript on disk.
 */
export function mergeSessionForJournal(disk: Session | null | undefined, live: Session): Session {
  if (!disk?.blocks.length) {
    const { window: _w, ...rest } = live;
    return { ...rest, preview: false };
  }
  if (!live.window || (live.window.earlierBlocks <= 0 && live.blocks.length >= disk.blocks.length)) {
    // Live looks complete enough; still restore fuller bodies when live stubbed.
    const byId = new Map(disk.blocks.map((block) => [block.id, block]));
    const blocks = live.blocks.map((block) => {
      const prior = byId.get(block.id);
      return prior ? preferFullerBlock(prior, block) : block;
    });
    const { window: _w, ...rest } = live;
    return { ...rest, blocks, preview: false };
  }
  const liveIds = new Set(live.blocks.map((block) => block.id));
  const prefix = disk.blocks.filter((block) => !liveIds.has(block.id));
  const byId = new Map(disk.blocks.map((block) => [block.id, block]));
  const tail = live.blocks.map((block) => {
    const prior = byId.get(block.id);
    return prior ? preferFullerBlock(prior, block) : block;
  });
  const { window: _w, ...rest } = live;
  return {
    ...rest,
    preview: false,
    blocks: [...prefix, ...tail],
  };
}
