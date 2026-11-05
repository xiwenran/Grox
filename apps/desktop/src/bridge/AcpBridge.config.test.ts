import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigDocument } from "./types";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { AcpBridge } from "./AcpBridge";

describe("AcpBridge config documents", () => {
  beforeEach(() => {
    invoke.mockReset();
    localStorage.clear();
  });

  it("保存时使用编辑器捕获的工作区，而不是 bridge 的可变当前工作区", async () => {
    invoke.mockResolvedValue({});
    const bridge = new AcpBridge();
    const document: ConfigDocument = {
      id: "agents",
      label: "AGENTS.md",
      path: "/project-a/AGENTS.md",
      content: "project rules",
      exists: true,
      language: "markdown",
    };

    await bridge.writeConfigDocument(document, "/project-a");

    expect(invoke).toHaveBeenCalledWith("write_config_document", {
      request: { id: "agents", cwd: "/project-a", content: "project rules" },
    });
  });

  it("恢复会话时绑定当前 reasoning effort 但不重选模型", async () => {
    localStorage.setItem("grok.effort", "max");
    invoke.mockRejectedValue(new Error("stop after request capture"));
    const bridge = new AcpBridge();
    const internal = bridge as unknown as {
      catalogue: Map<string, unknown>;
    };
    internal.catalogue.set("session-a", {
      id: "session-a",
      title: "Session A",
      cwd: "/project-a",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: "grok-build",
      turns: 1,
    });

    await expect(bridge.loadSession("session-a")).rejects.toThrow("stop after request capture");

    expect(invoke).toHaveBeenCalledWith("open_agent_session", {
      request: expect.objectContaining({
        cwd: "/project-a",
        sessionId: "session-a",
        reasoningEffort: "max",
      }),
    });
    const request = invoke.mock.calls[0][1].request as Record<string, unknown>;
    expect(request).not.toHaveProperty("preferredModel");
  });

  it("持久化首条消息期间切换运行时，不会在新账号下创建会话", async () => {
    const bridge = new AcpBridge();
    const internal = bridge as unknown as { acpGeneration: number };
    internal.acpGeneration = 7;
    let finish!: () => void;
    const preparation = new Promise<void>(resolve => { finish = resolve; });
    const creating = bridge.newSession("/project-a", "pending-a", preparation);
    const rejected = expect(creating).rejects.toThrow("运行环境已切换");
    expect(invoke).not.toHaveBeenCalled();
    internal.acpGeneration = 8;
    finish();
    await rejected;
    expect(invoke).not.toHaveBeenCalled();
  });

  it("首条消息保存失败时不创建会话", async () => {
    const bridge = new AcpBridge();
    await expect(bridge.newSession("/project-a", "pending-a", Promise.reject(new Error("磁盘写入失败"))))
      .rejects.toThrow("磁盘写入失败");
    expect(invoke).not.toHaveBeenCalled();
  });
});
