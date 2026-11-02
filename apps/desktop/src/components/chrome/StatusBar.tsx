/* ─────────────────────────────────────────────────────────────────────────
   StatusBar — the telemetry strip. Spacecraft instrument readouts for the
   active mission: link state, context burn, token flow, cost, model.
   ───────────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react";
import { useDesktop } from "../../state/store";
import { gitSummary } from "../../lib/hostActions";
import { fmtCost, fmtTokens } from "../../lib/format";
import { BlackHole } from "../fx/BlackHole";
import { useI18n } from "../../lib/i18n";

export function StatusBar() {
  const { language, t } = useI18n();
  const activeId = useDesktop((s) => s.activeId);
  const sessionStatus = useDesktop((s) => (s.activeId ? s.sessions[s.activeId]?.status : undefined));
  const usage = useDesktop((s) => (s.activeId ? s.sessions[s.activeId]?.usage : undefined));
  const runtimeConnection = useDesktop((s) => s.runtimeConnection);
  const workspace = useDesktop((s) => s.workspace);
  const [branch, setBranch] = useState<string | null>(null);

  const status = sessionStatus ?? "idle";
  const presentation = runtimeConnection === "reconnecting"
    ? { zh: "正在重连", en: "Reconnecting", tone: "text-gold", spin: "slow" as const }
    : runtimeConnection === "offline"
      ? { zh: "运行时离线", en: "Runtime offline", tone: "text-red", spin: false as const }
      : runtimeConnection === "starting"
        ? { zh: "正在连接", en: "Connecting", tone: "text-mute", spin: "slow" as const }
        : status === "connecting"
          ? { zh: "正在恢复", en: "Restoring", tone: "text-mute", spin: "slow" as const }
          : status === "running"
            ? { zh: "处理中", en: "Working", tone: "text-acc", spin: true as const }
            : status === "stopping"
              ? { zh: "正在停止", en: "Stopping", tone: "text-gold", spin: "slow" as const }
              : status === "cancelled"
                ? { zh: "已停止", en: "Stopped", tone: "text-gold", spin: false as const }
              : status === "disconnected"
                ? { zh: "连接已中断", en: "Disconnected", tone: "text-red", spin: false as const }
                : status === "failed"
                  ? { zh: "失败", en: "Failed", tone: "text-red", spin: false as const }
                  : status === "awaiting_permission"
                    ? { zh: "等待批准", en: "Awaiting approval", tone: "text-gold", spin: "slow" as const }
                    : status === "awaiting_input"
                      ? { zh: "等待输入", en: "Awaiting input", tone: "text-gold", spin: "slow" as const }
                      : { zh: "已完成", en: "Completed", tone: "text-mute", spin: false as const };
  const ctxPct =
    usage && usage.contextMax > 0
      ? Math.min(100, Math.round((usage.contextUsed / usage.contextMax) * 100))
      : 0;

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window) || !workspace) {
      setBranch(null);
      return;
    }
    let cancelled = false;
    void gitSummary<{ branch?: string; isRepository: boolean }>(workspace)
      .then((summary) => {
        if (!cancelled) setBranch(summary.isRepository ? (summary.branch ?? "DETACHED") : null);
      })
      .catch(() => {
        if (!cancelled) setBranch(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace, activeId, status]);

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between border-t border-line bg-panel px-3 text-[13px] text-dim select-none">
      <div className="flex items-center gap-2">
        <BlackHole size={13} spin={presentation.spin} />
        <span className={presentation.tone}>
          {language === "zh-CN" ? presentation.zh : presentation.en}
        </span>
        {branch && (
          <>
            <Sep />
            <span className="tnum text-fg2">{branch}</span>
          </>
        )}
      </div>

      {usage && (usage.contextUsed > 0 || usage.inputTokens + usage.outputTokens > 0) && (
        <div className="flex items-center gap-1">
          {usage.contextMax > 0 && (
            <HoverDetail
              trigger={
                <>
                  <ContextRing pct={ctxPct} />
                  <span className={`tnum ${ctxPct > 80 ? "text-gold" : "text-fg2"}`}>{ctxPct}%</span>
                </>
              }
              label={t("sbContext")}
            >
              <p className="text-[13px] leading-[1.55] text-fg2">
                {t("sbContextDetail")
                  .replace("{used}", fmtTokens(usage.contextUsed))
                  .replace("{max}", fmtTokens(usage.contextMax))
                  .replace("{pct}", String(ctxPct))}
              </p>
            </HoverDetail>
          )}
          <HoverDetail
            trigger={
              <>
                <span>{t("sbSession")}</span>
                <span className="tnum text-fg2">{fmtTokens(usage.inputTokens + usage.outputTokens)}</span>
                {usage.costUSD > 0 && <span className="tnum text-fg2">· {fmtCost(usage.costUSD)}</span>}
              </>
            }
            label={t("sbSessionTitle")}
          >
            <p className="mb-2 text-[12px] font-semibold text-faint">{t("sbSessionTitle")}</p>
            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-[13px]">
              <dt className="text-dim">{t("sbInput")}</dt><dd className="tnum text-right text-fg2">{fmtTokens(usage.inputTokens)}</dd>
              {usage.cacheReadTokens > 0 && <><dt className="pl-3 text-dim">{t("sbCacheRead")}</dt><dd className="tnum text-right text-fg2">{fmtTokens(usage.cacheReadTokens)}</dd></>}
              <dt className="text-dim">{t("sbOutput")}</dt><dd className="tnum text-right text-fg2">{fmtTokens(usage.outputTokens)}</dd>
              <dt className="text-dim">{t("sbTurns")}</dt><dd className="tnum text-right text-fg2">{usage.turns}</dd>
              {usage.costUSD > 0 && <><dt className="text-dim">{t("sbCost")}</dt><dd className="tnum text-right text-fg2">{fmtCost(usage.costUSD)}</dd></>}
            </dl>
            <p className="mt-2 text-[12px] leading-[1.55] text-faint">{t("sbInputHint")}</p>
          </HoverDetail>
        </div>
      )}
    </footer>
  );
}

const Sep = () => <span className="text-faint">·</span>;

/** 12px ring: a compact context gauge instead of a long bar. */
function ContextRing({ pct }: { pct: number }) {
  const r = 4.5;
  const c = 2 * Math.PI * r;
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0 -rotate-90">
      <circle cx="6" cy="6" r={r} fill="none" strokeWidth="2" className="stroke-high" />
      <circle
        cx="6" cy="6" r={r} fill="none" strokeWidth="2" strokeLinecap="round"
        className={pct > 80 ? "stroke-gold" : "stroke-acc"}
        strokeDasharray={`${(c * Math.max(0, Math.min(100, pct))) / 100} ${c}`}
      />
    </svg>
  );
}

/** Ghost button with a small rounded popover shown on hover or keyboard focus. */
function HoverDetail({ trigger, label, children }: { trigger: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <span className="group/hd relative">
      <button
        type="button"
        aria-label={label}
        className="flex h-6 items-center gap-1.5 rounded-full px-2 text-[13px] text-dim hover:bg-raise hover:text-fg2 focus-visible:bg-raise"
      >
        {trigger}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full right-0 z-40 mb-2 w-[280px] rounded-[14px] bg-raise p-3 opacity-0 shadow-[0_16px_44px_rgba(60,70,150,0.18),0_2px_8px_rgba(60,70,150,0.08)] transition-opacity duration-150 group-hover/hd:visible group-hover/hd:opacity-100 group-hover/hd:delay-[380ms] group-focus-within/hd:visible group-focus-within/hd:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}
