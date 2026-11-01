/* ─────────────────────────────────────────────────────────────────────────
   GrokFace — the little living avatar.

   A round face with two upright "eye" bars. Idle: it blinks every few
   seconds. Busy (thinking / streaming / running a tool): the eyes glance
   left and right and the face gives a tiny hop. Pure CSS — see the
   `.grok-face` rules in styles/tokens.css. Honors prefers-reduced-motion
   and the in-app reduce-motion preference.
   ───────────────────────────────────────────────────────────────────────── */

import type { CSSProperties } from "react";

export type GrokFaceMood = "idle" | "busy" | "still";

export interface GrokFaceProps {
  size?: number;
  mood?: GrokFaceMood;
  className?: string;
  title?: string;
}

export function GrokFace({ size = 16, mood = "idle", className = "", title }: GrokFaceProps) {
  const style = { "--face-size": `${size}px` } as CSSProperties;
  return (
    <span
      className={`grok-face grok-face--${mood} ${className}`}
      style={style}
      data-mood={mood}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <span className="grok-face__eyes">
        <span className="grok-face__eye" />
        <span className="grok-face__eye" />
      </span>
    </span>
  );
}
