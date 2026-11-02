/* Markdown rendering for untrusted agent output. */

import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import "katex/dist/katex.min.css";
import { invoke } from "@tauri-apps/api/core";
import type { MouseEvent } from "react";
import { memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ImageLightbox } from "../components/common/ImageLightbox";
import { cachedImageUrl, classifyImageSource, MarkdownImageScopeContext, resolveLocalImages } from "./markdownImages";
import { useI18n } from "./i18n";
import { isSafeMarkdownOpenUrl } from "./openUrlSafety";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (char) => ESCAPES[char]);

/*
 * Images keep their original reference in data-md-src. Only sources the
 * webview can load itself (https, data:image, blob) get a src up front; local
 * paths are resolved by the host after render (see markdownImages.ts), so the
 * webview never requests them against the app origin and shows a broken icon.
 */
function renderImage(href: string, title: string | null | undefined, text: string): string {
  const source = href.trim();
  const kind = classifyImageSource(source);
  if (kind === "blocked") return escapeHtml(text);
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  const srcAttr = kind === "remote" ? ` src="${escapeHtml(source)}"` : "";
  return `<img data-md-src="${escapeHtml(source)}"${srcAttr} alt="${escapeHtml(text)}"${titleAttr} loading="lazy">`;
}

function renderCodeBlock(text: string, lang: string): string {
  const language = lang.trim().toLowerCase();
  const valid = language !== "" && hljs.getLanguage(language) ? language : "";
  let highlighted: string;
  if (valid) {
    try {
      highlighted = hljs.highlight(text, { language: valid }).value;
    } catch {
      highlighted = escapeHtml(text);
    }
  } else {
    highlighted = escapeHtml(text);
  }
  const label = escapeHtml(valid || "text");
  return (
    `<div class="md-code"><div class="md-code-bar"><span class="md-code-lang">${label}</span>` +
    `<button type="button" class="md-code-copy" data-code-copy>copy</button></div>` +
    `<pre><code class="hljs${valid ? ` language-${valid}` : ""}">${highlighted}</code></pre></div>`
  );
}

marked.use({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }) {
      return renderCodeBlock(text, lang ?? "");
    },
    image({ href, title, text }) {
      return renderImage(href ?? "", title, text ?? "");
    },
  },
});
marked.use(markedKatex({ throwOnError: false, nonStandard: true, output: "mathml" }));

export function normalizeMathDelimiters(text: string): string {
  let fence: { marker: string; length: number } | undefined;
  let displayMath = false;
  return text.split("\n").map((line) => {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.marker && fenceMatch[1].length >= fence.length) fence = undefined;
      return line;
    }
    if (fenceMatch) {
      fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
      return line;
    }

    let output = "";
    let inlineTicks = 0;
    for (let index = 0; index < line.length;) {
      if (line[index] === "`") {
        let end = index + 1;
        while (line[end] === "`") end += 1;
        const ticks = end - index;
        inlineTicks = inlineTicks === 0 ? ticks : inlineTicks === ticks ? 0 : inlineTicks;
        output += line.slice(index, end);
        index = end;
        continue;
      }
      const next = line[index + 1];
      if (inlineTicks === 0 && line.startsWith("$$", index)) {
        output += displayMath ? "\n$$\n\n" : "\n\n$$\n";
        displayMath = !displayMath;
        index += 2;
        continue;
      }
      if (inlineTicks === 0 && line[index] === "\\" && line[index - 1] !== "\\" && (next === "(" || next === ")" || next === "[" || next === "]")) {
        if (next === "[") {
          output += "\n\n$$\n";
          displayMath = true;
        } else if (next === "]") {
          output += "\n$$\n\n";
          displayMath = false;
        } else {
          output += "$";
        }
        index += 2;
        continue;
      }
      output += line[index];
      index += 1;
    }
    return output;
  }).join("\n");
}

/*
 * The CLI usually emits normal GFM tables. Some streamed model responses,
 * however, collapse the header, divider and body into one physical line:
 *
 *   | Name | Purpose |---|---| tool-a | … | tool-b | … |
 *
 * A Markdown parser must treat that as a paragraph because line breaks are
 * structural in GFM. Recover the unambiguous shape before parsing it. Fenced
 * code is deliberately left untouched so source examples stay byte-for-byte.
 */
