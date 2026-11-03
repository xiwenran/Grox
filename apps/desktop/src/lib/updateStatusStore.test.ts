import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: (path: string) => path }));

import { checkForUpdates, checkForUpdatesOnLaunch, resetUpdateStatusForTests, useUpdateStatus } from "./updateStatusStore";

const STATUS = {
  currentVersion: "0.3.5",
  updateAvailable: false,
  latest: { currentVersion: "0.3.5", latestVersion: "0.3.5", title: "v0.3.5", notes: "", releaseUrl: "https://github.com/x/y", installable: true, requiresXattr: false },
  history: [],
};

beforeEach(() => {
  invoke.mockReset();
  resetUpdateStatusForTests();
});

describe("更新状态缓存", () => {
  it("启动只读取一次 Host 版本信息，之后直接用缓存", async () => {
    invoke.mockResolvedValue(STATUS);
    await Promise.all([checkForUpdatesOnLaunch(), checkForUpdatesOnLaunch()]);
    await checkForUpdatesOnLaunch();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("get_update_status");
    expect(useUpdateStatus.getState().status?.currentVersion).toBe("0.3.5");
    expect(useUpdateStatus.getState().checking).toBe(false);
  });

  it("独立维护版显示本地版本并关闭安装与回退", async () => {
    invoke.mockResolvedValue({ ...STATUS, updatesDisabled: true, latest: { ...STATUS.latest, installable: false }, rollback: null });
    await checkForUpdatesOnLaunch();
    const status = useUpdateStatus.getState().status!;
    expect(status.updatesDisabled).toBe(true);
    expect(status.updateAvailable).toBe(false);
    expect(status.latest.installable).toBe(false);
    expect(status.rollback).toBeNull();
    expect(invoke.mock.calls).toEqual([["get_update_status"]]);
  });

  it("手动检查会重新请求；同时点两次只发一次", async () => {
    invoke.mockResolvedValue(STATUS);
    await checkForUpdatesOnLaunch();
    await Promise.all([checkForUpdates(), checkForUpdates()]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("检查失败时记录错误，不清掉已有结果", async () => {
    invoke.mockResolvedValueOnce(STATUS).mockRejectedValueOnce(new Error("offline"));
    await checkForUpdates();
    await checkForUpdates();
    const state = useUpdateStatus.getState();
    expect(state.status?.latest.latestVersion).toBe("0.3.5");
    expect(state.error).toBe("offline");
  });
});
