import { describe, expect, it } from "vitest";
import {
  imageExpired,
  imageTooLarge,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_JOB,
  MAX_OCR_ATTEMPTS,
  shouldRetryOcr
} from "../src/index";

describe("operational safety limits", () => {
  it("accepts at most 13 images for one TID", () => {
    expect(MAX_IMAGES_PER_JOB).toBe(13);
  });

  it("rejects an image only after the configured byte ceiling", () => {
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
});
