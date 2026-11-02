import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useTurnVirtualizer } from "./turnVirtualizer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let fire: ((id: string, near: boolean) => void) | null = null;
class FakeIO {
  private els = new Map<string, Element>();
  constructor(private cb: IntersectionObserverCallback) {
    fire = (id, near) => {
      const target = this.els.get(id);
      if (target) this.cb([{ target, isIntersecting: near } as IntersectionObserverEntry], this as never);
    };
  }
  observe(el: Element) { this.els.set((el as HTMLElement).dataset.id!, el); }
  unobserve() {}
  disconnect() {}
}
(globalThis as never as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO;

function Harness({ ids }: { ids: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const v = useTurnVirtualizer(ref, "s");
  return <div ref={ref}>{ids.map((id) => (
    <div key={id} data-id={id} ref={v.register(id)}>{v.near.has(id) ? `content-${id}` : ""}</div>
  ))}</div>;
}

afterEach(() => { fire = null; document.body.replaceChildren(); });

describe("useTurnVirtualizer", () => {
  it("renders only turns reported near the viewport and drops them when they leave", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Harness ids={["a", "b", "c"]} />));
    expect(host.textContent).toBe("");
    await act(async () => fire?.("b", true));
    expect(host.textContent).toBe("content-b");
    await act(async () => { fire?.("b", false); fire?.("c", true); });
    expect(host.textContent).toBe("content-c");
    await act(async () => root.unmount());
  });
});
