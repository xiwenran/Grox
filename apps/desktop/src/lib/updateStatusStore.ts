/* 本地版本信息。独立维护版的 Host 不发起网络检查，也不安装远端应用包。 */

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
  updatesDisabled?: boolean;
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

/** 读取 Host 管理的版本状态，并发调用共用一个请求。 */
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
