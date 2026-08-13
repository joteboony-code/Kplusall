type Region = "north" | "central" | "isan" | "south" | "bangkok";
export type Env = {
  DB: D1Database; SLIPS: R2Bucket; LINE_WEBHOOKS: Queue<LineWebhookQueueMessage>;
  OCR_JOBS: Queue<OcrQueueMessage>; OCR_FALLBACK_JOBS: Queue<OcrQueueMessage>; AI: Ai;
  ADMIN_PASSWORD?: string; CONFIG_ENCRYPTION_KEY?: string;
  PADDLEOCR_TOKEN?: string; PADDLEOCR_MODEL?: string;
};
type RegionConfigRow = { region: Region; enabled: number; line_channel_secret: ArrayBuffer | null; line_channel_token: ArrayBuffer | null; ocrspace_api_key: ArrayBuffer | null };
type RegionConfig = { region: Region; enabled: boolean; lineSecret: string; lineToken: string; ocrKey: string };
type OcrResult = "passed" | "failed" | "silent" | "needs_fallback";
type OcrAnalysis = {
  result: OcrResult;
  foundKplus: boolean;
  foundSettlement: boolean;
  matchedAmount: string | null;
  detectedAmounts: string[];
  reason: string;
};
type OcrLogRow = {
  id: string;
  region: Region;
  job_number: string;
  status: string;
  ocr_provider: string | null;
  result: string | null;
  result_sent_at: string | null;
  found_kplus: number | null;
  found_settlement: number | null;
  matched_amount: string | null;
  detected_amounts: string | null;
  decision_reason: string | null;
  ocr_excerpt: string | null;
  ocrspace_found_kplus: number | null;
  ocrspace_found_settlement: number | null;
  ocrspace_detected_amounts: string | null;
  ocrspace_key_region: Region | null;
  ai_provider: string | null;
  ai_response_excerpt: string | null;
  ai_found_kplus: number | null;
  ai_found_settlement: number | null;
  ai_detected_amounts: string | null;
  ai_confident: number | null;
  image_set_id: string | null;
  image_set_index: number | null;
  image_set_total: number | null;
  reply_token_age_ms: number | null;
  reply_token_source_slip_id: string | null;
  created_at: string;
  updated_at: string;
};
type DailyUsageRow = { region?: Region; provider: string; request_count: number; success_count: number; error_count: number };
type OcrSpaceUsageRow = { region: Region; request_count: number };
type OcrSpaceKeyReservation = { keyRegion: Region; apiKey: string };
type OcrQueueMessage = {
  id: string;
  region: Region;
  phase?: "start" | "paddle_poll" | "ocrspace" | "finalize";
  paddleJobId?: string;
  paddlePollCount?: number;
  ocrSpaceAttempt?: number;
  paddleAttempted?: boolean;
};
export type LineWebhookQueueMessage = {
  kind: "line_webhook";
  region: Region;
  events: LineEvent[];
  receivedAtMs: number;
};
type WorkerQueueMessage = OcrQueueMessage | LineWebhookQueueMessage;
type LatestReplyTokenRow = {
  id: string;
  line_reply_token: string;
  received_at_ms: number;
};
type LineImageSet = { id?: string; index?: number; total?: number };
type LineEvent = {
  type?: string;
  webhookEventId?: string;
  replyToken?: string;
  timestamp?: number;
  source?: { type?: "user" | "group" | "room"; userId?: string; groupId?: string; roomId?: string };
  message?: { id?: string; type?: string; text?: string; quoteToken?: string; imageSet?: LineImageSet };
};
type ActiveUserJob = { id: string; job_number: string };
type SlipProcessRow = {
  id: string;
  region: Region;
  parent_job_id: string;
  line_message_id: string;
  line_user_id: string;
  r2_key: string;
  status: string;
  job_number: string;
  line_reply_token: string;
  line_quote_token: string | null;
  line_source_type: "user" | "group" | "room";
  created_at?: string;
  matched_amount: string | null;
  detected_amounts: string | null;
  decision_reason: string | null;
  result_sent_at: string | null;
  paddle_job_id?: string | null;
  paddle_poll_count?: number;
};
const REGIONS: Region[] = ["north", "isan", "south", "central", "bangkok"];
const WEBHOOK_REGION_ALIASES: Record<string, Region> = {
  phitsanulok: "central",
  korat: "bangkok"
};
const enc = new TextEncoder();
const dec = new TextDecoder();
const JOB_REFERENCE_MINUTES = 30;
const PASS_CLAIM_MINUTES = 2;
export const FAILED_RESULT_WAIT_SECONDS = 45;
const FAILED_RESULT_WAIT_MS = FAILED_RESULT_WAIT_SECONDS * 1000;
export const REPLY_TOKEN_WARNING_MS = 50_000;
const OCRSPACE_DAILY_LIMIT = 500;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_OCR_ATTEMPTS = 2;
const R2_FALLBACK_RETENTION_MS = 24 * 60 * 60 * 1000;
const WORKERS_AI_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const WORKERS_AI_PROVIDER = "workers_ai_vision";
const PADDLEOCR_PROVIDER = "paddleocr";
const PADDLEOCR_JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";
export const DEFAULT_PADDLEOCR_MODEL = "PaddleOCR-VL-1.6";
export const PADDLEOCR_POLL_DELAY_SECONDS = 3;
/** Fast PaddleOCR jobs are polled inline to avoid two extra Queue messages. */
export const PADDLEOCR_INLINE_POLLS = 2;
export const MAX_PADDLEOCR_POLLS = 3;
export const VISIBLE_TEXT_PROMPT = `Transcribe only text that is clearly visible in this image.
Preserve line breaks, decimal points, and minus signs exactly as printed.
Do not describe the image, infer hidden text, correct values, or add commentary.
If no text is readable, return NONE.`;

function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
function b64(bytes: Uint8Array) { let s = ""; bytes.forEach((b) => s += String.fromCharCode(b)); return btoa(s); }
function unb64(text: string) { const s = atob(text); return Uint8Array.from(s, (c) => c.charCodeAt(0)); }
export function bangkokDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
function today() { return bangkokDate(); }

function sqlTimestampMs(value: string): number | undefined {
  const normalized = value.trim().replace(" ", "T");
  const parsed = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(normalized)
    ? normalized
    : `${normalized}Z`);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Inspection jobs are intentionally valid only on their Bangkok calendar day. */
export function isCurrentInspectionDay(
  value: string | number | null | undefined,
  now = Date.now(),
): boolean {
  const timestamp = typeof value === "number"
    ? value
    : typeof value === "string"
      ? sqlTimestampMs(value)
      : undefined;
  if (!Number.isFinite(timestamp) || timestamp === undefined || timestamp <= 0) {
    return true;
  }
  return bangkokDate(new Date(timestamp)) === bangkokDate(new Date(now));
}

