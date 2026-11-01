/* ─────────────────────────────────────────────────────────────────────────
   BlackHole — historical name for the app mark. It now renders the
   animated GrokFace avatar so every call site (sidebar, home hero,
   transcript, status, thinking indicators) shares one living identity.

   spin = true    → busy (eyes look around, small hop)
   spin = "slow"  → idle (occasional blink)
   spin = false   → idle (occasional blink)
   ───────────────────────────────────────────────────────────────────────── */

import { GrokFace } from "./GrokFace";

export interface BlackHoleProps {
  size?: number;
  /** true = busy/working animation; "slow" or false = idle blinking */
  spin?: boolean | "slow";
  className?: string;
}

export function BlackHole({ size = 16, spin = false, className }: BlackHoleProps) {
  return <GrokFace size={size} mood={spin === true ? "busy" : "idle"} className={className} />;
}
