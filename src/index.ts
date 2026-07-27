type Region = "north" | "central" | "isan" | "south" | "bangkok";
type Env = {
  DB: D1Database; SLIPS: R2Bucket; OCR_JOBS: Queue;
  ADMIN_PASSWORD?: string; CONFIG_ENCRYPTION_KEY?: string;
};
type RegionConfigRow = { region: Region; enabled: number; line_channel_secret: ArrayBuffer | null; line_channel_token: ArrayBuffer | null; ocrspace_api_key: ArrayBuffer | null };
type RegionConfig = { region: Region; enabled: boolean; lineSecret: string; lineToken: string; ocrKey: string };
type OcrResult = "passed" | "silent" | "needs_fallback";
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
  found_kplus: number | null;
  found_settlement: number | null;
  matched_amount: string | null;
  detected_amounts: string | null;
  decision_reason: string | null;
  ocr_excerpt: string | null;
  image_set_id: string | null;
  image_set_index: number | null;
  image_set_total: number | null;
  created_at: string;
  updated_at: string;
};
type LineImageSet = { id?: string; index?: number; total?: number };
type LineEvent = {
  type?: string;
  source?: { type?: string; userId?: string };
  message?: { id?: string; type?: string; text?: string; imageSet?: LineImageSet };
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
  pass_sent_at: string | null;
};
const REGIONS: Region[] = ["north", "central", "isan", "south", "bangkok"];
const enc = new TextEncoder();
const dec = new TextDecoder();
const JOB_REFERENCE_MINUTES = 30;
const PASS_CLAIM_MINUTES = 2;
const OCRSPACE_DAILY_LIMIT = 500;

function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
function b64(bytes: Uint8Array) { let s = ""; bytes.forEach((b) => s += String.fromCharCode(b)); return btoa(s); }
function unb64(text: string) { const s = atob(text); return Uint8Array.from(s, (c) => c.charCodeAt(0)); }
function today() { return new Date().toISOString().slice(0, 10); }
function isRegion(value: string): value is Region { return REGIONS.includes(value as Region); }
function cookie(request: Request, key: string) { return request.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${key}=`))?.slice(key.length + 1); }

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
async function audit(env: Env, event: string, detail: string, region?: Region) { await env.DB.prepare("INSERT INTO audit_logs(region,event_type,detail) VALUES(?,?,?)").bind(region ?? null, event, detail.slice(0, 1000)).run(); }
async function reserveOcrSpaceUsage(env: Env, region: Region) {
  await env.DB.prepare("INSERT OR IGNORE INTO daily_usage(usage_date,region,provider) VALUES(?,?,'ocrspace')")
    .bind(today(), region).run();
  const reserved = await env.DB.prepare("UPDATE daily_usage SET request_count=request_count+1 WHERE usage_date=? AND region=? AND provider='ocrspace' AND request_count<?")
    .bind(today(), region, OCRSPACE_DAILY_LIMIT).run();
  return (reserved.meta.changes ?? 0) === 1;
}
async function recordOcrSpaceOutcome(env: Env, region: Region, success: boolean) {
  await env.DB.prepare(`UPDATE daily_usage SET
      success_count=success_count+?,
      error_count=error_count+?
    WHERE usage_date=? AND region=? AND provider='ocrspace'`)
    .bind(success ? 1 : 0, success ? 0 : 1, today(), region).run();
}
async function lineCall(token: string, endpoint: string, body: unknown, retryKey?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  if (retryKey) headers["x-line-retry-key"] = retryKey;
  const response = await fetch(`https://api.line.me/v2/bot/${endpoint}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`LINE ${endpoint}: ${response.status}`);
}
async function pushPass(token: string, to: string, job: string, retryKey: string) {
  await lineCall(token, "message/push", { to, messages: [{ type: "flex", altText: `งาน ${job}: ผ่าน`, contents: { type: "bubble", body: { type: "box", layout: "vertical", contents: [{ type: "text", text: "ตรวจสอบผ่าน", weight: "bold", size: "xl", color: "#16803c" }, { type: "text", text: `เลขงาน ${job}`, margin: "md" }] } } }] }, retryKey);
}
async function validSignature(raw: string, signature: string | null, secret: string) { return Boolean(signature) && await safeEqual(await hmac(raw, secret), signature!); }

