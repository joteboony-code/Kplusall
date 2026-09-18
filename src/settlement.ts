/** Count headings within ONE provider's transcription of ONE image.
 * A success footer on the same slip is not another receipt. Never sum
 * these counts across providers or images.
 */
export function countSettlementHeadings(text: string): number {
  // OCR may truncate/split SUCCESSFUL, e.g. "SUCCESSF\n'UL" (62439029).
  // Require the SUCCESS stem immediately after SETTLEMENT; do not suppress
  // another heading just because a success footer appears later in the text.
  return [...text.toUpperCase().matchAll(
    /\bSETTLEMENT\b(?!\s+(?:SUCCESS(?:FULLY|FULL|FUL|FU|F)?|COMPLETE(?:D)?|OK)\b)/g,
  )].length;
}
