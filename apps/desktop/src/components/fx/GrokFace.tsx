/* ─────────────────────────────────────────────────────────────────────────
   GrokFace — the little living avatar.

   A round face with two upright "eye" bars. Idle: it blinks every few
   seconds. Busy (thinking / streaming / running a tool): the eyes glance
   left and right and the face gives a tiny hop. The eyes also follow the
   mouse pointer anywhere in the window (a few px, clamped, eased) via one
   shared listener — see `gazeTracker` below. Honors prefers-reduced-motion
   and the in-app reduce-motion preference (no gaze, no animation).
   ───────────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, type CSSProperties } from "react";

export type GrokFaceMood = "idle" | "busy" | "still";

export interface GrokFaceProps {
  size?: number;
  mood?: GrokFaceMood;
  className?: string;
  title?: string;
  /** Follow the mouse pointer with the eyes (default true; off for "still"). */
  followPointer?: boolean;
}

export function GrokFace({ size = 16, mood = "idle", className = "", title, followPointer }: GrokFaceProps) {
  const style = { "--face-size": `${size}px` } as CSSProperties;
  const gazeRef = useRef<HTMLSpanElement | null>(null);
  const follow = followPointer ?? mood !== "still";
  useEffect(() => {
    const el = gazeRef.current;
    if (!el || !follow) return;
    return gazeTracker.register(el, size);
  }, [follow, size]);
  return (
    <span
      className={`grok-face grok-face--${mood} ${className}`}
      style={style}
      data-mood={mood}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <span ref={gazeRef} className="grok-face__gaze">
        <span className="grok-face__eyes">
          <span className="grok-face__eye" />
          <span className="grok-face__eye" />
        </span>
      </span>
    </span>
  );
}

/* ── shared pointer → gaze tracker ──────────────────────────────────── */

interface GazeTarget {
  el: HTMLElement;
  size: number;
  x: number;
  y: number;
}

/** How far (in face sizes) the eyes may travel from center. */
export const GAZE_MAX_X = 0.12;
export const GAZE_MAX_Y = 0.08;
/** Pointer distance (px) at which the eyes reach full travel. */
const GAZE_REACH_PX = 240;
/** Per-frame easing factor toward the target offset. */
const GAZE_EASE = 0.16;

/**
 * Offset (px) the eyes should sit at for a face of `size` whose center is
 * (cx, cy), given the pointer at (px, py). Clamped to an ellipse.
 */
export function gazeOffset(size: number, cx: number, cy: number, px: number, py: number): { x: number; y: number } {
  const dx = px - cx;
  const dy = py - cy;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.5) return { x: 0, y: 0 };
  const reach = Math.min(1, dist / GAZE_REACH_PX);
  return {
    x: (dx / dist) * reach * size * GAZE_MAX_X,
    y: (dy / dist) * reach * size * GAZE_MAX_Y,
  };
}

function reducedMotion(): boolean {
  if (typeof document === "undefined") return true;
  if (document.documentElement.dataset.reduceMotion === "1") return true;
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const gazeTracker = (() => {
  const targets = new Set<GazeTarget>();
  let pointer: { x: number; y: number } | null = null;
  let frame = 0;
  let listening = false;

  const onMove = (event: PointerEvent | MouseEvent) => {
    pointer = { x: event.clientX, y: event.clientY };
    schedule();
  };
  const onLeave = () => {
    pointer = null;
    schedule();
  };

  function schedule() {
    if (!frame && typeof window !== "undefined") frame = window.requestAnimationFrame(tick);
  }

  function tick() {
    frame = 0;
    const still = reducedMotion();
    let moving = false;
    for (const t of targets) {
      let goal = { x: 0, y: 0 };
      if (pointer && !still) {
        const face = t.el.parentElement ?? t.el;
        const r = face.getBoundingClientRect();
        if (r.width > 0) goal = gazeOffset(t.size, r.left + r.width / 2, r.top + r.height / 2, pointer.x, pointer.y);
      }
      const nx = still ? goal.x : t.x + (goal.x - t.x) * GAZE_EASE;
      const ny = still ? goal.y : t.y + (goal.y - t.y) * GAZE_EASE;
      if (Math.abs(goal.x - nx) > 0.02 || Math.abs(goal.y - ny) > 0.02) moving = true;
      t.x = Math.abs(goal.x - nx) <= 0.02 ? goal.x : nx;
      t.y = Math.abs(goal.y - ny) <= 0.02 ? goal.y : ny;
      t.el.style.transform = t.x || t.y ? `translate(${t.x.toFixed(2)}px, ${t.y.toFixed(2)}px)` : "";
    }
    if (moving) schedule();
  }

  function start() {
    if (listening || typeof window === "undefined") return;
    listening = true;
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
  }

  function stop() {
    if (!listening) return;
    listening = false;
    window.removeEventListener("pointermove", onMove);
    document.documentElement.removeEventListener("pointerleave", onLeave);
    window.removeEventListener("blur", onLeave);
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
  }

  return {
    register(el: HTMLElement, size: number) {
      const target: GazeTarget = { el, size, x: 0, y: 0 };
      targets.add(target);
      start();
      schedule();
      return () => {
        targets.delete(target);
        el.style.transform = "";
        if (targets.size === 0) stop();
      };
    },
  };
})();
