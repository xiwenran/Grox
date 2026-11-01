/* ─────────────────────────────────────────────────────────────────────────
   The wordmark: the living face avatar + "Grox" in the system sans,
   normal case, no wide tracking.
   ───────────────────────────────────────────────────────────────────────── */

import type { ReactNode } from "react";
import { BlackHole } from "./BlackHole";

export function Wordmark({
  size = 15,
  withMark = true,
  markSpin = false,
  className = "",
}: {
  size?: number;
  withMark?: boolean;
  markSpin?: boolean | "slow";
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {withMark && <BlackHole size={Math.round(size * 1.6)} spin={markSpin} />}
      <span className="font-sans font-semibold text-fg" style={{ fontSize: size + 1, letterSpacing: "-0.01em" }}>
        Grox
      </span>
    </span>
  );
}

/** Caption paired under the wordmark, e.g. "Desktop · build 0.1.0". */
export function WordmarkCaption({ children }: { children: ReactNode }) {
  return <div className="lbl">{children}</div>;
}
