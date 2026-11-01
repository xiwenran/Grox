/**
 * Process-panel fold policy.
 *
 * 运行中的回合展开过程；回合结束后，思考、工具调用和计划统一收进一张
 * 「已处理 · N 段思考 · N 个工具」卡片并默认折叠——卡片标题本身就把审计
 * 轨迹的存在和数量写明（避免用户以为模型没思考），点开即可逐条查看，
 * 让最终答案保持主体地位。手动展开/折叠的选择会被记住，优先级高于默认策略。
 *
 * A leftover thinking.live after the session is already idle is a label
 * bug, not an open turn. Completed conversations always fold; the last
 * turn stays open only while session status is still running.
 *
 * Virtuoso recycles row components when they leave the viewport. Local
 * `useState(initialProcessOpen)` alone would re-collapse every remount and
 * thrash scroll (expand → scroll → remount → collapse → jump). Remember the
 * operator's last open/closed choice per turn for the lifetime of this
 * renderer process.
 */

import type { SessionBlock } from "../bridge/types";
import { isOpenToolStatus } from "./promptTurnTimeout";

const processOpenByTurn = new Map<string, boolean>();

/** 思考 / 工具 / 计划构成审计轨迹；纯文字回合没有可检视的过程。 */
export function turnHasInspectableProcess(blocks: readonly SessionBlock[]): boolean {
  return blocks.some(
    (block) => block.type === "thinking" || block.type === "tool" || block.type === "plan",
  );
}

export function processOpenMemoryKey(sessionId: string, turnId: string): string {
  return `${sessionId}\0${turnId}`;
}

export function rememberProcessOpen(sessionId: string, turnId: string, open: boolean): void {
  processOpenByTurn.set(processOpenMemoryKey(sessionId, turnId), open);
}

export function readProcessOpen(sessionId: string, turnId: string): boolean | undefined {
  return processOpenByTurn.get(processOpenMemoryKey(sessionId, turnId));
}

/** Test / session-teardown helper — not needed on the hot path. */
export function clearProcessOpenMemory(sessionId?: string): void {
  if (sessionId === undefined) {
    processOpenByTurn.clear();
    return;
  }
  const prefix = `${sessionId}\0`;
  for (const key of processOpenByTurn.keys()) {
    if (key.startsWith(prefix)) processOpenByTurn.delete(key);
  }
}

// `hasInspectableProcess` is kept for call-site compatibility; finished turns
// fold regardless, because the card header already summarizes the trail.
export function initialProcessOpen(complete: boolean, _hasInspectableProcess = false): boolean {
  return !complete;
}

/**
 * Prefer the operator's remembered choice; otherwise the default policy
 * (live 一直展开；结束后折叠成「已处理」卡片)。
 */
export function resolveInitialProcessOpen(
  sessionId: string,
  turnId: string,
  complete: boolean,
  hasInspectableProcess = false,
): boolean {
  const remembered = readProcessOpen(sessionId, turnId);
  if (remembered !== undefined) return remembered;
  return initialProcessOpen(complete, hasInspectableProcess);
}

/**
 * Decide the next open state when `complete` flips.
 * - live: force open
 * - just finished: fold into the 已处理 card
 * - already complete (no transition): keep current manual state
 */
export function nextProcessOpenOnCompleteChange(args: {
  wasComplete: boolean;
  complete: boolean;
  currentOpen: boolean;
  hasInspectableProcess?: boolean;
}): boolean {
  if (!args.complete) return true;
  if (!args.wasComplete && args.complete) return false;
  return args.currentOpen;
}

export function blockIsLiveProcess(block: SessionBlock): boolean {
  if (block.type === "thinking") return Boolean(block.live);
  if (block.type === "assistant") return Boolean(block.streaming);
  if (block.type === "tool") return isOpenToolStatus(block.call.status);
  return false;
}

export function turnHasLiveProcess(blocks: readonly SessionBlock[]): boolean {
  return blocks.some(blockIsLiveProcess);
}

/** Thinking / streaming only — leftover running tools must not reopen a finished turn. */
export function turnHasLiveText(blocks: readonly SessionBlock[]): boolean {
  return blocks.some((block) =>
    (block.type === "thinking" && Boolean(block.live))
    || (block.type === "assistant" && Boolean(block.streaming)),
  );
}

/** Completed process trails must never keep the "思考中" spinner. */
export function thinkingIsLive(
  block: Pick<Extract<SessionBlock, { type: "thinking" }>, "live">,
  processing?: boolean,
): boolean {
  if (processing === false) return false;
  return Boolean(block.live);
}

/**
 * Completed conversations always fold, even if a thinking block still has
 * leftover live=true. The last turn stays open only while the session is
 * still running.
 */
export function isProcessFoldComplete(args: {
  active: boolean;
  sessionTerminal: boolean;
}): boolean {
  return !args.active || args.sessionTerminal;
}