export function imageSetMetadata(event: LineEvent) {
  const imageSet = event.message?.imageSet;
  return {
    id: typeof imageSet?.id === "string" ? imageSet.id : null,
    index: Number.isInteger(imageSet?.index) ? imageSet!.index! : null,
    total: Number.isInteger(imageSet?.total) ? imageSet!.total! : null
  };
}

async function webhook(request: Request, env: Env, region: Region) {
  let c: RegionConfig;
  try { c = await config(env, region); } catch { return json({ error: "control secrets not initialized" }, 503); }
  if (!c.enabled || !c.lineSecret || !c.lineToken || !c.ocrKey) return json({ error: "region is not configured" }, 503);
  const raw = await request.text();
  if (!(await validSignature(raw, request.headers.get("x-line-signature"), c.lineSecret))) { await audit(env, "signature_invalid", "LINE signature rejected", region); return new Response("Unauthorized", { status: 401 }); }
  const payload = JSON.parse(raw) as { events?: LineEvent[] };
  for (const event of payload.events ?? []) {
    if (event.type !== "message" || !event.source?.userId) continue;
    const userId = event.source.userId;
    if (event.message?.type === "text") {
      const job = String(event.message.text ?? "").trim();
      if (!/^\d{8}$/.test(job)) continue;
      const id = crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO user_jobs(
          id,region,line_user_id,job_number,status,expires_at,reference_set_at
        ) VALUES(?,?,?,?, 'collecting',datetime('now',?),strftime('%Y-%m-%d %H:%M:%f','now'))
        ON CONFLICT(region,line_user_id,job_number) DO UPDATE SET
          status=CASE WHEN user_jobs.expires_at <= CURRENT_TIMESTAMP THEN 'collecting' ELSE user_jobs.status END,
          pass_claimed_at=CASE WHEN user_jobs.expires_at <= CURRENT_TIMESTAMP THEN NULL ELSE user_jobs.pass_claimed_at END,
          pass_claim_token=CASE WHEN user_jobs.expires_at <= CURRENT_TIMESTAMP THEN NULL ELSE user_jobs.pass_claim_token END,
          pass_sent_at=CASE WHEN user_jobs.expires_at <= CURRENT_TIMESTAMP THEN NULL ELSE user_jobs.pass_sent_at END,
          expires_at=datetime('now',?),
          reference_set_at=strftime('%Y-%m-%d %H:%M:%f','now'),
          updated_at=CURRENT_TIMESTAMP`)
        .bind(id, region, userId, job, `+${JOB_REFERENCE_MINUTES} minutes`, `+${JOB_REFERENCE_MINUTES} minutes`).run();
      await audit(env, "job_received", job, region);
      continue;
    }
    if (event.message?.type !== "image" || !event.message.id) continue;
    const parent = await env.DB.prepare("SELECT id,job_number FROM user_jobs WHERE region=? AND line_user_id=? AND expires_at>CURRENT_TIMESTAMP ORDER BY reference_set_at DESC,rowid DESC LIMIT 1")
      .bind(region, userId).first<ActiveUserJob>();
    if (!parent) {
      await audit(env, "image_ignored_no_active_job", event.message.id, region);
      continue;
    }
    const messageId = event.message.id;
    const id = crypto.randomUUID();
    const r2Key = `${region}/${today()}/${id}.jpg`;
    const imageSet = imageSetMetadata(event);
    const inserted = await env.DB.prepare(`INSERT INTO slip_jobs(
        id,region,parent_job_id,line_message_id,line_user_id,r2_key,
        image_set_id,image_set_index,image_set_total
      ) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(region,line_message_id) DO NOTHING`)
      .bind(id, region, parent.id, messageId, userId, r2Key, imageSet.id, imageSet.index, imageSet.total).run();
    if ((inserted.meta.changes ?? 0) !== 1) {
      const duplicate = await env.DB.prepare("SELECT id,status FROM slip_jobs WHERE region=? AND line_message_id=?")
        .bind(region, messageId).first<{ id: string; status: string }>();
      if (duplicate?.status === "queued") {
        await env.OCR_JOBS.send({ id: duplicate.id, region });
      }
      await audit(env, "image_duplicate_ignored", messageId, region);
      continue;
    }
    await env.OCR_JOBS.send({ id, region });
    await audit(env, "image_queued", `${parent.job_number}${imageSet.total ? ` รูป ${imageSet.index ?? "?"}/${imageSet.total}` : ""}`, region);
  }
  return new Response("OK");
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

export function analyzeOcr(text: string): OcrAnalysis {
  const normalized = normalizeOcrText(text);
  const foundKplus =
    /\bKPLUS\b/.test(normalized) ||
    /(?:^|[^A-Z0-9])K\s*\+(?:[^A-Z0-9]|$)/.test(normalized) ||
    /\b(?:THAI\s*QR(?:\s*PAYMENT)?|QR\s*PAYMENT)\b/.test(normalized);
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
  return { result: "needs_fallback", foundKplus, foundSettlement, matchedAmount, detectedAmounts, reason: "พบ KPLUS และ SETTLEMENT แต่ไม่พบยอด 1.22 หรือ -1.22" };
}
export function classify(text: string) { return analyzeOcr(text).result; }

async function deliverPass(env: Env, row: SlipProcessRow, token: string) {
  if (row.pass_sent_at) return;
  const claimToken = crypto.randomUUID();
  const claimed = await env.DB.prepare(`UPDATE user_jobs SET
      status='pass_claimed',
      pass_claimed_at=CURRENT_TIMESTAMP,
      pass_claim_token=?
    WHERE id=? AND pass_sent_at IS NULL AND (
      pass_claimed_at IS NULL OR
      pass_claimed_at<datetime('now',?)
    )`)
    .bind(claimToken, row.parent_job_id, `-${PASS_CLAIM_MINUTES} minutes`).run();
  if ((claimed.meta.changes ?? 0) !== 1) {
    const state = await env.DB.prepare("SELECT pass_sent_at FROM user_jobs WHERE id=?")
      .bind(row.parent_job_id).first<{ pass_sent_at: string | null }>();
    if (state?.pass_sent_at) return;
    throw new Error("pass delivery claim is busy");
  }
  try {
    await pushPass(token, row.line_user_id, row.job_number, row.parent_job_id);
    await env.DB.batch([
      env.DB.prepare("UPDATE user_jobs SET status='passed',pass_sent_at=CURRENT_TIMESTAMP,pass_claimed_at=NULL,pass_claim_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND pass_claim_token=?")
        .bind(row.parent_job_id, claimToken),
      env.DB.prepare("UPDATE slip_jobs SET replied_at=CURRENT_TIMESTAMP WHERE id=? AND replied_at IS NULL")
        .bind(row.id)
    ]);
  } catch (error) {
    await env.DB.prepare("UPDATE user_jobs SET status='collecting',pass_claimed_at=NULL,pass_claim_token=NULL WHERE id=? AND pass_claim_token=? AND pass_sent_at IS NULL")
      .bind(row.parent_job_id, claimToken).run();
    throw error;
  }
}

async function processJob(env: Env, data: { id: string; region: Region }) {
  const row = await env.DB.prepare("SELECT s.*,u.job_number,u.pass_sent_at FROM slip_jobs s JOIN user_jobs u ON u.id=s.parent_job_id WHERE s.id=? AND s.region=?")
    .bind(data.id, data.region).first<SlipProcessRow>();
  if (!row) return;
  const c = await config(env, data.region); if (!c.enabled || !c.ocrKey || !c.lineToken) throw new Error("region configuration unavailable");
  if (row.status === "passed" && !row.pass_sent_at) {
    await deliverPass(env, row, c.lineToken);
    return;
  }
  if (row.status !== "queued") return;
  if (row.pass_sent_at) {
    await env.DB.prepare("UPDATE slip_jobs SET status='suppressed',result='silent',decision_reason='งานนี้แจ้งผลผ่านไปแล้ว จึงไม่ตรวจซ้ำ',updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(row.id).run();
    await audit(env, "ocr_suppressed_after_pass", row.job_number, data.region);
    return;
  }
  let imageBytes: ArrayBuffer;
  const object = await env.SLIPS.get(row.r2_key);
  if (object && "body" in object && object.body) {
    imageBytes = await new Response(object.body).arrayBuffer();
  } else {
    const content = await fetch(`https://api-data.line.me/v2/bot/message/${row.line_message_id}/content`, {
      headers: { authorization: `Bearer ${c.lineToken}` }
    });
    if (!content.ok) {
      await audit(env, "line_image_download_failed", `${row.job_number}: HTTP ${content.status}`, data.region);
      throw new Error(`LINE image download failed: HTTP ${content.status}`);
    }
    imageBytes = await content.arrayBuffer();
    await env.SLIPS.put(row.r2_key, imageBytes, {
      httpMetadata: { contentType: content.headers.get("content-type") ?? "image/jpeg" }
    });
  }
  const form = new FormData();
  form.append("apikey", c.ocrKey); form.append("language", "eng"); form.append("isOverlayRequired", "false");
  form.append("file", new Blob([imageBytes]), "slip.jpg");
  if (!(await reserveOcrSpaceUsage(env, data.region))) {
    await env.DB.prepare("UPDATE slip_jobs SET status='quota_exhausted',result='needs_fallback',ocr_provider='ocrspace',decision_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(`OCR.space ของภูมิภาคนี้ครบ ${OCRSPACE_DAILY_LIMIT} รูปต่อวัน`, row.id).run();
    await audit(env, "ocr_quota_exhausted", row.job_number, data.region);
    return;
  }
  const response = await fetch("https://api.ocr.space/parse/image", { method: "POST", body: form });
  const payload = await response.json<any>().catch(() => ({}));
  const text = (payload.ParsedResults ?? []).map((v: any) => v.ParsedText ?? "").join("\n");
  const succeeded = response.ok && !payload.IsErroredOnProcessing;
  await recordOcrSpaceOutcome(env, data.region, succeeded);
  if (!succeeded) {
    const errorDetail = String(payload.ErrorMessage ?? response.status);
    await env.DB.prepare("UPDATE slip_jobs SET status='ocr_error',ocr_provider='ocrspace',ocr_text=?,decision_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(errorDetail.slice(0, 10000), `OCR.space ผิดพลาด: ${errorDetail}`.slice(0, 1000), row.id).run();
    await audit(env, "ocr_error", errorDetail, data.region);
    return;
  }
  const analysis = analyzeOcr(text);
  await env.DB.prepare("UPDATE slip_jobs SET status=?,ocr_provider='ocrspace',ocr_text=?,result=?,found_kplus=?,found_settlement=?,matched_amount=?,detected_amounts=?,decision_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(analysis.result, text.slice(0, 10000), analysis.result, analysis.foundKplus ? 1 : 0, analysis.foundSettlement ? 1 : 0, analysis.matchedAmount, JSON.stringify(analysis.detectedAmounts), analysis.reason, row.id).run();
  if (analysis.result === "passed") {
    await deliverPass(env, row, c.lineToken);
  }
  await audit(env, `ocr_${analysis.result}`, row.job_number, data.region);
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
    .field{display:block;margin-top:11px}.field-label{display:flex;justify-content:space-between;margin:0 2px 6px;font-size:12px;font-weight:700}.field-state{color:var(--muted);font-weight:500}
    input[type=text],input[type=password]{width:100%;padding:12px 13px;border:1px solid var(--line);border-radius:13px;outline:0;background:#fff;color:var(--ink);transition:.18s;box-shadow:0 2px 4px rgba(45,39,65,.025)}
    input[type=text]:focus,input[type=password]:focus{border-color:#b28af2;box-shadow:0 0 0 4px rgba(139,92,246,.1)}
    .save-region{width:100%;margin-top:17px;padding:12px 16px;border:0;border-radius:14px;color:white;font-weight:800;cursor:pointer;background:linear-gradient(100deg,#342d48 0%,#5a487c 45%,#8b5cf6 100%);box-shadow:0 10px 23px rgba(76,58,114,.2);transition:.18s}
    .save-region:hover{transform:translateY(-1px);box-shadow:0 13px 28px rgba(76,58,114,.28)}.save-region:disabled{opacity:.65;cursor:wait}
    .loading{grid-column:1/-1;text-align:center;padding:48px;border-radius:25px;background:rgba(255,255,255,.7);color:var(--muted)}
    .spinner{display:inline-block;width:25px;height:25px;margin-bottom:8px;border:3px solid #e8def7;border-top-color:var(--purple);border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
    .toast{position:fixed;right:22px;bottom:22px;z-index:20;padding:13px 17px;border-radius:14px;color:white;background:#342d48;box-shadow:0 14px 34px rgba(45,39,65,.25);opacity:0;transform:translateY(15px);pointer-events:none;transition:.25s}.toast.show{opacity:1;transform:none}.toast.error{background:#b94561}
    .log-panel{padding:20px;border:1px solid rgba(255,255,255,.92);border-radius:25px;background:rgba(255,255,255,.82);box-shadow:0 16px 40px rgba(73,55,108,.09);backdrop-filter:blur(14px)}
    .log-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:16px}.log-tabs{display:flex;flex-wrap:wrap;gap:8px}.log-tab,.refresh-logs{padding:9px 13px;border:1px solid var(--line);border-radius:999px;background:white;color:var(--ink);font-weight:750;cursor:pointer}.log-tab.active{border-color:transparent;color:white;background:linear-gradient(100deg,var(--pink),var(--purple));box-shadow:0 7px 18px rgba(139,92,246,.2)}.refresh-logs{border-radius:12px}
    .log-list{display:grid;gap:11px}.log-row{padding:16px;border:1px solid var(--line);border-radius:18px;background:#fff}.log-main{display:grid;grid-template-columns:minmax(105px,.8fr) minmax(115px,.9fr) minmax(100px,.8fr) minmax(0,2.5fr);gap:13px;align-items:center}.log-cell small{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.45px}.log-cell strong{display:block;margin-top:2px;font-size:13px;overflow-wrap:anywhere}.status-pill{display:inline-flex!important;width:max-content;padding:5px 9px;border-radius:999px}.status-passed{color:#167b59;background:#e7f7f0}.status-silent{color:#756b85;background:#f1eef5}.status-fallback{color:#a86618;background:#fff2dc}.status-error{color:#ae3c57;background:#ffe8ee}.status-queued{color:#6652a2;background:#eee9ff}
    .log-facts{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.fact{padding:5px 8px;border-radius:9px;background:#f8f5fb;color:#5f5770;font-size:11px}.fact.yes{color:#167b59;background:#eaf8f2}.fact.no{color:#ad4059;background:#fff0f3}.ocr-detail{margin-top:11px;color:var(--muted);font-size:12px}.ocr-detail summary{cursor:pointer;font-weight:700;color:#6e518e}.ocr-text{margin:8px 0 0;padding:11px;border-radius:11px;background:#f8f6fb;white-space:pre-wrap;overflow-wrap:anywhere}.empty-logs{text-align:center;padding:44px;color:var(--muted)}
    @media(max-width:760px){.shell{width:min(100% - 20px,1180px);padding-top:16px}.hero{padding:23px;border-radius:24px}.hero:after{font-size:80px}.summary{grid-template-columns:1fr}.grid{grid-template-columns:1fr}.region-card:last-child:nth-child(odd){grid-column:auto}.section-head{align-items:start;flex-direction:column}.secure-note{align-self:flex-start}.log-toolbar{align-items:stretch;flex-direction:column}.refresh-logs{width:100%}.log-main{grid-template-columns:1fr 1fr}.log-cell.reason{grid-column:1/-1}}
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div class="brand"><div class="brand-icon">✦</div><div><h1>Kplusall <span class="gradient-text">Control</span></h1><p class="subtitle">ศูนย์จัดการ LINE OA และ OCR.space สำหรับทั้ง 5 ภูมิภาค</p></div></div>
      <div class="summary">
        <div class="summary-item"><span class="summary-value">5</span><span class="summary-label">ภูมิภาคทั้งหมด</span></div>
        <div class="summary-item"><span class="summary-value" id="active-count">—</span><span class="summary-label">กำลังเปิดใช้งาน</span></div>
        <div class="summary-item"><span class="summary-value" id="ready-count">—</span><span class="summary-label">ตั้งค่าครบพร้อมใช้</span></div>
      </div>
    </section>
    <div class="section-head"><div><h2>ตั้งค่าระบบแต่ละภูมิภาค</h2><p>กรอกเฉพาะค่าที่ต้องการเปลี่ยน ค่าเดิมจะไม่ถูกแสดงกลับมา</p></div><div class="secure-note">🔒 Secret เข้ารหัสแล้ว</div></div>
    <section class="grid" id="app"><div class="loading"><span class="spinner"></span><br>กำลังโหลดข้อมูล...</div></section>
    <div class="section-head"><div><h2>ประวัติการตรวจ OCR</h2><p>แสดง 50 รายการล่าสุดของแต่ละภาค และเก็บข้อมูลย้อนหลัง 30 วัน</p></div><div class="secure-note">🔄 อัปเดตทุก 30 วินาที</div></div>
    <section class="log-panel">
      <div class="log-toolbar"><div class="log-tabs" id="log-tabs"></div><button class="refresh-logs" id="refresh-logs">รีเฟรช Log</button></div>
      <div class="log-list" id="log-list"><div class="empty-logs"><span class="spinner"></span><br>กำลังโหลด Log...</div></div>
    </section>
  </main>
  <div class="toast" id="toast"></div>
  <script>
    const regions=['north','central','isan','south','bangkok'];
    const meta={north:{name:'ภาคเหนือ',icon:'⛰️'},central:{name:'ภาคกลาง',icon:'🌾'},isan:{name:'ภาคอีสาน',icon:'☀️'},south:{name:'ภาคใต้',icon:'🌊'},bangkok:{name:'กรุงเทพฯ',icon:'🏙️'}};
    const app=document.querySelector('#app');
    const logList=document.querySelector('#log-list');
    const logTabs=document.querySelector('#log-tabs');
    let activeLogRegion='north';
    function notify(text,error=false){const toast=document.querySelector('#toast');toast.textContent=text;toast.className='toast show'+(error?' error':'');setTimeout(()=>toast.className='toast',2600)}
    function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]))}
    function formatTime(value){if(!value)return '—';const date=new Date(String(value).replace(' ','T')+'Z');return Number.isNaN(date.getTime())?value:date.toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'})}
    function statusInfo(item){const key=item.status==='quota_exhausted'?'quota_exhausted':(item.result||item.status);return {passed:['ผ่าน','status-passed'],silent:['เงียบ','status-silent'],needs_fallback:['รอ OCR สำรอง','status-fallback'],quota_exhausted:['OCR ครบโควตา','status-fallback'],ocr_error:['OCR ผิดพลาด','status-error'],download_error:['โหลดรูปผิดพลาด','status-error'],suppressed:['หยุดหลังพบรูปผ่าน','status-silent'],queued:['รอตรวจ','status-queued']}[key]||[key||'ไม่ทราบ','status-queued']}
    function fact(label,value){const state=value===null?'':(value?' yes':' no');const text=value===null?'—':(value?'พบ':'ไม่พบ');return '<span class="fact'+state+'">'+label+': '+text+'</span>'}
    function field(region,id,label,placeholder,isSet){return '<label class="field"><span class="field-label"><span>'+label+'</span><span class="field-state">'+(isSet?'ตั้งค่าแล้ว ✓':'ยังไม่ตั้ง')+'</span></span><input type="text" autocomplete="off" id="'+id+'-'+region+'" placeholder="'+placeholder+'"></label>'}
    async function load(){
      const response=await fetch('/admin/api/config');
      if(!response.ok){location='/admin';return}
      const data=await response.json();
      const active=data.filter(item=>item.enabled).length;
      const ready=data.filter(item=>item.hasLineSecret&&item.hasLineToken&&item.hasOcrKey).length;
      document.querySelector('#active-count').textContent=String(active);
      document.querySelector('#ready-count').textContent=String(ready);
      app.innerHTML=regions.map(region=>{
        const item=data.find(value=>value.region===region)||{enabled:false};
        const complete=Boolean(item.hasLineSecret&&item.hasLineToken&&item.hasOcrKey);
        return '<article class="region-card"><div class="card-head"><div class="region-title"><div class="region-icon">'+meta[region].icon+'</div><div><div class="region-name">'+meta[region].name+'</div><div class="region-code">'+region+'</div></div></div><span class="badge '+(complete?'ready':'incomplete')+'">'+(complete?'พร้อมใช้งาน':'ตั้งค่าไม่ครบ')+'</span></div><div class="toggle-row"><div class="toggle-label"><strong>เปิดใช้งานภูมิภาคนี้</strong><span>รับ Webhook และประมวลผล OCR</span></div><label class="switch"><input type="checkbox" id="e-'+region+'" '+(item.enabled?'checked':'')+'><span class="slider"></span></label></div>'+field(region,'s','LINE Channel Secret','ใส่เมื่อสร้างหรือเปลี่ยน Secret',item.hasLineSecret)+field(region,'t','LINE Channel Access Token','ใส่เมื่อสร้างหรือเปลี่ยน Token',item.hasLineToken)+field(region,'o','OCR.space API Key','ใส่ API Key ของภูมิภาคนี้',item.hasOcrKey)+'<button class="save-region" data-region="'+region+'">บันทึก '+meta[region].name+'</button></article>'
      }).join('');
      document.querySelectorAll('.save-region').forEach(button=>button.addEventListener('click',()=>save(button.dataset.region,button)));
    }
    async function save(region,button){
      button.disabled=true;button.textContent='กำลังบันทึก...';
      const body={region,enabled:document.querySelector('#e-'+region).checked,lineSecret:document.querySelector('#s-'+region).value,lineToken:document.querySelector('#t-'+region).value,ocrKey:document.querySelector('#o-'+region).value};
      const response=await fetch('/admin/api/config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      if(response.ok){notify('บันทึก '+meta[region].name+' เรียบร้อยแล้ว');await load()}else{let message='บันทึกไม่สำเร็จ (HTTP '+response.status+')';try{const result=await response.json();if(result&&result.error)message=result.error}catch{}notify(message,true);button.disabled=false;button.textContent='บันทึก '+meta[region].name}
    }
    function renderLogs(items){
      if(!items.length){logList.innerHTML='<div class="empty-logs">ยังไม่มีประวัติการตรวจของ '+meta[activeLogRegion].name+'</div>';return}
      logList.innerHTML=items.map(item=>{
        const status=statusInfo(item);const amounts=item.matchedAmount||((item.detectedAmounts||[]).join(', '))||'ไม่พบ';
        const detail=item.ocrExcerpt?'<details class="ocr-detail"><summary>ดูข้อความ OCR บางส่วน</summary><pre class="ocr-text">'+escapeHtml(item.ocrExcerpt)+'</pre></details>':'';
        const imageSet=item.imageSetTotal?'<span class="fact">รูปในชุด: '+escapeHtml((item.imageSetIndex??'?')+'/'+item.imageSetTotal)+'</span>':'';
        return '<article class="log-row"><div class="log-main"><div class="log-cell"><small>เวลา</small><strong>'+escapeHtml(formatTime(item.updatedAt))+'</strong></div><div class="log-cell"><small>เลขงาน</small><strong>'+escapeHtml(item.jobNumber)+'</strong></div><div class="log-cell"><small>ผล</small><strong class="status-pill '+status[1]+'">'+escapeHtml(status[0])+'</strong></div><div class="log-cell reason"><small>เหตุผล</small><strong>'+escapeHtml(item.reason||'กำลังรอประมวลผล')+'</strong></div></div><div class="log-facts"><span class="fact">ตรวจด้วย: '+escapeHtml(item.provider==='ocrspace'?'OCR.space':(item.provider||'รอระบุ'))+'</span>'+imageSet+fact('KPLUS/K+',item.foundKplus)+fact('SETTLEMENT',item.foundSettlement)+'<span class="fact">ยอดที่พบ: '+escapeHtml(amounts)+'</span></div>'+detail+'</article>'
      }).join('')
    }
    async function loadLogs(){
      logList.innerHTML='<div class="empty-logs"><span class="spinner"></span><br>กำลังโหลด Log...</div>';
      const response=await fetch('/admin/api/logs?region='+encodeURIComponent(activeLogRegion));
      if(response.status===401){location='/admin';return}
      if(!response.ok)throw new Error('โหลด Log ไม่สำเร็จ');
      renderLogs(await response.json())
    }
    logTabs.innerHTML=regions.map(region=>'<button class="log-tab '+(region===activeLogRegion?'active':'')+'" data-log-region="'+region+'">'+meta[region].name+'</button>').join('');
    logTabs.querySelectorAll('.log-tab').forEach(button=>button.addEventListener('click',async()=>{activeLogRegion=button.dataset.logRegion;logTabs.querySelectorAll('.log-tab').forEach(tab=>tab.classList.toggle('active',tab===button));try{await loadLogs()}catch{notify('โหลด Log ไม่สำเร็จ',true)}}));
    document.querySelector('#refresh-logs').addEventListener('click',()=>loadLogs().catch(()=>notify('โหลด Log ไม่สำเร็จ',true)));
    load().catch(()=>{app.innerHTML='<div class="loading">โหลดข้อมูลไม่สำเร็จ กรุณารีเฟรชหน้าอีกครั้ง</div>';notify('โหลดข้อมูลไม่สำเร็จ',true)});
    loadLogs().catch(()=>{logList.innerHTML='<div class="empty-logs">โหลด Log ไม่สำเร็จ กรุณารีเฟรชอีกครั้ง</div>';notify('โหลด Log ไม่สำเร็จ',true)});
    setInterval(()=>loadLogs().catch(()=>{}),30000);
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
async function admin(request: Request, env: Env, url: URL) {
  if (!env.ADMIN_PASSWORD || !env.CONFIG_ENCRYPTION_KEY) return new Response("Admin setup required: set ADMIN_PASSWORD and CONFIG_ENCRYPTION_KEY as Worker Secrets.", { status: 503 });
  if (url.pathname === "/admin/login" && request.method === "POST") { const form = await request.formData(); if (!(await safeEqual(String(form.get("password") ?? ""), env.ADMIN_PASSWORD))) return new Response("Unauthorized", { status: 401 }); const payload = `${Date.now() + 8 * 3600_000}`; const token = `${b64(enc.encode(payload))}.${await hmac(payload, env.CONFIG_ENCRYPTION_KEY)}`; return new Response(null, { status: 303, headers: { location: "/admin", "set-cookie": `kplusall_admin=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800` } }); }
  const token = cookie(request, "kplusall_admin"); const [body, sig] = token?.split(".") ?? []; const payload = body ? dec.decode(unb64(body)) : "";
  if (!sig || !(await safeEqual(sig, await hmac(payload, env.CONFIG_ENCRYPTION_KEY))) || Number(payload) < Date.now()) return new Response(loginHtml(), { status: 401, headers: { "content-type": "text/html; charset=utf-8" } });
  if (url.pathname === "/admin/api/config" && request.method === "GET") { const rows = await env.DB.prepare("SELECT region,enabled,line_channel_secret,line_channel_token,ocrspace_api_key FROM region_config ORDER BY region").all<RegionConfigRow>(); return json(rows.results.map((r) => ({ region:r.region, enabled:Boolean(r.enabled), hasLineSecret:Boolean(r.line_channel_secret), hasLineToken:Boolean(r.line_channel_token), hasOcrKey:Boolean(r.ocrspace_api_key) }))); }
  if (url.pathname === "/admin/api/logs" && request.method === "GET") {
    const region = url.searchParams.get("region") ?? "north";
    if (!isRegion(region)) return json({ error:"invalid region" }, 400);
    const rows = await env.DB.prepare("SELECT s.id,s.region,u.job_number,s.status,s.ocr_provider,s.result,s.found_kplus,s.found_settlement,s.matched_amount,s.detected_amounts,s.decision_reason,substr(s.ocr_text,1,500) AS ocr_excerpt,s.image_set_id,s.image_set_index,s.image_set_total,s.created_at,s.updated_at FROM slip_jobs s JOIN user_jobs u ON u.id=s.parent_job_id WHERE s.region=? ORDER BY s.created_at DESC LIMIT 50")
      .bind(region).all<OcrLogRow>();
    return json(rows.results.map((row) => ({
      id: row.id,
      region: row.region,
      jobNumber: row.job_number,
      status: row.status,
      provider: row.ocr_provider,
      result: row.result,
      foundKplus: row.found_kplus === null ? null : Boolean(row.found_kplus),
      foundSettlement: row.found_settlement === null ? null : Boolean(row.found_settlement),
      matchedAmount: row.matched_amount,
      detectedAmounts: decodeAmounts(row.detected_amounts),
      reason: row.decision_reason,
      ocrExcerpt: row.ocr_excerpt,
      imageSetId: row.image_set_id,
      imageSetIndex: row.image_set_index,
      imageSetTotal: row.image_set_total,
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
    if (url.pathname.startsWith("/webhook/")) { const region = url.pathname.split("/")[2]; if (!isRegion(region) || request.method !== "POST") return new Response("Not Found", { status:404 }); return webhook(request, env, region); }
    if (url.pathname.startsWith("/admin")) return admin(request, env, url);
    if (url.pathname === "/health") return json({ ok:true, service:"kplusall" });
    return new Response("Kplusall Worker", { status:200 });
  },
  async queue(batch, env) { for (const message of batch.messages) { try { await processJob(env, message.body as { id:string; region:Region }); message.ack(); } catch (error) { await audit(env,"queue_error",error instanceof Error ? error.message : String(error)); message.retry(); } } },
  async scheduled(_controller, env, ctx) { ctx.waitUntil(cleanupOldLogs(env)); }
} satisfies ExportedHandler<Env>;
