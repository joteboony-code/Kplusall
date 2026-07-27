import { describe, expect, it } from "vitest";
import { analyzeOcr, classify, imageSetMetadata } from "../src/index";

describe("original KPLUS settlement rules", () => {
  it("passes when both markers and 1.22 are present", () => {
    expect(classify("KPLUS SETTLEMENT amount 1.22")).toBe("passed");
    expect(classify("settlement KPLUS amount -1.22")).toBe("passed");
  });

  it("recognizes the original K+ and Thai QR payment evidence", () => {
    expect(classify("K+\nSETTLEMENT\nAMT: -THB 1.22")).toBe("passed");
    expect(classify("Thai QR Payment\nSETTLEMENT\nAMOUNT THB 1.22")).toBe("passed");
    expect(classify("Kplus122 replied\nSETTLEMENT\n1.22")).toBe("silent");
  });
  it("is silent when either required marker is missing", () => {
    expect(classify("KPLUS 1.22")).toBe("silent");
    expect(classify("SETTLEMENT 1.22")).toBe("silent");
  });
  it("holds for a later fallback when the amount is wrong", () => {
    expect(classify("KPLUS SETTLEMENT 9.99")).toBe("needs_fallback");
  });

  it("returns the details needed by the regional control log", () => {
    expect(analyzeOcr("KPLUS SETTLEMENT amount -1.22")).toMatchObject({
      result: "passed",
      foundKplus: true,
      foundSettlement: true,
      matchedAmount: "-1.22",
      detectedAmounts: ["-1.22"]
    });

    expect(analyzeOcr("KPLUS SETTLEMENT amount 9.99")).toMatchObject({
      result: "needs_fallback",
      foundKplus: true,
      foundSettlement: true,
      matchedAmount: null,
      detectedAmounts: ["9.99"]
    });
  });

  it("records which required marker is missing", () => {
    const analysis = analyzeOcr("KPLUS amount 1.22");

    expect(analysis.result).toBe("silent");
    expect(analysis.foundKplus).toBe(true);
    expect(analysis.foundSettlement).toBe(false);
    expect(analysis.reason).toContain("SETTLEMENT");
  });

  it("keeps LINE image-set metadata for every image in a batch", () => {
    expect(imageSetMetadata({
      message: {
        type: "image",
        id: "image-3",
        imageSet: { id: "set-7-images", index: 3, total: 7 }
      }
    })).toEqual({ id: "set-7-images", index: 3, total: 7 });

    expect(imageSetMetadata({
      message: { type: "image", id: "single-image" }
    })).toEqual({ id: null, index: null, total: null });
  });
});