function restoreCollapsedTables(text: string): string {
  let fence: { marker: string; length: number } | undefined;

  return text.split("\n").map((line) => {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.marker && fenceMatch[1].length >= fence.length) fence = undefined;
      return line;
    }
    if (fenceMatch) {
      fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
      return line;
    }

    // A GFM divider contains at least two divider cells, e.g. |---|---|.
    // It is safe to use as a recovery signal because ordinary prose almost
    // never contains this exact sequence.
    const divider = /\|(?:\s*:?-{3,}:?\s*\|){2,}/.exec(line);
    if (!divider || divider.index === undefined) return line;

    const tableStart = line.indexOf("|");
    if (tableStart < 0 || tableStart >= divider.index) return line;

    let header = line.slice(tableStart, divider.index).trimEnd();
    const columns = (divider[0].match(/\|/g) ?? []).length - 1;
    if (columns < 2 || (header.match(/\|/g) ?? []).length < columns) return line;
    if (!header.endsWith("|")) header += " |";
    const trailing = line.slice(divider.index + divider[0].length).trim();
    if (!trailing) return `${line.slice(0, tableStart)}${header}\n${divider[0]}`;

    const cells = trailing
      .replace(/^\|\s*/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length < columns || cells.length % columns !== 0) return line;

    const rows: string[] = [];
    for (let index = 0; index < cells.length; index += columns) {
      rows.push(`| ${cells.slice(index, index + columns).join(" | ")} |`);
    }
    return `${line.slice(0, tableStart)}${header}\n${divider[0]}\n${rows.join("\n")}`;
  }).join("\n");
}

function wrapTables(html: string): string {
  return html.replace(/<table>/g, '<div class="md-table-wrap"><table>').replace(/<\/table>/g, "</table></div>");
}

export function renderMarkdownHtml(text: string): string {
  const normalized = restoreCollapsedTables(normalizeMathDelimiters(text));
  const rendered = wrapTables(marked.parse(normalized, { async: false }));
  return DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true, mathMl: true },
    FORBID_TAGS: ["style", "iframe", "object", "embed"],
    FORBID_ATTR: ["style"],
  });
}

function showMissing(image: HTMLImageElement, label: string) {
  const placeholder = document.createElement("span");
  placeholder.className = "md-img-missing";
  const source = image.getAttribute("data-md-src") ?? "";
  placeholder.title = source;
  placeholder.textContent = `🖼 ${image.alt || source.split("/").pop() || ""} · ${label}`;
  image.replaceWith(placeholder);
}

export const Markdown = memo(function Markdown({ text, className = "", streaming = false }: { text: string; className?: string; streaming?: boolean }) {
  const html = useMemo(() => renderMarkdownHtml(text), [text]);
  const scope = useContext(MarkdownImageScopeContext);
  const { t } = useI18n();
  const missingLabel = t("imageMissing");
  const rootRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const pendingImages: HTMLImageElement[] = [];
    for (const image of root.querySelectorAll<HTMLImageElement>("img[data-md-src]:not([src])")) {
      const source = image.getAttribute("data-md-src") ?? "";
      const cached = cachedImageUrl(scope, source);
      if (cached) image.src = cached;
      else if (cached === null) showMissing(image, missingLabel);
      else pendingImages.push(image);
    }
    if (pendingImages.length === 0) return;
    let cancelled = false;
    const sources = pendingImages.map((image) => image.getAttribute("data-md-src") ?? "");
    void resolveLocalImages(scope, sources).then((urls) => {
      if (cancelled) return;
      pendingImages.forEach((image, index) => {
        if (!image.isConnected) return;
        const url = urls.get(sources[index]);
        if (url) image.src = url;
        else showMissing(image, missingLabel);
      });
    });
    return () => { cancelled = true; };
  }, [html, scope.sessionId, scope.cwd, missingLabel]);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (target instanceof HTMLImageElement && target.hasAttribute("data-md-src")) {
      event.preventDefault();
      if (target.currentSrc || target.src) setPreview({ src: target.currentSrc || target.src, alt: target.alt });
      return;
    }
    const copyButton = target.closest("[data-code-copy]");
    if (copyButton instanceof HTMLElement) {
      const code = copyButton.closest(".md-code")?.querySelector("pre code")?.textContent ?? "";
      void navigator.clipboard.writeText(code).then(() => {
        copyButton.classList.add("copied");
        copyButton.textContent = "copied";
        setTimeout(() => {
          copyButton.classList.remove("copied");
          copyButton.textContent = "copy";
        }, 1200);
      });
      return;
    }
    const anchor = target.closest("a");
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute("href");
    if (!href) return;
    try {
      const url = new URL(href);
      // Dual-gate with Rust parse_browser_url / is_blocked_service_host.
      if (!isSafeMarkdownOpenUrl(url)) return;
      void invoke("open_external", { url: url.toString() });
    } catch {
      // Relative links stay inert because there is no trusted navigation base.
    }
  };
  return (
    <>
      <div
        ref={rootRef}
        className={`md ${streaming ? "md-streaming" : ""} ${className}`}
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {preview && <ImageLightbox src={preview.src} alt={preview.alt} onClose={() => setPreview(null)} />}
    </>
  );
});
