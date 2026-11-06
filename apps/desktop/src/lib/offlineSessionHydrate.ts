import { invoke } from "@tauri-apps/api/core";
import type { Session, SessionMeta } from "../bridge/types";
import { isSessionTerminal } from "../bridge/types";
import { loadSessionJournal } from "./sessionCache";
import {
  reconcileSessionJournal,
  type SessionJournalReconcileOutcome,
} from "./sessionJournalReconcile";
import { sanitizeSessionForOpen } from "./sessionOpenPolicy";
import { sessionFromDiskPreview, type SessionDiskPreview } from "./sessionDiskPreview";
import { sessionWindowCleanScore, windowSessionForLive } from "./sessionWindow";

/**
 * When ACP catalogue no longer knows a sidebar mission (stale id / other CLI),
 * still try local UI cache + on-disk chat_history.jsonl so open is not empty.
 */
export async function hydrateSessionOffline(id: string, meta: SessionMeta): Promise<Session | null> {
  return (await hydrateSessionOfflineDetailed(id, meta)).session;
}

export interface OfflineSessionHydration {
  session: Session | null;
  outcome: SessionJournalReconcileOutcome;
  journalSavedAt?: number;
  journalError?: unknown;
  agentError?: unknown;
}

/** Always inspect both sources: a stale app snapshot must not hide Agent's final reply. */
export async function hydrateSessionOfflineDetailed(
  id: string,
  meta: SessionMeta,
): Promise<OfflineSessionHydration> {
  const [journalResult, agentResult] = await Promise.allSettled([
    loadSessionJournal(id),
    invoke<SessionDiskPreview | null>("preview_session_from_disk", { id }),
  ]);
  const snapshot = journalResult.status === "fulfilled" ? journalResult.value : null;
  const preview = agentResult.status === "fulfilled" ? agentResult.value : null;
  const agentSession = preview?.entries?.length ? sessionFromDiskPreview(meta, preview) : null;
  const reconciled = reconcileSessionJournal(snapshot, agentSession);
  const raw = reconciled.session
    ? reconciled.outcome === "interrupted"
      ? reconciled.session
      : { ...reconciled.session, ...sanitizeSessionForOpen(reconciled.session) }
    : null;
  // Plan B: only the live tail window enters zustand; journal stays on disk.
  const session = raw ? windowSessionForLive(raw) : null;
  return {
    ...reconciled,
    session,
    journalSavedAt: snapshot?.savedAt,
    journalError: journalResult.status === "rejected" ? journalResult.reason : undefined,
    agentError: agentResult.status === "rejected" ? agentResult.reason : undefined,
  };
}

/**
 * Prefer a cleaner in-window view over a fatter raw transcript.
 * Live busy sessions still win over idle previews.
 */
export function preferRicherSession(current: Session | undefined, incoming: Session): Session {
  if (!current) return incoming;
  const currentBusy = !isSessionTerminal(current.status) && !current.preview && current.blocks.length > 0;
  const incomingPreview = Boolean(incoming.preview);
  if (currentBusy && incomingPreview) return current;
  if (!current.preview && incoming.preview && current.blocks.length > 0 && !incoming.window) {
    return current;
  }
  // Empty shell loses to any real payload.
  if (current.blocks.length === 0 && incoming.blocks.length > 0) return incoming;
  if (incoming.blocks.length === 0 && current.blocks.length > 0) return current;

  const currentScore = sessionWindowCleanScore(current);
  const incomingScore = sessionWindowCleanScore(incoming);
  // When both are windowed (or both raw), prefer the cleaner score — not more blocks.
  if (incoming.window && !current.window) return incoming;
  if (current.window && !incoming.window && current.blocks.length > 0) return current;
  if (incomingScore !== currentScore) {
    return incomingScore >= currentScore ? incoming : current;
  }
  // Same cleanliness: keep whichever covers more of the journal via window meta.
  const currentTotal = current.window?.totalBlocks ?? current.blocks.length;
  const incomingTotal = incoming.window?.totalBlocks ?? incoming.blocks.length;
  if (incomingTotal > currentTotal) return incoming;
  if (current.blocks.length > incoming.blocks.length && !incoming.preview) return current;
  return incoming;
}
