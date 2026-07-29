import { describe, expect, it } from "vitest";
import {
  bangkokDate,
  imageExpired,
  imageTooLarge,
  MAX_IMAGE_BYTES,
  MAX_OCR_ATTEMPTS,
  rankOcrSpaceKeyRegions,
  regionFromWebhookPath,
  shouldRetryOcr
} from "../src/index";

describe("operational safety limits", () => {
  it("rejects an image only after the configured byte ceiling", () => {
    expect(MAX_IMAGE_BYTES).toBe(8 * 1024 * 1024);
    expect(imageTooLarge(MAX_IMAGE_BYTES)).toBe(false);
    expect(imageTooLarge(MAX_IMAGE_BYTES + 1)).toBe(true);
    expect(imageTooLarge(Number.NaN)).toBe(true);
  });

  it("allows exactly one OCR retry", () => {
    expect(MAX_OCR_ATTEMPTS).toBe(2);
    expect(shouldRetryOcr(1)).toBe(true);
    expect(shouldRetryOcr(2)).toBe(false);
  });

  it("selects cached images older than one day for scheduled cleanup", () => {
    const now = Date.UTC(2026, 6, 28, 12);
    expect(imageExpired(new Date(now - 24 * 60 * 60 * 1000), now)).toBe(true);
    expect(imageExpired(new Date(now - 23 * 60 * 60 * 1000), now)).toBe(false);
  });

  it("resets daily usage at midnight in Bangkok", () => {
    expect(bangkokDate(new Date("2026-07-28T16:59:59.000Z"))).toBe("2026-07-28");
    expect(bangkokDate(new Date("2026-07-28T17:00:00.000Z"))).toBe("2026-07-29");
  });

  it("maps the new public webhook paths onto the preserved database regions", () => {
    expect(regionFromWebhookPath("phitsanulok")).toBe("central");
    expect(regionFromWebhookPath("korat")).toBe("bangkok");
    expect(regionFromWebhookPath("north")).toBe("north");
    expect(regionFromWebhookPath("unknown")).toBeNull();
  });

  it("uses the region's own OCR.space key while it has capacity", () => {
    expect(rankOcrSpaceKeyRegions("north", {
      north: 499,
      central: 10,
      isan: 0
    }, ["north", "central", "isan"])).toEqual(["north", "isan", "central"]);
  });

  it("borrows the configured key with the most remaining quota", () => {
    expect(rankOcrSpaceKeyRegions("north", {
      north: 500,
      central: 320,
      isan: 40,
      south: 120,
      bangkok: 500
    })).toEqual(["isan", "south", "central"]);
  });
});
