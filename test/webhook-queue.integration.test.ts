import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processWebhookEvents } from "../src/index";

describe("durable LINE webhook ingestion", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM audit_logs"),
      env.DB.prepare("DELETE FROM image_set_bindings"),
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

  it("binds a delayed image to the TID that existed at the LINE event time", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const now = Date.now();

    await processWebhookEvents([
      {
        type: "message",
        timestamp: now - 2_000,
        source: { type: "user", userId: "user-1" },
        message: { type: "text", text: "28401904" }
      },
      {
        type: "message",
        timestamp: now - 1_000,
        source: { type: "user", userId: "user-1" },
        message: { type: "text", text: "28253121" }
      },
      {
        type: "message",
        timestamp: now - 1_500,
        webhookEventId: "webhook-delayed-image",
        replyToken: "reply-delayed-image",
        source: { type: "user", userId: "user-1" },
        message: { id: "line-image-delayed", type: "image" }
      }
    ], { DB: env.DB, OCR_JOBS: { send } }, "north", now);

    expect(await env.DB.prepare(`SELECT u.job_number
      FROM slip_jobs s JOIN user_jobs u ON u.id=s.parent_job_id
      WHERE s.line_message_id='line-image-delayed'`).first()).toMatchObject({
      job_number: "28401904"
    });
  });

  it("keeps every image in one LINE album on the first TID", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const now = Date.now();

    await processWebhookEvents([
      {
        type: "message",
        timestamp: now - 3_000,
        source: { type: "user", userId: "user-1" },
        message: { type: "text", text: "28401904" }
      },
      {
        type: "message",
        timestamp: now - 2_000,
        webhookEventId: "webhook-album-1",
        replyToken: "reply-album-1",
        source: { type: "user", userId: "user-1" },
        message: { id: "line-album-1", type: "image", imageSet: { id: "album-lock", index: 1, total: 2 } }
      },
      {
        type: "message",
        timestamp: now - 1_000,
        source: { type: "user", userId: "user-1" },
        message: { type: "text", text: "28253121" }
      },
      {
        type: "message",
        webhookEventId: "webhook-album-2",
        replyToken: "reply-album-2",
        source: { type: "user", userId: "user-1" },
        message: { id: "line-album-2", type: "image", imageSet: { id: "album-lock", index: 2, total: 2 } }
      }
    ], { DB: env.DB, OCR_JOBS: { send } }, "north", now);

    const rows = await env.DB.prepare(`SELECT s.line_message_id,u.job_number
      FROM slip_jobs s JOIN user_jobs u ON u.id=s.parent_job_id
      WHERE s.line_message_id IN ('line-album-1','line-album-2')
      ORDER BY s.line_message_id`).all<{ line_message_id: string; job_number: string }>();
    expect(rows.results).toEqual([
      { line_message_id: "line-album-1", job_number: "28401904" },
      { line_message_id: "line-album-2", job_number: "28401904" },
    ]);
  });

  it("does not write the OCR Queue twice for a duplicate webhook", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const event = {
      type: "message",
      webhookEventId: "webhook-duplicate",
      replyToken: "reply-duplicate",
      source: { type: "user", userId: "user-1" },
      message: { id: "line-image-duplicate", type: "image" }
    } as const;

    await processWebhookEvents([event], { DB: env.DB, OCR_JOBS: { send } }, "north", Date.now());
    await processWebhookEvents([event], { DB: env.DB, OCR_JOBS: { send } }, "north", Date.now());

    expect(send).toHaveBeenCalledOnce();
  });
});
