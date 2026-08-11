import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processWebhookEvents } from "../src/index";

describe("durable LINE webhook ingestion", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM audit_logs"),
      env.DB.prepare("DELETE FROM slip_jobs"),
      env.DB.prepare("DELETE FROM user_jobs"),
      env.DB.prepare(`INSERT INTO user_jobs(
          id,region,line_user_id,line_sender_id,line_conversation_id,
          line_source_type,job_number,status,expires_at,reference_set_at
        ) VALUES(
          'job-webhook','north','user-1','user-1','user-1',
          'user','12345678','collecting',datetime('now','+30 minutes'),CURRENT_TIMESTAMP
        )`)
    ]);
  });

  it("preserves HTTP receipt time when the queued image is persisted", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const receivedAtMs = 1_785_426_752_448;

    await processWebhookEvents([{
      type: "message",
      webhookEventId: "webhook-1",
      replyToken: "reply-1",
      source: { type: "user", userId: "user-1" },
      message: {
        id: "line-image-1",
        type: "image",
        quoteToken: "quote-1",
        imageSet: { id: "set-1", index: 1, total: 1 }
      }
    }], { DB: env.DB, OCR_JOBS: { send } }, "north", receivedAtMs);

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toMatchObject({ region: "north" });
    expect(await env.DB.prepare(`SELECT
        status,reply_token_received_at_ms,image_set_index,image_set_total
      FROM slip_jobs WHERE line_message_id='line-image-1'`).first()).toMatchObject({
      status: "queued",
      reply_token_received_at_ms: receivedAtMs,
      image_set_index: 1,
      image_set_total: 1
    });
  });

  it("keeps the durable image row when the OCR queue is over quota", async () => {
    const send = vi.fn().mockRejectedValue(new Error("daily write operations limit"));

    await processWebhookEvents([{
      type: "message",
      webhookEventId: "webhook-deferred",
      replyToken: "reply-deferred",
      source: { type: "user", userId: "user-1" },
      message: { id: "line-image-deferred", type: "image" }
    }], { DB: env.DB, OCR_JOBS: { send } }, "north", 1_785_426_752_448);

    expect(send).toHaveBeenCalledOnce();
    expect(await env.DB.prepare(
      "SELECT status FROM slip_jobs WHERE line_message_id='line-image-deferred'"
    ).first()).toMatchObject({ status: "queued" });
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_logs WHERE event_type='queue_write_deferred'"
    ).first()).toMatchObject({ count: 1 });
  });
});