const EXPIRED_INSPECTION_REASON = "งานข้ามวันแล้ว จึงยุติการตรวจและไม่ส่งผลย้อนหลัง";
function isRegion(value: string): value is Region { return REGIONS.includes(value as Region); }
export function regionFromWebhookPath(value: string): Region | null {
  return WEBHOOK_REGION_ALIASES[value] ?? (isRegion(value) ? value : null);
}
function cookie(request: Request, key: string) { return request.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${key}=`))?.slice(key.length + 1); }
export function shouldRetryOcr(attempt: number) { return attempt < MAX_OCR_ATTEMPTS; }
export function imageTooLarge(size: number) { return !Number.isFinite(size) || size > MAX_IMAGE_BYTES; }
export function imageExpired(uploaded: Date, now = Date.now()) { return now - uploaded.getTime() >= R2_FALLBACK_RETENTION_MS; }
export function replyTokenAgeMs(eventTimestampMs: number, now = Date.now()) {
  return Math.max(0, now - eventTimestampMs);
}

function imageBase64(bytes: Uint8Array) {
  const chunks: string[] = [];
  const chunkSize = 0x6000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    let binary = "";
    for (const byte of bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))) {
      binary += String.fromCharCode(byte);
    }
    chunks.push(btoa(binary));
  }
  return chunks.join("");
}

export function ocrSpaceRequestInit(imageBytes: ArrayBuffer, apiKey: string): RequestInit {
  const bytes = new Uint8Array(imageBytes);
  const form = new FormData();
  form.set("base64Image", `data:${imageMime(bytes)};base64,${imageBase64(bytes)}`);
  form.set("language", "eng");
  form.set("isOverlayRequired", "false");
  form.set("detectOrientation", "true");
  form.set("scale", "true");
  form.set("isTable", "true");
  form.set("OCREngine", "2");
  return {
    method: "POST",
    headers: { apikey: apiKey },
    body: form,
    signal: AbortSignal.timeout(30_000)
  };
}

export function paddleOcrSubmitRequest(
  imageBytes: ArrayBuffer,
  token: string,
  model = DEFAULT_PADDLEOCR_MODEL
): RequestInit {
  const bytes = new Uint8Array(imageBytes);
  const form = new FormData();
  form.set("model", model);
  form.set("optionalPayload", JSON.stringify({
    useDocOrientationClassify: true,
    useDocUnwarping: false,
    useChartRecognition: false
  }));
  form.set("file", new Blob([imageBytes], { type: imageMime(bytes) }), "slip");
  return {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(30_000)
  };
}

export function paddleOcrPollRequest(token: string): RequestInit {
  return {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000)
  };
}

export function extractPaddleOcrText(jsonl: string) {
  const text: string[] = [];
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value: any;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const result = value?.result ?? value;
    for (const item of result?.layoutParsingResults ?? []) {
      const markdown = item?.markdown?.text;
      if (typeof markdown === "string" && markdown.trim()) text.push(markdown);
    }
    for (const item of result?.ocrResults ?? []) {
      const pruned = item?.prunedResult;
      if (typeof pruned === "string" && pruned.trim()) {
        text.push(pruned);
      } else if (pruned && typeof pruned === "object") {
        const recTexts = pruned.rec_texts ?? pruned.recTexts;
        if (Array.isArray(recTexts)) text.push(recTexts.map(String).join("\n"));
      }
    }
  }
  return text.join("\n").trim();
}

async function hmac(text: string, key: string) {
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(text))));
}
async function safeEqual(a: string, b: string) { return a.length === b.length && (await hmac(a, "compare")) === (await hmac(b, "compare")); }
export function encryptionKeyBytes(value?: string) {
  if (!value) throw new Error("CONFIG_ENCRYPTION_KEY is not configured");
  let raw: Uint8Array;
  try {
    raw = unb64(value.trim());
  } catch {
    throw new Error("CONFIG_ENCRYPTION_KEY must be valid base64 encoded 32 bytes");
  }
  if (raw.byteLength !== 32) throw new Error("CONFIG_ENCRYPTION_KEY must be base64 encoded 32 bytes");
  return raw;
}
async function cryptoKey(env: Env) {
  const raw = encryptionKeyBytes(env.CONFIG_ENCRYPTION_KEY);
  const keyData = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  return crypto.subtle.importKey("raw", keyData, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(value: string, env: Env): Promise<ArrayBuffer | null> {
  if (!value) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(env), enc.encode(value)));
  const all = new Uint8Array(iv.length + body.length); all.set(iv); all.set(body, iv.length); return all.buffer;
}
async function open(value: ArrayBuffer | null, env: Env) {
  if (!value) return "";
  const all = new Uint8Array(value); const iv = all.slice(0, 12); const body = all.slice(12);
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await cryptoKey(env), body));
}
async function config(env: Env, region: Region): Promise<RegionConfig> {
  const row = await env.DB.prepare("SELECT * FROM region_config WHERE region = ?").bind(region).first<RegionConfigRow>();
  if (!row) throw new Error("unknown region configuration");
  return { region, enabled: Boolean(row.enabled), lineSecret: await open(row.line_channel_secret, env), lineToken: await open(row.line_channel_token, env), ocrKey: await open(row.ocrspace_api_key, env) };
}
async function audit(env: Pick<Env, "DB">, event: string, detail: string, region?: Region) { await env.DB.prepare("INSERT INTO audit_logs(region,event_type,detail) VALUES(?,?,?)").bind(region ?? null, event, detail.slice(0, 1000)).run(); }
function queueErrorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
async function auditQueueDeferral(env: Pick<Env, "DB">, target: string, detail: string, region: Region) {
  try {
    await audit(env, "queue_write_deferred", `${target}: ${detail}`, region);
  } catch (auditError) {
    console.error("failed to audit deferred queue write", { target, region, error: detail, auditError });
  }
}
async function enqueueOcrJobSafely(
  env: { DB: D1Database; OCR_JOBS: Pick<Queue<OcrQueueMessage>, "send"> },
  message: OcrQueueMessage,
  region: Region,
  options?: QueueSendOptions,
) {
  try {
    await env.OCR_JOBS.send(message, options);
    return true;
  } catch (error) {
    const detail = queueErrorText(error);
    console.error(JSON.stringify({ event: "queue_write_deferred", target: "ocr-jobs", region, error: detail, id: message.id }));
    await auditQueueDeferral(env, "ocr-jobs", `${message.id}: ${detail}`, region);
    return false;
  }
}

type PendingResultState = {
  imageCount: number;
  expectedImageCount: number;
  pendingCount: number;
  failedCount: number;
  passedCount: number;
  firstFailedAt?: string | null;
  latestCreatedAt: string | null;
};

export type PendingResultDecision = "wait" | "awaiting_images" | "passed" | "failed" | "silent";

/**
 * A wrong amount on one image is not final while an OCR result is still
 * pending. A matching image always wins immediately. When LINE tells us the
 * total image-set size, do not finalize until every image in that set arrives;
 * for standalone images, the 45-second timeout remains the safety limit for a
 * stuck OCR result.
 */
export function pendingResultDecision(
  state: PendingResultState,
  nowMs = Date.now()
): PendingResultDecision {
  if (state.passedCount > 0) return "passed";
  if (
    state.expectedImageCount > 0 &&
    state.imageCount < state.expectedImageCount
  ) {
    return "awaiting_images";
  }
  if (state.pendingCount > 0) {
    const failedAtMs = state.firstFailedAt
      ? Date.parse(`${state.firstFailedAt.replace(" ", "T")}Z`)
      : Number.NaN;
    if (!Number.isFinite(failedAtMs) || nowMs - failedAtMs < FAILED_RESULT_WAIT_MS) {
      return "wait";
    }
  }
  return state.failedCount > 0 ? "failed" : "silent";
}

async function enqueuePendingResultFinalizer(
  env: { DB: D1Database; OCR_JOBS: Pick<Queue<OcrQueueMessage>, "send"> },
  row: Pick<SlipProcessRow, "id" | "region">
) {
  return enqueueOcrJobSafely(
    env,
    { id: row.id, region: row.region, phase: "finalize" },
    row.region,
    { delaySeconds: FAILED_RESULT_WAIT_SECONDS }
  );
}

async function deferFailedResult(
  env: { DB: D1Database; OCR_JOBS: Pick<Queue<OcrQueueMessage>, "send"> },
  row: Pick<SlipProcessRow, "id" | "parent_job_id" | "region" | "job_number">,
  lineToken: string,
) {
  // Only the first wrong-amount image schedules the delayed finalizer when an
  // OCR result is still pending. Later wrong images share the same TID state
  // and do not multiply queue writes. The scheduled recovery path also retries
  // this if the queue is full.
  const claimed = await env.DB.prepare(`UPDATE user_jobs
    SET status='pending_failed', updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND result_sent_at IS NULL AND status='collecting'`)
    .bind(row.parent_job_id)
    .run();
  if ((claimed.meta.changes ?? 0) !== 1) return;
  const state = await pendingResultState(env, row.parent_job_id);
  const decision = state ? pendingResultDecision(state) : "wait";
  if (decision === "awaiting_images") return;
  if (state && decision !== "wait") {
    await finalizePendingResult(env, row, lineToken);
    return;
  }
  await enqueuePendingResultFinalizer(env, row);
}

async function pendingResultState(env: Pick<Env, "DB">, parentJobId: string) {
  return env.DB.prepare(`SELECT
      COUNT(s.id) AS "imageCount",
      COALESCE(MAX(s.image_set_total),0) AS "expectedImageCount",
      COALESCE(SUM(CASE WHEN s.status IN ('queued','paddle_pending') THEN 1 ELSE 0 END),0) AS "pendingCount",
      COALESCE(SUM(CASE WHEN s.status='failed' OR s.result='failed' THEN 1 ELSE 0 END),0) AS "failedCount",
      COALESCE(SUM(CASE WHEN s.status='passed' OR s.result='passed' THEN 1 ELSE 0 END),0) AS "passedCount",
      MIN(CASE WHEN s.status='failed' OR s.result='failed'
        THEN COALESCE(s.updated_at,s.created_at) END) AS "firstFailedAt",
      MAX(s.created_at) AS "latestCreatedAt"
    FROM slip_jobs s
    WHERE s.parent_job_id=?`)
    .bind(parentJobId)
    .first<PendingResultState>();
}

async function loadDecisiveRow(env: Pick<Env, "DB">, parentJobId: string, result: "passed" | "failed") {
  return env.DB.prepare(`SELECT
      s.*,u.job_number,u.line_source_type,u.result_sent_at
    FROM slip_jobs s
    JOIN user_jobs u ON u.id=s.parent_job_id
    WHERE s.parent_job_id=? AND (s.status=? OR s.result=?)
    ORDER BY s.updated_at DESC,s.created_at DESC,s.rowid DESC
    LIMIT 1`)
    .bind(parentJobId, result, result)
    .first<SlipProcessRow>();
}

async function finalizePendingResult(
  env: { DB: D1Database; OCR_JOBS: Pick<Queue<OcrQueueMessage>, "send"> },
  row: Pick<SlipProcessRow, "id" | "parent_job_id" | "region" | "job_number">,
  lineToken: string,
) {
  const parent = await env.DB.prepare(`SELECT id,result_sent_at,status,expires_at
    FROM user_jobs WHERE id=?`)
    .bind(row.parent_job_id)
    .first<{ id: string; result_sent_at: string | null; status: string; expires_at: string | null }>();
  if (!parent || parent.result_sent_at) return;
  if (parent.expires_at && Date.parse(`${parent.expires_at.replace(" ", "T")}Z`) <= Date.now()) {
    await env.DB.prepare("UPDATE user_jobs SET status='collecting',updated_at=CURRENT_TIMESTAMP WHERE id=? AND result_sent_at IS NULL")
      .bind(row.parent_job_id).run();
    await audit(env, "inspection_expired", row.job_number, row.region);
    return;
  }

  const state = await pendingResultState(env, row.parent_job_id);
  if (!state) return;
  const decision = pendingResultDecision(state);
  if (decision === "awaiting_images") return;
  if (decision === "wait") {
    const firstFailedMs = state.firstFailedAt
      ? Date.parse(`${state.firstFailedAt.replace(" ", "T")}Z`)
      : Number.NaN;
    const remainingSeconds = Number.isFinite(firstFailedMs)
      ? Math.max(5, Math.ceil((FAILED_RESULT_WAIT_MS - (Date.now() - firstFailedMs)) / 1000))
      : 15;
    await enqueueOcrJobSafely(
      env,
      { id: row.id, region: row.region, phase: "finalize" },
      row.region,
      { delaySeconds: Math.min(FAILED_RESULT_WAIT_SECONDS, remainingSeconds) }
    );
    return;
  }

  if (decision === "passed") {
    const passedRow = await loadDecisiveRow(env, row.parent_job_id, "passed");
    if (passedRow) await deliverResult(env, passedRow, lineToken, "passed");
    return;
  }
  if (decision === "failed") {
    const failedRow = await loadDecisiveRow(env, row.parent_job_id, "failed");
    if (failedRow) await deliverResult(env, failedRow, lineToken, "failed");
    return;
  }

  // Images that never contained KPLUS + SETTLEMENT remain silent, preserving
  // the original no-evidence rule and allowing a later image in the same TID.
  await env.DB.prepare("UPDATE user_jobs SET status='collecting',updated_at=CURRENT_TIMESTAMP WHERE id=? AND result_sent_at IS NULL")
    .bind(row.parent_job_id).run();
}

async function settlePendingResultIfReady(
  env: { DB: D1Database; OCR_JOBS: Pick<Queue<OcrQueueMessage>, "send"> },
  row: Pick<SlipProcessRow, "id" | "parent_job_id" | "region" | "job_number">,
  lineToken: string,
) {
  const parent = await env.DB.prepare(`SELECT status,result_sent_at
    FROM user_jobs WHERE id=?`)
    .bind(row.parent_job_id)
    .first<{ status: string; result_sent_at: string | null }>();
  if (!parent || parent.result_sent_at || parent.status !== "pending_failed") return;
  const state = await pendingResultState(env, row.parent_job_id);
  if (!state) return;
  const decision = pendingResultDecision(state);
  if (decision === "wait" || decision === "awaiting_images") return;
  await finalizePendingResult(env, row, lineToken);
}
export async function reserveOcrSpaceUsage(env: Pick<Env, "DB">, region: Region) {
  await env.DB.prepare("INSERT OR IGNORE INTO daily_usage(usage_date,region,provider) VALUES(?,?,'ocrspace')")
    .bind(today(), region).run();
  const reserved = await env.DB.prepare("UPDATE daily_usage SET request_count=request_count+1 WHERE usage_date=? AND region=? AND provider='ocrspace' AND request_count<?")
    .bind(today(), region, OCRSPACE_DAILY_LIMIT).run();
  return (reserved.meta.changes ?? 0) === 1;
}
export function rankOcrSpaceKeyRegions(
  preferredRegion: Region,
  usage: Partial<Record<Region, number>>,
  availableRegions: Region[] = REGIONS
) {
  return [...availableRegions]
    .filter((region) => (usage[region] ?? 0) < OCRSPACE_DAILY_LIMIT)
    .sort((left, right) => {
      if (left === preferredRegion && right !== preferredRegion) return -1;
      if (right === preferredRegion && left !== preferredRegion) return 1;
      const usageDifference = (usage[left] ?? 0) - (usage[right] ?? 0);
      return usageDifference || REGIONS.indexOf(left) - REGIONS.indexOf(right);
    });
}
async function reserveOcrSpaceKey(
  env: Env,
  preferredRegion: Region
): Promise<OcrSpaceKeyReservation | null> {
  const configured = await env.DB.prepare(`SELECT
      rc.region,
      COALESCE(du.request_count,0) AS request_count
    FROM region_config rc
    LEFT JOIN daily_usage du
      ON du.usage_date=?
      AND du.region=rc.region
      AND du.provider='ocrspace'
    WHERE rc.enabled=1 AND rc.ocrspace_api_key IS NOT NULL`)
    .bind(today())
    .all<OcrSpaceUsageRow>();
  const usage = Object.fromEntries(
    configured.results.map((row) => [row.region, row.request_count])
  ) as Partial<Record<Region, number>>;
  const rankedRegions = rankOcrSpaceKeyRegions(
    preferredRegion,
    usage,
    configured.results.map((row) => row.region)
  );

  for (const keyRegion of rankedRegions) {
    const row = await env.DB.prepare(
      "SELECT enabled,ocrspace_api_key FROM region_config WHERE region=?"
    ).bind(keyRegion).first<Pick<RegionConfigRow, "enabled" | "ocrspace_api_key">>();
    if (!row?.enabled || !row.ocrspace_api_key) continue;
    const apiKey = await open(row.ocrspace_api_key, env);
    if (!apiKey) continue;
    // The conditional UPDATE in reserveOcrSpaceUsage is the atomic quota claim.
    // If another queue consumer took the last slot, continue to the next key.
    if (await reserveOcrSpaceUsage(env, keyRegion)) {
      return { keyRegion, apiKey };
    }
  }
  return null;
}
async function recordOcrSpaceOutcome(env: Env, region: Region, success: boolean) {
  await env.DB.prepare(`UPDATE daily_usage SET
      success_count=success_count+?,
      error_count=error_count+?
    WHERE usage_date=? AND region=? AND provider='ocrspace'`)
    .bind(success ? 1 : 0, success ? 0 : 1, today(), region).run();
}
async function beginPaddleOcrUsage(env: Env, region: Region) {
  await env.DB.prepare("INSERT OR IGNORE INTO daily_usage(usage_date,region,provider) VALUES(?,?,?)")
    .bind(today(), region, PADDLEOCR_PROVIDER).run();
  await env.DB.prepare("UPDATE daily_usage SET request_count=request_count+1 WHERE usage_date=? AND region=? AND provider=?")
    .bind(today(), region, PADDLEOCR_PROVIDER).run();
}
async function recordPaddleOcrOutcome(env: Env, region: Region, success: boolean) {
  await env.DB.prepare(`UPDATE daily_usage SET
      success_count=success_count+?,
      error_count=error_count+?
    WHERE usage_date=? AND region=? AND provider=?`)
    .bind(success ? 1 : 0, success ? 0 : 1, today(), region, PADDLEOCR_PROVIDER).run();
}
async function beginWorkersAiUsage(env: Env, region: Region) {
  await env.DB.prepare("INSERT OR IGNORE INTO daily_usage(usage_date,region,provider) VALUES(?,?,?)")
    .bind(today(), region, WORKERS_AI_PROVIDER).run();
  await env.DB.prepare("UPDATE daily_usage SET request_count=request_count+1 WHERE usage_date=? AND region=? AND provider=?")
    .bind(today(), region, WORKERS_AI_PROVIDER).run();
}
async function recordWorkersAiOutcome(env: Env, region: Region, success: boolean) {
  await env.DB.prepare(`UPDATE daily_usage SET
      success_count=success_count+?,
      error_count=error_count+?
    WHERE usage_date=? AND region=? AND provider=?`)
    .bind(success ? 1 : 0, success ? 0 : 1, today(), region, WORKERS_AI_PROVIDER).run();
}
async function lineCall(token: string, endpoint: string, body: unknown) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const response = await fetch(`https://api.line.me/v2/bot/${endpoint}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`LINE ${endpoint}: ${response.status}`);
}

function inspectionResultMessage(row: SlipProcessRow, result: "passed" | "failed") {
  const detectedAmounts = decodeAmounts(row.detected_amounts);
  const detectedAmountText = detectedAmounts.length ? `${detectedAmounts.join(", ")} บาท` : "อ่านยอดไม่ได้";
  const jobText = `TID: ${row.job_number}`;
  const resultText = result === "passed"
    ? `✅ ตรวจสอบผ่าน: พบ KPLUS + SETTLEMENT + ยอด ${row.matched_amount ?? "1.22"} บาท ข้อมูลถูกต้อง`
    : `❌ ตรวจสอบไม่พบยอด 1.22: พบ KPLUS + SETTLEMENT แต่ยอดไม่ตรง\nยอดที่อ่านได้: ${detectedAmountText}\nหาก Test ผ่าน Link POS อย่าลืมลง Remark`;
  const quote = row.line_quote_token ? { quoteToken: row.line_quote_token } : {};
  if ((row.line_source_type === "group" || row.line_source_type === "room") && row.line_user_id) {
    return {
      type: "textV2",
      text: `{sender}\n${jobText}\n${resultText}`,
      ...quote,
      substitution: {
        sender: { type: "mention", mentionee: { type: "user", userId: row.line_user_id } }
      }
    };
  }
  return { type: "text", text: `${jobText}\n${resultText}`, ...quote };
}

export async function replyInspectionResult(token: string, row: SlipProcessRow, result: "passed" | "failed") {
  if (!row.line_reply_token) throw new Error("LINE reply token is unavailable");
  await lineCall(token, "message/reply", {
    replyToken: row.line_reply_token,
    messages: [inspectionResultMessage(row, result)]
  });
}

async function validSignature(raw: string, signature: string | null, secret: string) { return Boolean(signature) && await safeEqual(await hmac(raw, secret), signature!); }

export function isLineWebhookQueueMessage(value: WorkerQueueMessage): value is LineWebhookQueueMessage {
  return typeof value === "object" && value !== null &&
    "kind" in value && value.kind === "line_webhook";
}

export function imageSetMetadata(event: LineEvent) {
  const imageSet = event.message?.imageSet;
  return {
    id: typeof imageSet?.id === "string" ? imageSet.id : null,
    index: Number.isInteger(imageSet?.index) ? imageSet!.index! : null,
    total: Number.isInteger(imageSet?.total) ? imageSet!.total! : null
  };
}

export function splitLineWebhookEvents(events: LineEvent[]) {
  return {
    referenceEvents: events.filter(
      (event) => event.type === "message" && event.message?.type === "text"
    ),
    imageEvents: events.filter(
      (event) => event.type === "message" && event.message?.type === "image"
    )
  };
}

export function lineScopeFromEvent(event: LineEvent) {
  const senderId = event.source?.userId;
  const conversationId = event.source?.groupId ?? event.source?.roomId ?? senderId;
  const sourceType = event.source?.type;
  if (!senderId || !conversationId || !sourceType) return null;
  return {
    senderId,
    conversationId,
    sourceType,
    identityKey: `${conversationId}:${senderId}`
  };
}

export function extractJobNumber(text: unknown) {
  const normalized = String(text ?? "")
    .normalize("NFKC")
    .replace(/[๐-๙]/g, (digit) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(digit)))
    .replace(/[\p{Cf}\uFE0E\uFE0F]/gu, "");
  const match = normalized.match(/(?:^|[^0-9])([0-9]{8})(?![0-9])/);
  return match?.[1] ?? null;
}

