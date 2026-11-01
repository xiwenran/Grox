import { describe, expect, it } from "vitest";
import { GAZE_MAX_X, GAZE_MAX_Y, gazeOffset } from "./GrokFace";

describe("GrokFace gaze", () => {
  it("looks toward the pointer", () => {
    const right = gazeOffset(40, 100, 100, 600, 100);
    expect(right.x).toBeGreaterThan(0);
    expect(right.y).toBeCloseTo(0);
    const upLeft = gazeOffset(40, 100, 100, 0, 0);
    expect(upLeft.x).toBeLessThan(0);
    expect(upLeft.y).toBeLessThan(0);
  });

  it("is clamped to a few px relative to face size", () => {
    const far = gazeOffset(40, 0, 0, 10_000, 0);
    expect(far.x).toBeCloseTo(40 * GAZE_MAX_X);
    const farDown = gazeOffset(40, 0, 0, 0, 10_000);
    expect(farDown.y).toBeCloseTo(40 * GAZE_MAX_Y);
  });

  it("rests at center when the pointer is on the face", () => {
    expect(gazeOffset(40, 50, 50, 50, 50)).toEqual({ x: 0, y: 0 });
  });
});
