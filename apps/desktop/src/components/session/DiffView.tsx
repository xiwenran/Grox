/* Shared inline diff renderer — official insert/delete colors.
   Lines are only rendered for files that are expanded, and long files are
   capped with 「显示更多」 so a large working-tree diff never builds tens of
   thousands of DOM rows at once. */

import { memo, useState } from "react";
import type { DiffHunk } from "../../bridge/types";
import { Icon } from "../fx/Icon";
import { useI18n } from "../../lib/i18n";

export const DIFF_LINE_PAGE = 300;

export const DiffView = memo(function DiffView({ diff, collapsed = false }: { diff: DiffHunk[]; collapsed?: boolean }) {
  return (
    <div className="space-y-2">
      {diff.map((hunk, i) => (
        <DiffFile key={`${hunk.path}-${i}`} hunk={hunk} initiallyOpen={!collapsed} />
      ))}
    </div>
  );
});

const DiffFile = memo(function DiffFile({ hunk, initiallyOpen }: { hunk: DiffHunk; initiallyOpen: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(initiallyOpen);
  const [limit, setLimit] = useState(DIFF_LINE_PAGE);
  const shown = open ? hunk.lines.slice(0, limit) : [];
  const remaining = hunk.lines.length - shown.length;
  return (
    <div className="overflow-hidden rounded-[5px] border border-line2 bg-void">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left"
      >
        <Icon name="chevronRight" size={8} className={`shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`} />
        <Icon name="file" size={10} className="text-faint" />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-mute">{hunk.path}</span>
        <span className="tnum text-[13px] text-diff-add-fg">+{hunk.added}</span>
        <span className="tnum text-[13px] text-diff-del-fg">−{hunk.removed}</span>
      </button>
      {open && (
        <div className="border-t border-line py-1 font-mono text-[13px] leading-[1.7] select-text">
          {hunk.lines.length === 0 && <div className="px-3 py-1 text-dim">{t("diffNoLines")}</div>}
          {shown.map((line, j) => (
            <div
              key={j}
              className={`flex ${
                line.kind === "add"
                  ? "bg-diff-add-bg/60 text-diff-add-fg"
                  : line.kind === "del"
                    ? "bg-diff-del-bg/60 text-diff-del-fg"
                    : "text-dim"
              }`}
            >
              <span className="w-7 shrink-0 select-none text-center opacity-70">
                {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
              </span>
              <span className="whitespace-pre-wrap">{line.text || " "}</span>
            </div>
          ))}
          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setLimit((value) => value + DIFF_LINE_PAGE * 3)}
              className="mx-2 my-1 rounded-[8px] px-2 py-0.5 text-[13px] text-dim hover:bg-raise hover:text-fg"
            >
              {t("diffShowMore").replace("{n}", String(remaining))}
            </button>
          )}
        </div>
      )}
    </div>
  );
});
