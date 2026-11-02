import { capWord } from "../../lib/format";
import { type AgentMode, type Effort, type PermissionMode } from "../../bridge/types";
import { useI18n } from "../../lib/i18n";
import { useDesktop } from "../../state/store";
import { useProviderCapability } from "../../state/providerCapabilityStore";
import { Icon } from "../fx/Icon";
import { ChipSelect, SectionedSelect } from "./ChipSelect";

/** Small marker beside the model chip, shown only when a non-default provider
 * (anything other than Grok OAuth) is active. Switching lives in Settings. */
export function ProviderMarker() {
  const { t } = useI18n();
  const provider = useProviderCapability((state) => state.provider);
  const profiles = useProviderCapability((state) => state.profiles);
  const activeProfileId = useProviderCapability((state) => state.activeProfileId);
  if (provider.kind === "oauth" && !activeProfileId) return null;
  const name = profiles.find((profile) => profile.id === activeProfileId)?.name
    ?? (provider.kind === "official" ? "xAI API" : "OpenAI API");
  return (
    <span title={t("providerMarkerTitle")} className="max-w-[120px] truncate rounded-full bg-acc/10 px-2 py-0.5 text-[12px] text-acc">
      {name}
    </span>
  );
}

export function ProviderSwitcher({ variant = "chip", menuPlacement = "up", align = "start" }: { variant?: "chip" | "field"; menuPlacement?: "up" | "down"; align?: "start" | "end" } = {}) {
  const { language } = useI18n();
  const provider = useProviderCapability((state) => state.provider);
  const profiles = useProviderCapability((state) => state.profiles);
  const activeProfileId = useProviderCapability((state) => state.activeProfileId);
  const switching = useProviderCapability((state) => state.switching);
  const configure = useDesktop((state) => state.configureProvider);
  const activate = useDesktop((state) => state.activateProviderProfile);
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  const activeId = activeProfileId ?? provider.kind;
  const label = switching
    ? (language === "zh-CN" ? "等待本轮完成" : "Waiting for turn")
    : activeProfile?.name ?? (provider.kind === "oauth" ? "Grok OAuth" : provider.kind === "official" ? "xAI API" : "OpenAI API");
  const items = [
    { id: "oauth", label: "Grok OAuth", hint: language === "zh-CN" ? "官方账户" : "Official account" },
    ...(provider.kind === "official" && !activeProfileId
      ? [{ id: "official", label: "xAI API", hint: language === "zh-CN" ? "当前官方密钥" : "Current official key" }]
      : []),
    ...profiles.map((profile) => ({
      id: profile.id,
      label: profile.name,
      hint: profile.baseUrl.replace(/^https?:\/\//, ""),
    })),
  ];

  return (
    <ChipSelect
      label={<span className="text-fg2">{label}</span>}
      items={items}
      activeId={activeId}
      disabled={switching}
      width={330}
      variant={variant}
      menuPlacement={menuPlacement}
      align={align}
      onSelect={(id) => {
        if (id === activeId || id === "official") return;
        if (id === "oauth") void configure({ kind: "oauth" }).catch(() => {});
        else void activate(id).catch(() => {});
      }}
    />
  );
}

/*
 * Composer "mode · effort" menu. Only what the official grok CLI exposes:
 *  - 思考强度: the `reasoning_effort` configOption that `grok agent stdio`
 *    returns from session/new (category thought_level). Names/descriptions
 *    mirror the CLI's; the per-model list comes from the CLI model catalogue.
 *  - 权限: the CLI's permission modes as exposed to ACP clients — default
 *    "ask" (prompt for approval), `_meta.autoMode` (Auto-review) and
 *    `_meta.yoloMode` (always-approve) on session/new.
 *  - 模式: the CLI's plan mode (/plan); default otherwise.
 * No Grox-invented options.
 */
export const CLI_EFFORT_ORDER: readonly Effort[] = ["xhigh", "high", "medium", "low"];

type T = ReturnType<typeof useI18n>["t"];

/** Labels are the CLI's own option names; hints translate the CLI descriptions. */
export function cliEffortLabel(effort: Effort, t: T): { label: string; hint: string } {
  switch (effort) {
    case "xhigh": return { label: "Extra High", hint: t("effortXhighHint") };
    case "high": return { label: "High", hint: t("effortHighHint") };
    case "medium": return { label: "Medium", hint: t("effortMediumHint") };
    case "low": return { label: "Low", hint: t("effortLowHint") };
    default: return { label: capWord(effort), hint: "" };
  }
}

export function permissionLabel(mode: PermissionMode, t: T): string {
  return mode === "bypass" ? t("permAlways") : mode === "auto" ? t("permAuto") : t("permAsk");
}

export function PromptOptionsMenu({
  mode,
  effort,
  permissionMode,
  onMode,
  onEffort,
  onPermission,
  efforts,
}: {
  mode: AgentMode;
  effort: Effort;
  permissionMode: PermissionMode;
  onMode(mode: AgentMode): void;
  onEffort(effort: Effort): void;
  onPermission(mode: PermissionMode): void;
  efforts?: readonly Effort[];
}) {
  const { t } = useI18n();
  // Prefer the model's CLI-advertised list; otherwise the CLI's standard four.
  const advertised = efforts && efforts.length > 0 ? CLI_EFFORT_ORDER.filter((e) => efforts.includes(e)) : [];
  const effortItems = (advertised.length > 0 ? advertised : CLI_EFFORT_ORDER).map((value) => ({ id: value, ...cliEffortLabel(value, t) }));
  const parts = [mode === "plan" ? t("modePlanShort") : "", cliEffortLabel(effort, t).label, permissionMode !== "default" ? permissionLabel(permissionMode, t) : ""].filter(Boolean);
  return (
    <SectionedSelect
      label={<span className="inline-flex items-center gap-1.5"><Icon name="gear" size={10} />{parts.join(" · ")}</span>}
      title={t("promptOptionsTitle")}
      aria-label={t("promptOptionsTitle")}
      width={360}
      sections={[
        {
          id: "mode",
          label: t("modeSection"),
          activeId: mode === "plan" ? "plan" : mode === "agent" ? "agent" : undefined,
          items: [
            { id: "agent", label: t("modeDefault"), hint: t("modeDefaultHint") },
            { id: "plan", label: t("modePlan"), hint: t("modePlanHint") },
          ],
          onSelect: (id) => onMode(id as AgentMode),
        },
        {
          id: "permission",
          label: t("permSection"),
          activeId: permissionMode,
          items: [
            { id: "default", label: t("permAsk"), hint: t("permAskHint") },
            { id: "auto", label: t("permAuto"), hint: t("permAutoHint") },
            { id: "bypass", label: t("permAlways"), hint: t("permAlwaysHint") },
          ],
          onSelect: (id) => onPermission(id as PermissionMode),
        },
        {
          id: "effort",
          label: t("effortSection"),
          activeId: effort,
          items: effortItems,
          onSelect: (id) => onEffort(id as Effort),
        },
      ]}
    />
  );
}
