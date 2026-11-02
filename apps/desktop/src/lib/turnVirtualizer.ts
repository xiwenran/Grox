/*
 * Turn-level virtualization for the session timeline.
 *
 * Every mounted turn keeps a wrapper element (so `data-turn-id`, rail jumps
 * and scrollIntoView keep working), but turns farther than OVERSCAN_PX from
 * the viewport render as an empty block of their last measured height. Heights
 * come from a ResizeObserver, so cards that expand/collapse are measured for
 * real. When a turn that sits entirely above the viewport changes height (an
 * estimate replaced by real content), scrollTop is shifted by the same amount
 * so what the operator is reading doesn't move.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export const TURN_OVERSCAN_PX = 1600;
/** Below this many turns everything renders; virtualization isn't worth it. */
export const TURN_VIRTUALIZE_MIN = 8;

export function estimateTurnHeight(blockCount: number): number {
  return Math.min(4000, 120 + blockCount * 56);
}

export interface TurnVirtualizer {
  /** Ids currently within the viewport + overscan. */
  near: ReadonlySet<string>;
  /** Last measured wrapper height for an id, if any. */
  height(id: string): number | undefined;
  /** Stable callback ref for the wrapper of turn `id`. */
  register(id: string): (element: HTMLElement | null) => void;
}

export function useTurnVirtualizer(scrollerRef: RefObject<HTMLElement | null>, resetKey: string): TurnVirtualizer {
  const heights = useRef(new Map<string, number>());
  const ids = useRef(new Map<Element, string>());
  const byId = useRef(new Map<string, HTMLElement>());
  const refs = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const io = useRef<IntersectionObserver | null>(null);
  const ro = useRef<ResizeObserver | null>(null);
  const [near, setNear] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    heights.current.clear();
    setNear(new Set());
  }, [resetKey]);

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const intersection = new IntersectionObserver((entries) => {
      setNear((previous) => {
        let next: Set<string> | null = null;
        for (const entry of entries) {
          const id = ids.current.get(entry.target);
          if (!id || entry.isIntersecting === previous.has(id)) continue;
          next ??= new Set(previous);
          if (entry.isIntersecting) next.add(id);
          else next.delete(id);
        }
        return next ?? previous;
      });
    }, { root, rootMargin: `${TURN_OVERSCAN_PX}px 0px ${TURN_OVERSCAN_PX}px 0px` });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => {
      const rootTop = root.getBoundingClientRect().top;
      let shift = 0;
      for (const entry of entries) {
        const id = ids.current.get(entry.target);
        if (!id) continue;
        const element = entry.target as HTMLElement;
        const height = element.offsetHeight;
        const previous = heights.current.get(id);
        heights.current.set(id, height);
        if (previous === undefined || previous === height) continue;
        const delta = height - previous;
        // Entirely above the viewport before the change → keep the reader's place.
        if (element.getBoundingClientRect().bottom - delta <= rootTop + 1) shift += delta;
      }
      if (shift !== 0) root.scrollTop += shift;
    });
    io.current = intersection;
    ro.current = resize;
    for (const element of ids.current.keys()) {
      intersection.observe(element);
      resize?.observe(element);
    }
    return () => {
      intersection.disconnect();
      resize?.disconnect();
      io.current = null;
      ro.current = null;
    };
  }, [scrollerRef]);

  const register = useCallback((id: string) => {
    let callback = refs.current.get(id);
    if (!callback) {
      callback = (element: HTMLElement | null) => {
        const old = byId.current.get(id);
        if (old && old !== element) {
          io.current?.unobserve(old);
          ro.current?.unobserve(old);
          ids.current.delete(old);
          byId.current.delete(id);
        }
        if (element && old !== element) {
          ids.current.set(element, id);
          byId.current.set(id, element);
          io.current?.observe(element);
          ro.current?.observe(element);
        }
      };
      refs.current.set(id, callback);
    }
    return callback;
  }, []);

  const height = useCallback((id: string) => heights.current.get(id), []);
  return { near, height, register };
}
