import { afterEach, describe, expect, it, vi } from "vitest";
import { replyInspectionResult } from "../src/index";

describe("LINE inspection delivery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses Reply API only and mentions the sender in a group", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await replyInspectionResult("channel-token", {
      id: "slip-1",
      region: "north",
      parent_job_id: "job-1",
      line_message_id: "message-1",
      line_user_id: "user-1",
      r2_key: "north/slip-1.jpg",
      status: "passed",
      job_number: "12345678",
      line_reply_token: "reply-token",
      line_quote_token: "quote-token",
      line_source_type: "group",
      matched_amount: "1.22",
      detected_amounts: '["1.22"]',
      decision_reason: "passed",
      result_sent_at: null
    }, "passed");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.line.me/v2/bot/message/reply");
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(options.body));
    expect(payload).toMatchObject({
      replyToken: "reply-token",
      messages: [{
        type: "textV2",
        quoteToken: "quote-token",
        substitution: {
          sender: { mentionee: { type: "user", userId: "user-1" } }
        }
      }]
    });
    expect(payload.messages[0].text).toContain("{sender}\nTID: 12345678\n");
    expect(payload.messages[0].text).toContain("✅ ตรวจสอบผ่าน: พบสลิป KPLUS\nยอด 1.22 บาท ข้อมูลถูกต้อง");
  });

  it("returns a failed result through Reply API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await replyInspectionResult("channel-token", {
      id: "slip-2",
      region: "central",
      parent_job_id: "job-2",
      line_message_id: "message-2",
      line_user_id: "user-2",
      r2_key: "central/slip-2.jpg",
      status: "failed",
      job_number: "87654321",
      line_reply_token: "reply-token-2",
      line_quote_token: null,
      line_source_type: "user",
      matched_amount: null,
      detected_amounts: '["9.99"]',
      decision_reason: "wrong amount",
      result_sent_at: null
    }, "failed");

    const payload = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(payload.messages[0].text).toBe(
      "TID: 87654321\n" +
      "❌ ตรวจสอบไม่พบยอด 1.22: สลิป KPLUS\n" +
      "ยอดที่อ่านได้: 9.99 บาท\n" +
      "สาเหตุ: ไม่พบยอด 1.22 หรือ -1.22 บาท\n" +
      "หาก Test ผ่าน Link POS อย่าลืมลง Remark"
    );
    expect(payload.messages[0].text).toContain("ตรวจสอบไม่พบยอด 1.22");
    expect(payload.messages[0].text).toContain("9.99");
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("/push");
  });
});