export async function processWebhookEvents(
  events: LineEvent[],
  env: { DB: D1Database; OCR_JOBS: Pick<Queue<OcrQueueMessage>, "send"> },
  region: Region,
  receivedAtMs = Date.now()
) {
  for (const event of events) {
    if (event.type !== "message") continue;
    if (event.timestamp !== undefined && !isCurrentInspectionDay(event.timestamp)) {
      await audit(
        env,
        "event_expired",
        event.message?.id ?? event.webhookEventId ?? "unknown",
        region,
      );
      continue;
    }
    const scope = lineScopeFromEvent(event);
    if (!scope) continue;
    const userId = scope.senderId;
    if (event.message?.type === "text") {
      const job = extractJobNumber(event.message.text);
      if (!job) {
        const text = String(event.message.text ?? "");
        const digitCount = (text.normalize("NFKC").match(/[0-9๐-๙]/g) ?? []).length;
        if (digitCount > 0) {
          await audit(
            env,
            "job_reference_not_detected",
            `digits=${digitCount};length=${[...text].length}`,
            region
          );
        }
        continue;
      }
      const id = crypto.randomUUID();
      const referenceTimestampMs = isCurrentInspectionDay(event.timestamp)
        ? (typeof event.timestamp === "number" && event.timestamp > 0
          ? event.timestamp
          : receivedAtMs)
        : receivedAtMs;
      await env.DB.prepare(`INSERT INTO user_jobs(
          id,region,line_user_id,line_sender_id,line_conversation_id,line_source_type,
          job_number,status,expires_at,reference_set_at
        ) VALUES(?,?,?,?,?,?,?, 'collecting',datetime('now',?),strftime('%Y-%m-%d %H:%M:%f',?/1000.0,'unixepoch'))
        ON CONFLICT(region,line_user_id,job_number) DO UPDATE SET
          status=CASE WHEN user_jobs.expires_at <= CURRENT_TIMESTAMP THEN 'collecting' ELSE user_jobs.status END,
          final_result=CASE WHEN user_jobs.expires_at <= CURRENT_TIMESTAMP THEN NULL ELSE user_jobs.final_result END,
          result_claimed_at=CASE WHEN user_jobs.expires_at <= CURRENT_TIMESTAMP THEN NULL ELSE user_jobs.result_claimed_at END,
          result_claim_token=CASE WHEN user_jobs.expires_at <= CURRENT_TIMESTAMP THEN NULL ELSE user_jobs.result_claim_token END,
          result_sent_at=CASE WHEN user_jobs.expires_at <= CURRENT_TIMESTAMP THEN NULL ELSE user_jobs.result_sent_at END,
          expires_at=datetime('now',?),
          reference_set_at=strftime('%Y-%m-%d %H:%M:%f',?/1000.0,'unixepoch'),
          updated_at=CURRENT_TIMESTAMP`)
        .bind(
          id, region, scope.identityKey, userId, scope.conversationId, scope.sourceType, job,
          `+${JOB_REFERENCE_MINUTES} minutes`, referenceTimestampMs,
          `+${JOB_REFERENCE_MINUTES} minutes`, referenceTimestampMs,
        ).run();
      await audit(env, "job_received", job, region);
      continue;
    }
    if (event.message?.type !== "image" || !event.message.id || !event.replyToken) continue;
    const hasEventTimestamp = typeof event.timestamp === "number" &&
      Number.isFinite(event.timestamp) && event.timestamp > 0;
    const parentQuery = hasEventTimestamp
      ? `SELECT id,job_number FROM user_jobs
          WHERE region=? AND line_conversation_id=? AND line_sender_id=?
            AND expires_at>CURRENT_TIMESTAMP
            AND reference_set_at<=strftime('%Y-%m-%d %H:%M:%f',?/1000.0,'unixepoch')
          ORDER BY reference_set_at DESC,rowid DESC LIMIT 1`
      : `SELECT id,job_number FROM user_jobs
          WHERE region=? AND line_conversation_id=? AND line_sender_id=?
            AND expires_at>CURRENT_TIMESTAMP
          ORDER BY reference_set_at DESC,rowid DESC LIMIT 1`;
    const parent = await env.DB.prepare(parentQuery)
      .bind(...(hasEventTimestamp
        ? [region, scope.conversationId, userId, event.timestamp]
        : [region, scope.conversationId, userId]))
      .first<ActiveUserJob>();
    if (!parent) {
      await audit(env, "image_ignored_no_active_job", event.message.id, region);
      continue;
    }
    const messageId = event.message.id;
    const id = crypto.randomUUID();
    const r2Key = `${region}/${today()}/${id}.jpg`;
    const imageSet = imageSetMetadata(event);
    const replyTokenReceivedAtMs = receivedAtMs;
    const inserted = await env.DB.prepare(`INSERT INTO slip_jobs(
        id,region,parent_job_id,line_message_id,line_user_id,r2_key,
        line_reply_token,line_quote_token,webhook_event_id,
        image_set_id,image_set_index,image_set_total,reply_token_received_at_ms
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(region,line_message_id) DO NOTHING`)
      .bind(
        id, region, parent.id, messageId, userId, r2Key,
        event.replyToken, event.message.quoteToken ?? null, event.webhookEventId ?? null,
        imageSet.id, imageSet.index, imageSet.total, replyTokenReceivedAtMs
      ).run();
    if ((inserted.meta.changes ?? 0) !== 1) {
      await env.DB.prepare(`UPDATE slip_jobs SET
          line_reply_token=?,
          line_quote_token=COALESCE(?,line_quote_token),
          webhook_event_id=COALESCE(?,webhook_event_id),
          reply_token_received_at_ms=?,
          updated_at=CURRENT_TIMESTAMP
        WHERE region=? AND line_message_id=? AND EXISTS (
          SELECT 1 FROM user_jobs u
          WHERE u.id=slip_jobs.parent_job_id AND u.result_sent_at IS NULL
        )`)
        .bind(
          event.replyToken,
          event.message.quoteToken ?? null,
          event.webhookEventId ?? null,
          replyTokenReceivedAtMs,
          region,
          messageId
        ).run();
      const duplicate = await env.DB.prepare(`SELECT
          s.id,s.status,u.result_sent_at
        FROM slip_jobs s
        JOIN user_jobs u ON u.id=s.parent_job_id
        WHERE s.region=? AND s.line_message_id=?`)
        .bind(region, messageId)
        .first<{ id: string; status: string; result_sent_at: string | null }>();
      if (duplicate && (
        duplicate.status === "queued" ||
        (!duplicate.result_sent_at &&
          (duplicate.status === "passed" || duplicate.status === "failed"))
      )) {
        await enqueueOcrJobSafely(env, { id: duplicate.id, region }, region);
      }
      await audit(
        env,
        "image_duplicate_ignored",
        messageId,
        region
      );
      continue;
    }
    await enqueueOcrJobSafely(env, { id, region }, region);
    await audit(env, "image_queued", `${parent.job_number}${imageSet.total ? ` รูป ${imageSet.index ?? "?"}/${imageSet.total}` : ""}`, region);
  }
}

async function recordWebhookFailure(env: Env, region: Region, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error("background webhook processing failed", { region, error });
  try {
    await audit(env, "webhook_background_error", detail, region);
  } catch (auditError) {
    console.error("failed to audit background webhook error", auditError);
  }
}

async function webhook(request: Request, env: Env, region: Region) {
  const receivedAtMs = Date.now();
  let c: RegionConfig;
  try { c = await config(env, region); } catch { return json({ error: "control secrets not initialized" }, 503); }
  if (!c.enabled || !c.lineSecret || !c.lineToken) return json({ error: "region is not configured" }, 503);
  const raw = await request.text();
  if (!(await validSignature(raw, request.headers.get("x-line-signature"), c.lineSecret))) {
    await audit(env, "signature_invalid", "LINE signature rejected", region);
    return new Response("Unauthorized", { status: 401 });
  }
  let payload: { events?: LineEvent[] };
  try {
    payload = JSON.parse(raw) as { events?: LineEvent[] };
  } catch {
    return json({ error: "invalid LINE payload" }, 400);
  }
  try {
    const events = Array.isArray(payload.events) ? payload.events : [];
    const { referenceEvents, imageEvents } = splitLineWebhookEvents(events);
    // Persist the TID before acknowledging it so a later image can always find
    // its parent. Image events are durably queued as one payload, keeping the
    // HTTP path short without relying on non-durable background work.
    if (referenceEvents.length) {
      await processWebhookEvents(referenceEvents, env, region, receivedAtMs);
    }
    if (imageEvents.length) {
      await processWebhookEvents(imageEvents, env, region, receivedAtMs);
    }
    return new Response("OK");
  } catch (error) {
    await recordWebhookFailure(env, region, error);
    return json({ error: "webhook processing temporarily unavailable" }, 503);
  }
}

function normalizeOcrText(text: string) {
  return text
    .toUpperCase()
    .replace(/\r/g, "\n")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/-\s*THB\s*/g, "THB -")
    .replace(/THB\s*-\s*/g, "THB -")
    .replace(/\s+/g, " ")
    .trim();
}

function receiptAmounts(text: string) {
  const normalized = normalizeOcrText(text);
  return [...new Set(
    [...normalized.matchAll(/(?:THB\s*)?(-?\d+[.,]\d{2})\b/g)]
      .map((match) => Number(match[1].replace(",", ".")))
      .filter(Number.isFinite)
  )];
}

function hasThaiQrPaymentText(normalized: string) {
  return /\b(?:THAI\s*QR(?:\s*PAYMENT)?|QR\s*PAYMENT)\b/.test(normalized);
}

function isKplusCandidateText(normalized: string) {
  return (
    /\bKPLUS\b/.test(normalized) ||
    /(?:^|[^A-Z0-9])K\s*\+(?:[^A-Z0-9]|$)/.test(normalized)
  );
}

function isConfirmedKplusReceiptText(normalized: string) {
  const hasStandaloneKplusLogo =
    /(?:^|[^A-Z0-9])K\s*\+(?:[^A-Z0-9]|$)/.test(normalized);
  if (hasStandaloneKplusLogo) return true;
  if (!/\bKPLUS\b/.test(normalized)) return false;
  return (
    /\b(?:CHANNEL|HOST|CARD\s*NAME)\s*:?\s*KPLUS\b/.test(normalized) ||
    hasThaiQrPaymentText(normalized)
  );
}

export function analyzeOcr(text: string, requireConfirmedBrand = false): OcrAnalysis {
  const normalized = normalizeOcrText(text);
  const foundKplus =
    (requireConfirmedBrand
      ? isConfirmedKplusReceiptText(normalized)
      : isKplusCandidateText(normalized)) ||
    hasThaiQrPaymentText(normalized);
  const foundSettlement = /\bSETTLEMENT\b/.test(normalized);
  const amounts = receiptAmounts(text);
  const matched = amounts.find((amount) => Math.abs(Math.abs(amount) - 1.22) < 0.005);
  const matchedAmount = matched === undefined ? null : matched.toFixed(2);
  const detectedAmounts = amounts.slice(0, 12).map((amount) => amount.toFixed(2));
  if (!foundKplus || !foundSettlement) {
    const missing = [!foundKplus ? "KPLUS/K+" : "", !foundSettlement ? "SETTLEMENT" : ""].filter(Boolean).join(" และ ");
    return { result: "silent", foundKplus, foundSettlement, matchedAmount, detectedAmounts, reason: `ไม่พบ ${missing} จึงไม่แจ้ง LINE` };
  }
  if (matchedAmount) {
    return { result: "passed", foundKplus, foundSettlement, matchedAmount, detectedAmounts, reason: `พบ KPLUS, SETTLEMENT และยอด ${matchedAmount}` };
  }
  if (detectedAmounts.length > 0) {
    return {
      result: "failed",
      foundKplus,
      foundSettlement,
      matchedAmount,
      detectedAmounts,
      reason: "พบ KPLUS และ SETTLEMENT แต่ยอดไม่ใช่ 1.22 หรือ -1.22"
    };
  }
  return { result: "needs_fallback", foundKplus, foundSettlement, matchedAmount, detectedAmounts, reason: "พบ KPLUS และ SETTLEMENT แต่ไม่พบยอด 1.22 หรือ -1.22" };
}
export function classify(text: string) { return analyzeOcr(text).result; }

export function shouldUseWorkersAi(analysis: OcrAnalysis, ocrUnavailable = false) {
  return ocrUnavailable || (analysis.result !== "passed" &&
    analysis.foundKplus &&
    analysis.foundSettlement);
}

function unavailableOcrAnalysis(reason: string): OcrAnalysis {
  return {
    result: "needs_fallback",
    foundKplus: false,
    foundSettlement: false,
    matchedAmount: null,
    detectedAmounts: [],
    reason
  };
}

type WorkersAiVisionAnalysis = OcrAnalysis & { confident: boolean; rawText: string };

function visionAmounts(values: unknown) {
  if (!Array.isArray(values)) return [];
  const amounts = values.flatMap((value) => {
    const match = String(value).replace(/[‐‑‒–—−]/g, "-").match(/-?\d+(?:[.,]\d{1,2})?/);
    if (!match) return [];
    const amount = Number(match[0].replace(",", "."));
    return Number.isFinite(amount) ? [amount] : [];
  });
  return [...new Set(amounts)].slice(0, 12).map((amount) => amount.toFixed(2));
}

