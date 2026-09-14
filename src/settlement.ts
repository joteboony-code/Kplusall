/** Count headings within ONE provider's transcription of ONE image.
 * A success footer on the same slip is not another receipt. Never sum
 * these counts across providers or images.
 */
export function countSettlementHeadings(text: string): number {
  return [...text.toUpperCase().matchAll(
    /\bSETTLEMENT\b(?!\s+(?:SUCCESSFUL(?:LY)?|SUCCESS|COMPLETE(?:D)?|OK)\b)/g,
  )].length;
}
