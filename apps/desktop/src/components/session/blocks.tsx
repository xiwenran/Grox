/* ─────────────────────────────────────────────────────────────────────────
   Core transcript blocks: operator prompt, agent message, system event.
   ───────────────────────────────────────────────────────────────────────── */

import { useLayoutEffect, useRef, useState } from "react";
import type { SessionBlock } from "../../bridge/types";
import { fmtClock } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { Markdown } from "../../lib/markdown";
import { useDesktop } from "../../state/store";
import { BlackHole } from "../fx/BlackHole";
import { Icon } from "../fx/Icon";
import { RewindMenu } from "./RewindMenu";

type UserBlock = Extract<SessionBlock, { type: "user" }>;
type AssistantBlock = Extract<SessionBlock, { type: "assistant" }>;
type SystemBlock = Extract<SessionBlock, { type: "system" }>;

/** Operator prompt — compact and visually distinct from the agent transcript. */
export function UserMsg({ block, rewindPromptIndex }: { block: UserBlock; rewindPromptIndex?: number }) {
  const { language } = useI18n();
  const zh = language === "zh-CN";
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const element = textRef.current;
    if (element && !expanded) setOverflowing(element.scrollHeight > element.clientHeight + 1);
  }, [block.text, expanded]);
  return (
    <div className="group mb-3 flex animate-fade-up justify-end">
      <div className="flex w-fit max-w-[85%] flex-col items-end">
      <div className="user-bubble w-fit max-w-full" title={fmtClock(block.ts)}>
        <div className="flex items-start">
          <p ref={textRef} className={`user-msg-text min-w-0 flex-1 whitespace-pre-wrap text-fg select-text ${expanded ? "" : "line-clamp-6"}`}>
            {block.text}
          </p>
        </div>
        {block.attachments && block.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {block.attachments.map((attachment) => (
              <span key={attachment.id} className="flex max-w-[220px] items-center gap-1.5 rounded-full bg-white/15 px-2 py-1 text-[13px] opacity-90">
                <Icon name={attachment.kind === "image" ? "square" : "file"} size={9} className="opacity-80" />
                <span className="truncate">{attachment.name}</span>
                <span className="opacity-70">{attachment.size < 1024 * 1024 ? `${Math.max(1, Math.round(attachment.size / 1024))}K` : `${(attachment.size / 1024 / 1024).toFixed(1)}M`}</span>
              </span>
            ))}
          </div>
        )}
      </div>
        <div className="mt-1 flex items-center gap-2 text-[13px] opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"><span className="tnum text-faint">{fmtClock(block.ts)}</span>{rewindPromptIndex !== undefined && <RewindMenu targetPromptIndex={rewindPromptIndex} variant="request" />}{(overflowing || expanded) && <button onClick={() => setExpanded((value) => !value)} className="h-7 px-1.5 text-acc hover:text-fg">{expanded ? (zh ? "收起" : "Collapse") : (zh ? "显示更多" : "Show more")}</button>}<MessageActions text={block.text} /></div>
      </div>
    </div>
  );
}

/** Agent message — an editorial transcript with a quiet identity rail. */
export function AssistantMsg({ block, process = false }: { block: AssistantBlock; process?: boolean }) {
  const { language } = useI18n();
  const streaming = block.streaming ?? false;
  if (process) {
    return (
      <div className="process-text mb-2 animate-fade-up">
        <span className="process-node" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <Markdown
            text={block.text}
            streaming={streaming}
            className="process-prose text-mute"
          />
          {streaming && <span className="stream-caret" />}
        </div>
      </div>
    );
  }

  return (
    <article className="assistant-message mb-4 animate-fade-up">
      <div className="flex items-start gap-2.5">
        <BlackHole size={24} spin={streaming} className="mt-1" />
        <div className="assistant-message__content min-w-0 flex-1">
          <div className="assistant-bubble">
            <Markdown text={block.text} streaming={streaming} className="assistant-prose text-fg2" />
            {streaming && <span className="stream-caret" />}
          </div>
          {streaming && <div className="mt-1 pl-1 text-[13px] text-faint">{language === "zh-CN" ? "正在输出…" : "Writing…"}</div>}
          {!streaming && <div className="mt-1.5 flex justify-start pl-1"><MessageActions text={block.text} /></div>}
        </div>
      </div>
    </article>
  );
}

function MessageActions({ text }: { text: string }) {
  const { language } = useI18n();
  const activeSessionId = useDesktop((state) => state.activeId);
  const continueSessionInNewChat = useDesktop((state) => state.continueSessionInNewChat);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    });
  };
  const continueInNewTask = () => {
    if (activeSessionId) void continueSessionInNewChat(activeSessionId);
  };
  return <div className="flex items-center gap-1 opacity-65 transition-opacity hover:opacity-100">
    <button onClick={copy} className="flex h-7 items-center gap-1 rounded-full px-2 text-[13px] text-dim hover:bg-high hover:text-fg2" title={language === "zh-CN" ? "复制这条消息" : "Copy message"}><Icon name="copy" size={9} />{copied ? (language === "zh-CN" ? "已复制" : "Copied") : (language === "zh-CN" ? "复制" : "Copy")}</button>
    <button disabled={!activeSessionId} onClick={continueInNewTask} className="flex h-7 items-center gap-1 rounded-full px-2 text-[13px] text-dim hover:bg-high hover:text-fg2 disabled:opacity-40" title={language === "zh-CN" ? "复制完整上下文到一个新任务" : "Fork the full context into a new task"}><Icon name="branch" size={9} />{language === "zh-CN" ? "新任务继续" : "Continue"}</button>
  </div>;
}

/** System event — a centered mono whisper (compact, rewind, errors). */
export function SystemEvent({ block }: { block: SystemBlock }) {
  const tone =
    block.kind === "error" ? "text-red" : block.kind === "compact" || block.kind === "rewind" ? "text-gold" : "text-dim";
  return (
    <div className="mb-2 flex min-h-7 items-start gap-2 rounded-[5px] border border-line bg-high/30 px-2.5 py-1.5 animate-fade-up">
      <Icon name={block.kind === "error" ? "x" : block.kind === "rewind" ? "refresh" : "bolt"} size={10} className={`mt-1 shrink-0 ${tone}`} />
      <span className={`min-w-0 font-mono text-[13px] leading-relaxed ${tone}`}>{block.text}</span>
    </div>
  );
}
