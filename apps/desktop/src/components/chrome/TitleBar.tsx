/* ─────────────────────────────────────────────────────────────────────────
   TitleBar — frameless window chrome. Draggable strip; macOS keeps its
   traffic lights under an overlay, Windows gets drawn controls.
   ───────────────────────────────────────────────────────────────────────── */

import { useDesktop } from "../../state/store";
import { baseName } from "../../lib/format";
import { Icon } from "../fx/Icon";
import { useI18n } from "../../lib/i18n";
import { EnvironmentSummary } from "./EnvironmentSummary";
import { usePreferences } from "../../state/preferences";

import { currentWindow } from "../../lib/hostActions";

const inTauri = () => "__TAURI_INTERNALS__" in window;
const isWindows = () => navigator.userAgent.includes("Windows");

async function winCtl(action: "min" | "max" | "close") {
  if (!inTauri()) return;
  const win = currentWindow();
  if (action === "min") await win.minimize();
  else if (action === "max") await win.toggleMaximize();
  else await win.close();
}

export function TitleBar() {
  const { language } = useI18n();
  const activeId = useDesktop((s) => s.activeId);
  const meta = useDesktop((s) => s.sessionIndex.find((m) => m.id === s.activeId));
  const draftSession = useDesktop((s) => {
    const id = s.activeId;
    if (!id || !id.startsWith("draft-")) return null;
    return s.sessions[id] ?? null;
  });
  const toggleInspector = useDesktop((s) => s.toggleInspector);
  const inspectorOpen = useDesktop((s) => s.inspectorOpen);
  const toggleTerminal = useDesktop((s) => s.toggleTerminal);
  const terminalOpen = useDesktop((s) => s.terminalOpen);
  const sidebarVisible = usePreferences((s) => s.sidebarVisible);
  const toggleSidebar = usePreferences((s) => s.toggleSidebar);
  const breadcrumbCwd = meta?.cwd ?? draftSession?.cwd;
  const breadcrumbTitle = meta?.title
    || (draftSession
      ? (language === "zh-CN" ? "新会话" : "New session")
      : null);
  const windows = isWindows();

  return (
    <header
      data-tauri-drag-region
      className={`titlebar relative z-40 flex h-10 shrink-0 items-center border-b border-line bg-base pr-2 select-none ${windows ? "pl-2" : "pl-[78px]"}`}
    >
      {!sidebarVisible && (
        <div
          data-tauri-drag-region="false"
          className={`absolute flex items-center ${windows ? "left-2" : "left-[78px]"}`}
        >
          <button
            className="chip"
            onClick={toggleSidebar}
            title={language === "zh-CN" ? "显示侧栏（Ctrl/⌘B）" : "Show sidebar (Ctrl/⌘B)"}
            aria-label={language === "zh-CN" ? "显示侧栏" : "Show sidebar"}
          >
            <Icon name="panelLeft" size={12} />
          </button>
        </div>
      )}

      {/* center — mission breadcrumb (drag only; not interactive) */}
      <div
        data-tauri-drag-region
        className="pointer-events-none flex min-w-0 flex-1 items-center justify-center px-3"
      >
        <div className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden whitespace-nowrap text-[14px]">
          {activeId && breadcrumbCwd && breadcrumbTitle !== null ? (
            <>
              <span className="lbl max-w-[35%] shrink-0 truncate">{baseName(breadcrumbCwd)}</span>
              <span className="shrink-0 text-faint">/</span>
              <span className="min-w-0 truncate text-fg2">{breadcrumbTitle}</span>
            </>
          ) : (
            <span className="font-medium text-mute">Grox</span>
          )}
        </div>
      </div>

      {/* right cluster — must be no-drag or buttons eat drag and never click */}
      <div data-tauri-drag-region="false" className="titlebar-actions flex shrink-0 items-center gap-1">
        <EnvironmentSummary />

        <button
          className={`chip ${terminalOpen ? "!text-fg2 !border-line3" : ""}`}
          onClick={toggleTerminal}
          title={language === "zh-CN" ? "显示/隐藏终端" : "Toggle terminal"}
          aria-pressed={terminalOpen}
        >
          <Icon name="terminal" size={12} />
        </button>

        <button
          disabled={!activeId}
          className={`chip disabled:cursor-default disabled:opacity-35 ${inspectorOpen ? "!text-fg2 !border-line3" : ""}`}
          onClick={toggleInspector}
          title={!activeId ? (language === "zh-CN" ? "进入任务后可用" : "Available inside a task") : (language === "zh-CN" ? "显示/隐藏检查器" : "Toggle inspector")}
          aria-pressed={inspectorOpen}
        >
          <Icon name="panelRight" size={12} />
        </button>

        {windows && (
          <div className="ml-1 flex items-center">
            <WinBtn onClick={() => winCtl("min")} label="—" />
            <WinBtn onClick={() => winCtl("max")} label="▢" />
            <WinBtn onClick={() => winCtl("close")} label="✕" danger />
          </div>
        )}
      </div>
    </header>
  );
}

function WinBtn({ onClick, label, danger }: { onClick: () => void; label: string; danger?: boolean }) {
  return (
    <button
      type="button"
      data-tauri-drag-region="false"
      onClick={onClick}
      className={`flex h-8 w-11 items-center justify-center text-[13px] text-mute transition-colors ${
        danger ? "hover:bg-red hover:text-base" : "hover:bg-high hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
}
