import { describe, expect, it } from "vitest";
import { countSettlementHeadings } from "../src/settlement";
import { analyzeOcr, analyzeWorkersAiTranscription, mergeOcrAndWorkersAi,
  shouldUseWorkersAi, extractPaddleOcrText } from "../src/index";

const single = "CHANNEL: KPLUS\nSETTLEMENT\nTHB -1.22";
const multiple = "SETTLEMENT\nHOST: KBANK\nTHB -1.00\n" + single;

describe("multiple settlement image filter", () => {

  // Verbatim excerpt of OCR.space output for image 4/10 in job 62439029.
  const splitFooter = "AIL: IHB\t-1.22\tSETTLEMENT SUCCESSF\t\r\n'UL\t\r\n";
  const footerVariants = [
    splitFooter, "SETTLEMENT SUCCESSF", "SETTLEMENT SUCCESSFU",
    "SETTLEMENT SUCCESSFUL", "SETTLEMENT SUCCESSFULLY",
    "SETTLEMENT SUCCESS\nFUL", "settlement\tsuccessf\r\n'ul",
  ];

  it.each(footerVariants)("62439029: does not count a broken success footer: %s", (footer) => {
    const text = single + "\n" + footer;
    expect(countSettlementHeadings(text)).toBe(1);
    expect(analyzeOcr(text, true).result).toBe("passed");
  });
  it("keeps two real headings even with a broken success footer", () => {
    const text = multiple + "\n" + splitFooter;
    expect(countSettlementHeadings(text)).toBe(2);
    expect(analyzeOcr(text, true).result).toBe("silent");
  });
  it("does not turn a wrong amount into a pass when ignoring a broken footer", () => {
    const text = (single + "\n" + splitFooter).replaceAll("-1.22", "-100.00");
    expect(countSettlementHeadings(text)).toBe(1);
    expect(analyzeOcr(text, true).result).toBe("failed");
  });
  it("28238752: AI repetition must not suppress wrong-amount result", () => {
    const ocr = analyzeOcr(single.replace("-1.22", "100.00"));
    const ai = analyzeWorkersAiTranscription("Receipt 1: CHONBURI SETTLEMENT CHANNEL: KPLUS AMOUNT THB 100.00\nReceipt 2: CHONBURI SETTLEMENT");
    expect(ai.result).toBe("failed");
    expect(mergeOcrAndWorkersAi(ocr, ai).result).toBe("failed");
    expect(mergeOcrAndWorkersAi(analyzeOcr(multiple), ai).result).toBe("silent");
  });
  it("skips two or four headings without forwarding to Workers AI", () => {
    for (const text of [multiple, multiple + "\nSETTLEMENT\nUNIONPAY\nSETTLEMENT\nKBANK FLEET", multiple.replace("-1.22", "-100.00")]) {
      const analysis = analyzeOcr(text, true);
      expect(analysis.result).toBe("silent");
      expect(shouldUseWorkersAi(analysis)).toBe(false);
      expect(shouldUseWorkersAi(analysis, true)).toBe(false);
    }
  });
  it("ignores repeated AI headings but preserves direct OCR rejection", () => {
    const aiMultiple = analyzeWorkersAiTranscription(multiple);
    expect(aiMultiple.result).toBe("passed");
    expect(mergeOcrAndWorkersAi(analyzeOcr(single), aiMultiple).result).toBe("passed");
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
