import { describe, expect, it } from "vitest";
import {
  analyzeOcr,
  analyzeWorkersAiTranscription,
  analyzeWorkersAiVision,
  classify,
  DEFAULT_PADDLEOCR_MODEL,
  extractPaddleOcrText,
  imageSetMetadata,
  lineScopeFromEvent,
  mergeOcrAndWorkersAi,
  ocrSpaceRequestInit,
  paddleOcrPollRequest,
  paddleOcrSubmitRequest,
  pendingResultDecision,
  shouldUseWorkersAi,
  VISIBLE_TEXT_PROMPT
} from "../src/index";

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
  it("fails when KPLUS and SETTLEMENT have a readable wrong amount", () => {
    expect(classify("KPLUS SETTLEMENT 9.99")).toBe("failed");
  });

  it("holds for a later fallback when the amount is unreadable", () => {
    expect(classify("KPLUS SETTLEMENT amount unreadable")).toBe("needs_fallback");
  });

  it("uses Workers AI only for unresolved images with receipt evidence", () => {
    expect(shouldUseWorkersAi(analyzeOcr("random equipment photo"))).toBe(false);
    expect(shouldUseWorkersAi(analyzeOcr("KPLUS amount unreadable"))).toBe(false);
    expect(shouldUseWorkersAi(analyzeOcr("SETTLEMENT amount unreadable"))).toBe(false);
    expect(shouldUseWorkersAi(analyzeOcr("KPLUS SETTLEMENT 9.99"))).toBe(true);
    expect(shouldUseWorkersAi(analyzeOcr("KPLUS SETTLEMENT 1.22"))).toBe(false);
  });

  it("uses Workers AI when OCR.space is unavailable, matching Kplus122", () => {
    const noOcrEvidence = analyzeOcr("");

    expect(shouldUseWorkersAi(noOcrEvidence, true)).toBe(true);
    expect(shouldUseWorkersAi(noOcrEvidence, false)).toBe(false);
  });

  it("can pass from Workers AI alone when OCR.space returned no usable result", () => {
    const noOcrEvidence = analyzeOcr("");
    const ai = analyzeWorkersAiTranscription(
      "CHANNEL: KPLUS\nSETTLEMENT\nAMT: THB 1.22"
    );

    expect(mergeOcrAndWorkersAi(noOcrEvidence, ai)).toMatchObject({
      result: "passed",
      foundKplus: true,
      foundSettlement: true,
      matchedAmount: "1.22"
    });
  });

  it("uses the stricter original Kplus122 brand confirmation for OCR.space", () => {
    expect(analyzeOcr("KPLUS\nSETTLEMENT\n1.22", true).result).toBe("silent");
    expect(analyzeOcr("CHANNEL: KPLUS\nSETTLEMENT\n1.22", true).result).toBe("passed");
    expect(analyzeOcr("K+\nSETTLEMENT\n-1.22", true).result).toBe("passed");
    expect(analyzeOcr("Thai QR Payment\nSETTLEMENT\n1.22", true).result).toBe("passed");
  });

  it("accepts a confident Workers AI confirmation of the target amount", () => {
    expect(analyzeWorkersAiVision('```json\n{"foundKplus":true,"foundSettlement":true,"amounts":["-1.22"],"confident":true}\n```')).toMatchObject({
      result: "passed",
      foundKplus: true,
      foundSettlement: true,
      matchedAmount: "-1.22",
      confident: true
    });
  });

  it("accepts the JSON object returned by Workers AI JSON Mode", () => {
    expect(analyzeWorkersAiVision({
      foundKplus: true,
      foundSettlement: true,
      amounts: ["1.22", "-1.22"],
      confident: true
    })).toMatchObject({
      result: "passed",
      matchedAmount: "1.22",
      detectedAmounts: ["1.22", "-1.22"],
      confident: true
    });
  });

  it("parses labeled prose when the vision model ignores JSON Mode", () => {
    expect(analyzeWorkersAiVision(`**Receipt Analysis**
**FoundKplus:** False
**FoundSettlement:** True
**Amounts:**
* 1.22 THB
**Confident:** True`)).toMatchObject({
      result: "needs_fallback",
      foundKplus: false,
      foundSettlement: true,
      matchedAmount: "1.22",
      detectedAmounts: ["1.22"],
      confident: true
    });
  });

  it("passes the real missed receipt by combining OCR.space and Workers AI evidence", () => {
    const ocr = analyzeOcr(`SETTI-IAMF-NEI'
CHANNEL: KPLUS
AMT: THB 1.22
VOID -THB 1.22`);
    const ai = analyzeWorkersAiVision(`**Receipt Analysis**
**FoundKplus:** False
**FoundSettlement:** True
**Amounts:**
* 1.22 THB (clearly readable)
**Confident:** True`);

    expect(mergeOcrAndWorkersAi(ocr, ai)).toMatchObject({
      result: "passed",
      foundKplus: true,
      foundSettlement: true,
      matchedAmount: "1.22",
      detectedAmounts: ["1.22", "-1.22"]
    });
  });

  it("does not pass merged evidence when the confirmed amount is wrong", () => {
    const ocr = analyzeOcr("CHANNEL: KPLUS AMT: THB 40.00");
    const ai = analyzeWorkersAiVision({
      foundKplus: false,
      foundSettlement: true,
      amounts: ["40.00", "-40.08"],
      confident: true
    });

    expect(mergeOcrAndWorkersAi(ocr, ai)).toMatchObject({
      result: "failed",
      foundKplus: true,
      foundSettlement: true,
      matchedAmount: null
    });
  });

  it("does not let uncertain AI evidence turn an OCR result into a pass", () => {
    const ocr = analyzeOcr("CHANNEL: KPLUS AMT: THB 1.22");
    const ai = analyzeWorkersAiVision({
      foundKplus: false,
      foundSettlement: true,
      amounts: ["1.22"],
      confident: false
    });

    expect(mergeOcrAndWorkersAi(ocr, ai).result).toBe("needs_fallback");
  });

  it("does not send an OCR.space failure when Workers AI cannot confirm it", () => {
    const ocr = analyzeOcr("CHANNEL: KPLUS\nSETTLEMENT\nTOTAL THB 60.00\nVOID -THB 60.00");
    const ai = analyzeWorkersAiTranscription("NONE");

    expect(mergeOcrAndWorkersAi(ocr, ai)).toMatchObject({
      result: "needs_fallback",
      foundKplus: true,
      foundSettlement: true,
      matchedAmount: null
    });
  });

  it("does not fail when Workers AI sees only a marker but cannot confirm the wrong amount", () => {
    const ocr = analyzeOcr("CHANNEL: KPLUS\nSETTLEMENT\nTOTAL THB 60.00");
    const ai = analyzeWorkersAiTranscription("KPLUS");

    expect(mergeOcrAndWorkersAi(ocr, ai).result).toBe("needs_fallback");
  });

  it("does not fail when OCR.space and Workers AI read different wrong amounts", () => {
    const ocr = analyzeOcr("CHANNEL: KPLUS\nSETTLEMENT\nTOTAL THB 60.00");
    const ai = analyzeWorkersAiTranscription(
      "CHANNEL: KPLUS\nSETTLEMENT\nTOTAL THB 40.00"
    );

    expect(mergeOcrAndWorkersAi(ocr, ai).result).toBe("needs_fallback");
  });

  it("fails when OCR.space and Workers AI confirm the same wrong amount", () => {
    const ocr = analyzeOcr("CHANNEL: KPLUS\nSETTLEMENT\nTOTAL THB 60.00");
    const ai = analyzeWorkersAiTranscription(
      "CHANNEL: KPLUS\nSETTLEMENT\nTOTAL THB 60.00"
    );

    expect(mergeOcrAndWorkersAi(ocr, ai)).toMatchObject({
      result: "failed",
      detectedAmounts: ["60.00"]
    });
  });

  it("uses the original Kplus122 transcription-only Workers AI rule", () => {
    expect(VISIBLE_TEXT_PROMPT).not.toContain("KPLUS");
    expect(VISIBLE_TEXT_PROMPT).not.toContain("SETTLEMENT");
    expect(VISIBLE_TEXT_PROMPT).not.toContain("1.22");
    expect(analyzeWorkersAiTranscription(
      "CHANNEL: KPLUS\nSETTLEMENT\nAMT: THB -1.22"
    )).toMatchObject({
      result: "passed",
      foundKplus: true,
      foundSettlement: true,
      matchedAmount: "-1.22",
      confident: true
    });
  });

  it("uses the proven OCR.space settings from the original Kplus122 system", () => {
    const init = ocrSpaceRequestInit(
      Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer,
      "test-key"
    );
    const form = init.body as FormData;

    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("apikey")).toBe("test-key");
    expect(form.get("base64Image")).toBe("data:image/jpeg;base64,/9j/2Q==");
    expect(form.get("language")).toBe("eng");
    expect(form.get("isOverlayRequired")).toBe("false");
    expect(form.get("detectOrientation")).toBe("true");
    expect(form.get("scale")).toBe("true");
    expect(form.get("isTable")).toBe("true");
    expect(form.get("OCREngine")).toBe("2");
  });

  it("submits images to PaddleOCR-VL-1.6 without exposing the token in the body", () => {
    const init = paddleOcrSubmitRequest(
      Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer,
      "paddle-secret"
    );
    const headers = new Headers(init.headers);
    const form = init.body as FormData;

    expect(init.method).toBe("POST");
    expect(headers.get("authorization")).toBe("Bearer paddle-secret");
    expect(form.get("model")).toBe(DEFAULT_PADDLEOCR_MODEL);
    expect(String(form.get("optionalPayload"))).toContain('"useDocOrientationClassify":true');
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(String(form.get("model")) + String(form.get("optionalPayload"))).not.toContain("paddle-secret");
  });

  it("builds an authenticated PaddleOCR polling request", () => {
    const init = paddleOcrPollRequest("paddle-secret");
    expect(init.method).toBe("GET");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer paddle-secret");
  });

  it("extracts visible text from PaddleOCR-VL JSONL results", () => {
    const result = extractPaddleOcrText([
      JSON.stringify({
        result: {
          layoutParsingResults: [
            { markdown: { text: "CHANNEL: KPLUS\nSETTLEMENT" } }
          ]
        }
      }),
      JSON.stringify({
        result: {
          layoutParsingResults: [
            { markdown: { text: "AMT: THB 1.22" } }
          ]
        }
      })
    ].join("\n"));

    expect(result).toBe("CHANNEL: KPLUS\nSETTLEMENT\nAMT: THB 1.22");
    expect(classify(result)).toBe("passed");
  });

  it("fails only when Workers AI confidently reads a different amount", () => {
    expect(analyzeWorkersAiVision('{"foundKplus":true,"foundSettlement":true,"amounts":["40.00","-40.08"],"confident":true}')).toMatchObject({
      result: "failed",
      detectedAmounts: ["40.00", "-40.08"],
      confident: true
    });
  });

  it("keeps uncertain or malformed Workers AI output silent", () => {
    expect(analyzeWorkersAiVision('{"foundKplus":true,"foundSettlement":true,"amounts":["1.22"],"confident":false}').result).toBe("needs_fallback");
    expect(analyzeWorkersAiVision("I cannot read this image").result).toBe("needs_fallback");
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
      result: "failed",
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

  it("waits after a wrong amount so a later image can pass", () => {
    expect(pendingResultDecision({
      imageCount: 1,
      expectedImageCount: 0,
      pendingCount: 0,
      failedCount: 1,
      passedCount: 0,
      latestCreatedAt: "2026-08-13 12:00:00"
    }, Date.parse("2026-08-13T12:00:20Z"))).toBe("wait");
  });

  it("fails only after the complete image set has no matching amount", () => {
    expect(pendingResultDecision({
      imageCount: 3,
      expectedImageCount: 3,
      pendingCount: 0,
      failedCount: 2,
      passedCount: 0,
      latestCreatedAt: "2026-08-13 12:00:00"
    }, Date.parse("2026-08-13T12:00:01Z"))).toBe("failed");
  });

  it("lets a matching image win over earlier wrong-amount images", () => {
    expect(pendingResultDecision({
      imageCount: 2,
      expectedImageCount: 2,
      pendingCount: 0,
      failedCount: 1,
      passedCount: 1,
      latestCreatedAt: "2026-08-13 12:00:00"
    })).toBe("passed");
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

  it("scopes a technician by room, sender, and Tid context", () => {
    expect(lineScopeFromEvent({
      source: { type: "group", groupId: "group-1", userId: "user-1" }
    })).toEqual({
      conversationId: "group-1",
      senderId: "user-1",
      sourceType: "group",
      identityKey: "group-1:user-1"
    });

    expect(lineScopeFromEvent({
      source: { type: "room", roomId: "room-2", userId: "user-1" }
    })?.identityKey).toBe("room-2:user-1");
  });
});
