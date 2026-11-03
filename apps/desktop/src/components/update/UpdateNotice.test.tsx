import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ installUpdate: vi.fn(), rollbackUpdate: vi.fn(), openExternal: vi.fn(), getUpdateStatus: vi.fn() }));
vi.mock("../../lib/hostActions", () => actions);

import { UpdateNotice } from "./UpdateNotice";
import { useUpdateStatus } from "../../lib/updateStatusStore";

beforeEach(() => { vi.clearAllMocks(); });

it("独立维护版的版本窗口显示版本来源，不提供更新和回退操作", async () => {
  const status = {
    currentVersion: "0.3.5 (abc1234)", updatesDisabled: true, updateAvailable: false,
    latest: { currentVersion: "0.3.5", latestVersion: "0.3.5", title: "Grox", notes: "", releaseUrl: "", installable: false, requiresXattr: false },
    history: [], rollback: null,
  };
  useUpdateStatus.setState({ status, checking: false, error: "" });
  actions.getUpdateStatus.mockResolvedValue(status);
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => { root.render(<UpdateNotice />); });
  await act(async () => { window.dispatchEvent(new Event("grox:open-update-center")); });
  expect(host.textContent).toContain("Grox 独立维护版");
  expect(host.textContent).toContain("0.3.5 (abc1234)");
  expect(host.textContent).not.toMatch(/一键更新|手动下载|手动检查更新|一键回退/);
  expect(actions.installUpdate).not.toHaveBeenCalled();
  expect(actions.rollbackUpdate).not.toHaveBeenCalled();
  await act(async () => { root.unmount(); });
});
