/* Images inside assistant Markdown.
 *
 * The grok CLI shows pictures by saving them into its session folder and
 * writing a session-relative image such as `![拼读](images/1.jpg)`; agents also
 * link absolute paths or file:// URLs. The webview cannot load any of those
 * directly (they resolve against the app origin), so local sources are
 * rendered without `src`, then mapped by the host to a real file that is
 * granted to the asset protocol, and finally loaded through convertFileSrc. */

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { createContext } from "react";

export interface MarkdownImageScope {
  sessionId?: string;
  cwd?: string;
}

export const MarkdownImageScopeContext = createContext<MarkdownImageScope>({});

export type ImageSourceKind = "remote" | "local" | "blocked";

/** remote: the webview loads it itself; local: ask the host; blocked: never load. */
export function classifyImageSource(source: string): ImageSourceKind {
  const value = source.trim();
  if (!value) return "blocked";
  if (/^data:image\//i.test(value) || /^blob:/i.test(value)) return "remote";
  if (/^https?:\/\//i.test(value)) return "remote";
  if (/^file:\/\//i.test(value)) return "local";
  // Windows drive paths look like a scheme ("C:\…"); treat them as local.
  if (/^[a-z]:[\\/]/i.test(value)) return "local";
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return "blocked";
  return "local";
}

type Resolved = string | null;
const cache = new Map<string, Resolved>();
const pending = new Map<string, Promise<Resolved>>();

const cacheKey = (scope: MarkdownImageScope, source: string) => `${scope.sessionId ?? ""}\u0000${scope.cwd ?? ""}\u0000${source}`;

/** Synchronous cache hit: a loadable URL, null when known-missing, undefined when unknown. */
export function cachedImageUrl(scope: MarkdownImageScope, source: string): Resolved | undefined {
  return cache.get(cacheKey(scope, source));
}

/** Resolve local sources to webview URLs; null means the file could not be found. */
export async function resolveLocalImages(scope: MarkdownImageScope, sources: string[]): Promise<Map<string, Resolved>> {
  const result = new Map<string, Resolved>();
  const unique = [...new Set(sources)];
  const missing: string[] = [];
  const waits: Promise<void>[] = [];
  for (const source of unique) {
    const key = cacheKey(scope, source);
    if (cache.has(key)) result.set(source, cache.get(key) ?? null);
    else if (pending.has(key)) waits.push(pending.get(key)!.then((url) => { result.set(source, url); }));
    else missing.push(source);
  }
  for (let start = 0; start < missing.length; start += 64) {
    const batch = missing.slice(start, start + 64);
    const request = invoke<Array<string | null>>("resolve_markdown_images", {
      sessionId: scope.sessionId ?? null,
      cwd: scope.cwd ?? null,
      sources: batch,
    }).then(
      (paths) => batch.map((_, index) => (paths[index] ? convertFileSrc(paths[index]!) : null)),
      () => batch.map(() => null),
    );
    batch.forEach((source, index) => {
      const key = cacheKey(scope, source);
      const one = request.then((urls) => {
        const url = urls[index] ?? null;
        cache.set(key, url);
        pending.delete(key);
        return url;
      });
      pending.set(key, one);
      waits.push(one.then((url) => { result.set(source, url); }));
    });
  }
  await Promise.all(waits);
  return result;
}

/** Test hook. */
export function clearMarkdownImageCache() {
  cache.clear();
  pending.clear();
}
