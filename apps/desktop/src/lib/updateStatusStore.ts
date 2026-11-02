/* Release status, checked once per app launch.
 *
 * GitHub is asked exactly once when Grox starts; the 更新日志 dialog and the
 * Settings row read the cached answer instantly. Only an explicit 检查更新
 * click asks again. There is no background polling. */

import { create } from "zustand";
import { getUpdateStatus } from "./hostActions";

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  title: string;
  notes: string;
  releaseUrl: string;
  publishedAt?: string;
  installable: boolean;
  assetName?: string;
  requiresXattr: boolean;
}

export interface ReleaseSummary {
  version: string;
  title: string;
  notes: string;
  releaseUrl: string;
  publishedAt?: string;
  installable: boolean;
}

export interface UpdateStatus {
  currentVersion: string;
  updateAvailable: boolean;
  latest: UpdateInfo;
  history: ReleaseSummary[];
  rollback?: ReleaseSummary | null;
}

interface UpdateStatusState {
  status: UpdateStatus | null;
  checking: boolean;
  error: string;
  checkedAt: number | null;
}

export const useUpdateStatus = create<UpdateStatusState>(() => ({
  status: null,
  checking: false,
  error: "",
  checkedAt: null,
}));

let inFlight: Promise<UpdateStatus | null> | null = null;
let launchCheck: Promise<UpdateStatus | null> | null = null;

/** Ask GitHub now. Concurrent callers share one request. */
export function checkForUpdates(): Promise<UpdateStatus | null> {
  if (inFlight) return inFlight;
  useUpdateStatus.setState({ checking: true, error: "" });
  inFlight = getUpdateStatus<UpdateStatus>()
    .then((status) => {
      useUpdateStatus.setState({ status, checking: false, error: "", checkedAt: Date.now() });
      return status;
    })
    .catch((cause: unknown) => {
      useUpdateStatus.setState({ checking: false, error: cause instanceof Error ? cause.message : String(cause), checkedAt: Date.now() });
      return null;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** The single automatic check for this app launch (idempotent). */
export function checkForUpdatesOnLaunch(): Promise<UpdateStatus | null> {
  launchCheck ??= checkForUpdates();
  return launchCheck;
}

/** Test hook. */
export function resetUpdateStatusForTests() {
  inFlight = null;
  launchCheck = null;
  useUpdateStatus.setState({ status: null, checking: false, error: "", checkedAt: null });
}
