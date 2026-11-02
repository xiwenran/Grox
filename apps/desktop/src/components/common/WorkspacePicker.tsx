/* Composer bottom-left project folder picker. Before the first message the
   draft can move to any recent project folder (or a newly chosen one); after
   that the session is bound to its folder and this is a read-only label. */

import { useMemo } from "react";
import { useDesktop } from "../../state/store";
import { useI18n } from "../../lib/i18n";
import { samePath } from "../../lib/projectCatalog";
import { Icon } from "../fx/Icon";
import { ChipSelect } from "./ChipSelect";

const PICK = "__pick_folder__";
const RECENT_LIMIT = 8;

export function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || trimmed;
}

export function WorkspacePicker({ locked = false, path }: { locked?: boolean; path?: string }) {
  const { t } = useI18n();
  const currentWorkspace = useDesktop((state) => state.workspace);
  const workspace = (locked && path) || currentWorkspace;
  const projects = useDesktop((state) => state.projects);
  const switchDraftWorkspace = useDesktop((state) => state.switchDraftWorkspace);

  const items = useMemo(() => {
    const recent = [...projects]
      .filter((project) => !project.archived)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastOpenedAt - a.lastOpenedAt)
      .slice(0, RECENT_LIMIT)
      .map((project) => ({ id: project.path, label: project.name || folderName(project.path), hint: project.path }));
    if (workspace && !recent.some((item) => samePath(item.id, workspace))) {
      recent.unshift({ id: workspace, label: folderName(workspace), hint: workspace });
    }
    return [...recent, { id: PICK, label: t("workspacePickerPick") }];
  }, [projects, workspace, t]);

  const label = (
    <span className="flex max-w-[180px] items-center gap-1.5 text-fg2" title={workspace}>
      <Icon name="folder" size={12} className="shrink-0 text-faint" />
      <span className="truncate">{workspace ? folderName(workspace) : t("workspacePickerPick")}</span>
    </span>
  );

  if (locked) {
    return (
      <span
        className="flex h-8 items-center rounded-full px-2.5 text-[13px] text-dim"
        title={`${t("workspacePickerLocked")}\n${workspace}`}
      >
        {label}
      </span>
    );
  }

  return (
    <ChipSelect
      aria-label={t("workspacePickerTitle")}
      label={label}
      items={items}
      activeId={items.find((item) => item.id !== PICK && samePath(item.id, workspace))?.id}
      width={300}
      onSelect={(id) => void switchDraftWorkspace(id === PICK ? undefined : id)}
    />
  );
}
