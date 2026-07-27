import { describe, expect, it } from "vitest";
import { classify } from "../src/index";

describe("original KPLUS settlement rules", () => {
  it("passes when both markers and 1.22 are present", () => {
    expect(classify("KPLUS SETTLEMENT amount 1.22")).toBe("passed");
    expect(classify("settlement KPLUS amount -1.22")).toBe("passed");
  });
  it("is silent when either required marker is missing", () => {
    expect(classify("KPLUS 1.22")).toBe("silent");
    expect(classify("SETTLEMENT 1.22")).toBe("silent");
  });
  it("holds for a later fallback when the amount is wrong", () => {
    expect(classify("KPLUS SETTLEMENT 9.99")).toBe("needs_fallback");
  });
});