function visionProseBoolean(text: string, field: "foundKplus" | "foundSettlement" | "confident") {
  const cleaned = text.replace(/[*_`]/g, "");
  const label = field === "foundKplus"
    ? "found\\s*kplus"
    : field === "foundSettlement"
      ? "found\\s*settlement"
      : "confident";
  const match = cleaned.match(new RegExp(`\\b${label}\\b\\s*(?::|=|is)\\s*(true|false)\\b`, "i"));
  if (!match) return undefined;
  return match[1].toLowerCase() === "true";
}

function visionProseValue(rawText: string) {
  const foundKplus = visionProseBoolean(rawText, "foundKplus");
  const foundSettlement = visionProseBoolean(rawText, "foundSettlement");
  const confident = visionProseBoolean(rawText, "confident");
  if (foundKplus === undefined || foundSettlement === undefined || confident === undefined) return null;
  return {
    foundKplus,
    foundSettlement,
    confident,
    amounts: receiptAmounts(rawText).map((amount) => amount.toFixed(2))
  };
}

export function analyzeWorkersAiVision(response: unknown): WorkersAiVisionAnalysis {
  const rawText = typeof response === "string" ? response : JSON.stringify(response ?? "");
  let value: Record<string, unknown>;
  try {
    if (response && typeof response === "object" && !Array.isArray(response)) {
      value = response as Record<string, unknown>;
    } else {
      const jsonText = rawText.match(/\{[\s\S]*\}/)?.[0] ?? "";
      value = JSON.parse(jsonText) as Record<string, unknown>;
    }
  } catch {
    const proseValue = visionProseValue(rawText);
    if (proseValue) {
      value = proseValue;
    } else {
      return {
        result: "needs_fallback",
        foundKplus: false,
        foundSettlement: false,
        matchedAmount: null,
        detectedAmounts: [],
        confident: false,
        rawText,
        reason: "Workers AI Vision ตอบกลับในรูปแบบที่ระบบอ่านไม่ได้"
      };
    }
  }
  const foundKplus = value.foundKplus === true;
  const foundSettlement = value.foundSettlement === true;
  const confident = value.confident === true;
  const detectedAmounts = visionAmounts(value.amounts);
  const matchedAmount = detectedAmounts.find((amount) => Math.abs(Math.abs(Number(amount)) - 1.22) < 0.005) ?? null;
  if (!confident) {
    return {
      result: "needs_fallback", foundKplus, foundSettlement, matchedAmount, detectedAmounts, confident, rawText,
      reason: "Workers AI Vision ไม่มั่นใจ จึงยังไม่แจ้งผล"
    };
  }
  if (!foundKplus || !foundSettlement) {
    return {
      result: "needs_fallback", foundKplus, foundSettlement, matchedAmount, detectedAmounts, confident, rawText,
      reason: "Workers AI Vision พบหลักฐาน KPLUS หรือ SETTLEMENT ไม่ครบ จึงยังไม่แจ้งผล"
    };
  }
  if (matchedAmount) {
    return {
      result: "passed", foundKplus, foundSettlement, matchedAmount, detectedAmounts, confident, rawText,
      reason: `Workers AI Vision ยืนยัน KPLUS, SETTLEMENT และยอด ${matchedAmount}`
    };
  }
  if (detectedAmounts.length > 0) {
    return {
      result: "failed", foundKplus, foundSettlement, matchedAmount, detectedAmounts, confident, rawText,
      reason: "Workers AI Vision ยืนยัน KPLUS และ SETTLEMENT แต่ยอดไม่ใช่ 1.22 หรือ -1.22"
    };
  }
  return {
    result: "needs_fallback", foundKplus, foundSettlement, matchedAmount, detectedAmounts, confident, rawText,
    reason: "Workers AI Vision พบ KPLUS และ SETTLEMENT แต่ยังอ่านยอดไม่ชัด"
  };
}

export function analyzeWorkersAiTranscription(response: unknown): WorkersAiVisionAnalysis {
  const rawText = typeof response === "string" ? response.trim() : "";
  if (!rawText || rawText.toUpperCase() === "NONE") {
    return {
      result: "needs_fallback",
      foundKplus: false,
      foundSettlement: false,
      matchedAmount: null,
      detectedAmounts: [],
      confident: false,
      rawText,
      reason: "Workers AI Vision ถอดข้อความที่อ่านได้ไม่สำเร็จ"
    };
  }
  const analysis = analyzeOcr(rawText);
  const confident = analysis.foundKplus || analysis.foundSettlement || analysis.detectedAmounts.length > 0;
  return {
    ...analysis,
    result: analysis.result === "silent" ? "needs_fallback" : analysis.result,
    confident,
    rawText,
    reason: confident
      ? `Workers AI Vision ถอดข้อความแล้ว: ${analysis.reason}`
      : "Workers AI Vision ถอดข้อความแล้วแต่ไม่พบหลักฐานที่ใช้ตัดสิน"
  };
}

export function mergeOcrAndWorkersAi(
  ocr: OcrAnalysis,
  ai: WorkersAiVisionAnalysis,
  ocrLabel = "OCR.space"
): OcrAnalysis {
  const aiCanConfirm = ai.confident;
  const foundKplus = ocr.foundKplus || (aiCanConfirm && ai.foundKplus);
  const foundSettlement = ocr.foundSettlement || (aiCanConfirm && ai.foundSettlement);
  const detectedAmounts = [...new Set([
    ...ocr.detectedAmounts,
    ...(aiCanConfirm ? ai.detectedAmounts : [])
  ])].slice(0, 12);
  const matchedAmount = detectedAmounts.find((amount) => Math.abs(Math.abs(Number(amount)) - 1.22) < 0.005) ?? null;
  const confirmedWrongAmount = ocr.detectedAmounts.find((ocrAmount) => {
    const numericOcrAmount = Number(ocrAmount);
    if (!Number.isFinite(numericOcrAmount) ||
        Math.abs(Math.abs(numericOcrAmount) - 1.22) < 0.005) {
      return false;
    }
    return ai.detectedAmounts.some((aiAmount) => {
      const numericAiAmount = Number(aiAmount);
      return Number.isFinite(numericAiAmount) &&
        Math.abs(numericOcrAmount - numericAiAmount) < 0.005;
    });
  });

  if (!aiCanConfirm) {
    return {
      result: "needs_fallback",
      foundKplus,
      foundSettlement,
      matchedAmount,
      detectedAmounts,
      reason: ai.reason
    };
  }
  if (foundKplus && foundSettlement && matchedAmount) {
    return {
      result: "passed",
      foundKplus,
      foundSettlement,
      matchedAmount,
      detectedAmounts,
      reason: `${ocrLabel} และ Workers AI Vision ยืนยันร่วมกัน: พบ KPLUS, SETTLEMENT และยอด ${matchedAmount}`
    };
  }
  if (foundKplus && foundSettlement && confirmedWrongAmount !== undefined) {
    return {
      result: "failed",
      foundKplus,
      foundSettlement,
      matchedAmount,
      detectedAmounts,
      reason: `${ocrLabel} และ Workers AI Vision ยืนยันยอดอื่นตรงกัน: ${confirmedWrongAmount} บาท`
    };
  }
  return {
    result: "needs_fallback",
    foundKplus,
    foundSettlement,
    matchedAmount,
    detectedAmounts,
    reason: `${ocrLabel} และ Workers AI Vision ยังพบหลักฐานไม่ครบ จึงยังไม่แจ้งผล`
  };
}

function imageMime(bytes: Uint8Array) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "image/webp";
  return "image/jpeg";
}

async function runWorkersAiVision(env: Env, imageBytes: ArrayBuffer) {
  const bytes = new Uint8Array(imageBytes);
  const output = await env.AI.run(WORKERS_AI_MODEL, {
    prompt: VISIBLE_TEXT_PROMPT,
    image: Array.from(bytes),
    max_tokens: 500,
    temperature: 0
  });
  const response: unknown = output.response;
  return analyzeWorkersAiTranscription(response);
}

async function completeImageAnalysis(
  env: Env,
  row: SlipProcessRow,
  lineToken: string,
  imageBytes: ArrayBuffer,
  ocrText: string,
  analysis: OcrAnalysis,
  ocrKeyRegion: Region | null,
  ocrUnavailable = false,
  primaryProvider = "ocrspace",
  ocrLabel = "OCR.space"
) {
  let finalAnalysis = analysis;
  let aiAnalysis: WorkersAiVisionAnalysis | null = null;
  if (shouldUseWorkersAi(analysis, ocrUnavailable)) {
    await beginWorkersAiUsage(env, row.region);
    try {
      aiAnalysis = await runWorkersAiVision(env, imageBytes);
      await recordWorkersAiOutcome(env, row.region, true);
      finalAnalysis = mergeOcrAndWorkersAi(analysis, aiAnalysis, ocrLabel);
      await audit(env, `workers_ai_${finalAnalysis.result}`, row.job_number, row.region);
    } catch (error) {
      await recordWorkersAiOutcome(env, row.region, false);
      const detail = error instanceof Error ? error.message : String(error);
      aiAnalysis = {
        result: "needs_fallback",
        foundKplus: false,
        foundSettlement: false,
        matchedAmount: null,
        detectedAmounts: [],
        confident: false,
        rawText: detail,
        reason: `Workers AI Vision ผิดพลาด: ${detail}`.slice(0, 1000)
      };
      finalAnalysis = mergeOcrAndWorkersAi(analysis, aiAnalysis, ocrLabel);
      await audit(env, "workers_ai_error", detail, row.region);
    }
  }
  const provider = aiAnalysis
    ? `${primaryProvider}+${WORKERS_AI_PROVIDER}`
    : primaryProvider;
  await env.DB.prepare(`UPDATE slip_jobs SET
      status=?,
      ocr_provider=?,
      ocr_text=?,
      result=?,
      found_kplus=?,
      found_settlement=?,
      matched_amount=?,
      detected_amounts=?,
      decision_reason=?,
      ocrspace_found_kplus=?,
      ocrspace_found_settlement=?,
      ocrspace_detected_amounts=?,
      ocrspace_key_region=?,
      ai_provider=?,
      ai_response=?,
      ai_found_kplus=?,
      ai_found_settlement=?,
      ai_detected_amounts=?,
      ai_confident=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?`)
    .bind(
      finalAnalysis.result,
      provider,
      ocrText.slice(0, 10000),
      finalAnalysis.result,
      finalAnalysis.foundKplus ? 1 : 0,
      finalAnalysis.foundSettlement ? 1 : 0,
      finalAnalysis.matchedAmount,
      JSON.stringify(finalAnalysis.detectedAmounts),
      finalAnalysis.reason,
      analysis.foundKplus ? 1 : 0,
      analysis.foundSettlement ? 1 : 0,
      JSON.stringify(analysis.detectedAmounts),
      ocrKeyRegion,
      aiAnalysis ? WORKERS_AI_PROVIDER : null,
      aiAnalysis?.rawText.slice(0, 10000) ?? null,
      aiAnalysis ? (aiAnalysis.foundKplus ? 1 : 0) : null,
      aiAnalysis ? (aiAnalysis.foundSettlement ? 1 : 0) : null,
      aiAnalysis ? JSON.stringify(aiAnalysis.detectedAmounts) : null,
      aiAnalysis ? (aiAnalysis.confident ? 1 : 0) : null,
      row.id
    ).run();
  await deleteCachedImage(env, row);
  if (finalAnalysis.result === "passed" || finalAnalysis.result === "failed") {
    row.matched_amount = finalAnalysis.matchedAmount;
    row.detected_amounts = JSON.stringify(finalAnalysis.detectedAmounts);
    row.decision_reason = finalAnalysis.reason;
    if (finalAnalysis.result === "passed") {
      // A confirmed KPLUS + SETTLEMENT + 1.22 image is decisive. Do not wait
      // for the remaining images in the same LINE batch.
      await deliverResult(env, row, lineToken, "passed");
    } else {
      // A wrong amount is only a candidate failure. More OCR results may still
      // contain the correct settlement, so defer only while an OCR result is
      // pending or until the 45-second safety timeout.
      await deferFailedResult(env, row, lineToken);
    }
  }
  await audit(
    env,
    ocrUnavailable ? "ocr_unavailable_fallback" : `ocr_${analysis.result}`,
    row.job_number,
    row.region
  );
  // A later image may be the last pending OCR result. Finalize immediately
  // once all received results are done instead of waiting for the timer.
  await settlePendingResultIfReady(env, row, lineToken);
}

export async function latestReplyToken(db: D1Database, parentJobId: string) {
  return db.prepare(`SELECT
      id,
      line_reply_token,
      COALESCE(
        reply_token_received_at_ms,
        CAST(strftime('%s',created_at) AS INTEGER) * 1000
      ) AS received_at_ms
    FROM slip_jobs
    WHERE parent_job_id=?
      AND line_reply_token IS NOT NULL
      AND reply_token_used_at IS NULL
    ORDER BY
      COALESCE(
        reply_token_received_at_ms,
        CAST(strftime('%s',created_at) AS INTEGER) * 1000
      ) DESC,
      created_at DESC,
      rowid DESC
    LIMIT 1`)
    .bind(parentJobId)
    .first<LatestReplyTokenRow>();
}

export async function deliverResult(env: Pick<Env, "DB">, row: SlipProcessRow, token: string, result: "passed" | "failed") {
  if (row.result_sent_at) return;
  const claimToken = crypto.randomUUID();
  const claimed = await env.DB.prepare(`UPDATE user_jobs SET
      status='result_claimed',
      final_result=?,
      result_claimed_at=CURRENT_TIMESTAMP,
      result_claim_token=?
    WHERE id=? AND result_sent_at IS NULL AND (
      result_claimed_at IS NULL OR
      result_claimed_at<datetime('now',?)
    )`)
    .bind(result, claimToken, row.parent_job_id, `-${PASS_CLAIM_MINUTES} minutes`).run();
  if ((claimed.meta.changes ?? 0) !== 1) {
    const state = await env.DB.prepare("SELECT result_sent_at FROM user_jobs WHERE id=?")
      .bind(row.parent_job_id).first<{ result_sent_at: string | null }>();
    if (state?.result_sent_at) return;
    throw new Error("result delivery claim is busy");
  }
  try {
    const selectedReply = await latestReplyToken(env.DB, row.parent_job_id);
    if (!selectedReply?.line_reply_token) throw new Error("LINE reply token is unavailable");
    const tokenAgeMs = replyTokenAgeMs(selectedReply.received_at_ms);
    await audit(
      env,
      "reply_token_selected",
      `${row.job_number}: age_ms=${tokenAgeMs}, source=${selectedReply.id}`,
      row.region
    );
    if (tokenAgeMs >= REPLY_TOKEN_WARNING_MS) {
      await audit(
        env,
        "reply_token_age_warning",
        `${row.job_number}: reply token age ${Math.round(tokenAgeMs / 1000)} seconds`,
        row.region
      );
    }
    await replyInspectionResult(
      token,
      { ...row, line_reply_token: selectedReply.line_reply_token },
      result
    );
    await env.DB.batch([
      env.DB.prepare("UPDATE user_jobs SET status=?,final_result=?,result_sent_at=CURRENT_TIMESTAMP,result_claimed_at=NULL,result_claim_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND result_claim_token=?")
        .bind(result, result, row.parent_job_id, claimToken),
      env.DB.prepare("UPDATE slip_jobs SET replied_at=CURRENT_TIMESTAMP,reply_token_age_ms=?,reply_token_source_slip_id=? WHERE id=? AND replied_at IS NULL")
        .bind(tokenAgeMs, selectedReply.id, row.id),
      env.DB.prepare("UPDATE slip_jobs SET reply_token_used_at=CURRENT_TIMESTAMP WHERE id=? AND reply_token_used_at IS NULL")
        .bind(selectedReply.id)
    ]);
  } catch (error) {
    await env.DB.prepare("UPDATE user_jobs SET status='collecting',final_result=NULL,result_claimed_at=NULL,result_claim_token=NULL WHERE id=? AND result_claim_token=? AND result_sent_at IS NULL")
      .bind(row.parent_job_id, claimToken).run();
    await audit(env, "line_reply_error", `${row.job_number}: ${error instanceof Error ? error.message : String(error)}`, row.region);
    throw error;
  }
}

async function deleteCachedImage(env: Env, row: Pick<SlipProcessRow, "id" | "region" | "r2_key">) {
  try {
    await env.SLIPS.delete(row.r2_key);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("failed to delete processed image", { id: row.id, region: row.region, error: detail });
    try {
      await audit(env, "r2_delete_error", `${row.id}: ${detail}`, row.region);
    } catch (auditError) {
      console.error("failed to audit R2 delete error", { id: row.id, region: row.region, error: auditError });
    }
  }
}

async function rejectOversizedImage(env: Env, row: SlipProcessRow, size: number) {
  const reason = `รูปมีขนาด ${size} bytes เกินเพดาน ${MAX_IMAGE_BYTES} bytes`;
  await env.DB.prepare("UPDATE slip_jobs SET status='image_too_large',result='needs_fallback',decision_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(reason, row.id).run();
  await audit(env, "image_too_large", `${row.job_number}: ${size} bytes`, row.region);
  await deleteCachedImage(env, row);
}

async function loadImageBytes(
  env: Env,
  row: SlipProcessRow,
  lineToken: string,
  attempt: number
) {
  const object = await env.SLIPS.get(row.r2_key);
  if (object && "body" in object && object.body) {
    if (imageTooLarge(object.size)) {
      await rejectOversizedImage(env, row, object.size);
      return null;
    }
    return new Response(object.body).arrayBuffer();
  }
  const content = await fetch(`https://api-data.line.me/v2/bot/message/${row.line_message_id}/content`, {
    headers: { authorization: `Bearer ${lineToken}` }
  });
  if (!content.ok) {
    await audit(env, "line_image_download_failed", `${row.job_number}: HTTP ${content.status}`, row.region);
    if (shouldRetryOcr(attempt)) throw new Error(`LINE image download failed: HTTP ${content.status}`);
    await env.DB.prepare("UPDATE slip_jobs SET status='download_error',result='needs_fallback',decision_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(`โหลดรูปจาก LINE ไม่สำเร็จหลังลอง ${MAX_OCR_ATTEMPTS} ครั้ง: HTTP ${content.status}`, row.id).run();
    await deleteCachedImage(env, row);
    return null;
  }
  const declaredSize = Number(content.headers.get("content-length"));
  if (content.headers.has("content-length") && imageTooLarge(declaredSize)) {
    await content.body?.cancel();
    await rejectOversizedImage(env, row, declaredSize);
    return null;
  }
  const imageBytes = await content.arrayBuffer();
  if (imageTooLarge(imageBytes.byteLength)) {
    await rejectOversizedImage(env, row, imageBytes.byteLength);
    return null;
  }
  await env.SLIPS.put(row.r2_key, imageBytes, {
    httpMetadata: { contentType: content.headers.get("content-type") ?? "image/jpeg" }
  });
  return imageBytes;
}

async function enqueueOcrSpaceFallback(
  env: Env,
  row: Pick<SlipProcessRow, "id" | "region">,
  paddleAttempted: boolean,
  ocrSpaceAttempt = 1,
  delaySeconds = 0
) {
  const message = {
    id: row.id,
    region: row.region,
    phase: "ocrspace",
    ocrSpaceAttempt,
    paddleAttempted
  } satisfies OcrQueueMessage;
  try {
    await env.OCR_FALLBACK_JOBS.send(
      message,
      delaySeconds > 0 ? { delaySeconds } : undefined
    );
    return true;
  } catch (error) {
    const detail = queueErrorText(error);
    console.error(JSON.stringify({
      event: "queue_write_deferred",
      target: "ocr-fallback",
      region: row.region,
      id: row.id,
      error: detail,
    }));
    await auditQueueDeferral(env, "ocr-fallback", `${row.id}: ${detail}`, row.region);
    return false;
  }
}

function waitForPaddlePoll(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, PADDLEOCR_POLL_DELAY_SECONDS * 1000);
  });
}

