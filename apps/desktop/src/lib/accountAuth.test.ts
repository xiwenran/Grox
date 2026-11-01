import { describe, expect, it } from "vitest";
import { resolveAccountAuthenticated } from "./accountAuth";

describe("resolveAccountAuthenticated", () => {
  it("does not treat auth.required=false as logged in", () => {
    expect(resolveAccountAuthenticated({})).toBe(false);
    expect(resolveAccountAuthenticated({ subscriptionAuthenticated: false })).toBe(false);
  });

  it("accepts subscription or email proof", () => {
    expect(resolveAccountAuthenticated({ subscriptionAuthenticated: true })).toBe(true);
    expect(resolveAccountAuthenticated({ email: "a@b.c" })).toBe(true);
  });
});
