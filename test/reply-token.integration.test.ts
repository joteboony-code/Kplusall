import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deliverResult,
  latestReplyToken,
  replyTokenAgeMs,
  REPLY_TOKEN_WARNING_MS,
  reserveOcrSpaceUsage
} from "../src/index";

describe("latest LINE reply token selection with D1", () => {
  const parentJobId = "job-reply-token";

  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM slip_jobs"),
      env.DB.prepare("DELETE FROM user_jobs"),
      env.DB.prepare(`INSERT INTO user_jobs(
          id,region,line_user_id,job_number,status,line_sender_id,
          line_conversation_id,line_source_type,expires_at,reference_set_at
        ) VALUES(?,?,?,?,?,?,?,?,datetime('now','+30 minutes'),CURRENT_TIMESTAMP)`)
        .bind(
          parentJobId,
          "north",
          "group-1:user-1",
          "12345678",
          "collecting",
          "user-1",
          "group-1",
          "group"
        )
    ]);
  });

  afterEach(() => vi.unstubAllGlobals());

  async function insertSlip(id: string, token: string, timestampMs: number) {
    await env.DB.prepare(`INSERT INTO slip_jobs(
        id,region,parent_job_id,line_message_id,line_user_id,r2_key,
        line_reply_token,reply_token_received_at_ms
      ) VALUES(?,?,?,?,?,?,?,?)`)
      .bind(
        id,
        "north",
        parentJobId,
        `message-${id}`,
        "user-1",
        `north/${id}.jpg`,
        token,
        timestampMs
      )
      .run();
  }

  it("selects the newest unused token in the same scoped job", async () => {
    await insertSlip("slip-old", "reply-old", 1_000);
    await insertSlip("slip-new", "reply-new", 2_000);

    expect(await latestReplyToken(env.DB, parentJobId)).toMatchObject({
      id: "slip-new",
      line_reply_token: "reply-new",
      received_at_ms: 2_000
    });
  });

  it("skips a token that has already been used", async () => {
    await insertSlip("slip-old", "reply-old", 1_000);
    await insertSlip("slip-new", "reply-new", 2_000);
    await env.DB.prepare(
      "UPDATE slip_jobs SET reply_token_used_at=CURRENT_TIMESTAMP WHERE id='slip-new'"
    ).run();

    expect(await latestReplyToken(env.DB, parentJobId)).toMatchObject({
      id: "slip-old",
      line_reply_token: "reply-old"
    });
  });

  it("never selects a newer token from a different TID", async () => {
    await insertSlip("slip-own", "reply-own", 1_000);
    await env.DB.prepare(`INSERT INTO user_jobs(
        id,region,line_user_id,job_number,status,line_sender_id,
        line_conversation_id,line_source_type,expires_at,reference_set_at
      ) VALUES('job-other','north','group-1:user-1','87654321','collecting',
        'user-1','group-1','group',datetime('now','+30 minutes'),CURRENT_TIMESTAMP)`).run();
    await env.DB.prepare(`INSERT INTO slip_jobs(
        id,region,parent_job_id,line_message_id,line_user_id,r2_key,
        line_reply_token,reply_token_received_at_ms
      ) VALUES('slip-other','north','job-other','message-other','user-1',
        'north/other.jpg','reply-other',9999)`).run();

    expect(await latestReplyToken(env.DB, parentJobId)).toMatchObject({
      id: "slip-own",
      line_reply_token: "reply-own"
    });
  });

  it("calculates the warning threshold without waiting in real time", () => {
    expect(replyTokenAgeMs(10_000, 59_999)).toBe(REPLY_TOKEN_WARNING_MS - 1);
    expect(replyTokenAgeMs(10_000, 60_000)).toBe(REPLY_TOKEN_WARNING_MS);
  });

  it("replies once with the newest token but quotes the decisive image", async () => {
    const now = Date.now();
    await insertSlip("slip-result", "reply-old", now - 20_000);
    await insertSlip("slip-latest", "reply-latest", now - 1_000);
    await env.DB.prepare(
      "UPDATE slip_jobs SET line_quote_token='quote-result',status='passed',result='passed' WHERE id='slip-result'"
    ).run();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const row = {
      id: "slip-result",
      region: "north" as const,
      parent_job_id: parentJobId,
      line_message_id: "message-slip-result",
      line_user_id: "user-1",
      r2_key: "north/slip-result.jpg",
      status: "passed",
      job_number: "12345678",
      line_reply_token: "reply-old",
      line_quote_token: "quote-result",
      line_source_type: "group" as const,
      matched_amount: "1.22",
      detected_amounts: '["1.22"]',
      decision_reason: "passed",
      result_sent_at: null
    };

    await deliverResult(env, row, "channel-token", "passed");
    await deliverResult(env, row, "channel-token", "passed");

    expect(fetchMock).toHaveBeenCalledOnce();
    const payload = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)
    );
    expect(payload.replyToken).toBe("reply-latest");
    expect(payload.messages[0].quoteToken).toBe("quote-result");
    expect(await env.DB.prepare(
      "SELECT final_result,result_sent_at FROM user_jobs WHERE id=?"
    ).bind(parentJobId).first()).toMatchObject({
      final_result: "passed"
    });
    expect(await env.DB.prepare(
      "SELECT reply_token_source_slip_id FROM slip_jobs WHERE id='slip-result'"
    ).first()).toMatchObject({
      reply_token_source_slip_id: "slip-latest"
    });
    expect(await env.DB.prepare(
      "SELECT reply_token_used_at FROM slip_jobs WHERE id='slip-latest'"
    ).first()).toMatchObject({
      reply_token_used_at: expect.any(String)
    });
  });

  it("atomically allows only one request to claim the 500th OCR slot", async () => {
    const usageDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
    await env.DB.prepare(`INSERT INTO daily_usage(
        usage_date,region,provider,request_count
      ) VALUES(?,'north','ocrspace',499)`)
      .bind(usageDate)
      .run();

    const results = await Promise.all([
      reserveOcrSpaceUsage(env, "north"),
      reserveOcrSpaceUsage(env, "north")
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await env.DB.prepare(`SELECT request_count
      FROM daily_usage
      WHERE usage_date=? AND region='north' AND provider='ocrspace'`)
      .bind(usageDate)
      .first()).toMatchObject({ request_count: 500 });
  });
});