async function pollPaddleInline(
  env: Env,
  row: SlipProcessRow,
  lineToken: string,
  imageBytes: ArrayBuffer,
  paddleToken: string,
  paddleJobId: string,
): Promise<boolean> {
  for (let pollCount = 0; pollCount < PADDLEOCR_INLINE_POLLS; pollCount += 1) {
    const response = await fetch(
      `${PADDLEOCR_JOB_URL}/${encodeURIComponent(paddleJobId)}`,
      paddleOcrPollRequest(paddleToken),
    );
    const payload = await response.json<any>().catch(() => null);
    if (!response.ok || payload?.code !== 0) {
      throw new Error(String(payload?.msg ?? `HTTP ${response.status}`));
    }
    const state = payload?.data?.state;
    if (state === "failed") {
      throw new Error(String(payload?.data?.errorMsg ?? "PaddleOCR parsing failed"));
    }
    if (state === "done") {
      const jsonUrl = payload?.data?.resultUrl?.jsonUrl;
      if (typeof jsonUrl !== "string" || !jsonUrl) {
        throw new Error("PaddleOCR ไม่ส่ง result URL");
      }
      const resultResponse = await fetch(jsonUrl, { signal: AbortSignal.timeout(20_000) });
      if (!resultResponse.ok) {
        throw new Error(`ดาวน์โหลดผล PaddleOCR ไม่สำเร็จ: HTTP ${resultResponse.status}`);
      }
      const text = extractPaddleOcrText(await resultResponse.text());
      if (!text) throw new Error("PaddleOCR ส่งผลลัพธ์ที่ไม่มีข้อความ");
      await recordPaddleOcrOutcome(env, row.region, true);
      await audit(env, "paddleocr_done", `${row.job_number}: ${paddleJobId}`, row.region);
      await completeImageAnalysis(
        env,
        row,
        lineToken,
        imageBytes,
        text,
        analyzeOcr(text, true),
        null,
        false,
        PADDLEOCR_PROVIDER,
        "PaddleOCR",
      );
      return true;
    }
    if (state !== "pending" && state !== "running") {
      throw new Error(`PaddleOCR สถานะไม่รู้จัก: ${String(state)}`);
    }
    const nextPollCount = pollCount + 1;
    await env.DB.prepare(
      "UPDATE slip_jobs SET paddle_poll_count=?,decision_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).bind(
      nextPollCount,
      `PaddleOCR กำลังประมวลผล (${nextPollCount}/${MAX_PADDLEOCR_POLLS})`,
      row.id,
    ).run();
    if (nextPollCount < PADDLEOCR_INLINE_POLLS) await waitForPaddlePoll();
  }
  return false;
}

async function runOcrSpaceFallback(
  env: Env,
  row: SlipProcessRow,
  lineToken: string,
  imageBytes: ArrayBuffer,
  ocrAttempt: number,
  paddleAttempted: boolean
) {
  const providerChain = paddleAttempted ? "paddleocr+ocrspace" : "ocrspace";
  const ocrReservation = await reserveOcrSpaceKey(env, row.region);
  if (!ocrReservation) {
    await audit(env, "ocr_pool_quota_exhausted", row.job_number, row.region);
    const unavailable = unavailableOcrAnalysis(
      `OCR.space ทุกภูมิภาคที่เปิดใช้งานครบ ${OCRSPACE_DAILY_LIMIT} รูปต่อวัน จึงส่งต่อ Workers AI`
    );
    await completeImageAnalysis(
      env,
      row,
      lineToken,
      imageBytes,
      "",
      unavailable,
      null,
      true,
      providerChain
    );
    return;
  }
  const ocrKeyRegion = ocrReservation.keyRegion;
  if (ocrKeyRegion !== row.region) {
    await audit(
      env,
      "ocr_key_borrowed",
      `${row.job_number}: ${row.region} -> ${ocrKeyRegion}`,
      row.region
    );
  }
  let response: Response;
  try {
    response = await fetch(
      "https://api.ocr.space/parse/image",
      ocrSpaceRequestInit(imageBytes, ocrReservation.apiKey)
    );
  } catch (error) {
    const errorDetail = error instanceof Error ? error.message : String(error);
    await recordOcrSpaceOutcome(env, ocrKeyRegion, false);
    await audit(env, "ocr_error", errorDetail, row.region);
    if (shouldRetryOcr(ocrAttempt)) {
      await env.DB.prepare("UPDATE slip_jobs SET status='queued',ocr_provider=?,ocrspace_key_region=?,ocr_text=?,decision_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(
          providerChain,
          ocrKeyRegion,
          errorDetail.slice(0, 10000),
          `OCR.space ผิดพลาดครั้งที่ ${ocrAttempt}; กำลัง retry อีก 1 ครั้ง: ${errorDetail}`.slice(0, 1000),
          row.id
        ).run();
      await enqueueOcrSpaceFallback(env, row, paddleAttempted, ocrAttempt + 1, 2);
      return;
    }
    await env.DB.prepare("UPDATE slip_jobs SET status='ocr_error',result='needs_fallback',ocr_provider=?,ocrspace_key_region=?,ocr_text=?,decision_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(
        providerChain,
        ocrKeyRegion,
        errorDetail.slice(0, 10000),
        `OCR.space ผิดพลาดหลังลอง ${MAX_OCR_ATTEMPTS} ครั้ง: ${errorDetail}`.slice(0, 1000),
        row.id
      ).run();
    const unavailable = unavailableOcrAnalysis(
      `OCR.space ผิดพลาดหลังลอง ${MAX_OCR_ATTEMPTS} ครั้ง จึงส่งต่อ Workers AI: ${errorDetail}`.slice(0, 1000)
    );
    await completeImageAnalysis(
      env,
      row,
      lineToken,
      imageBytes,
      errorDetail,
      unavailable,
      ocrKeyRegion,
      true,
      providerChain
    );
    return;
  }
  let payload: any;
  let payloadParsed = true;
  try {
    payload = await response.json<any>();
  } catch {
    payload = {};
    payloadParsed = false;
  }
  const text = (payload.ParsedResults ?? []).map((v: any) => v.ParsedText ?? "").join("\n");
  const succeeded = response.ok && payloadParsed && !payload.IsErroredOnProcessing;
  await recordOcrSpaceOutcome(env, ocrKeyRegion, succeeded);
  if (!succeeded) {
    const errorDetail = String(payload.ErrorMessage ?? (payloadParsed ? response.status : "invalid JSON response"));
    await audit(env, "ocr_error", errorDetail, row.region);
    if (shouldRetryOcr(ocrAttempt)) {
      await env.DB.prepare("UPDATE slip_jobs SET status='queued',ocr_provider=?,ocrspace_key_region=?,ocr_text=?,decision_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(
          providerChain,
          ocrKeyRegion,
          errorDetail.slice(0, 10000),
          `OCR.space ผิดพลาดครั้งที่ ${ocrAttempt}; กำลัง retry อีก 1 ครั้ง: ${errorDetail}`.slice(0, 1000),
          row.id
        ).run();
      await enqueueOcrSpaceFallback(env, row, paddleAttempted, ocrAttempt + 1, 2);
      return;
    }
    await env.DB.prepare("UPDATE slip_jobs SET status='ocr_error',result='needs_fallback',ocr_provider=?,ocrspace_key_region=?,ocr_text=?,decision_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(
        providerChain,
        ocrKeyRegion,
        errorDetail.slice(0, 10000),
        `OCR.space ผิดพลาดหลังลอง ${MAX_OCR_ATTEMPTS} ครั้ง: ${errorDetail}`.slice(0, 1000),
        row.id
      ).run();
    const unavailable = unavailableOcrAnalysis(
      `OCR.space ผิดพลาดหลังลอง ${MAX_OCR_ATTEMPTS} ครั้ง จึงส่งต่อ Workers AI: ${errorDetail}`.slice(0, 1000)
    );
    await completeImageAnalysis(
      env,
      row,
      lineToken,
      imageBytes,
      errorDetail,
      unavailable,
      ocrKeyRegion,
      true,
      providerChain
    );
    return;
  }
  const analysis = analyzeOcr(text, true);
  await completeImageAnalysis(
    env,
    row,
    lineToken,
    imageBytes,
    text,
    analysis,
    ocrKeyRegion,
    false,
    providerChain
  );
}

async function suppressExpiredSlip(env: Env, row: SlipProcessRow) {
  await env.DB.prepare(`UPDATE slip_jobs SET
      status='suppressed', result='silent', decision_reason=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status IN ('queued','paddle_pending','passed','failed')`)
    .bind(EXPIRED_INSPECTION_REASON, row.id)
    .run();
  await audit(env, "inspection_expired", row.job_number, row.region);
  await deleteCachedImage(env, row);
}

