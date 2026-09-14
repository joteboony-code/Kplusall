import { describe, expect, it } from "vitest";
import { countSettlementHeadings } from "../src/settlement";
import { analyzeOcr, analyzeWorkersAiTranscription, mergeOcrAndWorkersAi,
  shouldUseWorkersAi, extractPaddleOcrText } from "../src/index";

const single = "CHANNEL: KPLUS\nSETTLEMENT\nTHB -1.22";
const multiple = "SETTLEMENT\nHOST: KBANK\nTHB -1.00\n" + single;

describe("multiple settlement image filter", () => {
  it("skips two or four headings without forwarding to Workers AI", () => {
    for (const text of [multiple, multiple + "\nSETTLEMENT\nUNIONPAY\nSETTLEMENT\nKBANK FLEET", multiple.replace("-1.22", "-100.00")]) {
      const analysis = analyzeOcr(text, true);
      expect(analysis.result).toBe("silent");
      expect(shouldUseWorkersAi(analysis)).toBe(false);
      expect(shouldUseWorkersAi(analysis, true)).toBe(false);
    }
  });
  it("preserves rejection from either provider", () => {
    const aiMultiple = analyzeWorkersAiTranscription(multiple);
    expect(aiMultiple.result).toBe("silent");
    expect(mergeOcrAndWorkersAi(analyzeOcr(single), aiMultiple).result).toBe("silent");
    expect(mergeOcrAndWorkersAi(analyzeOcr(multiple), analyzeWorkersAiTranscription(single)).result).toBe("silent");
    expect(mergeOcrAndWorkersAi(analyzeOcr(single), analyzeWorkersAiTranscription(single)).result).toBe("passed");
  });
  it("keeps single-slip footer and original wrong-amount behavior", () => {
    expect(analyzeOcr(single + "\nSETTLEMENT SUCCESSFUL").result).toBe("passed");
    expect(analyzeOcr(single.replace("-1.22", "-100.00")).result).toBe("failed");
  });
  it("does not double-count Paddle OCR and Markdown representations", () => {
    const payload = JSON.stringify({ result: {
      layoutParsingResults: [{ markdown: { text: single } }],
      ocrResults: [{ prunedResult: { rec_texts: single.split("\n") } }],
    } });
    expect(countSettlementHeadings(extractPaddleOcrText(payload))).toBe(1);
  });
});