async function processJob(env: Env, data: OcrQueueMessage, attempt = 1) {
  const row = await env.DB.prepare("SELECT s.*,u.job_number,u.line_source_type,u.result_sent_at FROM slip_jobs s JOIN user_jobs u ON u.id=s.parent_job_id WHERE s.id=? AND s.region=?")
    .bind(data.id, data.region).first<SlipProcessRow>();
  if (!row) return;
  if (!isCurrentInspectionDay(row.created_at)) {
    await suppressExpiredSlip(env, row);
    return;
  }
  const c = await config(env, data.region);
  if (!c.enabled || !c.lineToken) throw new Error("region configuration unavailable");
  if (data.phase === "finalize") {
    await finalizePendingResult(env, row, c.lineToken);
    return;
  }
  if (row.status === "passed" && !row.result_sent_at) {
    await deleteCachedImage(env, row);
    await deliverResult(env, row, c.lineToken, "passed");
    return;
  }
  if (row.status === "failed" && !row.result_sent_at) {
    await deferFailedResult(env, row, c.lineToken);
    return;
  }
  if (row.status !== "queued" && row.status !== "paddle_pending") {
    await deleteCachedImage(env, row);
    return;
  }
  if (row.result_sent_at) {
    await env.DB.prepare("UPDATE slip_jobs SET status='suppressed',result='silent',decision_reason='งานนี้แจ้งผลตรวจไปแล้ว จึงไม่ตรวจซ้ำ',updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(row.id).run();
    await audit(env, "ocr_suppressed_after_result", row.job_number, data.region);
    await deleteCachedImage(env, row);
    return;
  }
  const imageBytes = await loadImageBytes(env, row, c.lineToken, attempt);
  if (!imageBytes) return;

  const phase = data.phase ?? (row.status === "paddle_pending" ? "paddle_poll" : "start");
  if (phase === "ocrspace") {
    await runOcrSpaceFallback(
      env,
      row,
      c.lineToken,
      imageBytes,
      data.ocrSpaceAttempt ?? 1,
      Boolean(data.paddleAttempted)
    );
    return;
  }

  const paddleToken = env.PADDLEOCR_TOKEN?.trim();
  if (!paddleToken) {
    await audit(env, "paddleocr_not_configured", `${row.job_number}: ใช้ OCR.space`, row.region);
    await env.DB.prepare("UPDATE slip_jobs SET status='queued',ocr_provider='ocrspace',decision_reason='ไม่ได้ตั้งค่า PaddleOCR จึงรอ OCR.space',updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(row.id).run();
    await enqueueOcrSpaceFallback(env, row, false);
    return;
  }

  if (phase === "start") {
    await beginPaddleOcrUsage(env, row.region);
    try {
      const response = await fetch(
        PADDLEOCR_JOB_URL,
        paddleOcrSubmitRequest(imageBytes, paddleToken, env.PADDLEOCR_MODEL?.trim() || DEFAULT_PADDLEOCR_MODEL)
      );
      const payload = await response.json<any>().catch(() => null);
      const jobId = payload?.data?.jobId;
      if (!response.ok || payload?.code !== 0 || typeof jobId !== "string" || !jobId) {
        throw new Error(String(payload?.msg ?? `HTTP ${response.status}`));
      }
      await env.DB.prepare(`UPDATE slip_jobs SET
          status='paddle_pending',
          ocr_provider=?,
          paddle_job_id=?,
          paddle_poll_count=0,
          decision_reason='ส่งรูปให้ PaddleOCR แล้ว กำลังรอผล',
          updated_at=CURRENT_TIMESTAMP
        WHERE id=?`)
        .bind(PADDLEOCR_PROVIDER, jobId, row.id).run();
      if (await pollPaddleInline(
        env,
        row,
        c.lineToken,
        imageBytes,
        paddleToken,
        jobId,
      )) {
        return;
      }
      await enqueueOcrJobSafely(env, {
        id: row.id,
        region: row.region,
        phase: "paddle_poll",
        paddleJobId: jobId,
        paddlePollCount: PADDLEOCR_INLINE_POLLS,
        paddleAttempted: true
      } satisfies OcrQueueMessage, row.region, { delaySeconds: PADDLEOCR_POLL_DELAY_SECONDS });
      await audit(env, "paddleocr_submitted", `${row.job_number}: ${jobId}`, row.region);
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await recordPaddleOcrOutcome(env, row.region, false);
      await audit(env, "paddleocr_submit_error", detail, row.region);
      await env.DB.prepare("UPDATE slip_jobs SET status='queued',ocr_provider='paddleocr',decision_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(`PaddleOCR ส่งงานไม่สำเร็จ จึงใช้ OCR.space: ${detail}`.slice(0, 1000), row.id).run();
      await enqueueOcrSpaceFallback(env, row, true);
      return;
    }
  }

  const jobId = data.paddleJobId ?? row.paddle_job_id;
  if (!jobId) {
    await recordPaddleOcrOutcome(env, row.region, false);
    await audit(env, "paddleocr_job_missing", row.job_number, row.region);
    await env.DB.prepare("UPDATE slip_jobs SET status='queued',ocr_provider='paddleocr',decision_reason='ไม่พบ PaddleOCR jobId จึงรอ OCR.space',updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(row.id).run();
    await enqueueOcrSpaceFallback(env, row, true);
    return;
  }
  try {
    const response = await fetch(`${PADDLEOCR_JOB_URL}/${encodeURIComponent(jobId)}`, paddleOcrPollRequest(paddleToken));
    const payload = await response.json<any>().catch(() => null);
    if (!response.ok || payload?.code !== 0) {
      throw new Error(String(payload?.msg ?? `HTTP ${response.status}`));
    }
    const state = payload?.data?.state;
    if (state === "pending" || state === "running") {
      const pollCount = (data.paddlePollCount ?? row.paddle_poll_count ?? 0) + 1;
      if (pollCount >= MAX_PADDLEOCR_POLLS) {
        throw new Error(`หมดเวลารอผลหลังตรวจสถานะ ${pollCount} ครั้ง`);
      }
      await env.DB.prepare("UPDATE slip_jobs SET paddle_poll_count=?,decision_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(pollCount, `PaddleOCR กำลังประมวลผล (${pollCount}/${MAX_PADDLEOCR_POLLS})`, row.id).run();
      await enqueueOcrJobSafely(env, {
        id: row.id,
        region: row.region,
        phase: "paddle_poll",
        paddleJobId: jobId,
        paddlePollCount: pollCount,
        paddleAttempted: true
      } satisfies OcrQueueMessage, row.region, { delaySeconds: PADDLEOCR_POLL_DELAY_SECONDS });
      return;
    }
    if (state === "failed") {
      throw new Error(String(payload?.data?.errorMsg ?? "PaddleOCR parsing failed"));
    }
    if (state !== "done") {
      throw new Error(`สถานะ PaddleOCR ไม่รู้จัก: ${String(state)}`);
    }
    const jsonUrl = payload?.data?.resultUrl?.jsonUrl;
    if (typeof jsonUrl !== "string" || !jsonUrl) throw new Error("PaddleOCR ไม่ส่ง result URL");
    const resultResponse = await fetch(jsonUrl, { signal: AbortSignal.timeout(20_000) });
    if (!resultResponse.ok) throw new Error(`ดาวน์โหลดผล PaddleOCR ไม่สำเร็จ: HTTP ${resultResponse.status}`);
    const text = extractPaddleOcrText(await resultResponse.text());
    if (!text) throw new Error("PaddleOCR ส่งผลลัพธ์ที่ไม่มีข้อความ");
    await recordPaddleOcrOutcome(env, row.region, true);
    await audit(env, "paddleocr_done", `${row.job_number}: ${jobId}`, row.region);
    await completeImageAnalysis(
      env,
      row,
      c.lineToken,
      imageBytes,
      text,
      analyzeOcr(text, true),
      null,
      false,
      PADDLEOCR_PROVIDER,
      "PaddleOCR"
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await recordPaddleOcrOutcome(env, row.region, false);
    await audit(env, "paddleocr_error", `${jobId}: ${detail}`, row.region);
    await env.DB.prepare("UPDATE slip_jobs SET status='queued',ocr_provider='paddleocr',decision_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(`PaddleOCR ไม่สำเร็จ จึงใช้ OCR.space: ${detail}`.slice(0, 1000), row.id).run();
    await enqueueOcrSpaceFallback(env, row, true);
  }
}

function decodeAmounts(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).slice(0, 12) : [];
  } catch {
    return [];
  }
}

async function cleanupOldLogs(env: Env) {
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM audit_logs WHERE created_at < datetime('now','-30 days')"),
    env.DB.prepare("DELETE FROM slip_jobs WHERE created_at < datetime('now','-30 days')"),
    env.DB.prepare("DELETE FROM user_jobs WHERE updated_at < datetime('now','-30 days') AND NOT EXISTS (SELECT 1 FROM slip_jobs WHERE slip_jobs.parent_job_id=user_jobs.id)")
  ]);
  console.log(JSON.stringify({ event: "retention_cleanup", retentionDays: 30, changes: results.map((result) => result.meta.changes ?? 0) }));
}

async function cleanupExpiredImages(env: Env) {
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const page = await env.SLIPS.list({ cursor, limit: 1000 });
    const keys = page.objects.filter((object) => imageExpired(object.uploaded)).map((object) => object.key);
    if (keys.length) {
      await env.SLIPS.delete(keys);
      deleted += keys.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  console.log(JSON.stringify({ event: "r2_daily_cleanup", retentionHours: 24, deleted }));
}

async function finalizePendingFailedJobs(env: Env) {
  const parents = await env.DB.prepare(`SELECT id,region
    FROM user_jobs
    WHERE status='pending_failed' AND result_sent_at IS NULL
      AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)
    ORDER BY updated_at
    LIMIT 100`)
    .all<{ id: string; region: Region }>();
  let checked = 0;
  for (const parent of parents.results) {
    const row = await loadDecisiveRow(env, parent.id, "failed") ??
      await env.DB.prepare(`SELECT s.*,u.job_number,u.line_source_type,u.result_sent_at
        FROM slip_jobs s JOIN user_jobs u ON u.id=s.parent_job_id
        WHERE s.parent_job_id=? ORDER BY s.updated_at DESC LIMIT 1`)
        .bind(parent.id).first<SlipProcessRow>();
    if (!row) continue;
    const c = await config(env, parent.region);
    if (!c.enabled || !c.lineToken) continue;
    await finalizePendingResult(env, row, c.lineToken);
    checked++;
  }
  return checked;
}

async function expireStaleQueuedJobs(env: Env): Promise<number> {
  // CURRENT_TIMESTAMP is UTC in D1. +7 hours makes the comparison use the
  // Bangkok calendar boundary (17:00 UTC), so yesterday's work is never
  // requeued after midnight Thailand time.
  const result = await env.DB.prepare(`UPDATE slip_jobs
    SET status='suppressed', result='silent', decision_reason=?, updated_at=CURRENT_TIMESTAMP
    WHERE status IN ('queued','paddle_pending')
      AND created_at < datetime('now','+7 hours','start of day','-7 hours')`)
    .bind(EXPIRED_INSPECTION_REASON)
    .run();
  const expired = result.meta.changes ?? 0;
  if (expired > 0) {
    await audit(env, "inspection_expired", `${expired} queued job(s)`);
  }
  return expired;
}

export function dashboardHtml() { return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#8b5cf6">
  <title>Kplusall Control</title>
  <style>
    :root{--ink:#2d2741;--muted:#777089;--purple:#8b5cf6;--pink:#e78bc5;--line:#ece7f5;--ok:#279b70;--warn:#d99032}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:linear-gradient(145deg,#fff5f8 0%,#f7f2ff 48%,#eee9ff 100%);background-attachment:fixed}
    body:before,body:after{content:"";position:fixed;border-radius:999px;filter:blur(10px);pointer-events:none;z-index:-1}
    body:before{width:360px;height:360px;background:rgba(243,178,211,.28);top:-120px;left:-110px}
    body:after{width:430px;height:430px;background:rgba(164,137,246,.22);right:-150px;bottom:-170px}
    .shell{width:min(1180px,calc(100% - 32px));margin:0 auto;padding:34px 0 70px}
    .hero{position:relative;overflow:hidden;padding:32px;border:1px solid rgba(255,255,255,.85);border-radius:30px;background:rgba(255,255,255,.73);box-shadow:0 24px 65px rgba(91,70,137,.13);backdrop-filter:blur(18px)}
    .hero:after{content:"✦";position:absolute;right:34px;top:20px;font-size:120px;line-height:1;color:rgba(139,92,246,.08)}
    .brand{display:flex;align-items:center;gap:16px;position:relative;z-index:1}
    .brand-icon{display:grid;place-items:center;width:58px;height:58px;border-radius:19px;color:white;font-size:28px;background:linear-gradient(135deg,var(--pink),var(--purple));box-shadow:0 13px 28px rgba(139,92,246,.3)}
    h1{font-size:clamp(28px,4vw,42px);line-height:1.1;margin:0;letter-spacing:-.8px}
    .gradient-text{background:linear-gradient(90deg,var(--purple),var(--pink));-webkit-background-clip:text;background-clip:text;color:transparent}
    .subtitle{margin:9px 0 0;color:var(--muted)}
    .summary{position:relative;z-index:1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:26px}
    .summary-item{padding:15px 17px;border:1px solid rgba(223,215,239,.85);border-radius:18px;background:rgba(255,255,255,.68)}
    .summary-value{display:block;font-size:24px;font-weight:800}
    .summary-label{color:var(--muted);font-size:13px}
    .section-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin:34px 4px 15px}
    .section-head h2{margin:0;font-size:21px}
    .section-head p{margin:3px 0 0;color:var(--muted);font-size:13px}
    .secure-note{display:flex;align-items:center;gap:7px;padding:8px 12px;border-radius:999px;color:#6e518e;background:rgba(255,255,255,.7);font-size:12px;font-weight:700}
    .view-tabs{display:flex;gap:8px;margin:18px 4px 0;padding:5px;border:1px solid rgba(255,255,255,.9);border-radius:16px;background:rgba(255,255,255,.62);box-shadow:0 9px 25px rgba(73,55,108,.07)}
    .view-tab{padding:9px 14px;border:0;border-radius:11px;color:var(--muted);background:transparent;font-weight:800;cursor:pointer;transition:.18s}
    .view-tab:hover{color:var(--ink);background:#faf8fd}.view-tab.active{color:white;background:linear-gradient(100deg,var(--pink),var(--purple));box-shadow:0 7px 18px rgba(139,92,246,.2)}
    .control-view[hidden]{display:none}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
    .region-card{position:relative;padding:22px;border:1px solid rgba(255,255,255,.92);border-radius:25px;background:rgba(255,255,255,.82);box-shadow:0 16px 40px rgba(73,55,108,.09);backdrop-filter:blur(14px);transition:.2s ease}
    .region-card:hover{transform:translateY(-2px);box-shadow:0 20px 46px rgba(73,55,108,.13)}
    .region-card:last-child:nth-child(odd){grid-column:1/-1}
    .card-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:20px}
    .region-title{display:flex;align-items:center;gap:12px}
    .region-icon{display:grid;place-items:center;width:44px;height:44px;border-radius:15px;background:linear-gradient(135deg,#f9dce9,#e5dbff);font-size:21px}
    .region-name{font-size:19px;font-weight:800}
    .region-code{color:var(--muted);font-size:11px;letter-spacing:.8px;text-transform:uppercase}
    .badge{display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border-radius:999px;font-size:11px;font-weight:800}
    .badge:before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 0 4px currentColor;opacity:.72}
    .badge.ready{color:var(--ok);background:#eaf8f2}
    .badge.incomplete{color:var(--warn);background:#fff5e7}
    .toggle-row{display:flex;align-items:center;justify-content:space-between;padding:11px 13px;margin-bottom:15px;border-radius:15px;background:#faf8fd}
    .toggle-label strong{display:block;font-size:13px}.toggle-label span{color:var(--muted);font-size:11px}
    .switch{position:relative;width:48px;height:28px;flex:none}.switch input{position:absolute;opacity:0;pointer-events:none}.slider{position:absolute;inset:0;border-radius:999px;background:#d8d1e3;cursor:pointer;transition:.2s}.slider:after{content:"";position:absolute;width:22px;height:22px;left:3px;top:3px;border-radius:50%;background:white;box-shadow:0 2px 8px rgba(45,39,65,.2);transition:.2s}.switch input:checked+.slider{background:linear-gradient(90deg,var(--pink),var(--purple))}.switch input:checked+.slider:after{transform:translateX(20px)}
    .webhook-label{display:block;margin:0 2px 6px;font-size:12px;font-weight:700}.webhook-row{display:flex;gap:8px}.webhook-row .webhook-url{min-width:0;color:#655778;background:#faf8fd;font-size:12px}.copy-webhook{flex:none;padding:0 13px;border:1px solid #ddd2f0;border-radius:13px;color:#6d4fa0;background:#f5efff;font-weight:800;cursor:pointer;transition:.18s}.copy-webhook:hover{border-color:#b28af2;background:#eee5ff}.copy-webhook.copied{color:#167b59;border-color:#b9e5d5;background:#eaf8f2}
    .field{display:block;margin-top:11px}.field-label{display:flex;justify-content:space-between;margin:0 2px 6px;font-size:12px;font-weight:700}.field-state{color:var(--muted);font-weight:500}
    input[type=text],input[type=password]{width:100%;padding:12px 13px;border:1px solid var(--line);border-radius:13px;outline:0;background:#fff;color:var(--ink);transition:.18s;box-shadow:0 2px 4px rgba(45,39,65,.025)}
    input[type=text]:focus,input[type=password]:focus{border-color:#b28af2;box-shadow:0 0 0 4px rgba(139,92,246,.1)}
    .save-region{width:100%;margin-top:17px;padding:12px 16px;border:0;border-radius:14px;color:white;font-weight:800;cursor:pointer;background:linear-gradient(100deg,#342d48 0%,#5a487c 45%,#8b5cf6 100%);box-shadow:0 10px 23px rgba(76,58,114,.2);transition:.18s}
    .save-region:hover{transform:translateY(-1px);box-shadow:0 13px 28px rgba(76,58,114,.28)}.save-region:disabled{opacity:.65;cursor:wait}
    .loading{grid-column:1/-1;text-align:center;padding:48px;border-radius:25px;background:rgba(255,255,255,.7);color:var(--muted)}
    .spinner{display:inline-block;width:25px;height:25px;margin-bottom:8px;border:3px solid #e8def7;border-top-color:var(--purple);border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
    .toast{position:fixed;right:22px;bottom:22px;z-index:20;padding:13px 17px;border-radius:14px;color:white;background:#342d48;box-shadow:0 14px 34px rgba(45,39,65,.25);opacity:0;transform:translateY(15px);pointer-events:none;transition:.25s}.toast.show{opacity:1;transform:none}.toast.error{background:#b94561}
    .log-panel{padding:20px;border:1px solid rgba(255,255,255,.92);border-radius:25px;background:rgba(255,255,255,.82);box-shadow:0 16px 40px rgba(73,55,108,.09);backdrop-filter:blur(14px)}
    .log-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:16px}.log-tabs,.log-actions{display:flex;flex-wrap:wrap;gap:8px}.log-tab,.refresh-logs,.requeue-stuck{padding:9px 13px;border:1px solid var(--line);border-radius:999px;background:white;color:var(--ink);font-weight:750;cursor:pointer}.log-tab.active{border-color:transparent;color:white;background:linear-gradient(100deg,var(--pink),var(--purple));box-shadow:0 7px 18px rgba(139,92,246,.2)}.refresh-logs,.requeue-stuck{border-radius:12px}.requeue-stuck{color:#7852bb;background:#f6f1ff}
    .ocr-usage-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.ocr-usage-region{padding:16px;border:1px solid var(--line);border-radius:20px;background:rgba(255,255,255,.84);box-shadow:0 10px 28px rgba(73,55,108,.07)}.ocr-usage-region h3{margin:0 0 12px;font-size:14px}.ocr-provider-count{display:grid;grid-template-columns:1fr auto;align-items:center;gap:3px 10px;padding:10px 0;border-top:1px solid #eee9f4}.ocr-provider-count:first-of-type{border-top:0}.ocr-provider-count span{font-size:11px;color:var(--muted)}.ocr-provider-count strong{grid-row:1/3;grid-column:2;font-size:23px;color:var(--ink)}.ocr-provider-count em{font-size:10px;color:var(--muted);font-style:normal}
    .usage-summary{display:flex;flex-wrap:wrap;gap:9px;margin:-3px 0 16px}.usage-card{min-width:230px;padding:11px 13px;border:1px solid var(--line);border-radius:14px;background:#faf8fd;color:var(--muted);font-size:12px}.usage-card strong{display:block;margin-bottom:3px;color:var(--ink);font-size:14px}.usage-count{font-size:20px;font-weight:850;color:var(--purple)}
    .log-list{display:grid;gap:11px}.log-row{padding:16px;border:1px solid var(--line);border-radius:18px;background:#fff}.log-main{display:grid;grid-template-columns:minmax(105px,.8fr) minmax(115px,.9fr) minmax(100px,.8fr) minmax(0,2.5fr);gap:13px;align-items:center}.log-cell small{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.45px}.log-cell strong{display:block;margin-top:2px;font-size:13px;overflow-wrap:anywhere}.status-pill{display:inline-flex!important;width:max-content;padding:5px 9px;border-radius:999px}.status-passed{color:#167b59;background:#e7f7f0}.status-silent{color:#756b85;background:#f1eef5}.status-fallback{color:#a86618;background:#fff2dc}.status-error{color:#ae3c57;background:#ffe8ee}.status-queued{color:#6652a2;background:#eee9ff}
    .log-facts{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.fact{padding:5px 8px;border-radius:9px;background:#f8f5fb;color:#5f5770;font-size:11px}.fact.yes{color:#167b59;background:#eaf8f2}.fact.no{color:#ad4059;background:#fff0f3}.ocr-detail{margin-top:11px;color:var(--muted);font-size:12px}.ocr-detail summary{cursor:pointer;font-weight:700;color:#6e518e}.ocr-text{margin:8px 0 0;padding:11px;border-radius:11px;background:#f8f6fb;white-space:pre-wrap;overflow-wrap:anywhere}.empty-logs{text-align:center;padding:44px;color:var(--muted)}
    @media(max-width:960px){.ocr-usage-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:760px){.shell{width:min(100% - 20px,1180px);padding-top:16px}.hero{padding:23px;border-radius:24px}.hero:after{font-size:80px}.summary{grid-template-columns:1fr}.grid,.ocr-usage-grid{grid-template-columns:1fr}.region-card:last-child:nth-child(odd){grid-column:auto}.section-head{align-items:start;flex-direction:column}.secure-note{align-self:flex-start}.view-tabs{margin-top:14px}.view-tab{flex:1}.log-toolbar{align-items:stretch;flex-direction:column}.log-actions{display:grid;grid-template-columns:1fr 1fr}.refresh-logs,.requeue-stuck{width:100%}.log-main{grid-template-columns:1fr 1fr}.log-cell.reason{grid-column:1/-1}.usage-card{min-width:100%}.webhook-row{align-items:stretch;flex-direction:column}.copy-webhook{min-height:40px}}
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div class="brand"><div class="brand-icon">✦</div><div><h1>Kplusall <span class="gradient-text">Control</span></h1><p class="subtitle">ศูนย์จัดการ LINE OA, PaddleOCR, OCR.space และ Workers AI สำหรับทั้ง 5 ภูมิภาค</p></div></div>
      <div class="summary">
        <div class="summary-item"><span class="summary-value">5</span><span class="summary-label">ภูมิภาคทั้งหมด</span></div>
        <div class="summary-item"><span class="summary-value" id="active-count">—</span><span class="summary-label">กำลังเปิดใช้งาน</span></div>
        <div class="summary-item"><span class="summary-value" id="ready-count">—</span><span class="summary-label">ตั้งค่าครบพร้อมใช้</span></div>
      </div>
    </section>
    <nav class="view-tabs" aria-label="เมนู Control">
      <button class="view-tab active" type="button" data-view="overview" aria-selected="true">ภาพรวม OCR</button>
      <button class="view-tab" type="button" data-view="settings" aria-selected="false">ตั้งค่า API</button>
    </nav>
    <section class="control-view" id="overview-view">
      <div class="section-head"><div><h2>การใช้งาน OCR วันนี้</h2><p>ตัวนับแยก PaddleOCR, OCR.space และ Workers AI ของแต่ละภูมิภาค</p></div><div class="secure-note">PaddleOCR เป็นตัวหลัก · OCR.space เป็นระบบสำรอง</div></div>
      <section class="ocr-usage-grid" id="ocr-usage-grid"><div class="loading"><span class="spinner"></span><br>กำลังโหลดตัวนับ...</div></section>
      <div class="section-head"><div><h2>ประวัติการตรวจ OCR</h2><p>แสดง 50 รายการล่าสุดของแต่ละภาค และเก็บข้อมูลย้อนหลัง 30 วัน</p></div><div class="secure-note">กดรีเฟรชเมื่อต้องการข้อมูลล่าสุด</div></div>
      <section class="log-panel">
        <div class="log-toolbar"><div class="log-tabs" id="log-tabs"></div><div class="log-actions"><button class="requeue-stuck" id="requeue-stuck">กู้รายการค้าง</button><button class="refresh-logs" id="refresh-logs">รีเฟรช Log</button></div></div>
        <div class="usage-summary" id="usage-summary"></div>
        <div class="log-list" id="log-list"><div class="empty-logs"><span class="spinner"></span><br>กำลังโหลด Log...</div></div>
      </section>
    </section>
    <section class="control-view" id="settings-view" hidden>
      <div class="section-head"><div><h2>ตั้งค่า API และภูมิภาค</h2><p>กรอกเฉพาะค่าที่ต้องการเปลี่ยน ค่าเดิมจะไม่ถูกแสดงกลับมา</p></div><div class="secure-note">🔒 Secret เข้ารหัสแล้ว</div></div>
      <section class="grid" id="app"><div class="loading"><span class="spinner"></span><br>กำลังโหลดข้อมูล...</div></section>
    </section>
  </main>
  <div class="toast" id="toast"></div>
  <script>
    const regions=['north','isan','south','central','bangkok'];
    const meta={north:{name:'ภาคเหนือ',code:'NORTH',path:'north',icon:'⛰️'},isan:{name:'ภาคอีสาน',code:'ISAN',path:'isan',icon:'☀️'},south:{name:'ภาคใต้',code:'SOUTH',path:'south',icon:'🌊'},central:{name:'พิษณุโลก',code:'PHITSANULOK',path:'phitsanulok',icon:'🌾'},bangkok:{name:'โคราช',code:'KORAT',path:'korat',icon:'🏙️'}};
    const app=document.querySelector('#app');
    const logList=document.querySelector('#log-list');
    const logTabs=document.querySelector('#log-tabs');
    const usageSummary=document.querySelector('#usage-summary');
    const ocrUsageGrid=document.querySelector('#ocr-usage-grid');
    const viewTabs=document.querySelectorAll('[data-view]');
    const controlViews=document.querySelectorAll('.control-view');
    let activeLogRegion='north';
    function notify(text,error=false){const toast=document.querySelector('#toast');toast.textContent=text;toast.className='toast show'+(error?' error':'');setTimeout(()=>toast.className='toast',2600)}
    function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]))}
    function formatTime(value){if(!value)return '—';const date=new Date(String(value).replace(' ','T')+'Z');return Number.isNaN(date.getTime())?value:date.toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'})}
    function statusInfo(item){const pendingFailed=item.result==='failed'&&!item.resultSentAt;const key=pendingFailed?'pending_failed':(['quota_exhausted','image_too_large','download_error','ocr_error'].includes(item.status)?item.status:(item.result||item.status));return {passed:['ผ่าน','status-passed'],failed:['ไม่ผ่าน','status-error'],pending_failed:['รอตรวจรูปถัดไป','status-queued'],silent:['เงียบ','status-silent'],needs_fallback:['รอตรวจสำรอง','status-fallback'],quota_exhausted:['OCR ครบโควตา','status-fallback'],ocr_error:['OCR ผิดพลาด','status-error'],download_error:['โหลดรูปผิดพลาด','status-error'],image_too_large:['รูปใหญ่เกินกำหนด','status-error'],suppressed:['หยุดหลังพบผลตรวจ','status-silent'],queued:['รอตรวจ','status-queued'],paddle_pending:['PaddleOCR กำลังตรวจ','status-queued']}[key]||[key||'ไม่ทราบ','status-queued']}
    function fact(label,value){const state=value===null?'':(value?' yes':' no');const text=value===null?'—':(value?'พบ':'ไม่พบ');return '<span class="fact'+state+'">'+label+': '+text+'</span>'}
    function field(region,id,label,placeholder,isSet){return '<label class="field"><span class="field-label"><span>'+label+'</span><span class="field-state">'+(isSet?'ตั้งค่าแล้ว ✓':'ยังไม่ตั้ง')+'</span></span><input type="text" autocomplete="off" id="'+id+'-'+region+'" placeholder="'+placeholder+'"></label>'}
    function providerName(provider){if(!provider)return 'รอระบุ';const names={paddleocr:'PaddleOCR',ocrspace:'OCR.space',workers_ai_vision:'Workers AI Vision'};return provider.split('+').map(part=>names[part]||part).join(' → ')}
    function webhookUrl(region){return location.origin+'/webhook/'+meta[region].path}
    async function copyWebhook(region,button){
      const value=webhookUrl(region);
      try{
        if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(value);
        else{const input=document.querySelector('#w-'+region);input.focus();input.select();document.execCommand('copy')}
        button.textContent='คัดลอกแล้ว ✓';button.classList.add('copied');notify('คัดลอก Webhook '+meta[region].name+' แล้ว');
        setTimeout(()=>{button.textContent='คัดลอก';button.classList.remove('copied')},1800)
      }catch{notify('คัดลอกไม่สำเร็จ กรุณาเลือก URL แล้วคัดลอกเอง',true)}
    }
    function renderUsage(items){
      const byProvider=Object.fromEntries(items.map(item=>[item.provider,item]));
      usageSummary.innerHTML=['paddleocr','ocrspace','workers_ai_vision'].map(provider=>{const item=byProvider[provider]||{requestCount:0,successCount:0,errorCount:0};const limit=provider==='ocrspace'?' / 500':'';return '<div class="usage-card"><strong>'+providerName(provider)+' · '+meta[activeLogRegion].name+'</strong><span class="usage-count">'+escapeHtml(item.requestCount)+limit+'</span> ครั้ง · สำเร็จ '+escapeHtml(item.successCount)+' · ผิดพลาด '+escapeHtml(item.errorCount)+'</div>'}).join('')
    }
    function renderAllUsage(items){
      const keyed=Object.fromEntries(items.map(item=>[item.region+':'+item.provider,item]));
      ocrUsageGrid.innerHTML=regions.map(region=>{
        const paddle=keyed[region+':paddleocr']||{requestCount:0,successCount:0,errorCount:0};
        const ocr=keyed[region+':ocrspace']||{requestCount:0,successCount:0,errorCount:0};
        const ai=keyed[region+':workers_ai_vision']||{requestCount:0,successCount:0,errorCount:0};
        const provider=(label,item,suffix='')=>'<div class="ocr-provider-count"><span>'+label+'</span><em>สำเร็จ '+escapeHtml(item.successCount)+' · ผิดพลาด '+escapeHtml(item.errorCount)+'</em><strong>'+escapeHtml(item.requestCount)+suffix+'</strong></div>';
        return '<article class="ocr-usage-region"><h3>'+meta[region].icon+' '+meta[region].name+'</h3>'+provider('PaddleOCR',paddle)+provider('OCR.space',ocr,'/500')+provider('Workers AI Vision',ai)+'</article>'
      }).join('')
    }
    async function loadAllUsage(){
      const response=await fetch('/admin/api/usage-summary');
      if(response.status===401){location='/admin';return}
      if(!response.ok)throw new Error('โหลดตัวนับ OCR ไม่สำเร็จ');
      renderAllUsage(await response.json())
    }
    async function load(){
      const response=await fetch('/admin/api/config');
      if(!response.ok){location='/admin';return}
      const data=await response.json();
      const active=data.filter(item=>item.enabled).length;
      const ready=data.filter(item=>item.hasLineSecret&&item.hasLineToken&&(item.hasPaddleToken||item.hasOcrKey)).length;
      document.querySelector('#active-count').textContent=String(active);
      document.querySelector('#ready-count').textContent=String(ready);
      app.innerHTML=regions.map(region=>{
        const item=data.find(value=>value.region===region)||{enabled:false};
        const complete=Boolean(item.hasLineSecret&&item.hasLineToken&&(item.hasPaddleToken||item.hasOcrKey));
        return '<article class="region-card"><div class="card-head"><div class="region-title"><div class="region-icon">'+meta[region].icon+'</div><div><div class="region-name">'+meta[region].name+'</div><div class="region-code">'+meta[region].code+'</div></div></div><span class="badge '+(complete?'ready':'incomplete')+'">'+(complete?'พร้อมใช้งาน':'ตั้งค่าไม่ครบ')+'</span></div><div class="toggle-row"><div class="toggle-label"><strong>เปิดใช้งานภูมิภาคนี้</strong><span>รับ Webhook และประมวลผล OCR</span></div><label class="switch"><input type="checkbox" id="e-'+region+'" '+(item.enabled?'checked':'')+'><span class="slider"></span></label></div><label class="webhook-label" for="w-'+region+'">Webhook URL</label><div class="webhook-row"><input class="webhook-url" type="text" id="w-'+region+'" readonly value="'+escapeHtml(webhookUrl(region))+'"><button class="copy-webhook" type="button" data-copy-region="'+region+'">คัดลอก</button></div>'+field(region,'s','LINE Channel Secret','ใส่เมื่อสร้างหรือเปลี่ยน Secret',item.hasLineSecret)+field(region,'t','LINE Channel Access Token','ใส่เมื่อสร้างหรือเปลี่ยน Token',item.hasLineToken)+field(region,'o','OCR.space API Key','ใส่ API Key ของภูมิภาคนี้',item.hasOcrKey)+'<button class="save-region" data-region="'+region+'">บันทึก '+meta[region].name+'</button></article>'
      }).join('');
      document.querySelectorAll('.save-region').forEach(button=>button.addEventListener('click',()=>save(button.dataset.region,button)));
      document.querySelectorAll('.copy-webhook').forEach(button=>button.addEventListener('click',()=>copyWebhook(button.dataset.copyRegion,button)));
    }
    async function save(region,button){
      button.disabled=true;button.textContent='กำลังบันทึก...';
      const body={region,enabled:document.querySelector('#e-'+region).checked,lineSecret:document.querySelector('#s-'+region).value,lineToken:document.querySelector('#t-'+region).value,ocrKey:document.querySelector('#o-'+region).value};
      const response=await fetch('/admin/api/config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      if(response.ok){notify('บันทึก '+meta[region].name+' เรียบร้อยแล้ว');await load()}else{let message='บันทึกไม่สำเร็จ (HTTP '+response.status+')';try{const result=await response.json();if(result&&result.error)message=result.error}catch{}notify(message,true);button.disabled=false;button.textContent='บันทึก '+meta[region].name}
    }
    viewTabs.forEach(button=>button.addEventListener('click',()=>{
      const view=button.dataset.view;
      viewTabs.forEach(tab=>{const active=tab===button;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active))});
      controlViews.forEach(panel=>{panel.hidden=panel.id!==view+'-view'});
    }));
    function renderLogs(items){
      if(!items.length){logList.innerHTML='<div class="empty-logs">ยังไม่มีประวัติการตรวจของ '+meta[activeLogRegion].name+'</div>';return}
      logList.innerHTML=items.map(item=>{
        const status=statusInfo(item);const amounts=item.matchedAmount||((item.detectedAmounts||[]).join(', '))||'ไม่พบ';
        const ocrDetail=item.ocrExcerpt?'<details class="ocr-detail"><summary>ดูข้อความ OCR บางส่วน</summary><pre class="ocr-text">'+escapeHtml(item.ocrExcerpt)+'</pre></details>':'';
        const aiDetail=item.aiResponseExcerpt?'<details class="ocr-detail"><summary>ดูคำตอบ Workers AI Vision</summary><pre class="ocr-text">'+escapeHtml(item.aiResponseExcerpt)+'</pre></details>':'';
        const imageSet=item.imageSetTotal?'<span class="fact">รูปในชุด: '+escapeHtml((item.imageSetIndex??'?')+'/'+item.imageSetTotal)+'</span>':'';
        const ocrAmounts=(item.ocrspaceDetectedAmounts||[]).join(', ')||'ไม่พบ';
        const ocrKey=item.ocrKeyRegion?'<span class="fact">OCR Key: '+escapeHtml(meta[item.ocrKeyRegion]?.name||item.ocrKeyRegion)+'</span>':'';
        const replyTokenAge=item.replyTokenAgeMs===null||item.replyTokenAgeMs===undefined?'':'<span class="fact '+(item.replyTokenAgeMs>=50000?'no':'yes')+'">Reply Token: '+escapeHtml((item.replyTokenAgeMs/1000).toFixed(1))+' วินาที</span>';
        const aiFacts=item.aiProvider?fact('AI KPLUS/K+',item.aiFoundKplus)+fact('AI SETTLEMENT',item.aiFoundSettlement)+'<span class="fact">AI ยอด: '+escapeHtml((item.aiDetectedAmounts||[]).join(', ')||'ไม่พบ')+'</span><span class="fact">AI มั่นใจ: '+(item.aiConfident?'ใช่':'ไม่')+'</span>':'';
        return '<article class="log-row"><div class="log-main"><div class="log-cell"><small>เวลา</small><strong>'+escapeHtml(formatTime(item.updatedAt))+'</strong></div><div class="log-cell"><small>เลขงาน</small><strong>'+escapeHtml(item.jobNumber)+'</strong></div><div class="log-cell"><small>ผล</small><strong class="status-pill '+status[1]+'">'+escapeHtml(status[0])+'</strong></div><div class="log-cell reason"><small>เหตุผล</small><strong>'+escapeHtml(item.reason||'กำลังรอประมวลผล')+'</strong></div></div><div class="log-facts"><span class="fact">ตรวจด้วย: '+escapeHtml(providerName(item.provider))+'</span>'+ocrKey+replyTokenAge+imageSet+fact('OCR KPLUS/K+',item.ocrspaceFoundKplus)+fact('OCR SETTLEMENT',item.ocrspaceFoundSettlement)+'<span class="fact">OCR ยอด: '+escapeHtml(ocrAmounts)+'</span>'+aiFacts+'<span class="fact">ผลสุดท้าย ยอด: '+escapeHtml(amounts)+'</span></div>'+ocrDetail+aiDetail+'</article>'
      }).join('')
    }
    async function loadLogs(){
      logList.innerHTML='<div class="empty-logs"><span class="spinner"></span><br>กำลังโหลด Log...</div>';
      const [response,usageResponse]=await Promise.all([fetch('/admin/api/logs?region='+encodeURIComponent(activeLogRegion)),fetch('/admin/api/usage?region='+encodeURIComponent(activeLogRegion))]);
      if(response.status===401){location='/admin';return}
      if(!response.ok||!usageResponse.ok)throw new Error('โหลด Log ไม่สำเร็จ');
      renderLogs(await response.json());
      renderUsage(await usageResponse.json())
    }
    logTabs.innerHTML=regions.map(region=>'<button class="log-tab '+(region===activeLogRegion?'active':'')+'" data-log-region="'+region+'">'+meta[region].name+'</button>').join('');
    logTabs.querySelectorAll('.log-tab').forEach(button=>button.addEventListener('click',async()=>{activeLogRegion=button.dataset.logRegion;logTabs.querySelectorAll('.log-tab').forEach(tab=>tab.classList.toggle('active',tab===button));try{await loadLogs()}catch{notify('โหลด Log ไม่สำเร็จ',true)}}));
    document.querySelector('#refresh-logs').addEventListener('click',()=>Promise.all([loadLogs(),loadAllUsage()]).catch(()=>notify('โหลด Log หรือตัวนับไม่สำเร็จ',true)));
    document.querySelector('#requeue-stuck').addEventListener('click',async(event)=>{
      const button=event.currentTarget;button.disabled=true;button.textContent='กำลังกู้รายการ...';
      try{
        const response=await fetch('/admin/api/requeue-stuck',{method:'POST'});
        const result=await response.json();
        if(!response.ok)throw new Error(result.error||'requeue failed');
        notify('ส่งรายการค้างกลับเข้าคิว '+result.requeued+' รายการ');
        await loadLogs()
      }catch{notify('กู้รายการค้างไม่สำเร็จ',true)}
      finally{button.disabled=false;button.textContent='กู้รายการค้าง'}
    });
    load().catch(()=>{app.innerHTML='<div class="loading">โหลดข้อมูลไม่สำเร็จ กรุณารีเฟรชหน้าอีกครั้ง</div>';notify('โหลดข้อมูลไม่สำเร็จ',true)});
    loadAllUsage().catch(()=>{ocrUsageGrid.innerHTML='<div class="loading">โหลดตัวนับ OCR ไม่สำเร็จ</div>';notify('โหลดตัวนับ OCR ไม่สำเร็จ',true)});
    loadLogs().catch(()=>{logList.innerHTML='<div class="empty-logs">โหลด Log ไม่สำเร็จ กรุณารีเฟรชอีกครั้ง</div>';notify('โหลด Log ไม่สำเร็จ',true)});
  </script>
</body>
</html>`; }
export function loginHtml() { return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#8b5cf6"><title>Kplusall Login</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:22px;font:15px system-ui,-apple-system,"Segoe UI",sans-serif;color:#2d2741;background:radial-gradient(circle at 10% 15%,#ffe6ee 0,transparent 34%),radial-gradient(circle at 85% 85%,#dcd2ff 0,transparent 35%),linear-gradient(145deg,#fff8fa,#f3efff)}
    .card{width:min(430px,100%);padding:44px 36px;border:1px solid rgba(255,255,255,.9);border-radius:32px;background:rgba(255,255,255,.78);box-shadow:0 28px 70px rgba(80,59,124,.18);backdrop-filter:blur(20px);text-align:center}
    .icon{display:grid;place-items:center;width:62px;height:62px;margin:0 auto 22px;border-radius:20px;color:white;font-size:30px;background:linear-gradient(135deg,#e78bc5,#8b5cf6);box-shadow:0 14px 30px rgba(139,92,246,.3)}
    h1{margin:0;font-size:32px;letter-spacing:-.5px}.gradient{background:linear-gradient(90deg,#8b5cf6,#e78bc5);-webkit-background-clip:text;background-clip:text;color:transparent}p{margin:10px 0 26px;color:#777089}
    input{width:100%;padding:14px 15px;border:1px solid #e9e2f3;border-radius:14px;outline:0;background:white;font:inherit}input:focus{border-color:#ad83ef;box-shadow:0 0 0 4px rgba(139,92,246,.1)}
    button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:14px;color:white;font:800 15px system-ui;cursor:pointer;background:linear-gradient(100deg,#342d48,#8b5cf6);box-shadow:0 12px 26px rgba(76,58,114,.25)}
    small{display:block;margin-top:22px;color:#938ba0}
  </style>
</head>
<body><form class="card" method="post" action="/admin/login"><div class="icon">✦</div><h1>Kplusall <span class="gradient">Control</span></h1><p>เข้าสู่ศูนย์จัดการระบบทั้ง 5 ภูมิภาค</p><input name="password" type="password" placeholder="Admin password" autocomplete="current-password" required autofocus><button>เข้าสู่ระบบ</button><small>🔒 การเชื่อมต่อและข้อมูล Secret ได้รับการปกป้อง</small></form></body>
</html>`; }

async function requeueStuckJobs(env: Env) {
  const rows = await env.DB.prepare(`SELECT id,region,status,ocr_provider,paddle_job_id,paddle_poll_count
    FROM slip_jobs
    WHERE status IN ('queued','paddle_pending')
      AND updated_at < datetime('now','-1 minute')
      AND created_at >= datetime('now','+7 hours','start of day','-7 hours')
    ORDER BY created_at
    LIMIT 100`).all<{
      id: string;
      region: Region;
      status: string;
      ocr_provider: string | null;
      paddle_job_id: string | null;
      paddle_poll_count: number;
    }>();
  let requeued = 0;
  for (const row of rows.results) {
    let queued: boolean;
    if (row.status === "queued" && row.ocr_provider?.includes("ocrspace")) {
      queued = await enqueueOcrSpaceFallback(env, row, row.ocr_provider.includes("paddleocr"));
    } else {
      queued = await enqueueOcrJobSafely(env, row.status === "paddle_pending" && row.paddle_job_id
        ? {
          id: row.id,
          region: row.region,
          phase: "paddle_poll",
          paddleJobId: row.paddle_job_id,
          paddlePollCount: row.paddle_poll_count,
          paddleAttempted: true
        } satisfies OcrQueueMessage
        : { id: row.id, region: row.region } satisfies OcrQueueMessage, row.region);
    }
    if (!queued) continue;
    await env.DB.prepare("UPDATE slip_jobs SET updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('queued','paddle_pending')")
      .bind(row.id).run();
    await audit(env, "image_requeued", row.id, row.region);
    requeued++;
  }
  return requeued;
}

async function admin(request: Request, env: Env, url: URL) {
  if (!env.ADMIN_PASSWORD || !env.CONFIG_ENCRYPTION_KEY) return new Response("Admin setup required: set ADMIN_PASSWORD and CONFIG_ENCRYPTION_KEY as Worker Secrets.", { status: 503 });
  if (url.pathname === "/admin/login" && request.method === "POST") { const form = await request.formData(); if (!(await safeEqual(String(form.get("password") ?? ""), env.ADMIN_PASSWORD))) return new Response("Unauthorized", { status: 401 }); const payload = `${Date.now() + 8 * 3600_000}`; const token = `${b64(enc.encode(payload))}.${await hmac(payload, env.CONFIG_ENCRYPTION_KEY)}`; return new Response(null, { status: 303, headers: { location: "/admin", "set-cookie": `kplusall_admin=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800` } }); }
  const token = cookie(request, "kplusall_admin"); const [body, sig] = token?.split(".") ?? []; const payload = body ? dec.decode(unb64(body)) : "";
  if (!sig || !(await safeEqual(sig, await hmac(payload, env.CONFIG_ENCRYPTION_KEY))) || Number(payload) < Date.now()) return new Response(loginHtml(), { status: 401, headers: { "content-type": "text/html; charset=utf-8" } });
  if (url.pathname === "/admin/api/config" && request.method === "GET") { const rows = await env.DB.prepare("SELECT region,enabled,line_channel_secret,line_channel_token,ocrspace_api_key FROM region_config ORDER BY region").all<RegionConfigRow>(); return json(rows.results.map((r) => ({ region:r.region, enabled:Boolean(r.enabled), hasLineSecret:Boolean(r.line_channel_secret), hasLineToken:Boolean(r.line_channel_token), hasOcrKey:Boolean(r.ocrspace_api_key), hasPaddleToken:Boolean(env.PADDLEOCR_TOKEN) }))); }
  if (url.pathname === "/admin/api/requeue-stuck" && request.method === "POST") {
    try {
      return json({ ok: true, requeued: await requeueStuckJobs(env) });
    } catch (error) {
      console.error("requeue stuck jobs failed", error);
      return json({ error: "requeue failed" }, 500);
    }
  }
  if (url.pathname === "/admin/api/usage" && request.method === "GET") {
    const region = url.searchParams.get("region") ?? "north";
    if (!isRegion(region)) return json({ error:"invalid region" }, 400);
    const rows = await env.DB.prepare("SELECT provider,request_count,success_count,error_count FROM daily_usage WHERE usage_date=? AND region=? AND provider IN ('paddleocr','ocrspace','workers_ai_vision') ORDER BY provider")
      .bind(today(), region).all<DailyUsageRow>();
    return json(rows.results.map((row) => ({
      provider: row.provider,
      requestCount: row.request_count,
      successCount: row.success_count,
      errorCount: row.error_count
    })));
  }
  if (url.pathname === "/admin/api/usage-summary" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT region,provider,request_count,success_count,error_count FROM daily_usage WHERE usage_date=? AND provider IN ('paddleocr','ocrspace','workers_ai_vision') ORDER BY region,provider")
      .bind(today()).all<DailyUsageRow>();
    return json(rows.results.map((row) => ({
      region: row.region,
      provider: row.provider,
      requestCount: row.request_count,
      successCount: row.success_count,
      errorCount: row.error_count
    })));
  }
  if (url.pathname === "/admin/api/logs" && request.method === "GET") {
    const region = url.searchParams.get("region") ?? "north";
    if (!isRegion(region)) return json({ error:"invalid region" }, 400);
    const rows = await env.DB.prepare(`SELECT
        s.id,s.region,u.job_number,s.status,s.ocr_provider,s.result,u.result_sent_at,
        s.found_kplus,s.found_settlement,s.matched_amount,s.detected_amounts,s.decision_reason,
        substr(s.ocr_text,1,500) AS ocr_excerpt,
        s.ocrspace_found_kplus,s.ocrspace_found_settlement,s.ocrspace_detected_amounts,
        s.ocrspace_key_region,
        s.ai_provider,substr(s.ai_response,1,500) AS ai_response_excerpt,
        s.ai_found_kplus,s.ai_found_settlement,s.ai_detected_amounts,s.ai_confident,
        s.image_set_id,s.image_set_index,s.image_set_total,
        s.reply_token_age_ms,s.reply_token_source_slip_id,
        s.created_at,s.updated_at
      FROM slip_jobs s
      JOIN user_jobs u ON u.id=s.parent_job_id
      WHERE s.region=?
      ORDER BY s.created_at DESC
      LIMIT 50`)
      .bind(region).all<OcrLogRow>();
    return json(rows.results.map((row) => ({
      id: row.id,
      region: row.region,
      jobNumber: row.job_number,
      status: row.status,
      provider: row.ocr_provider,
      result: row.result,
      resultSentAt: row.result_sent_at,
      foundKplus: row.found_kplus === null ? null : Boolean(row.found_kplus),
      foundSettlement: row.found_settlement === null ? null : Boolean(row.found_settlement),
      matchedAmount: row.matched_amount,
      detectedAmounts: decodeAmounts(row.detected_amounts),
      reason: row.decision_reason,
      ocrExcerpt: row.ocr_excerpt,
      ocrspaceFoundKplus: row.ocrspace_found_kplus === null ? (row.ai_provider ? null : row.found_kplus === null ? null : Boolean(row.found_kplus)) : Boolean(row.ocrspace_found_kplus),
      ocrspaceFoundSettlement: row.ocrspace_found_settlement === null ? (row.ai_provider ? null : row.found_settlement === null ? null : Boolean(row.found_settlement)) : Boolean(row.ocrspace_found_settlement),
      ocrspaceDetectedAmounts: decodeAmounts(row.ocrspace_detected_amounts ?? (row.ai_provider ? null : row.detected_amounts)),
      ocrKeyRegion: row.ocrspace_key_region,
      aiProvider: row.ai_provider,
      aiResponseExcerpt: row.ai_response_excerpt,
      aiFoundKplus: row.ai_found_kplus === null ? null : Boolean(row.ai_found_kplus),
      aiFoundSettlement: row.ai_found_settlement === null ? null : Boolean(row.ai_found_settlement),
      aiDetectedAmounts: decodeAmounts(row.ai_detected_amounts),
      aiConfident: row.ai_confident === null ? null : Boolean(row.ai_confident),
      imageSetId: row.image_set_id,
      imageSetIndex: row.image_set_index,
      imageSetTotal: row.image_set_total,
      replyTokenAgeMs: row.reply_token_age_ms,
      replyTokenSourceSlipId: row.reply_token_source_slip_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })));
  }
  if (url.pathname === "/admin/api/config" && request.method === "POST") {
    try {
      const input = await request.json<any>();
      if (!isRegion(input.region)) return json({ error:"invalid region" }, 400);
      const old = await config(env,input.region);
      const secret = input.lineSecret ? await seal(String(input.lineSecret),env) : await seal(old.lineSecret,env);
      const tokenValue = input.lineToken ? await seal(String(input.lineToken),env) : await seal(old.lineToken,env);
      const key = input.ocrKey ? await seal(String(input.ocrKey),env) : await seal(old.ocrKey,env);
      await env.DB.prepare("UPDATE region_config SET enabled=?,line_channel_secret=?,line_channel_token=?,ocrspace_api_key=?,updated_at=CURRENT_TIMESTAMP WHERE region=?").bind(input.enabled?1:0,secret,tokenValue,key,input.region).run();
      await audit(env,"config_updated","admin config updated",input.region);
      return json({ ok:true });
    } catch (error) {
      console.error("admin config update failed", error);
      return json({ error:"บันทึกการตั้งค่าไม่สำเร็จ กรุณาตรวจสอบ Worker Secret แล้วลองใหม่" }, 500);
    }
  }
  return new Response(dashboardHtml(), { headers:{ "content-type":"text/html; charset=utf-8", "cache-control":"no-store" } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/webhook/")) { const region = regionFromWebhookPath(url.pathname.split("/")[2]); if (!region || request.method !== "POST") return new Response("Not Found", { status:404 }); return webhook(request, env, region); }
    if (url.pathname.startsWith("/admin")) return admin(request, env, url);
    if (url.pathname === "/health") return json({ ok:true, service:"kplusall" });
    return new Response("Kplusall Worker", { status:200 });
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      const body = message.body as WorkerQueueMessage;
      if (isLineWebhookQueueMessage(body) &&
          !isCurrentInspectionDay(body.receivedAtMs)) {
        console.log(JSON.stringify({
          event: "webhook_queue_expired",
          region: body.region,
          receivedAtMs: body.receivedAtMs,
        }));
        message.ack();
        continue;
      }
      try {
        if (isLineWebhookQueueMessage(body)) {
          await processWebhookEvents(body.events, env, body.region, body.receivedAtMs);
        } else {
          await processJob(env, body, message.attempts);
        }
        message.ack();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        try {
          await audit(
            env,
            isLineWebhookQueueMessage(body) ? "webhook_queue_error" : "queue_error",
            detail,
            body.region
          );
        } catch (auditError) {
          console.error("failed to audit queue error", { error: detail, auditError });
        }
        message.retry();
      }
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const scheduledAt = new Date(controller.scheduledTime);
        const runDailyCleanup = scheduledAt.getUTCHours() === 18 && scheduledAt.getUTCMinutes() === 0;
        const expired = await expireStaleQueuedJobs(env);
        const tasks: Array<Promise<number | void>> = [
          requeueStuckJobs(env),
          finalizePendingFailedJobs(env),
        ];
        if (runDailyCleanup) {
          tasks.push(cleanupOldLogs(env), cleanupExpiredImages(env));
        }
        const [requeued, finalized] = await Promise.all(tasks);
        console.log(JSON.stringify({ event: "scheduled_recovery_completed", expired, requeued, finalized, runDailyCleanup }));
      } catch (error) {
        console.error(JSON.stringify({
          event: "scheduled_recovery_failed",
          error: queueErrorText(error),
        }));
      }
    })());
  }
} satisfies ExportedHandler<Env>;
